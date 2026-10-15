// GET /api/cron/retention - scheduled execution of the data retention purge.
//
// AUDIT REFERENCE - FINANCIAL_MODULE_AUDIT_REPORT.md (SYS cross-cutting) and
// the ISO 27001 A.8.3.2 / ISO 9001 7.5.3 controls implemented in
// src/lib/data-retention.ts: expired records (past retention + grace period)
// are purged on a schedule instead of being left to a manual admin POST.
//
// DEVIATION NOTE: the audit spec called for `runRetentionPolicies()`, but
// data-retention.ts exports the `dataRetention` singleton whose
// `executeAll()` IS the policy runner - it iterates every policy, catches
// failures PER CATEGORY (including IMMUTABILITY_VIOLATION errors from the
// db.ts immutability guard on append-only models) and records each failure
// in the returned `{ category, purged, success, error }` results, so nothing
// is double-handled here. executeAll() also emits its own
// DATA_RETENTION_EXECUTION systemLog summary.
//
// SCHEDULE NOTE (Vercel Hobby plan): Hobby clamps crons to a daily minimum -
// the nightly "0 3 * * *" expression is fine on every plan.
//
// AUTH: same CRON_SECRET gate as /api/cron/outbox (see that file for the
// full rationale). A cron-triggered purge is attributable to the scheduler
// itself (userId null); executeAll() logs the run to system_logs.

import { runWithoutTenant } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { dataRetention } from '@/lib/data-retention';
import { runHrRetentionSweep } from '@/lib/hr/data-protection';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Purges are deleteMany batches across 6 categories; 60s leaves headroom for
// Neon cold start + large backlog first-run.
export const maxDuration = 60;

async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set - /api/cron/retention accepted an unauthenticated request.',
      metadata: { path: '/api/cron/retention' },
    });
    return null;
  }

  if (provided !== secret) {
    return Response.json(
      { success: false, error: 'Forbidden: invalid or missing x-cron-secret header.' },
      { status: 403 },
    );
  }

  return null;
}

async function retentionCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  // Cross-tenant by design: retention policies apply org-wide.
  const result = await runWithoutTenant(async () => {
    // executeAll() try/catches each category internally - a thrown
    // IMMUTABILITY_VIOLATION (purge attempted on an append-only model)
    // is recorded as { success: false, error } for that category and does
    // not abort the remaining categories.
    const results = await dataRetention.executeAll();

    const totalPurged = results.reduce((sum, r) => sum + r.purged, 0);
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      await systemLog({
        action: 'DATA_RETENTION_CRON_FAILURES',
        component: LogComponent.SYSTEM,
        severity: LogSeverity.WARN,
        message: `Retention cron finished with ${failed.length} failed category(ies): ${failed
          .map((f) => `${f.category} (${f.error})`)
          .join('; ')}`,
        metadata: { failed: failed.map((f) => ({ category: f.category, error: f.error })) },
      }).catch(() => {});
    }

    // EMS v2.20.0 (spec Phase 4.8): per-organization HR retention sweep
    // (applicant rejections, closed discipline, attendance device data) with
    // legal-hold support. Anonymises in place; each scope is audit logged.
    let hrSweep: Awaited<ReturnType<typeof runHrRetentionSweep>> = [];
    try {
      const orgs = await (await import('@/lib/db')).db.organization.findMany({ select: { id: true } });
      for (const org of orgs) {
        hrSweep = hrSweep.concat(await runHrRetentionSweep(org.id, 'system'));
      }
    } catch (hrError) {
      await systemLog({
        action: 'HR_RETENTION_CRON_FAILURE',
        component: LogComponent.SYSTEM,
        severity: LogSeverity.WARN,
        message: `HR retention sweep failed: ${hrError instanceof Error ? hrError.message : 'unknown'}`,
      }).catch(() => {});
    }

    return {
      totalPurged,
      categoriesProcessed: results.length,
      failures: failed.length,
      hrRetention: hrSweep,
      results: results.map((r) => ({
        category: r.category,
        purged: r.purged,
        success: r.success,
        error: r.error,
      })),
      ranAt: new Date().toISOString(),
    };
  });

  return Response.json({ success: true, result });
}

export const GET = withErrorBoundary(retentionCronHandler, LogComponent.SYSTEM);
