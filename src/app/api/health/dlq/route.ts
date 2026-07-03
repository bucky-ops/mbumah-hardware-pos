// GET  /api/health/dlq
// POST /api/health/dlq
//
// Phase 6 — Dead Letter Queue observability + admin endpoint.
//
// GET (any authenticated user):
//   Returns the current list of DLQ items (with filtering + pagination) AND
//   a metrics summary. This is the "operations dashboard" view — it shows
//   which external service calls (SMS, Email, M-Pesa, Webhooks) are stuck
//   in the dead letter queue, what their status is, and how many retries
//   they've consumed.
//
//   Query params:
//     ?status=DEAD          — filter by item status (PENDING, RETRYING,
//                             COMPLETED, DEAD, CANCELLED)
//     ?targetService=twilio-sms  — filter by target service
//     ?operationType=SEND_SMS    — filter by operation type
//     ?storeId=xxx               — filter by store (multi-tenant)
//     ?limit=50                  — page size (default 50, max 200)
//     ?offset=0                  — page offset (default 0)
//
//   Response 200:
//     {
//       "success": true,
//       "data": {
//         "items": [ ... ],          // DLQ items for current page
//         "total": 27,               // total matching items
//         "metrics": {               // summary across ALL items (not just page)
//           "pending": 5,
//           "retrying": 2,
//           "completed": 8,
//           "dead": 10,
//           "cancelled": 2,
//           "totalEnqueued": 27,
//           "byOperationType": { ... },
//           "byTargetService": { ... },
//           "oldestPendingAt": "2026-..."
//         }
//       },
//       "requestId": "...",
//       "timestamp": "..."
//     }
//
// POST (SUPER_ADMIN only):
//   Administrative actions to manage the DLQ. Useful for:
//     • Retrying a specific item that was marked DEAD (e.g. a failed M-Pesa
//       STK push that the admin wants to manually re-attempt).
//     • Retrying ALL items (or all for a given service) when the admin knows
//       the downstream service has recovered.
//     • Cancelling an item that should never be retried (e.g. a test SMS).
//     • Purging old completed/dead/cancelled items to keep the table tidy.
//
//   Body:
//     { "action": "retry" | "retryAll" | "cancel" | "purge",
//       "id"?: "dlq-item-uuid",                 // required for retry/cancel
//       "targetService"?: "twilio-sms",          // optional filter for retryAll/purge
//       "olderThanDays"?: 7 }                    // for purge (default 7 days)
//
//   Response 200:
//     {
//       "success": true,
//       "data": {
//         "action": "retry",
//         "affected": 1,
//         ...
//       }
//     }

import { type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { successResponse, errorFromThrown } from '@/lib/api-response';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { dlq } from '@/lib/dead-letter-queue';

export const dynamic = 'force-dynamic';

// ── GET: list DLQ items + metrics ─────────────────────────────────────────────

export const GET = requireAuth(async (request: NextRequest, _session) => {
  try {
    const url = request.nextUrl;
    const status = url.searchParams.get('status') || undefined;
    const targetService = url.searchParams.get('targetService') || undefined;
    const operationType = url.searchParams.get('operationType') || undefined;
    const storeId = url.searchParams.get('storeId') || undefined;

    // Parse pagination params — clamp to sane bounds
    const limit = Math.min(
      Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)),
      200,
    );
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    // Fetch the filtered + paginated list of DLQ items
    const { items, total } = await dlq.list({
      status,
      targetService,
      operationType,
      storeId,
      limit,
      offset,
    });

    // Fetch aggregate metrics (across ALL items, not just this page).
    // This gives the dashboard a "big picture" view of queue health.
    const metrics = await dlq.getMetrics({ storeId });

    return successResponse({
      items,
      total,
      limit,
      offset,
      metrics,
    });
  } catch (err) {
    return errorFromThrown(err, { context: 'DLQ_LIST' });
  }
});

// ── POST: admin actions ───────────────────────────────────────────────────────

type AdminAction = 'retry' | 'retryAll' | 'cancel' | 'purge';

interface AdminBody {
  action: AdminAction;
  id?: string;
  targetService?: string;
  olderThanDays?: number;
}

const VALID_ACTIONS = new Set<AdminAction>(['retry', 'retryAll', 'cancel', 'purge']);

export const POST = requireAuth(
  async (request: NextRequest, session) => {
    try {
      const body = (await request.json()) as AdminBody;

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

      // ── retry: retry a single DLQ item by id ────────────────────────────
      // Resets the retry count + status so it gets picked up by the next
      // processor cycle. Useful when an admin knows a specific item can
      // succeed now (e.g. the downstream service was temporarily down).
      if (action === 'retry') {
        if (!body.id) {
          return Response.json(
            {
              success: false,
              error: 'Item "id" is required for action "retry".',
            },
            { status: 400 },
          );
        }

        const ok = await dlq.retryItem(body.id);
        if (!ok) {
          return Response.json(
            {
              success: false,
              error: `DLQ item "${body.id}" not found or cannot be retried (may be RETRYING).`,
              code: 'NOT_FOUND',
            },
            { status: 404 },
          );
        }

        await logAdminAction(session.userId, action, body.id, 1, {
          dlqItemId: body.id,
        });

        return successResponse({
          action,
          id: body.id,
          affected: 1,
          message: `Item "${body.id}" has been reset for retry.`,
        });
      }

      // ── retryAll: re-queue all items (optionally filtered) ──────────────
      // Useful when the admin knows a service has recovered and wants to
      // flush the queue immediately. Both PENDING and DEAD items are
      // re-queued (DEAD items get a second chance).
      if (action === 'retryAll') {
        const count = await dlq.retryAll(body.targetService);

        await logAdminAction(session.userId, action, undefined, count, {
          targetService: body.targetService,
        });

        return successResponse({
          action,
          targetService: body.targetService || 'ALL',
          affected: count,
          message: `${count} item(s) have been re-queued for retry.`,
        });
      }

      // ── cancel: cancel a single DLQ item ────────────────────────────────
      // The item will not be retried. Useful for removing items that should
      // never have been enqueued (e.g. test data, duplicate notifications).
      if (action === 'cancel') {
        if (!body.id) {
          return Response.json(
            {
              success: false,
              error: 'Item "id" is required for action "cancel".',
            },
            { status: 400 },
          );
        }

        const ok = await dlq.cancelItem(body.id);
        if (!ok) {
          return Response.json(
            {
              success: false,
              error: `DLQ item "${body.id}" not found or already completed/cancelled.`,
              code: 'NOT_FOUND',
            },
            { status: 404 },
          );
        }

        await logAdminAction(session.userId, action, body.id, 1, {
          dlqItemId: body.id,
        });

        return successResponse({
          action,
          id: body.id,
          affected: 1,
          message: `Item "${body.id}" has been cancelled.`,
        });
      }

      // ── purge: remove old completed/dead/cancelled items ────────────────
      // Keeps the dead_letter_queue table from growing unboundedly.
      // Only items with a `resolvedAt` older than `olderThanDays` are purged.
      if (action === 'purge') {
        const olderThanDays = body.olderThanDays ?? 7;
        const olderThanMs = olderThanDays * 24 * 60 * 60 * 1000;

        const count = await dlq.purge({
          olderThanMs,
          targetService: body.targetService,
        });

        await logAdminAction(session.userId, action, undefined, count, {
          olderThanDays,
          targetService: body.targetService,
        });

        return successResponse({
          action,
          olderThanDays,
          targetService: body.targetService || 'ALL',
          affected: count,
          message: `${count} item(s) older than ${olderThanDays} day(s) have been purged.`,
        });
      }

      // Should be unreachable (VALID_ACTIONS check above), but just in case.
      return Response.json(
        { success: false, error: `Unsupported action: ${action}` },
        { status: 400 },
      );
    } catch (err) {
      return errorFromThrown(err, { context: 'DLQ_ADMIN' });
    }
  },
  { roles: ['SUPER_ADMIN'] },
);

// ── Audit log helper ──────────────────────────────────────────────────────────
//
// Every admin action on the DLQ is audit-logged. This creates a traceable
// record of WHO did WHAT and WHEN — required for ISO 27001 A.12.4.1
// (event logging) and for post-incident investigation.
//
// Audit logging is best-effort — a logging failure never blocks the admin
// action (the DLQ mutation has already been committed at this point).

async function logAdminAction(
  userId: string,
  action: AdminAction,
  itemId: string | undefined,
  affected: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await systemLog({
      action: 'DLQ_ADMIN',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        `Admin applied "${action}" to ` +
        (itemId ? `DLQ item "${itemId}"` : 'multiple DLQ items') +
        ` (${affected} affected).`,
      userId,
      metadata: {
        adminAction: action,
        dlqItemId: itemId,
        affected,
        ...metadata,
      },
    });
  } catch {
    // Audit logging is best-effort — never block the admin action.
  }
}
