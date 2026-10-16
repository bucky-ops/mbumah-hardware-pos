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
import { isB2CConfigured, initiatePayrollB2C } from '@/lib/mpesa-b2c';
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
  };

  for (const detail of details) {
    const code = detail.employee.employeeCode || detail.employeeId;
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
      }
    } catch (error) {
      summary.failed.push({
        employeeCode: code,
        code: 'B2C_INITIATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown B2C failure',
      });
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
