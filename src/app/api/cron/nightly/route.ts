// GET /api/cron/nightly - combined nightly cron dispatcher.
//
// DEPLOY-INCIDENT FIX (2026-09, PR #15 follow-up): see
// src/app/api/cron/hourly/route.ts for the full incident write-up (Vercel
// Hobby plan = 2 cron jobs; four declared crons rejected every deployment).
// This dispatcher consolidates the two nightly jobs into ONE scheduled
// endpoint:
//
//   /api/cron/reconciliation (was "30 2 * * *") -> /api/cron/nightly "30 2 * * *"
//   /api/cron/retention      (was "0 3 * * *")  -> /api/cron/nightly "30 2 * * *"
//
// Both original routes remain live for manual/external triggers. Retention
// shifts from 03:00 to 02:30 UTC - acceptable: reconciliation aggregates
// financial summaries while retention purges EXPIRED records (retention +
// grace period, e.g. years-old rows), and each category is individually
// try/caught, so the overlap does not produce meaningful contention.
//
// v2.165.0: the tick LEDGER comes to the nightly dispatcher (below), and
// the session reaper rides BOTH dispatchers - the hourly tick already
// sweeps sessions at 03:00 UTC, but that tick is a single daily shot on
// Vercel Hobby; folding the reaper here gives every day a SECOND sweep
// (02:30 UTC) so a frozen or failed 03:00 deployment never leaves expired
// sessions unreaped until tomorrow. The reaper is idempotent by
// construction (one deleteMany on expiresAt < now), so overlapping
// dispatchers cannot double-delete - a sweep that finds nothing is a
// SUCCESS and still leaves its ledger row.
//
// AUTH + PARALLELISM: identical pattern to /api/cron/hourly (CRON_SECRET
// gate, Request passed through unmodified, concurrent sub-jobs with
// independent result reporting).

import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { GET as reconciliationGET } from '@/app/api/cron/reconciliation/route';
import { GET as retentionGET } from '@/app/api/cron/retention/route';
// v2.22.0: scheduled HR report email digests ride the same nightly dispatch
// (no additional Vercel cron entry on the Hobby plan).
import { GET as hrDigestGET } from '@/app/api/cron/hr-report-digests/route';
// v2.165.0: the session reaper joins the NIGHTLY dispatcher (it has swept
// the hourly one since v2.163.0) - same fold pattern, same scope rule:
// expiresAt only, never lastActiveAt.
import { GET as sessionReaperGET } from '@/app/api/cron/session-reaper/route';

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
        'CRON_SECRET env var is not set - /api/cron/nightly accepted an unauthenticated request.',
      metadata: { path: '/api/cron/nightly' },
    });
    return null;
  }

  if (provided !== secret) {
    // v2.170.0: a refusal is a real operational event - before this, a tick
    // that sent the WRONG secret was invisible everywhere (no ledger row,
    // the 403 body the only trace), so the exact moment the pinger's secret
    // went stale left the card green with an aging tick and no explanation.
    // The ledger records the denial ONLY when the request at least SENT a
    // non-empty secret: a misconfigured-but-honest tick (the pinger with a
    // stale GitHub secret, a curl with a typo) always does, while anonymous
    // scanners and the Vercel-managed scheduler (which cannot send custom
    // headers) send nothing - the ledger never chases noise, and an
    // unauthenticated caller cannot write rows by spamming the endpoint.
    // No secret material rides the row - the path names the dispatcher,
    // nothing else is needed to diagnose a mismatch.
    if (provided && provided.length > 0) {
      await systemLog({
        action: 'CRON_TICK_DENIED',
        component: LogComponent.SYSTEM,
        severity: LogSeverity.WARN,
        message: 'A tick sent an x-cron-secret that did not match - refused with 403.',
        metadata: { path: '/api/cron/nightly' },
      }).catch(() => {});
    }
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

// v2.165.0: the ledger entry the nightly tick writes for ONE sub-job -
// the IDENTICAL contract the hourly dispatcher has carried since v2.164.0
// (name/ok/status always; the session-reaper's `deleted` count promoted
// from its response body ONLY when a non-negative finite number - the
// ledger never invents a count). Deliberately self-contained per the
// dispatcher house pattern (each route owns its own helpers, like
// verifyCronSecret/dispatchAll above); the shared contract is the ACTION
// name and the metadata shape, pinned by tests on both files.
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

async function nightlyCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const results = await dispatchAll(request, [
    { name: 'reconciliation', run: () => reconciliationGET(request) },
    { name: 'retention', run: () => retentionGET(request) },
    { name: 'hr-report-digests', run: () => hrDigestGET(request) },
    // v2.165.0: the session reaper's SECOND daily sweep (hourly keeps its
    // own) - idempotent deleteMany, so the 02:30 and 03:00 UTC ticks can
    // never fight over a row.
    { name: 'session-reaper', run: () => sessionReaperGET(request) },
  ]);

  // v2.165.0: the nightly always-row. The hourly dispatcher has written a
  // CRON_DISPATCH_TICK ledger row on every completed dispatch since
  // v2.159.0; until now a healthy nightly dispatch left NO trace, so the
  // Automation pulse card could never show the nightly heartbeat (nor the
  // reconciliation/retention/digest sweeps it carries). Same contract,
  // same promoted entries, and the metadata names the dispatcher that
  // fired so the card can say which heartbeat it is reading.
  const ledgerResults = results.map(ledgerEntry);
  const failed = results.filter((r) => !r.ok);
  await systemLog({
    action: 'CRON_DISPATCH_TICK',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message:
      failed.length > 0
        ? `Nightly cron tick recorded: ${results.length} sub-job(s), ${failed.length} failed.`
        : `Nightly cron tick recorded: ${results.length} sub-job(s) all ok.`,
    metadata: { dispatcher: 'nightly', results: ledgerResults },
  }).catch(() => {});

  const allOk = results.every((r) => r.ok);
  return Response.json(
    { success: allOk, dispatcher: '/api/cron/nightly', results },
    { status: allOk || results.some((r) => r.ok) ? 200 : 500 },
  );
}

export const GET = withErrorBoundary(nightlyCronHandler, LogComponent.SYSTEM);
