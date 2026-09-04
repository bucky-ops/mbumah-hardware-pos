// GET /api/cron/hourly — combined hourly cron dispatcher.
//
// DEPLOY-INCIDENT FIX (2026-09, PR #15 follow-up):
//   vercel.json declared FOUR cron jobs (outbox, payments-sweeper,
//   reconciliation, retention). Vercel's Hobby plan allows TWO cron jobs per
//   project — every deployment since the crons landed was REJECTED at
//   config validation (commit status links to the Vercel cron-jobs docs),
//   which froze production on a stale build while the codebase moved ahead.
//   This dispatcher consolidates the two hourly jobs into ONE scheduled
//   endpoint so the project stays within the plan limit with zero
//   functional loss: all four original routes remain live and can still be
//   triggered manually or by external schedulers.
//
// MAPPING (verbatim cadences preserved):
//   /api/cron/outbox           (was "0 * * * *")  ─┐
//   /api/cron/payments-sweeper (was "5 * * * *")  ─┴─> /api/cron/hourly "0 * * * *"
//
// SCHEDULE NOTE (Vercel Hobby plan — updated by the FINANCIAL MATH AUDIT
// remediation, PR #17): Vercel now ENFORCES once-daily cron schedules on
// Hobby at config validation — the previous "0 * * * *" expression (which
// used to be silently clamped to daily) is REJECTED outright and fails the
// whole deployment with a commit status linking to the cron usage-and-
// pricing docs. vercel.json therefore schedules this dispatcher daily
// ("0 3 * * *", staggered 30 min after the nightly dispatcher). The route
// itself stays hourly-capable: on Pro plans (or via any external scheduler
// holding CRON_SECRET) it can be triggered every hour with zero code
// change. The outbox also pumps opportunistically after checkout commits
// and M-Pesa confirmations process synchronously via the callback route,
// so daily sweeping slows only the retry of edge-case missed pumps.
//
// AUTH: same CRON_SECRET gate as the sibling routes (fail-open with a WARN
// systemLog when CRON_SECRET is unset — Vercel Cron cannot send per-run
// secrets on all plans). The incoming Request is passed through UNMODIFIED,
// so each sub-route re-verifies the header itself.
//
// PARALLELISM: sub-jobs run concurrently — they touch disjoint tables
// (outbox_events vs M-Pesa/payment sweeps) and each is independently
// guarded against double-delivery, so parallel execution is safe and keeps
// wall-clock time within the 60s serverless cap on Hobby.

import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { GET as outboxGET } from '@/app/api/cron/outbox/route';
import { GET as paymentsSweeperGET } from '@/app/api/cron/payments-sweeper/route';

export const dynamic = 'force-dynamic';
// Both sub-routes declare maxDuration 60; running them in parallel keeps the
// dispatcher's wall clock at ~60s worst case (Vercel clamps to plan limits).
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
        'CRON_SECRET env var is not set — /api/cron/hourly accepted an unauthenticated request.',
      metadata: { path: '/api/cron/hourly' },
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
        // The sub-handlers are withErrorBoundary-wrapped and never throw;
        // this guard keeps an unexpected module-level failure from taking
        // down the other sub-job's result.
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

async function hourlyCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const results = await dispatchAll(request, [
    { name: 'outbox', run: () => outboxGET(request) },
    { name: 'payments-sweeper', run: () => paymentsSweeperGET(request) },
  ]);

  const allOk = results.every((r) => r.ok);
  return Response.json(
    { success: allOk, dispatcher: '/api/cron/hourly', results },
    { status: allOk || results.some((r) => r.ok) ? 200 : 500 },
  );
}

export const GET = withErrorBoundary(hourlyCronHandler, LogComponent.SYSTEM);
