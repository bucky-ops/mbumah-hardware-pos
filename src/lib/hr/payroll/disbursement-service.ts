// MBUMAH HARDWARE POS - EMS payroll M-Pesa B2C disbursement service (v2.21.0)
//
// Bridges the payroll run lifecycle (run-service.ts) with the Daraja B2C
// client (mpesa-b2c.ts). The EMS spec's audit question "Can payroll
// disbursement reuse MpesaTransaction safely if B2C is enabled later?" is
// answered with an additive nullable payrollDetailId on MpesaTransaction plus
// the same idempotency discipline as the sales flow:
//   • One payslip has at most one ACTIVE disbursement transaction
//     (PENDING/PROCESSING/COMPLETED) - re-runs skip, never double-pay.
//   • MOCK mode (no Daraja credentials) completes rows immediately with a SIM
//     receipt and marks the payslip PAID so QA exercises the full loop;
//     production refuses mock mode (B2C_NOT_CONFIGURED) - money movement can
//     never be silently simulated.
//   • REAL mode keeps the payslip PENDING until Daraja calls the B2C result
//     webhook, which claims the callback exactly once and settles the payslip
//     through withImmutabilityBypass (posted payslips are append-only).
//
// Every mutation is audit-logged via hrAudit; no direct Prisma writes from
// route handlers.

import { db, withImmutabilityBypass } from '@/lib/db';
import { isB2CConfigured, initiatePayrollB2C, queryPayrollB2CStatus } from '@/lib/mpesa-b2c';
import { hrAudit, HrEntityType } from '../audit';
import { PayrollLifecycleError, type RunActorContext } from './run-service';

// ── Run-level B2C disbursement ──────────────────────────────────────────────

export interface B2CSkip {
  employeeCode: string;
  reason: string;
}

export interface B2CFailure {
  employeeCode: string;
  code: string;
  message: string;
}

export interface B2CDisburseSummary {
  mode: 'daraja' | 'mock';
  eligible: number;
  initiated: number;
  alreadyInitiated: number;
  skipped: B2CSkip[];
  failed: B2CFailure[];
  receipts: Array<{ employeeCode: string; receipt: string }>;
  /** v2.33.0: candidates the gate blocked - backoff window still open. */
  backoffSkipped?: number;
  /** v2.33.0: candidates at the attempt ceiling - need human investigation. */
  maxAttemptSkipped?: number;
  /**
   * v2.50.0: per-payslip payment rows for the disbursement digest CSV —
   * every eligible payslip in this batch with its outcome (PAID settled now,
   * SENT in flight, FAILED, SKIPPED). Optional so older callers/records
   * without the field stay valid.
   */
  results?: Array<{
    employeeCode: string;
    employeeName: string;
    net: number;
    status: 'PAID' | 'SENT' | 'FAILED' | 'SKIPPED';
    receipt?: string | null;
  }>;
}

/**
 * Disburse every pending payslip of a posted/locked run via M-Pesa B2C.
 * Only payslips with paymentStatus PENDING and netPay > 0 are eligible.
 * Employees without a phone number are SKIPPED (reported), not failed.
 */
export async function disburseRunViaMpesa(
  ctx: RunActorContext,
  runId: string,
): Promise<B2CDisburseSummary> {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId: ctx.storeId },
    include: { payrollPeriod: { select: { name: true } } },
  });
  if (!run) {
    throw new PayrollLifecycleError('RUN_NOT_FOUND', 'Payroll run not found.', 404);
  }
  if (run.status !== 'POSTED' && run.status !== 'LOCKED') {
    throw new PayrollLifecycleError(
      'INVALID_TRANSITION',
      'Only posted or locked runs can be disbursed.',
    );
  }

  const production = process.env.NODE_ENV === 'production';
  const mock = !isB2CConfigured();
  // Mock mode is development-default. A production build may opt in
  // explicitly (staging / hermetic QA) via MPESA_B2C_ALLOW_MOCK=true; the
  // opt-in is audit-logged so a mock settlement can never hide behind
  // NODE_ENV alone.
  const mockAllowed = !production || process.env.MPESA_B2C_ALLOW_MOCK === 'true';
  if (mock && !mockAllowed) {
    throw new PayrollLifecycleError(
      'B2C_NOT_CONFIGURED',
      'M-Pesa B2C is not configured. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_INITIATOR_NAME and the initiator credential before disbursing payroll in production (or set MPESA_B2C_ALLOW_MOCK=true on a staging system for simulated disbursement).',
      400,
    );
  }

  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: run.id, paymentStatus: 'PENDING', netPay: { gt: 0 } },
    include: {
      employee: {
        select: { employeeCode: true, firstName: true, lastName: true, phone: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  const summary: B2CDisburseSummary = {
    mode: mock ? 'mock' : 'daraja',
    eligible: details.length,
    initiated: 0,
    alreadyInitiated: 0,
    skipped: [],
    failed: [],
    receipts: [],
    // v2.50.0: per-payslip payment rows for the digest CSV.
    results: [],
  };

  for (const detail of details) {
    const code = detail.employee.employeeCode || detail.employeeId;
    const employeeName =
      `${detail.employee.firstName ?? ''} ${detail.employee.lastName ?? ''}`.trim() || 'Unnamed employee';
    const net = Number(detail.netPay);
    if (!detail.employee.phone) {
      summary.skipped.push({ employeeCode: code, reason: 'No M-Pesa phone number on the employee record.' });
      summary.results?.push({ employeeCode: code, employeeName, net, status: 'SKIPPED' });
      continue;
    }
    try {
      const result = await initiatePayrollB2C({
        phone: detail.employee.phone,
        amount: net,
        storeId: ctx.storeId,
        payrollDetailId: detail.id,
        employeeCode: code,
        periodName: run.payrollPeriod.name,
      });
      if (result.alreadyInitiated) {
        summary.alreadyInitiated += 1;
        summary.results?.push({ employeeCode: code, employeeName, net, status: 'SENT' });
        continue;
      }
      summary.initiated += 1;
      summary.results?.push({ employeeCode: code, employeeName, net, status: 'SENT' });
      if (result.mode === 'mock' && result.status === 'COMPLETED' && result.receiptNumber) {
        // MOCK: no webhook will arrive - settle the payslip now.
        await withImmutabilityBypass(async () =>
          db.payrollDetail.update({
            where: { id: detail.id },
            data: {
              paymentStatus: 'PAID',
              paymentDate: new Date(),
              paymentRef: `MPESA-${result.receiptNumber}`,
            },
          }),
          'payroll_b2c_mock_settle',
        );
        summary.receipts.push({ employeeCode: code, receipt: result.receiptNumber });
        const row = summary.results?.find((r) => r.employeeCode === code && r.status === 'SENT');
        if (row) {
          row.status = 'PAID';
          row.receipt = `MPESA-${result.receiptNumber}`;
        }
      }
    } catch (error) {
      summary.failed.push({
        employeeCode: code,
        code: 'B2C_INITIATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown B2C failure',
      });
      summary.results?.push({ employeeCode: code, employeeName, net, status: 'FAILED' });
    }
  }

  // Only stamp paidAt when every eligible payslip actually completed
  // (mock mode). In daraja mode the webhook settles remaining payslips.
  if (summary.initiated > 0 && summary.failed.length === 0 && summary.mode === 'mock') {
    const remaining = await db.payrollDetail.count({
      where: { payrollRunId: run.id, paymentStatus: 'PENDING', netPay: { gt: 0 } },
    });
    if (remaining === 0) {
      await db.payrollRun.update({ where: { id: run.id }, data: { paidAt: new Date() } });
    }
  }

  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: {
        b2cDisbursement: true,
        mode: summary.mode,
        mockOptIn: mock && production ? true : undefined,
        eligible: summary.eligible,
        initiated: summary.initiated,
        alreadyInitiated: summary.alreadyInitiated,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      },
    },
  );

  return summary;
}

// ── B2C result webhook settlement ───────────────────────────────────────────

export interface B2CResultPayload {
  OriginatorConversationID?: string;
  ConversationID?: string;
  TransactionID?: string;
  Result?: {
    ResultType?: number | string;
    ResultCode?: number | string;
    ResultDesc?: string;
    OriginatorConversationID?: string;
    ConversationID?: string;
    TransactionID?: string;
    ResultParameters?: Record<string, unknown>;
  };
}

/**
 * Settle a payslip from a Daraja B2C result webhook.
 * Idempotent: the callback is claimed atomically (callbackReceived=false →
 * true); duplicates return alreadySettled without re-applying anything.
 */
export async function settlePayrollB2CResult(payload: B2CResultPayload): Promise<{
  settled: boolean;
  alreadySettled: boolean;
  outcome: 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  payrollDetailId: string | null;
}> {
  const result = payload.Result ?? {};
  const originator =
    payload.OriginatorConversationID || result.OriginatorConversationID || '';
  const providerConversation = payload.ConversationID || result.ConversationID || '';
  const transactionId = payload.TransactionID || result.TransactionID || '';
  const resultCode = String(result.ResultCode ?? payload.Result?.ResultCode ?? '');
  const resultDesc = String(result.ResultDesc ?? 'B2C result received.');

  if (!originator && !providerConversation) {
    return { settled: false, alreadySettled: false, outcome: 'UNKNOWN', payrollDetailId: null };
  }

  const orConditions: Array<{ checkoutRequestId: string } | { merchantRequestId: string }> = [];
  if (originator) orConditions.push({ checkoutRequestId: originator });
  if (providerConversation) orConditions.push({ merchantRequestId: providerConversation });
  if (orConditions.length === 0) {
    return { settled: false, alreadySettled: false, outcome: 'UNKNOWN', payrollDetailId: null };
  }
  const row = await db.mpesaTransaction.findFirst({
    where: { OR: orConditions },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) {
    return { settled: false, alreadySettled: false, outcome: 'UNKNOWN', payrollDetailId: null };
  }
  if (row.callbackReceived) {
    return { settled: false, alreadySettled: true, outcome: 'UNKNOWN', payrollDetailId: row.payrollDetailId };
  }

  const success = resultCode === '0';
  const receipt = transactionId || null;

  // Atomic claim: exactly one webhook application per transaction row.
  const claimed = await db.mpesaTransaction.updateMany({
    where: { id: row.id, callbackReceived: false },
    data: {
      callbackReceived: true,
      status: success ? 'COMPLETED' : 'FAILED',
      resultCode,
      resultDesc: resultDesc.slice(0, 250),
      mpesaReceiptNumber: receipt,
    },
  });
  if (claimed.count === 0) {
    return { settled: false, alreadySettled: true, outcome: 'UNKNOWN', payrollDetailId: row.payrollDetailId };
  }

  if (success && row.payrollDetailId) {
    await withImmutabilityBypass(async () =>
      db.payrollDetail.update({
        where: { id: row.payrollDetailId as string },
        data: {
          paymentStatus: 'PAID',
          paymentDate: new Date(),
          paymentRef: `MPESA-${receipt}`,
        },
      }),
      'payroll_b2c_webhook_settle',
    );
    const detail = await db.payrollDetail.findFirst({
      where: { id: row.payrollDetailId },
      select: { storeId: true, employee: { select: { employeeCode: true } } },
    });
    if (detail) {
      await hrAudit(
        {
          actorId: 'system',
          actorRole: 'SYSTEM',
          action: 'UPDATE',
          resourceType: HrEntityType.PAYSLIP,
          resourceId: row.payrollDetailId,
          storeId: detail.storeId,
          metadata: {
            b2cSettled: true,
            receipt,
            employeeCode: detail.employee.employeeCode,
            amount: Number(row.amount),
          },
        },
      );
    }
  } else if (!success && row.payrollDetailId) {
    // Failure: payslip stays PENDING so the owner can retry after fixing the
    // cause (wrong number, recipient not registered, etc.).
    await hrAudit(
      {
        actorId: 'system',
        actorRole: 'SYSTEM',
        action: 'UPDATE',
        resourceType: HrEntityType.PAYSLIP,
        resourceId: row.payrollDetailId,
        storeId: row.storeId,
        metadata: { b2cFailed: true, resultCode, resultDesc: resultDesc.slice(0, 200) },
      },
    ).catch(() => {});
  }

  return {
    settled: true,
    alreadySettled: false,
    outcome: success ? 'COMPLETED' : 'FAILED',
    payrollDetailId: row.payrollDetailId,
  };
}

// ── B2C retry + stuck-status recovery (v2.22.0) ─────────────────────────────
// NOTE: MpesaTransaction links to PayrollDetail through a plain nullable
// payrollDetailId column (no Prisma relation), so every lookup below resolves
// the run's detail ids first and then queries transactions with an IN filter.

/** A PROCESSING transaction with no callback for this long is considered stuck. */
export const B2C_STALE_PROCESSING_MS = 10 * 60 * 1000;

// ── v2.33.0: retry discipline (backoff + attempt ceiling) ───────────────────
// retryFailedPayrollB2C previously re-sent every FAILED payslip on demand
// with no rate limit - a manager hammering "Retry failed" could fire a
// request at Daraja every few seconds, and a payslip failing for a permanent
// reason (closed wallet, wrong till) would be retried forever. The gate
// below is PURE so the arithmetic is unit-testable without Daraja or DB.

/** Backoff after the 1st failed attempt; doubles per subsequent failure. */
export const B2C_RETRY_BASE_BACKOFF_MS = 2 * 60 * 1000;
/** Longest single backoff window - after ~4 failures retries space out to
 *  this regardless of the doubling. */
export const B2C_RETRY_BACKOFF_CAP_MS = 30 * 60 * 1000;
/** Attempt ceiling per payslip: past this, retrying from the UI is blocked
 *  and the failure needs human eyes (Daraja portal / till investigation). */
export const B2C_MAX_RETRY_ATTEMPTS = 5;

/** Exponential backoff for a payslip with `failedAttempts` terminal-FAILED
 *  attempts: base × 2^(n-1), capped. 1 fail → 2m, 2 → 4m, 3 → 8m,
 *  4 → 16m, 5+ → 30m (cap). Inputs below 1 yield the base window. */
export function b2cRetryBackoffMs(failedAttempts: number): number {
  const n = Math.max(1, Math.floor(failedAttempts));
  const doubled = B2C_RETRY_BASE_BACKOFF_MS * 2 ** (n - 1);
  return Math.min(doubled, B2C_RETRY_BACKOFF_CAP_MS);
}

export interface B2CRetryGateResult {
  /** true → the retry may be initiated now. */
  allowed: boolean;
  /** true → the attempt ceiling is reached; retrying is blocked until a
   *  human investigates (distinct surface from the time-based backoff). */
  maxReached: boolean;
  /** When the gate reopens (epoch ms) for a time-blocked retry; null when
   *  allowed or max-blocked. */
  nextRetryAtMs: number | null;
  /** Millis still to wait for a time-blocked retry (0 when allowed). */
  waitMs: number;
}

/** Pure retry gate: a payslip whose latest attempt FAILED may re-initiate
 *  only when (a) the attempt count is under the ceiling and (b) the latest
 *  failure is older than the per-attempt backoff window. Called from the
 *  retry service and the run summary so both agree on the same arithmetic. */
export function evaluateB2CRetryGate(
  failedAttempts: number,
  lastAttemptAtMs: number | null,
  nowMs: number,
): B2CRetryGateResult {
  if (failedAttempts >= B2C_MAX_RETRY_ATTEMPTS) {
    return { allowed: false, maxReached: true, nextRetryAtMs: null, waitMs: 0 };
  }
  if (lastAttemptAtMs == null) {
    return { allowed: true, maxReached: false, nextRetryAtMs: null, waitMs: 0 };
  }
  const windowMs = b2cRetryBackoffMs(failedAttempts);
  const elapsed = nowMs - lastAttemptAtMs;
  if (elapsed >= windowMs) {
    return { allowed: true, maxReached: false, nextRetryAtMs: null, waitMs: 0 };
  }
  return {
    allowed: false,
    maxReached: false,
    nextRetryAtMs: lastAttemptAtMs + windowMs,
    waitMs: windowMs - elapsed,
  };
}

/** "3m 40s" style rendering for the run-dialog countdown chips. */
export function formatB2CRetryWait(waitMs: number): string {
  const totalSec = Math.max(0, Math.ceil(waitMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  if (min >= 60) {
    const hr = Math.floor(min / 60);
    return `${hr}h ${min % 60}m`;
  }
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export interface B2CPayslipState {
  payrollDetailId: string;
  attempts: number;
  lastStatus: string | null;
  lastAttemptAt: string | null;
  lastResultDesc: string | null;
  settled: boolean;
  /** v2.33.0 retry discipline: true when the latest attempt FAILED and the
   *  gate blocks an immediate re-send (time backoff OR attempt ceiling). */
  retryBlocked?: boolean;
  /** When the backoff reopens (ISO) for a time-blocked retry; null when
   *  retrying is allowed or the ceiling is hit. */
  nextRetryAt?: string | null;
  /** true when B2C_MAX_RETRY_ATTEMPTS is reached - the UI shows a distinct
   *  "manual investigation" surface instead of a countdown. */
  maxAttemptsReached?: boolean;
}

export interface B2CStateSummary {
  pendingWithoutAttempt: number;
  processing: number;
  staleProcessing: number;
  failed: number;
  completed: number;
  /** v2.33.0: FAILED payslips whose retry the gate blocks right now (backoff
   *  or ceiling) - the run dialog subtracts them from the "Retry failed" N. */
  retryBlocked: number;
  perPayslip: B2CPayslipState[];
}

/** Aggregate the run's payslip ids once for the transaction queries below. */
async function runDetailIds(runId: string): Promise<string[]> {
  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: runId },
    select: { id: true },
  });
  return details.map((d) => d.id);
}

/**
 * Aggregated, PII-free B2C disbursement state for one run's payslips. Powers
 * the run dialog's retry affordances: "Retry failed" lights up when a payslip
 * has a terminal-FAILED attempt and is still unpaid; "Check status" lights up
 * when a PROCESSING attempt has gone quiet for B2C_STALE_PROCESSING_MS.
 */
export async function summariseRunB2CState(runId: string): Promise<B2CStateSummary> {
  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: runId },
    select: { id: true, paymentStatus: true },
    orderBy: { id: 'asc' },
  });
  const ids = details.map((d) => d.id);
  const txs = ids.length
    ? await db.mpesaTransaction.findMany({
        where: { payrollDetailId: { in: ids } },
        orderBy: { createdAt: 'asc' },
        select: {
          payrollDetailId: true,
          status: true,
          createdAt: true,
          resultDesc: true,
        },
      })
    : [];

  const byDetail = new Map<string, typeof txs>();
  for (const tx of txs) {
    if (!tx.payrollDetailId) continue;
    const list = byDetail.get(tx.payrollDetailId) ?? [];
    list.push(tx);
    byDetail.set(tx.payrollDetailId, list);
  }

  const now = Date.now();
  const summary: B2CStateSummary = {
    pendingWithoutAttempt: 0,
    processing: 0,
    staleProcessing: 0,
    failed: 0,
    completed: 0,
    retryBlocked: 0,
    perPayslip: [],
  };

  for (const d of details) {
    const txList = byDetail.get(d.id) ?? [];
    const latest = txList[txList.length - 1] ?? null;
    const settled = d.paymentStatus === 'PAID';
    if (latest?.status === 'PROCESSING') {
      summary.processing += 1;
      if (now - latest.createdAt.getTime() > B2C_STALE_PROCESSING_MS) summary.staleProcessing += 1;
    } else if (latest?.status === 'FAILED') {
      summary.failed += 1;
    } else if (latest?.status === 'COMPLETED' || settled) {
      summary.completed += 1;
    } else if (!settled && !latest) {
      summary.pendingWithoutAttempt += 1;
    }
    if (txList.length > 0 || d.paymentStatus !== 'PENDING') {
      // v2.33.0: run the shared retry gate so the per-row chips and the
      // retry service agree on which FAILED payslips may re-send right now.
      const failedAttempts = txList.filter((t) => t.status === 'FAILED').length;
      const gate =
        latest?.status === 'FAILED' && !settled
          ? evaluateB2CRetryGate(failedAttempts, latest.createdAt.getTime(), now)
          : null;
      if (gate && !gate.allowed) summary.retryBlocked += 1;
      summary.perPayslip.push({
        payrollDetailId: d.id,
        attempts: txList.length,
        lastStatus: latest?.status ?? null,
        lastAttemptAt: latest?.createdAt.toISOString() ?? null,
        lastResultDesc: latest?.resultDesc ?? null,
        settled,
        retryBlocked: gate ? !gate.allowed : undefined,
        nextRetryAt: gate?.nextRetryAtMs != null ? new Date(gate.nextRetryAtMs).toISOString() : null,
        maxAttemptsReached: gate ? gate.maxReached : undefined,
      });
    }
  }
  return summary;
}

/**
 * Re-initiate B2C for payslips whose latest disbursement attempt FAILED and
 * which are still unpaid (PENDING). Idempotency is unchanged: a payslip with
 * an active (PENDING/PROCESSING/COMPLETED) transaction is never touched, so
 * this can never double-pay. Distinct from disburseRunViaMpesa so the UI can
 * offer a targeted repair action with its own audit trail.
 */
export async function retryFailedPayrollB2C(
  ctx: RunActorContext,
  runId: string,
  /** v2.34.0: optional per-payslip targeting from the run dialog's row-level
   *  Retry buttons. Ids that do not belong to this run are silently dropped
   *  (the run-wide scan below only sees this run's details anyway); an empty
   *  or absent list means "every gate-allowed FAILED payslip". */
  detailIds?: string[],
): Promise<B2CDisburseSummary> {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId: ctx.storeId },
    include: { payrollPeriod: { select: { name: true } } },
  });
  if (!run) {
    throw new PayrollLifecycleError('RUN_NOT_FOUND', 'Payroll run not found.', 404);
  }
  if (run.status !== 'POSTED' && run.status !== 'LOCKED') {
    throw new PayrollLifecycleError(
      'INVALID_TRANSITION',
      'Only posted or locked runs can be re-disbursed.',
    );
  }

  const production = process.env.NODE_ENV === 'production';
  const mock = !isB2CConfigured();
  const mockAllowed = !production || process.env.MPESA_B2C_ALLOW_MOCK === 'true';
  if (mock && !mockAllowed) {
    throw new PayrollLifecycleError('B2C_NOT_CONFIGURED', 'M-Pesa B2C is not configured.', 400);
  }

  // Payslips still PENDING whose latest transaction is terminal-FAILED.
  const ids = await runDetailIds(run.id);
  const txs = ids.length
    ? await db.mpesaTransaction.findMany({
        where: { payrollDetailId: { in: ids } },
        orderBy: { createdAt: 'asc' },
        // v2.33.0: createdAt feeds the per-payslip backoff gate below.
        select: { payrollDetailId: true, status: true, createdAt: true },
      })
    : [];
  const txsByDetail = new Map<string, Array<{ status: string; createdAt: Date }>>();
  for (const tx of txs) {
    if (!tx.payrollDetailId) continue;
    const list = txsByDetail.get(tx.payrollDetailId) ?? [];
    list.push({ status: tx.status, createdAt: tx.createdAt });
    txsByDetail.set(tx.payrollDetailId, list);
  }
  const latestByDetail = new Map<string, string>();
  for (const [detailId, list] of txsByDetail) {
    latestByDetail.set(detailId, list[list.length - 1].status);
  }
  const failedIds = ids.filter((id) => latestByDetail.get(id) === 'FAILED');
  if (failedIds.length === 0) {
    throw new PayrollLifecycleError(
      'NOTHING_TO_RETRY',
      'No payslip in this run has a failed B2C attempt.',
      409,
    );
  }

  const details = await db.payrollDetail.findMany({
    where: {
      id: { in: failedIds },
      paymentStatus: 'PENDING',
      netPay: { gt: 0 },
      // v2.34.0: row-level Retry narrows the sweep to the clicked payslip
      // (ids outside this run simply cannot match failedIds, so no extra
      // validation pass is needed).
      ...(detailIds && detailIds.length > 0 ? { id: { in: detailIds } } : {}),
    },
    include: {
      employee: { select: { employeeCode: true, firstName: true, lastName: true, phone: true } },
    },
    orderBy: { id: 'asc' },
  });

  const summary: B2CDisburseSummary = {
    mode: mock ? 'mock' : 'daraja',
    eligible: details.length,
    initiated: 0,
    alreadyInitiated: 0,
    skipped: [],
    failed: [],
    receipts: [],
    backoffSkipped: 0,
    maxAttemptSkipped: 0,
  };

  const nowMs = Date.now();
  for (const detail of details) {
    const code = detail.employee.employeeCode || detail.employeeId;
    // v2.33.0 retry discipline: the same pure gate the run summary uses.
    // Ceil-blocked payslips are never re-fired from the UI; backoff-blocked
    // ones return the exact remaining wait so the manager knows when to
    // come back instead of discovering it from a Daraja rejection.
    const txList = txsByDetail.get(detail.id) ?? [];
    const failedAttempts = txList.filter((t) => t.status === 'FAILED').length;
    const latestFailedAt = [...txList].reverse().find((t) => t.status === 'FAILED')?.createdAt ?? null;
    const gate = evaluateB2CRetryGate(failedAttempts, latestFailedAt ? latestFailedAt.getTime() : null, nowMs);
    if (!gate.allowed) {
      if (gate.maxReached) {
        summary.maxAttemptSkipped = (summary.maxAttemptSkipped ?? 0) + 1;
        summary.skipped.push({
          employeeCode: code,
          reason: `Max retry attempts (${B2C_MAX_RETRY_ATTEMPTS}) reached - investigate in the Daraja portal before retrying.`,
        });
      } else {
        summary.backoffSkipped = (summary.backoffSkipped ?? 0) + 1;
        summary.skipped.push({
          employeeCode: code,
          reason: `Backoff active - retry available in ${formatB2CRetryWait(gate.waitMs)}.`,
        });
      }
      continue;
    }
    if (!detail.employee.phone) {
      summary.skipped.push({ employeeCode: code, reason: 'No M-Pesa phone number on the employee record.' });
      continue;
    }
    try {
      const result = await initiatePayrollB2C({
        phone: detail.employee.phone,
        amount: Number(detail.netPay),
        storeId: ctx.storeId,
        payrollDetailId: detail.id,
        employeeCode: code,
        periodName: run.payrollPeriod.name,
      });
      if (result.alreadyInitiated) {
        summary.alreadyInitiated += 1;
        continue;
      }
      summary.initiated += 1;
      if (result.mode === 'mock' && result.status === 'COMPLETED' && result.receiptNumber) {
        await withImmutabilityBypass(async () =>
          db.payrollDetail.update({
            where: { id: detail.id },
            data: {
              paymentStatus: 'PAID',
              paymentDate: new Date(),
              paymentRef: `MPESA-${result.receiptNumber}`,
            },
          }),
          'payroll_b2c_mock_settle',
        );
        summary.receipts.push({ employeeCode: code, receipt: result.receiptNumber });
      }
    } catch (error) {
      summary.failed.push({
        employeeCode: code,
        code: 'B2C_RETRY_FAILED',
        message: error instanceof Error ? error.message : 'Unknown B2C failure',
      });
    }
  }

  if (summary.initiated > 0 && summary.failed.length === 0 && summary.mode === 'mock') {
    const remaining = await db.payrollDetail.count({
      where: { payrollRunId: run.id, paymentStatus: 'PENDING', netPay: { gt: 0 } },
    });
    if (remaining === 0 && !run.paidAt) {
      await db.payrollRun.update({ where: { id: run.id }, data: { paidAt: new Date() } });
    }
  }

  await hrAudit({
    actorId: ctx.actorId,
    actorRole: 'SYSTEM',
    action: 'UPDATE',
    resourceType: HrEntityType.PAYROLL_RUN,
    resourceId: run.id,
    storeId: ctx.storeId,
    metadata: {
      b2cRetry: true,
      mode: summary.mode,
      mockOptIn: mock && production ? true : undefined,
      eligible: summary.eligible,
      initiated: summary.initiated,
      failed: summary.failed.length,
      backoffSkipped: summary.backoffSkipped ?? 0,
      maxAttemptSkipped: summary.maxAttemptSkipped ?? 0,
    },
  });

  return summary;
}

export interface B2CStaleResult {
  mode: 'daraja' | 'mock';
  queried: number;
  settled: number;
  receipts: Array<{ employeeCode: string; receipt: string }>;
  message: string;
}

/**
 * Re-query stuck PROCESSING disbursements (no result callback for
 * B2C_STALE_PROCESSING_MS). Real mode: fires the Daraja Transaction Status
 * query — the definitive result re-arrives on the result webhook and settles
 * through the existing idempotent path. Mock mode: resolves each stuck
 * transaction immediately so QA exercises the settle loop.
 */
export async function refreshStuckPayrollB2C(
  ctx: RunActorContext,
  runId: string,
): Promise<B2CStaleResult> {
  const run = await db.payrollRun.findFirst({ where: { id: runId, storeId: ctx.storeId } });
  if (!run) {
    throw new PayrollLifecycleError('RUN_NOT_FOUND', 'Payroll run not found.', 404);
  }

  const cutoff = new Date(Date.now() - B2C_STALE_PROCESSING_MS);
  const ids = await runDetailIds(run.id);
  const stuck = ids.length
    ? await db.mpesaTransaction.findMany({
        where: {
          payrollDetailId: { in: ids },
          status: 'PROCESSING',
          callbackReceived: false,
          createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, checkoutRequestId: true, payrollDetailId: true, createdAt: true },
      })
    : [];

  const result: B2CStaleResult = {
    mode: isB2CConfigured() ? 'daraja' : 'mock',
    queried: 0,
    settled: 0,
    receipts: [],
    message: '',
  };

  // Employee codes for audit/receipt attribution (no PII leaves the service).
  const detailRows = stuck.length
    ? await db.payrollDetail.findMany({
        where: { id: { in: stuck.map((t) => t.payrollDetailId).filter((v): v is string => Boolean(v)) } },
        select: { id: true, paymentStatus: true, employee: { select: { employeeCode: true } } },
      })
    : [];
  const codeById = new Map(detailRows.map((d) => [d.id, d.employee.employeeCode || d.id]));
  const paidStatusById = new Map(detailRows.map((d) => [d.id, d.paymentStatus]));

  for (const tx of stuck) {
    if (!tx.payrollDetailId) continue;
    // Belt-and-braces age check: the query already filters on createdAt, but
    // never trust a stale row that raced past the cutoff between query and loop.
    if (tx.createdAt.getTime() > Date.now() - B2C_STALE_PROCESSING_MS) continue;
    const code = codeById.get(tx.payrollDetailId) || 'employee';
    result.queried += 1;
    try {
      const q = await queryPayrollB2CStatus({
        originatorConversationId: tx.checkoutRequestId || '',
        storeId: ctx.storeId,
        employeeCode: code,
      });
      if (q.status === 'COMPLETED' && q.receiptNumber && paidStatusById.get(tx.payrollDetailId) === 'PENDING') {
        // Same settle path as the webhook: payslip PENDING → PAID.
        await withImmutabilityBypass(async () =>
          db.payrollDetail.update({
            where: { id: tx.payrollDetailId as string },
            data: {
              paymentStatus: 'PAID',
              paymentDate: new Date(),
              paymentRef: `MPESA-${q.receiptNumber}`,
            },
          }),
          'payroll_b2c_status_query_settle',
        );
        paidStatusById.set(tx.payrollDetailId, 'PAID');
        result.settled += 1;
        result.receipts.push({ employeeCode: code, receipt: q.receiptNumber });
      }
    } catch (error) {
      // Per-transaction isolation: one failed query never blocks the rest.
      result.message = error instanceof Error ? error.message : 'Status query failure';
    }
  }

  if (!result.message) {
    result.message =
      result.queried === 0
        ? 'No stuck transactions to re-query.'
        : result.mode === 'daraja'
          ? `${result.queried} stuck transaction(s) re-queried; Safaricom re-sends the result and payslips settle automatically.`
          : `${result.settled} stuck transaction(s) resolved.`;
  }

  await hrAudit({
    actorId: ctx.actorId,
    actorRole: 'SYSTEM',
    action: 'UPDATE',
    resourceType: HrEntityType.PAYROLL_RUN,
    resourceId: run.id,
    storeId: ctx.storeId,
    metadata: {
      b2cStatusQuery: true,
      mode: result.mode,
      queried: result.queried,
      settled: result.settled,
    },
  });

  return result;
}
