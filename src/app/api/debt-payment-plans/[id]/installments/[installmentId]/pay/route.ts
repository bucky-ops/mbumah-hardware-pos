// POST /api/debt-payment-plans/[id]/installments/[installmentId]/pay
//
// Record a payment against a single installment. The payment:
//   1. Updates the installment's amountPaid/status (PAID if full, PARTIAL otherwise)
//   2. Recalculates the parent plan's denormalized totals
//   3. Marks the plan COMPLETED if balance reaches zero
//   4. Records a DebtPayment against the underlying DebtLedger (so existing
//      debt accounting — customer.currentDebtBalance, journal entry, cash
//      drawer log — stays consistent)
//
// All of the above happens in a single `db.$transaction`.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { generateJournalEntryNumber, calculateAgingBucket } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { toNumber, recalculatePlanTotals, getPlanStatus } from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string; installmentId: string }>;
}

const VALID_PAYMENT_METHODS = ['CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE'] as const;
type PaymentMethod = (typeof VALID_PAYMENT_METHODS)[number];

async function payInstallmentHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id, installmentId } = await context.params;
  const body = await request.json();

  const { amount, paymentMethod, paymentReference } = body ?? {};

  // ── Validate input ────────────────────────────────────────────────────────
  const payAmount = toNumber(amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return Response.json(
      { success: false, error: 'Amount must be greater than zero.' },
      { status: 400 },
    );
  }

  const method: PaymentMethod = VALID_PAYMENT_METHODS.includes(paymentMethod)
    ? paymentMethod
    : 'CASH';

  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  // ── Load plan + installment + debt ledger ────────────────────────────────
  const plan = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, currentDebtBalance: true } },
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
        error: `Cannot record payment on a plan with status "${plan.status}". Plan must be ACTIVE.`,
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
        error: `Installment is already ${installment.status.toLowerCase()}.`,
      },
      { status: 400 },
    );
  }

  const remainingOnInstallment =
    toNumber(installment.amountDue) - toNumber(installment.amountPaid);
  if (payAmount > remainingOnInstallment + 0.01) {
    return Response.json(
      {
        success: false,
        error: `Payment amount (KES ${payAmount.toLocaleString()}) exceeds remaining installment balance (KES ${remainingOnInstallment.toLocaleString()}).`,
      },
      { status: 400 },
    );
  }

  // Also guard against overpaying the plan as a whole.
  if (payAmount > toNumber(plan.balance) + 0.01) {
    return Response.json(
      {
        success: false,
        error: `Payment amount (KES ${payAmount.toLocaleString()}) exceeds plan balance (KES ${toNumber(plan.balance).toLocaleString()}).`,
      },
      { status: 400 },
    );
  }

  // ── Execute the payment transaction ──────────────────────────────────────
  const result = await db.$transaction(async (tx) => {
    const newInstPaid = toNumber(installment.amountPaid) + payAmount;
    const newInstBalance = toNumber(installment.amountDue) - newInstPaid;
    const newInstStatus =
      newInstBalance <= 0.001 ? 'PAID' : 'PARTIAL';

    // 1. Update the installment row.
    const updatedInstallment = await tx.debtPlanInstallment.update({
      where: { id: installmentId },
      data: {
        amountPaid: newInstPaid,
        status: newInstStatus,
        paidAt: new Date(),
        paymentMethod: method,
        paymentReference: typeof paymentReference === 'string' ? paymentReference : null,
      },
    });

    // 2. Recompute plan totals from all installments.
    const refreshedInstallments = plan.installments.map((i) =>
      i.id === installmentId ? { ...i, ...updatedInstallment } : i,
    );
    const totals = recalculatePlanTotals(plan, refreshedInstallments);

    // 3. Derive new plan status — COMPLETED if balance is now 0.
    let newPlanStatus = getPlanStatus({
      ...plan,
      ...totals,
    });
    if (totals.balance <= 0.001) {
      newPlanStatus = 'COMPLETED';
    }

    const updatedPlan = await tx.debtPaymentPlan.update({
      where: { id },
      data: {
        amountPaid: totals.amountPaid,
        balance: totals.balance,
        installmentsPaid: totals.installmentsPaid,
        installmentsOverdue: totals.installmentsOverdue,
        status: newPlanStatus,
        completedAt: newPlanStatus === 'COMPLETED' ? new Date() : null,
      },
    });

    // 4. Mirror the payment onto the underlying DebtLedger + customer.
    const debt = plan.debtLedger;
    if (debt) {
      const newDebtPaid = toNumber(debt.amountPaid) + payAmount;
      const newDebtBalance = toNumber(debt.amountOwed) - newDebtPaid;
      let newDebtStatus = debt.status;
      if (newDebtBalance <= 0.001) {
        newDebtStatus = 'SETTLED';
      } else if (newDebtPaid > 0) {
        newDebtStatus = 'PARTIAL';
      }
      await tx.debtLedger.update({
        where: { id: debt.id },
        data: {
          amountPaid: newDebtPaid,
          balance: Math.max(0, newDebtBalance),
          status: newDebtStatus,
          agingBucket: calculateAgingBucket(debt.dueDate),
        },
      });

      await tx.debtPayment.create({
        data: {
          storeId: plan.storeId,
          debtLedgerId: debt.id,
          amount: payAmount,
          paymentMethod: method,
          reference: typeof paymentReference === 'string' ? paymentReference : null,
          receivedBy: session.userId,
        },
      });

      await tx.customer.update({
        where: { id: plan.customerId },
        data: { currentDebtBalance: { decrement: payAmount } },
      });

      // Cash drawer log for CASH payments.
      if (method === 'CASH') {
        const lastDrawer = await tx.cashDrawerLog.findFirst({
          where: { storeId: plan.storeId },
          orderBy: { createdAt: 'desc' },
        });
        const currentBalance = lastDrawer?.balance ? toNumber(lastDrawer.balance) : 0;
        await tx.cashDrawerLog.create({
          data: {
            storeId: plan.storeId,
            userId: session.userId,
            action: 'CASH_IN',
            amount: payAmount,
            balance: currentBalance + payAmount,
            notes: `Installment payment from ${plan.customer?.name ?? 'customer'} (Plan #${plan.id.slice(-6)})`,
          },
        });
      }

      // Journal entry — debit cash/mpesa, credit accounts receivable.
      const store = await tx.store.findUnique({
        where: { id: plan.storeId },
        select: { organizationId: true },
      });
      const orgId = store?.organizationId || 'org_mbumah';
      const accounts = await getAccountIds(orgId, [
        ACCOUNT_CODES.CASH_ON_HAND,
        ACCOUNT_CODES.MPESA_ACCOUNT,
        ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
      ]);
      const cashAccountId =
        method === 'CASH' ? accounts.CASH_ON_HAND : accounts.MPESA_ACCOUNT;

      await tx.journalEntry.create({
        data: {
          storeId: plan.storeId,
          entryNumber: generateJournalEntryNumber(),
          description: `Installment payment from ${plan.customer?.name ?? 'customer'} — Plan #${plan.id.slice(-6)} (KES ${payAmount.toLocaleString()})`,
          referenceType: 'DEBT_PAYMENT_PLAN',
          referenceId: plan.id,
          totalDebit: payAmount,
          totalCredit: payAmount,
          isPosted: true,
          postedAt: new Date(),
          createdBy: session.userId,
          lines: {
            create: [
              {
                accountId: cashAccountId,
                debit: payAmount,
                credit: 0,
                description: `Installment payment received — ${method}`,
              },
              {
                accountId: accounts.ACCOUNTS_RECEIVABLE,
                debit: 0,
                credit: payAmount,
                description: `Reduce A/R for ${plan.customer?.name ?? 'customer'}`,
              },
            ],
          },
        },
      });
    }

    return { updatedInstallment, updatedPlan };
  });

  await systemLog({
    action: 'DEBT_PLAN_INSTALLMENT_PAID',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Installment ${installment.installmentNumber} on plan ${id} paid KES ${payAmount.toLocaleString()} via ${method}.`,
    storeId: plan.storeId,
    userId: session.userId,
    metadata: {
      planId: id,
      installmentId,
      amount: payAmount,
      paymentMethod: method,
      paymentReference: paymentReference || null,
      newPlanStatus: result.updatedPlan.status,
      newPlanBalance: toNumber(result.updatedPlan.balance),
    },
  });

  // Reload the full plan (with installments + customer) for the response.
  const finalPlan = await db.debtPaymentPlan.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, name: true, phone: true, email: true, currentDebtBalance: true },
      },
      debtLedger: {
        select: { id: true, amountOwed: true, balance: true, status: true },
      },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
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
  withFinancialAuth(payInstallmentHandler, WRITE_ROLES),
  'DEBT_PLAN_INSTALLMENT_PAY',
);
