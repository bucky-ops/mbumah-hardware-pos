// GET  /api/health/retention
// POST /api/health/retention
//
// Phase 7 — Data Retention Management endpoint (ISO 27001 A.8.3.2 / ISO 9001 7.5.3).
//
// GET (any authenticated user):
//   Returns the current retention policies AND metrics for the MBUMAH HARDWARE
//   POS system. This is the "data lifecycle observability" view — it shows
//   which data categories have retention policies, how many records are
//   eligible for purge, and when the last auto-purge ran.
//
//   The response also includes a `purgeableEstimate` field from the dry-run
//   estimation, so operators can see exactly how many records per category
//   would be deleted if a purge were executed now — WITHOUT actually deleting
//   anything.
//
//   Response 200:
//     {
//       "success": true,
//       "data": {
//         "metrics": {
//           "totalPolicies": 6,
//           "autoPurgeEnabled": 6,
//           "estimatedPurgeableRecords": 142,
//           "policies": [ ... ],
//           "lastExecutionAt": "2026-..."
//         },
//         "purgeableEstimate": {
//           "system_logs": 87,
//           "audit_logs": 0,
//           "dead_letter_queue_completed": 12,
//           "dead_letter_queue_dead": 3,
//           "security_events": 0,
//           "sessions": 40
//         }
//       },
//       "requestId": "...",
//       "timestamp": "..."
//     }
//
// POST (SUPER_ADMIN only):
//   Administrative actions to manage data retention purging. Useful for:
//     • Dry-run: preview how many records WOULD be purged across all
//       categories, without actually deleting anything. This lets an
//       admin verify the impact before committing.
//     • Execute: actually run the retention purge for all categories.
//       This deletes expired records (past retention + grace period)
//       permanently. This action is IRREVERSIBLE.
//
//   Body:
//     { "action": "dryRun" | "execute" }
//
//   Response 200 (dryRun):
//     {
//       "success": true,
//       "data": {
//         "action": "dryRun",
//         "estimate": {
//           "system_logs": 87,
//           "audit_logs": 0,
//           ...
//         },
//         "totalPurgeable": 142,
//         "message": "Dry run complete. No data was deleted."
//       }
//     }
//
//   Response 200 (execute):
//     {
//       "success": true,
//       "data": {
//         "action": "execute",
//         "results": [
//           { "category": "system_logs", "purged": 87, "success": true },
//           ...
//         ],
//         "totalPurged": 142,
//         "message": "Retention purge executed across 6 categories."
//       }
//     }
//
// ── Security considerations ────────────────────────────────────────────────────
//
// Both GET and POST require authentication. The POST action (which can
// permanently delete data) is restricted to SUPER_ADMIN only. Every POST
// action is audit-logged via systemLog for ISO 27001 A.12.4.1 compliance
// (event logging) and post-incident investigation.

import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorFromThrown } from '@/lib/api-response';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { dataRetention } from '@/lib/data-retention';

export const dynamic = 'force-dynamic';

// ── GET: retention policies + metrics ────────────────────────────────────────

export const GET = requireAuth(async (_request, _session) => {
  try {
    // ── Fetch retention metrics ──────────────────────────────────────────
    // getMetrics() returns the full policy list, total counts, and
    // the last execution timestamp. It internally calls estimatePurgeable()
    // to compute the aggregate purgeable record count.
    const metrics = await dataRetention.getMetrics();

    // ── Fetch per-category purgeable estimate ────────────────────────────
    // This gives the operator a breakdown of exactly how many records
    // per category are eligible for purge RIGHT NOW. It's a count-only
    // operation — no data is modified.
    const purgeableEstimate = await dataRetention.estimatePurgeable();

    return successResponse({
      metrics,
      purgeableEstimate,
    });
  } catch (err) {
    return errorFromThrown(err, { context: 'RETENTION_METRICS' });
  }
});

// ── POST: admin actions (SUPER_ADMIN only) ───────────────────────────────────

type RetentionAction = 'dryRun' | 'execute';

interface RetentionBody {
  action: RetentionAction;
}

const VALID_ACTIONS = new Set<RetentionAction>(['dryRun', 'execute']);

export const POST = requireAuth(
  async (_request: NextRequest, session) => {
    try {
      const body = (await _request.json()) as RetentionBody;

      // ── Validate action ─────────────────────────────────────────────────
      if (!body.action || !VALID_ACTIONS.has(body.action)) {
        return Response.json(
          {
            success: false,
            error: `Invalid action. Must be one of: ${Array.from(VALID_ACTIONS).join(', ')}.`,
          },
          { status: 400 },
        );
      }

      const action = body.action;

      // ── dryRun: estimate purgeable records without deleting ─────────────
      // Returns a per-category breakdown so the admin can verify the
      // impact before committing. This is the "measure twice, cut once"
      // approach mandated by ISO 9001 10.2 (nonconformity and corrective
      // action) — we preview the effect before applying irreversible changes.
      if (action === 'dryRun') {
        const estimate = await dataRetention.estimatePurgeable();
        const totalPurgeable = Object.values(estimate).reduce(
          (sum, v) => sum + Math.max(0, v),
          0,
        );

        // Audit-log the dry-run request for traceability
        await logRetentionAction(session.userId, action, 0, { estimate, totalPurgeable });

        return successResponse({
          action,
          estimate,
          totalPurgeable,
          message: 'Dry run complete. No data was deleted.',
        });
      }

      // ── execute: actually purge expired records ────────────────────────
      // This is the IRREVERSIBLE operation. It iterates through every
      // retention policy category and deletes records that are past the
      // retention period + grace period. Each category result is returned
      // so the admin can verify what was purged.
      if (action === 'execute') {
        const results = await dataRetention.executeAll();
        const totalPurged = results.reduce((sum, r) => sum + r.purged, 0);
        const failedCategories = results.filter((r) => !r.success);

        // Audit-log the execution — this is a CRITICAL operation that
        // permanently deletes data, so we log at WARN severity (or ERROR
        // if any categories failed).
        const severity = failedCategories.length > 0
          ? LogSeverity.ERROR
          : LogSeverity.WARN;

        await logRetentionAction(session.userId, action, totalPurged, {
          results,
          totalPurged,
          failedCategories: failedCategories.length,
        }, severity);

        return successResponse({
          action,
          results,
          totalPurged,
          message: `Retention purge executed across ${results.length} categories.`,
        });
      }

      // Should be unreachable (VALID_ACTIONS check above), but just in case.
      return Response.json(
        { success: false, error: `Unsupported action: ${action}` },
        { status: 400 },
      );
    } catch (err) {
      return errorFromThrown(err, { context: 'RETENTION_ADMIN' });
    }
  },
  { roles: ['SUPER_ADMIN'] },
);

// ── Audit log helper ─────────────────────────────────────────────────────────
//
// Every admin action on data retention is audit-logged. This creates a
// traceable record of WHO triggered a purge, WHEN, and WHAT was affected —
// required for:
//   • ISO 27001 A.12.4.1 (event logging)
//   • ISO 27001 A.12.4.3 (administrator and operator logs)
//   • ISO 9001 7.5.3 (control of documented information)
//
// Audit logging is best-effort — a logging failure never blocks the admin
// action (the purge has already been committed at this point).

async function logRetentionAction(
  userId: string,
  action: RetentionAction,
  totalAffected: number,
  metadata: Record<string, unknown>,
  severity: LogSeverity = LogSeverity.WARN,
): Promise<void> {
  try {
    await systemLog({
      action: 'DATA_RETENTION_ADMIN',
      component: LogComponent.SYSTEM,
      severity,
      message:
        `Admin triggered "${action}" on data retention policies` +
        (action === 'execute'
          ? ` (${totalAffected} records purged).`
          : ` (${totalAffected} estimated purgeable).`),
      userId,
      metadata: {
        adminAction: action,
        totalAffected,
        ...metadata,
      },
    });
  } catch {
    // Audit logging is best-effort — never block the admin action.
  }
}
