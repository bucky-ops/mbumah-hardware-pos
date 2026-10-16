// GET /api/cron/hr-report-digests - sweep due HR report schedules (v2.22.0).
//
// Computes each due schedule's aggregate report through the governed report
// service (fail-closed scope, aggregates only — no names / national IDs /
// raw ids ever leave) and emails the digest. Outcomes are stamped on the
// HrReportSchedule row (lastRunAt/lastStatus/lastError) and audit-logged.
//
// AUTH: same CRON_SECRET gate as /api/cron/retention. `?force=1` runs every
// active schedule regardless of the due calculation (ops/testing escape
// hatch; still CRON_SECRET-gated and still audit-logged per schedule).
//
// SCHEDULE NOTE (Vercel Hobby plan): the nightly dispatcher
// /api/cron/nightly calls this sweep too, so no extra Vercel cron entry is
// needed — digests go out once per UTC day at 02:30 plus any schedule whose
// send hour falls within the sweep window.

import { runWithoutTenant } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { runDueHrReportSchedules } from '@/lib/hr/report-schedule-service';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';
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
        'CRON_SECRET env var is not set - /api/cron/hr-report-digests accepted an unauthenticated request.',
      metadata: { path: '/api/cron/hr-report-digests' },
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

async function hrDigestCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const force = new URL(request.url).searchParams.get('force') === '1';

  // Cross-tenant by design: schedules carry their own organizationId.
  const result = await runWithoutTenant(async () => runDueHrReportSchedules(new Date(), force));

  if (result.failed > 0) {
    await systemLog({
      action: 'HR_REPORT_DIGEST_FAILURES',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message: `HR report digest sweep finished with ${result.failed} failed schedule(s)`,
      metadata: { failed: result.results.filter((r) => r.status === 'FAILED') },
    }).catch(() => {});
  }

  return Response.json({ success: true, result: { ...result, forced: force, ranAt: new Date().toISOString() } });
}

export const GET = withErrorBoundary(hrDigestCronHandler, LogComponent.SYSTEM);
