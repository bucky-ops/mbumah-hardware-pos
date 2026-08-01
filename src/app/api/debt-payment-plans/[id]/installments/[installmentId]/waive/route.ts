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
  toNumber,
  recalculatePlanTotals,
  getPlanStatus,
} from '@/lib/debt-plan-utils';

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

  if (plan.status !== 'ACTIVE' && plan.status !== 'PAUSED') {
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

  const waivedAmount = toNumber(installment.amountDue);

  const result = await db.$transaction(async (tx) => {
    // 1. Mark the installment WAIVED.
    const updatedInstallment = await tx.debtPlanInstallment.update({
      where: { id: installmentId },
      data: {
        status: 'WAIVED',
        waiverReason,
      },
    });

    // 2. Reduce the plan's totalAmount by the waived installment's amountDue
    //    so that `balance = totalAmount - amountPaid` stays consistent
    //    (a waived installment is no longer owed).
    const newTotalAmount = toNumber(plan.totalAmount) - waivedAmount;

    // 3. Recompute plan totals from installments (with the waived one).
    const refreshedInstallments = plan.installments.map((i) =>
      i.id === installmentId
        ? { ...i, status: 'WAIVED' as const }
        : i,
    );
    const totals = recalculatePlanTotals(
      { ...plan, totalAmount: newTotalAmount },
      refreshedInstallments,
    );

    let newPlanStatus = getPlanStatus({
      ...plan,
      ...totals,
      totalAmount: newTotalAmount,
    });
    if (totals.balance <= 0.001) {
      newPlanStatus = 'COMPLETED';
    }

    const updatedPlan = await tx.debtPaymentPlan.update({
      where: { id },
      data: {
        totalAmount: newTotalAmount,
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
    if (plan.debtLedger) {
      const debt = plan.debtLedger;
      const newAmountOwed = toNumber(debt.amountOwed) - waivedAmount;
      const newBalance = Math.max(0, newAmountOwed - toNumber(debt.amountPaid));
      let newDebtStatus = debt.status;
      if (newBalance <= 0.001) {
        newDebtStatus = 'SETTLED';
      }
      await tx.debtLedger.update({
        where: { id: debt.id },
        data: {
          amountOwed: newAmountOwed,
          balance: newBalance,
          status: newDebtStatus,
        },
      });

      await tx.customer.update({
        where: { id: plan.customerId },
        data: { currentDebtBalance: { decrement: waivedAmount } },
      });
    }

    return { updatedInstallment, updatedPlan };
  });

  await systemLog({
    action: 'DEBT_PLAN_INSTALLMENT_WAIVED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Installment ${installment.installmentNumber} on plan ${id} waived (KES ${waivedAmount.toLocaleString()}). Reason: ${waiverReason}`,
    storeId: plan.storeId,
    userId: session.userId,
    metadata: {
      planId: id,
      installmentId,
      waivedAmount,
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

  const serialized = finalPlan && {
    ...finalPlan,
    totalAmount: toNumber(finalPlan.totalAmount),
    installmentAmount: toNumber(finalPlan.installmentAmount),
    amountPaid: toNumber(finalPlan.amountPaid),
    balance: toNumber(finalPlan.balance),
    interestRate: toNumber(finalPlan.interestRate),
    lateFee: toNumber(finalPlan.lateFee),
    installments: finalPlan.installments.map((i) => ({
      ...i,
      amountDue: toNumber(i.amountDue),
      amountPaid: toNumber(i.amountPaid),
      lateFeeApplied: toNumber(i.lateFeeApplied),
    })),
    debtLedger: finalPlan.debtLedger
      ? {
          ...finalPlan.debtLedger,
          amountOwed: toNumber(finalPlan.debtLedger.amountOwed),
          balance: toNumber(finalPlan.debtLedger.balance),
        }
      : null,
  };

  return Response.json({
    success: true,
    data: {
      plan: serialized,
      installment: {
        ...result.updatedInstallment,
        amountDue: toNumber(result.updatedInstallment.amountDue),
        amountPaid: toNumber(result.updatedInstallment.amountPaid),
        lateFeeApplied: toNumber(result.updatedInstallment.lateFeeApplied),
      },
    },
  });
}

export const POST = withErrorBoundary(
  withFinancialAuth(waiveInstallmentHandler, WRITE_ROLES),
  'DEBT_PLAN_INSTALLMENT_WAIVE',
);
