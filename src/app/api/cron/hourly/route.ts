// GET /api/cron/hourly - combined hourly cron dispatcher.
//
// DEPLOY-INCIDENT FIX (2026-09, PR #15 follow-up):
//   vercel.json declared FOUR cron jobs (outbox, payments-sweeper,
//   reconciliation, retention). Vercel's Hobby plan allows TWO cron jobs per
//   project - every deployment since the crons landed was REJECTED at
//   config validation (commit status links to the Vercel cron-jobs docs),
//   which froze production on a stale build while the codebase moved ahead.
//   This dispatcher consolidates the two hourly jobs into ONE scheduled
//   endpoint so the project stays within the plan limit with zero
//   functional loss: all four original routes remain live and can still be
//   triggered manually or by external schedulers.
//
// MAPPING (verbatim cadences preserved):
//   /api/cron/outbox           (was "0 * * * *")  -> /api/cron/hourly "0 * * * *"
//   /api/cron/payments-sweeper (was "5 * * * *")  -> /api/cron/hourly "0 * * * *"
//
// SCHEDULE NOTE (Vercel Hobby plan - updated by the FINANCIAL MATH AUDIT
// remediation, PR #17): Vercel now ENFORCES once-daily cron schedules on
// Hobby at config validation - the previous "0 * * * *" expression (which
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
// systemLog when CRON_SECRET is unset - Vercel Cron cannot send per-run
// secrets on all plans). The incoming Request is passed through UNMODIFIED,
// so each sub-route re-verifies the header itself.
//
// PARALLELISM: sub-jobs run concurrently - they touch disjoint tables
// (outbox_events vs M-Pesa/payment sweeps) and each is independently
// guarded against double-delivery, so parallel execution is safe and keeps
// wall-clock time within the 60s serverless cap on Hobby.

import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { GET as outboxGET } from '@/app/api/cron/outbox/route';
import { GET as paymentsSweeperGET } from '@/app/api/cron/payments-sweeper/route';
// v2.6.1: the eTIMS retry queue and the debt-reminder sweep originally
// shipped as dedicated vercel.json cron entries - which pushed the project
// past Vercel Hobby's TWO-cron-jobs-per-project limit and REJECTED every
// deployment (commit status links to the cron usage-and-pricing docs; prod
// froze on v2.5.8). Same remediation as the original dispatcher: fold them
// into this endpoint and keep the routes live for external schedulers.
import { GET as etimsRetryGET } from '@/app/api/cron/etims-retry/route';
import { GET as debtRemindersGET } from '@/app/api/cron/debt-reminders/route';
// v2.155.0: the payroll B2C auto-recovery sweep joins the dispatcher - the
// same fold pattern as etims-retry/debt-reminders (Vercel Hobby's two-cron
// limit keeps every new scheduled job out of vercel.json). The sweep is
// self-rate-limiting: the v2.33.0 retry gate (backoff + ceiling) decides
// which payslips may re-send, and initiation is idempotent, so overlapping
// ticks cannot double-pay.
import { GET as b2cRecoveryGET } from '@/app/api/cron/b2c-recovery/route';
// v2.163.0: the session reaper joins the dispatcher - one deleteMany on the
// indexed expiresAt column (the session-hygiene sweep; idle-expiry deletion
// stays the portal guard's own enforcement path, this reaper only owns
// sessions nobody will ever present again).
import { GET as sessionReaperGET } from '@/app/api/cron/session-reaper/route';

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
        'CRON_SECRET env var is not set - /api/cron/hourly accepted an unauthenticated request.',
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

// v2.164.0: the ledger entry the tick writes for ONE sub-job. name/ok/status
// were always carried; `deleted` is the session-reaper's own honest count,
// promoted from its response body SO THE PULSE CAN SPEAK IT (the org card
// reads the tick ledger, not the reaper route - if the count is not on the
// ledger, the card can never say it). Anything that is not a non-negative
// finite number is DROPPED - the ledger never invents a count.
function ledgerEntry(r: {
  name: string;
  ok: boolean;
  status: number;
  body: unknown;
}): { name: string; ok: boolean; status: number; deleted?: number } {
  const deleted = (r.body as { deleted?: unknown } | null | undefined)?.deleted;
  const carryDeleted =
    typeof deleted === 'number' && Number.isFinite(deleted) && deleted >= 0;
  return {
    name: r.name,
    ok: r.ok,
    status: r.status,
    ...(carryDeleted ? { deleted } : {}),
  };
}

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
  const ledgerResults = results.map(ledgerEntry);
  // v2.165.0: the metadata names the dispatcher that fired ('hourly') - the
  // nightly dispatcher writes the SAME action from v2.165.0 on, so a ledger
  // row without a name can no longer say which heartbeat it recorded. The
  // Automation pulse card reads this field to label the last tick.
  if (failed.length > 0) {
    await systemLog({
      action: 'CRON_DISPATCH_PARTIAL_FAILURE',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message: `Cron dispatch finished with ${failed.length}/${results.length} failed sub-job(s): ${failed
        .map((f) => `${f.name} (${f.status})`)
        .join('; ')}`,
      metadata: { dispatcher: 'hourly', results: ledgerResults },
    }).catch(() => {});
  }

  // v2.159.0: the tick LEDGER. The WARN above only fires on partial failure,
  // which meant a healthy production tick left NO trace - the org console's
  // automation pulse (GET /api/org/automation) could never tell "the last
  // tick was all green" from "no tick has ever run". Every completed
  // dispatch now writes one INFO row carrying the full sub-job ledger; the
  // automation card reads the latest row. One row per tick (~24/day with the
  // hourly pinger armed) - SystemLog is a log table and retention sweeps own
  // the rest.
  await systemLog({
    action: 'CRON_DISPATCH_TICK',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message:
      failed.length > 0
        ? `Cron tick recorded: ${results.length} sub-job(s), ${failed.length} failed.`
        : `Cron tick recorded: ${results.length} sub-job(s) all ok.`,
    metadata: { dispatcher: 'hourly', results: ledgerResults },
  }).catch(() => {});

  return results;
}

async function hourlyCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const results = await dispatchAll(request, [
    { name: 'outbox', run: () => outboxGET(request) },
    { name: 'payments-sweeper', run: () => paymentsSweeperGET(request) },
    // v2.6.1 sub-jobs (each re-verifies the x-cron-secret itself and is
    // independently guarded against double-delivery / double-reminding):
    { name: 'etims-retry', run: () => etimsRetryGET(request) },
    // The debt-reminder sweep carries a 7-day per-ledger re-reminder guard,
    // so a daily tick here preserves the 30/60/90+ bucket semantics without
    // a dedicated cron entry. Runs at the dispatcher's 03:00 UTC tick
    // (06:00 EAT) - statement times shift with the schedule, not the code.
    { name: 'debt-reminders', run: () => debtRemindersGET(request) },
    // v2.155.0: B2C auto-recovery - re-sends gate-allowed FAILED disbursements
    // and re-queries stuck PROCESSING transfers across unsettled posted/locked
    // runs (backoff + ceiling respected; early-outs in production when Daraja
    // is unconfigured and mock is not opted in).
    { name: 'b2c-recovery', run: () => b2cRecoveryGET(request) },
    // v2.163.0: session reaper - deletes auth sessions whose expiresAt has
    // passed (one deleteMany on an indexed column; a reaped-zero sweep is a
    // healthy outcome and still leaves its INFO ledger row).
    { name: 'session-reaper', run: () => sessionReaperGET(request) },
  ]);

  const allOk = results.every((r) => r.ok);
  return Response.json(
    { success: allOk, dispatcher: '/api/cron/hourly', results },
    { status: allOk || results.some((r) => r.ok) ? 200 : 500 },
  );
}

export const GET = withErrorBoundary(hourlyCronHandler, LogComponent.SYSTEM);
