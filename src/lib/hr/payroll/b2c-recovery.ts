// ── v2.155.0: the B2C auto-recovery sweep ───────────────────────────────────
//
// The "persistence" half of the B2C retry story. v2.33.0 gave FAILED
// disbursements a disciplined retry gate (exponential backoff + attempt
// ceiling) and v2.34.0 gave it row-level targeting — but every retry was
// UI-DRIVEN: if nobody opened the run dialog, a gate-allowed FAILED payslip
// sat unpaid forever, and a stuck PROCESSING transaction was never re-queried.
// This sweep closes that loop: the hourly cron dispatcher now walks unsettled
// posted/locked runs and applies the EXACT same gate arithmetic
// (evaluateB2CRetryGate via summariseRunB2CState → pickB2CRecoveryActions →
// retryFailedPayrollB2C / refreshStuckPayrollB2C). One source of truth — the
// sweep can never be more aggressive than the UI, only more punctual.
//
// SAFETY:
//   • Idempotency is inherited, not re-invented: initiatePayrollB2C never
//     re-sends a payslip with an active (PENDING/PROCESSING/COMPLETED)
//     transaction, so a double-dispatched tick cannot double-pay.
//   • Mock discipline is inherited: in production without Daraja credentials
//     and MPESA_B2C_ALLOW_MOCK the sweep early-outs (configured:false) before
//     touching the database — the same rule the UI paths enforce.
//   • Backoff is the rate limit: a payslip the gate blocks (backoff open or
//     ceiling hit) is NEVER fired from here. The ceiling surface (max 5
//     attempts) stays human-only, exactly as the UI promise states.
//   • Per-run isolation: one bad run (bad data, provider error) is recorded
//     and skipped; the tick never aborts wholesale.
//
// AUDIT: each retry/status-query already writes its own PAYROLL_RUN audit row
// from inside the service (actorRole 'SYSTEM'); the sweep acts through them
// with a stable sentinel actor so the trail reads "the recovery sweep" rather
// than a fabricated human. AuditLog.userId is a plain nullable string (no
// FK), so a namespaced sentinel is safe.

import { db } from '@/lib/db';
import { isB2CConfigured } from '@/lib/mpesa-b2c';
import { systemLog } from '@/lib/logger';
import { LogComponent, LogSeverity } from '@/lib/types';
import {
  PayrollLifecycleError,
  type RunActorContext,
} from '@/lib/hr/payroll/run-service';
import {
  summariseRunB2CState,
  retryFailedPayrollB2C,
  refreshStuckPayrollB2C,
  type B2CStateSummary,
} from '@/lib/hr/payroll/disbursement-service';

/** Audit sentinel for sweep-initiated retries (no FK on AuditLog.userId). */
export const B2C_RECOVERY_ACTOR_ID = 'system:b2c-recovery';

/** Runs swept per tick - a serverless wall-clock budget, oldest first. */
export const B2C_RECOVERY_MAX_RUNS_PER_TICK = 25;

/** True when the sweep may act in the current environment. Mirrors the
 *  mock-allowed discipline the UI paths enforce (disbursement-service). */
export function b2cRecoveryConfigured(): boolean {
  if (isB2CConfigured()) return true;
  const production = process.env.NODE_ENV === 'production';
  return !production || process.env.MPESA_B2C_ALLOW_MOCK === 'true';
}

export interface B2CRecoveryActions {
  /** Payslip ids whose latest attempt FAILED, the gate allows, and the
   *  payslip is still unpaid - the sweep re-sends these. */
  retryDetailIds: string[];
  /** true when at least one PROCESSING transaction has gone quiet past
   *  B2C_STALE_PROCESSING_MS - the sweep re-queries these. */
  refreshStuck: boolean;
}

/** PURE decision layer between the run summary and the sweep's two actions.
 *  Kept separate so the selection arithmetic is unit-testable without DB or
 *  Daraja, and so the sweep and any future caller agree by construction. */
export function pickB2CRecoveryActions(
  summary: B2CStateSummary,
  opts?: { settledRun?: boolean },
): B2CRecoveryActions {
  const actions: B2CRecoveryActions = { retryDetailIds: [], refreshStuck: false };
  if (opts?.settledRun) return actions;
  for (const p of summary.perPayslip) {
    if (p.settled) continue;
    if (p.lastStatus === 'FAILED' && !p.retryBlocked) actions.retryDetailIds.push(p.payrollDetailId);
  }
  if (summary.staleProcessing > 0) actions.refreshStuck = true;
  return actions;
}

export interface B2CRecoveryRunOutcome {
  runId: string;
  storeId: string;
  /** What the sweep did on this run. */
  action: 'retry' | 'refresh' | 'both' | 'none' | 'skipped';
  retried?: number;
  alreadyInitiated?: number;
  backoffSkipped?: number;
  maxAttemptSkipped?: number;
  stuckQueried?: number;
  stuckSettled?: number;
  receipts?: Array<{ employeeCode: string; receipt: string }>;
  /** Benign lifecycle refusals (NOTHING_TO_RETRY, B2C_NOT_CONFIGURED). */
  benignCode?: string;
  /** Unexpected failure message (the run is skipped, the tick continues). */
  error?: string;
}

export interface B2CRecoverySummary {
  configured: boolean;
  mode: 'daraja' | 'mock';
  runsScanned: number;
  runsTouched: number;
  retriedPayslips: number;
  alreadyInitiated: number;
  stuckQueried: number;
  stuckSettled: number;
  backoffSkipped: number;
  maxAttemptSkipped: number;
  receipts: Array<{ employeeCode: string; receipt: string }>;
  errors: Array<{ runId: string; message: string }>;
  /** Runs skipped by a benign lifecycle refusal (nothing eligible). */
  benignSkips: number;
  outcomes: B2CRecoveryRunOutcome[];
  checkedAt: string;
}

function emptySummary(configured: boolean, mode: 'daraja' | 'mock'): B2CRecoverySummary {
  return {
    configured,
    mode,
    runsScanned: 0,
    runsTouched: 0,
    retriedPayslips: 0,
    alreadyInitiated: 0,
    stuckQueried: 0,
    stuckSettled: 0,
    backoffSkipped: 0,
    maxAttemptSkipped: 0,
    receipts: [],
    errors: [],
    benignSkips: 0,
    outcomes: [],
    checkedAt: new Date().toISOString(),
  };
}

const BENIGN_CODES = new Set(['NOTHING_TO_RETRY', 'B2C_NOT_CONFIGURED']);

/**
 * Walk every posted/locked run that still holds unpaid money and let the
 * existing retry machinery do its work. Returns a PII-free summary the cron
 * route logs verbatim. `deps` is injectable for tests (defaults to the real
 * service functions); production callers must not pass it.
 */
export async function sweepStalledPayrollB2C(deps?: {
  summarise?: typeof summariseRunB2CState;
  retry?: typeof retryFailedPayrollB2C;
  refresh?: typeof refreshStuckPayrollB2C;
  nowMs?: number;
}): Promise<B2CRecoverySummary> {
  const mode: 'daraja' | 'mock' = isB2CConfigured() ? 'daraja' : 'mock';
  if (!b2cRecoveryConfigured()) {
    // Honest early-out: production without Daraja credentials (and without
    // the explicit mock opt-in) never touches the database. The summary says
    // so plainly instead of pretending to have swept.
    return emptySummary(false, mode);
  }

  const summarise = deps?.summarise ?? summariseRunB2CState;
  const retry = deps?.retry ?? retryFailedPayrollB2C;
  const refresh = deps?.refresh ?? refreshStuckPayrollB2C;

  const summary = emptySummary(true, mode);

  // Candidates: posted/locked runs with at least one unpaid, positive-net
  // payslip and no paidAt stamp. Oldest first so the oldest debt recovers
  // first; capped per tick to respect the serverless time budget.
  const runs = await db.payrollRun.findMany({
    where: {
      status: { in: ['POSTED', 'LOCKED'] },
      paidAt: null,
      details: { some: { paymentStatus: 'PENDING', netPay: { gt: 0 } } },
    },
    orderBy: { createdAt: 'asc' },
    take: B2C_RECOVERY_MAX_RUNS_PER_TICK,
    select: { id: true, storeId: true, store: { select: { organizationId: true } } },
  });
  summary.runsScanned = runs.length;

  for (const run of runs) {
    const ctx: RunActorContext = {
      storeId: run.storeId,
      organizationId: run.store.organizationId,
      actorId: B2C_RECOVERY_ACTOR_ID,
    };
    const outcome: B2CRecoveryRunOutcome = { runId: run.id, storeId: run.storeId, action: 'none' };
    try {
      const state = await summarise(run.id);
      const actions = pickB2CRecoveryActions(state);

      if (actions.retryDetailIds.length > 0) {
        const retryResult = await retry(ctx, run.id, actions.retryDetailIds);
        outcome.action = 'retry';
        outcome.retried = retryResult.initiated;
        outcome.alreadyInitiated = retryResult.alreadyInitiated;
        outcome.backoffSkipped = retryResult.backoffSkipped ?? 0;
        outcome.maxAttemptSkipped = retryResult.maxAttemptSkipped ?? 0;
        outcome.receipts = retryResult.receipts;
        summary.retriedPayslips += retryResult.initiated;
        summary.alreadyInitiated += retryResult.alreadyInitiated;
        summary.backoffSkipped += retryResult.backoffSkipped ?? 0;
        summary.maxAttemptSkipped += retryResult.maxAttemptSkipped ?? 0;
        summary.receipts.push(...retryResult.receipts);
      }

      if (actions.refreshStuck) {
        const refreshResult = await refresh(ctx, run.id);
        outcome.action = outcome.action === 'retry' ? 'both' : 'refresh';
        outcome.stuckQueried = refreshResult.queried;
        outcome.stuckSettled = refreshResult.settled;
        summary.stuckQueried += refreshResult.queried;
        summary.stuckSettled += refreshResult.settled;
        if (refreshResult.receipts.length > 0) {
          outcome.receipts = [...(outcome.receipts ?? []), ...refreshResult.receipts];
          summary.receipts.push(...refreshResult.receipts);
        }
      }

      if (outcome.action !== 'none') summary.runsTouched += 1;
      summary.outcomes.push(outcome);
    } catch (error) {
      if (error instanceof PayrollLifecycleError && BENIGN_CODES.has(error.code)) {
        // A race can empty the eligible set between summarise and retry
        // (NOTHING_TO_RETRY); an unconfigured provider refuses per-run
        // (B2C_NOT_CONFIGURED). Both are honest no-ops, not failures.
        outcome.action = 'skipped';
        outcome.benignCode = error.code;
        summary.benignSkips += 1;
        summary.outcomes.push(outcome);
        continue;
      }
      outcome.action = 'skipped';
      outcome.error = error instanceof Error ? error.message : String(error);
      summary.errors.push({ runId: run.id, message: outcome.error });
      summary.outcomes.push(outcome);
    }
  }

  // One sweep-level log (the per-run actions already audited themselves) so
  // the cron dispatcher's WARN-on-failure logic has a stable signal here.
  await systemLog({
    action: 'B2C_RECOVERY_SWEEP',
    component: LogComponent.PAYMENT,
    severity: summary.errors.length > 0 ? LogSeverity.WARN : LogSeverity.INFO,
    message: `B2C recovery sweep: ${summary.runsScanned} unsettled run(s) scanned, ${summary.retriedPayslips} retry initiated, ${summary.stuckSettled} stuck settled, ${summary.errors.length} error(s).`,
    metadata: {
      mode: summary.mode,
      runsScanned: summary.runsScanned,
      runsTouched: summary.runsTouched,
      retriedPayslips: summary.retriedPayslips,
      alreadyInitiated: summary.alreadyInitiated,
      stuckQueried: summary.stuckQueried,
      stuckSettled: summary.stuckSettled,
      backoffSkipped: summary.backoffSkipped,
      maxAttemptSkipped: summary.maxAttemptSkipped,
      benignSkips: summary.benignSkips,
      errors: summary.errors,
    },
  }).catch(() => undefined);

  return summary;
}
