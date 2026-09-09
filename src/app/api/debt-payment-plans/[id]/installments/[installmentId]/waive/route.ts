// POST /api/debt-payment-plans/[id]/installments/[installmentId]/waive
//
// Mark an installment as WAIVED (e.g. customer goodwill, dispute resolution).
// Recalculates the parent plan totals. Waived installments are NOT counted
// as paid — they are removed from the outstanding balance calculation via
// the recalculation rule (waived installments contribute nothing to
// amountPaid, but their `amountDue` is also no longer owed, so we explicitly
// reduce the plan's `totalAmount` by the waived amount to keep the
// denormalized balance correct).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  recalculatePlanTotals,
  getPlanStatus,
  serializePlanRow,
  serializeInstallmentRow,
} from '@/lib/debt-plan-utils';
// Task 12-c: canonical financial math (HALF_UP 2dp). Prisma Decimal
// `valueOf()` returns a STRING — `totalAmount − waivedAmount` used to coerce
// through float, and the waive writes were read-modify-write (double-waive
// race). Money math below is Decimal; mutations are conditional claims.
import { toDec, round2 } from '@/lib/utils/financialMath';

// Typed in-transaction conflict for the optimistic claims (count 0).
// Caught in the handler → client-facing 400 (same pattern as
// CreditLimitExceededError in src/app/api/transactions/route.ts).
class InstallmentClaimConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallmentClaimConflictError';
  }
}

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string; installmentId: string }>;
}

async function waiveInstallmentHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id, installmentId } = await context.params;
  const body = await request.json();

  const waiverReason =
    typeof body?.waiverReason === 'string' && body.waiverReason.trim().length > 0
      ? body.waiverReason.trim()
      : null;

  if (!waiverReason) {
    return Response.json(
      { success: false, error: 'A waiver reason is required.' },
      { status: 400 },
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const plan = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      debtLedger: true,
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });

  if (!plan) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  // Task 12-d (debt-plan audit): DEFAULTED plans accept waivers so a
  // delinquent plan can be cured (or fully waived to completion) — the old
  // guard left DEFAULTED plans with no exit at all.
  if (!['ACTIVE', 'PAUSED', 'DEFAULTED'].includes(plan.status)) {
    return Response.json(
      {
        success: false,
        error: `Cannot waive installments on a plan with status "${plan.status}".`,
      },
      { status: 400 },
    );
  }

  const installment = plan.installments.find((i) => i.id === installmentId);
  if (!installment) {
    return Response.json(
      { success: false, error: 'Installment not found on this plan.' },
      { status: 404 },
    );
  }

  if (installment.status === 'PAID' || installment.status === 'WAIVED') {
    return Response.json(
      {
        success: false,
        error: `Cannot waive an installment that is already ${installment.status.toLowerCase()}.`,
      },
      { status: 400 },
    );
  }

  // Task 12-d: the waived amount is NO LONGER computed here from the
  // outside-tx read — only the UNPAID remainder of the installment is
  // forgiven, and that must be derived from the authoritative in-transaction
  // row (see below). The old code waived the full amountDue even for a
  // PARTIAL installment: the paid portion had already been collected (the
  // pay route decrements the debt ledger + customer balance at pay time), so
  // waiving the full amount double-credited the customer by amountPaid and
  // understated the plan balance by the same amount.

  const result = await db.$transaction(async (tx) => {
    // 1. Mark the installment WAIVED — ATOMIC conditional claim (was an
    //    unconditional update after an outside-tx status read; two concurrent
    //    waives both passed and both wrote).
    const claimedInstallment = await tx.debtPlanInstallment.updateMany({
      where: {
        id: installmentId,
        status: { in: ['SCHEDULED', 'PARTIAL', 'OVERDUE', 'MISSED'] },
      },
      data: {
        status: 'WAIVED',
        waiverReason,
      },
    });
    if (claimedInstallment.count === 0) {
      throw new InstallmentClaimConflictError(
        'Waiver conflict: the installment is already paid, waived, or concurrently claimed. Refresh and retry.'
      );
    }
    // Re-read INSIDE the tx for the authoritative claimed row.
    const updatedInstallment = await tx.debtPlanInstallment.findUniqueOrThrow({
      where: { id: installmentId },
    });

    // Task 12-d: waive only the UNPAID remainder (amountDue − amountPaid).
    // Computing this from the in-tx row also closes the outside-read → claim
    // race where a concurrent pay would have been missed by a stale snapshot.
    const remainingDueDec = toDec(updatedInstallment.amountDue).minus(
      toDec(updatedInstallment.amountPaid),
    );
    if (remainingDueDec.lte('0.001')) {
      throw new InstallmentClaimConflictError(
        'Waiver conflict: the installment was fully paid concurrently. Refresh and retry.'
      );
    }
    const waivedAmountDec = remainingDueDec;
    const waivedAmount = round2(waivedAmountDec);

    // 2. Reduce the plan totalAmount by the WAIVED REMAINDER (not amountDue)
    //    so that `balance = totalAmount - amountPaid` stays consistent
    //    (a waived installment is no longer owed).
    //    Task 12-c: exact Decimal subtraction (was float) and the write uses
    //    an ATOMIC decrement instead of an absolute overwrite.
    const newTotalAmountDec = toDec(plan.totalAmount).minus(waivedAmountDec);

    // 3. Recompute plan totals from a FRESH in-transaction read of all
    //    installments (the claim above is already visible to this read).
    //    Task 12-d: the old code re-used the outside-tx snapshot — a
    //    concurrent pay or waive on a DIFFERENT installment of the same plan
    //    could be silently reverted by this absolute totals write (lost
    //    update). Reading inside the tx closes that window.
    const freshInstallments = await tx.debtPlanInstallment.findMany({
      where: { planId: id },
      orderBy: { installmentNumber: 'asc' },
    });
    const totals = recalculatePlanTotals(
      { ...plan, totalAmount: newTotalAmountDec },
      freshInstallments,
    );

    let newPlanStatus = getPlanStatus({
      ...plan,
      ...totals,
      totalAmount: newTotalAmountDec,
    });
    if (toDec(totals.balance).lte('0.001')) {
      newPlanStatus = 'COMPLETED';
    }

    const updatedPlan = await tx.debtPaymentPlan.update({
      where: { id },
      data: {
        // Atomic decrement — the read-then-write absolute totalAmount allowed
        // a concurrent waive of a different installment to be overwritten.
        totalAmount: { decrement: waivedAmount },
        amountPaid: totals.amountPaid,
        balance: totals.balance,
        installmentsPaid: totals.installmentsPaid,
        installmentsOverdue: totals.installmentsOverdue,
        status: newPlanStatus,
        completedAt: newPlanStatus === 'COMPLETED' ? new Date() : null,
      },
    });

    // 4. Mirror the waiver onto the underlying DebtLedger: reduce amountOwed
    //    so the customer's overall debt balance drops accordingly. This is
    //    effectively a write-off of one installment's worth of debt.
    //    Task 12-d: decrement by the UNPAID remainder (was the full
    //    amountDue — double-credited the paid portion), and ATOMIC
    //    conditional decrements (was read-modify-write of absolute values
    //    with a float Math.max(0, …) clamp).
    if (plan.debtLedger) {
      const debt = plan.debtLedger;
      const claimedDebt = await tx.debtLedger.updateMany({
        where: {
          id: debt.id,
          balance: { gte: waivedAmount },
        },
        data: {
          amountOwed: { decrement: waivedAmount },
          balance: { decrement: waivedAmount },
        },
      });
      if (claimedDebt.count === 0) {
        throw new InstallmentClaimConflictError(
          'Debt ledger waiver conflict: balance changed or already settled. Refresh and retry.'
        );
      }

      // Re-read INSIDE the tx for the authoritative post-claim state.
      const freshDebt = await tx.debtLedger.findUniqueOrThrow({ where: { id: debt.id } });
      let newDebtStatus = debt.status;
      if (toDec(freshDebt.balance).lte('0.001')) {
        newDebtStatus = 'SETTLED';
      }
      await tx.debtLedger.update({
        where: { id: debt.id },
        data: {
          status: newDebtStatus,
        },
      });

      await tx.customer.update({
        where: { id: plan.customerId },
        data: { currentDebtBalance: { decrement: waivedAmount } },
      });
    }

    // Task 12-e (production hotfix): return `waivedAmount` so the post-tx
    // systemLog can reference it. It was previously scoped to this callback
    // only — the log statement below raised `ReferenceError: waivedAmount is
    // not defined`, so every SUCCESSFUL waiver committed the transaction and
    // then answered HTTP 500 (withErrorBoundary). Money moved; the UI showed
    // an error. invisibleBuildErrors (ts ignoreBuildErrors + advisory
    // typecheck) let the scoping bug ship.
    return { updatedInstallment, updatedPlan, waivedAmount };
  }).catch((err: unknown) => {
    // Map the typed in-transaction claim conflicts to client-facing 400s.
    if (err instanceof InstallmentClaimConflictError) {
      return Response.json(
        { success: false, error: err.message },
        { status: 400 },
      );
    }
    throw err;
  });

  // Early-return shape for the conflict path (typed narrow).
  if (result instanceof Response) {
    return result;
  }

  await systemLog({
    action: 'DEBT_PLAN_INSTALLMENT_WAIVED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Installment ${installment.installmentNumber} on plan ${id} waived (KES ${result.waivedAmount.toLocaleString()}). Reason: ${waiverReason}`,
    storeId: plan.storeId,
    userId: session.userId,
    metadata: {
      planId: id,
      installmentId,
      waivedAmount: result.waivedAmount,
      waiverReason,
      newPlanStatus: result.updatedPlan.status,
    },
  });

  // Reload full plan for response.
  const finalPlan = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true },
      },
      debtLedger: {
        select: { id: true, amountOwed: true, balance: true, status: true },
      },
      installments: { orderBy: { installmentNumber: 'asc' } },
    },
  });

  const serialized = finalPlan ? serializePlanRow(finalPlan) : null;

  return Response.json({
    success: true,
    data: {
      plan: serialized,
      installment: serializeInstallmentRow(result.updatedInstallment),
    },
  });
}

export const POST = withErrorBoundary(
  withFinancialAuth(waiveInstallmentHandler, WRITE_ROLES),
  'DEBT_PLAN_INSTALLMENT_WAIVE',
);
