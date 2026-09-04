// GET /api/cron/nightly — combined nightly cron dispatcher.
//
// DEPLOY-INCIDENT FIX (2026-09, PR #15 follow-up): see
// src/app/api/cron/hourly/route.ts for the full incident write-up (Vercel
// Hobby plan = 2 cron jobs; four declared crons rejected every deployment).
// This dispatcher consolidates the two nightly jobs into ONE scheduled
// endpoint:
//
//   /api/cron/reconciliation (was "30 2 * * *") ─┐
//   /api/cron/retention      (was "0 3 * * *")  ─┴─> /api/cron/nightly "30 2 * * *"
//
// Both original routes remain live for manual/external triggers. Retention
// shifts from 03:00 to 02:30 UTC — acceptable: reconciliation aggregates
// financial summaries while retention purges EXPIRED records (retention +
// grace period, e.g. years-old rows), and each category is individually
// try/caught, so the overlap does not produce meaningful contention.
//
// AUTH + PARALLELISM: identical pattern to /api/cron/hourly (CRON_SECRET
// gate, Request passed through unmodified, concurrent sub-jobs with
// independent result reporting).

import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { GET as reconciliationGET } from '@/app/api/cron/reconciliation/route';
import { GET as retentionGET } from '@/app/api/cron/retention/route';

export const dynamic = 'force-dynamic';
// Both sub-routes declare maxDuration 60; parallel execution keeps the
// dispatcher within the 60s serverless cap on Hobby.
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
        'CRON_SECRET env var is not set — /api/cron/nightly accepted an unauthenticated request.',
      metadata: { path: '/api/cron/nightly' },
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

type SubJob = { name: string; run: () => Promise<Response> };

async function dispatchAll(request: Request, jobs: readonly SubJob[]) {
  const results = await Promise.all(
    jobs.map(async (job) => {
      try {
        const res = await job.run();
        const body = await res.json().catch(() => ({}));
        return { name: job.name, ok: res.ok, status: res.status, body };
      } catch (err) {
        return {
          name: job.name,
          ok: false,
          status: 500,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    }),
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    await systemLog({
      action: 'CRON_DISPATCH_PARTIAL_FAILURE',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message: `Cron dispatch finished with ${failed.length}/${results.length} failed sub-job(s): ${failed
        .map((f) => `${f.name} (${f.status})`)
        .join('; ')}`,
      metadata: { results: results.map((r) => ({ name: r.name, ok: r.ok, status: r.status })) },
    }).catch(() => {});
  }

  return results;
}

async function nightlyCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const results = await dispatchAll(request, [
    { name: 'reconciliation', run: () => reconciliationGET(request) },
    { name: 'retention', run: () => retentionGET(request) },
  ]);

  const allOk = results.every((r) => r.ok);
  return Response.json(
    { success: allOk, dispatcher: '/api/cron/nightly', results },
    { status: allOk || results.some((r) => r.ok) ? 200 : 500 },
  );
}

export const GET = withErrorBoundary(nightlyCronHandler, LogComponent.SYSTEM);
