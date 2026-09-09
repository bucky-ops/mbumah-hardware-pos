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
import { toNumber, recalculatePlanTotals, getPlanStatus, serializePlanRow, serializeInstallmentRow } from '@/lib/debt-plan-utils';
// Task 12-c: canonical financial math (HALF_UP 2dp). Prisma Decimal
// `valueOf()` returns a STRING — the old float/tolerance math and the
// read-then-write on the installment + DebtLedger allowed concurrent
// double-pay. Money math below is Decimal; balance mutations are atomic
// conditional claims (updateMany + count check), mirroring the R3 pattern
// in src/app/api/debt/route.ts.
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
  // Task 12-c: money rounded HALF_UP to 2dp before it touches Decimal columns.
  const payNum = round2(payAmount);
  const payDec = toDec(payNum);

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

  // Task 12-d (debt-plan audit): DEFAULTED plans accept catch-up payments.
  // getPlanStatus flips a plan to DEFAULTED at ≥25% overdue installments, and
  // the old guard then made it impossible to record the very payments that
  // would cure the default (pay/waive required ACTIVE/PAUSED, and PATCH had
  // no transition out of DEFAULTED — the plan was bricked). The status
  // re-derivation below automatically promotes the plan back to ACTIVE once
  // the overdue ratio drops under the threshold.
  if (!['ACTIVE', 'PAUSED', 'DEFAULTED'].includes(plan.status)) {
    return Response.json(
      {
        success: false,
        error: `Cannot record payment on a plan with status "${plan.status}". Only ACTIVE, PAUSED, or DEFAULTED plans accept payments.`,
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

  // Task 12-c: Decimal comparisons with the original 0.01 tolerance kept as
  // an exact Decimal constant (was float `payAmount > remaining + 0.01`).
  const OVERPAY_TOLERANCE = toDec('0.01');

  const remainingOnInstallmentDec = toDec(installment.amountDue).minus(toDec(installment.amountPaid));
  if (payDec.gt(remainingOnInstallmentDec.plus(OVERPAY_TOLERANCE))) {
    return Response.json(
      {
        success: false,
        error: `Payment amount (KES ${payDec.toNumber().toLocaleString()}) exceeds remaining installment balance (KES ${round2(remainingOnInstallmentDec).toLocaleString()}).`,
      },
      { status: 400 },
    );
  }

  // Also guard against overpaying the plan as a whole.
  const planBalanceDec = toDec(plan.balance);
  if (payDec.gt(planBalanceDec.plus(OVERPAY_TOLERANCE))) {
    return Response.json(
      {
        success: false,
        error: `Payment amount (KES ${payDec.toNumber().toLocaleString()}) exceeds plan balance (KES ${round2(planBalanceDec).toLocaleString()}).`,
      },
      { status: 400 },
    );
  }

  // ── Execute the payment transaction ─────────────────────────────────────
  const result = await db.$transaction(async (tx) => {
    // Task 12-c: ATOMIC installment claim. The old code read amountPaid,
    // computed an absolute `amountPaid + pay` and wrote it back — two
    // concurrent submissions both passed the PAID check and both wrote
    // (double-pay). The status predicate makes the claim conditional: at
    // most ONE concurrent request can increment a non-settled installment.
    const claimedInstallment = await tx.debtPlanInstallment.updateMany({
      where: {
        id: installmentId,
        status: { in: ['SCHEDULED', 'PARTIAL', 'OVERDUE', 'MISSED'] },
      },
      data: {
        amountPaid: { increment: payNum },
        paidAt: new Date(),
        paymentMethod: method,
        paymentReference: typeof paymentReference === 'string' ? paymentReference : null,
      },
    });
    if (claimedInstallment.count === 0) {
      throw new InstallmentClaimConflictError(
        'Installment payment conflict: already paid, waived, or concurrently claimed. Refresh and retry.'
      );
    }

    // Re-read INSIDE the tx for the authoritative post-claim state.
    const claimedRow = await tx.debtPlanInstallment.findUniqueOrThrow({
      where: { id: installmentId },
    });
    const newInstPaidDec = toDec(claimedRow.amountPaid);
    const newInstBalanceDec = toDec(claimedRow.amountDue).minus(newInstPaidDec);
    const newInstStatus = newInstBalanceDec.lte('0.001') ? 'PAID' : 'PARTIAL';

    // 1. Persist the derived status (amountPaid was already claimed above).
    const updatedInstallment = await tx.debtPlanInstallment.update({
      where: { id: installmentId },
      data: {
        status: newInstStatus,
      },
    });

    // 2. Recompute plan totals from a FRESH in-transaction read of all
    //    installments. Task 12-d: the old code re-used the outside-tx
    //    snapshot with only this installment patched — a concurrent pay or
    //    waive on a DIFFERENT installment of the same plan could land between
    //    our read and our absolute totals write, and the loser silently
    //    reverted the winner's amountPaid/balance (lost update). The
    //    installment-level claims were atomic, but the plan-row totals write
    //    was read-modify-write; re-reading inside the tx closes that window.
    const freshInstallments = await tx.debtPlanInstallment.findMany({
      where: { planId: id },
      orderBy: { installmentNumber: 'asc' },
    });
    const totals = recalculatePlanTotals(plan, freshInstallments);

    // 3. Derive new plan status — COMPLETED if balance is now 0 (exact
    // Decimal comparison, was float `totals.balance <= 0.001`).
    let newPlanStatus = getPlanStatus({
      ...plan,
      ...totals,
    });
    if (toDec(totals.balance).lte('0.001')) {
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
      // Task 12-c: ATOMIC conditional claim (R3 pattern from
      // src/app/api/debt/route.ts) — was read-modify-write of amountPaid +
      // absolute balance, which could double-pay the ledger concurrently.
      const claimedDebt = await tx.debtLedger.updateMany({
        where: {
          id: debt.id,
          status: { notIn: ['SETTLED', 'WRITTEN_OFF'] },
          balance: { gte: payNum },
        },
        data: {
          amountPaid: { increment: payNum },
          balance: { decrement: payNum },
        },
      });
      if (claimedDebt.count === 0) {
        throw new InstallmentClaimConflictError(
          'Debt ledger payment conflict: balance changed or already settled. Refresh and retry.'
        );
      }

      // Re-read INSIDE the tx for the authoritative post-claim state.
      const freshDebt = await tx.debtLedger.findUniqueOrThrow({ where: { id: debt.id } });
      const newDebtPaidDec = toDec(freshDebt.amountPaid);
      const newDebtBalanceDec = toDec(freshDebt.balance);
      let newDebtStatus = debt.status;
      if (newDebtBalanceDec.lte('0.001')) {
        newDebtStatus = 'SETTLED';
      } else if (newDebtPaidDec.gt(0)) {
        newDebtStatus = 'PARTIAL';
      }
      await tx.debtLedger.update({
        where: { id: debt.id },
        data: {
          status: newDebtStatus,
          agingBucket: calculateAgingBucket(debt.dueDate),
        },
      });

      await tx.debtPayment.create({
        data: {
          storeId: plan.storeId,
          debtLedgerId: debt.id,
          amount: payNum,
          paymentMethod: method,
          reference: typeof paymentReference === 'string' ? paymentReference : null,
          receivedBy: session.userId,
        },
      });

      await tx.customer.update({
        where: { id: plan.customerId },
        data: { currentDebtBalance: { decrement: payNum } },
      });

      // Cash drawer log for CASH payments.
      if (method === 'CASH') {
        // AUDIT FIX: read-latest-row lost-update race → aggregate _sum pattern
        // (same as src/app/api/transactions/route.ts R6 remediation). The
        // latest row's balance can be stale under concurrent drawer writes.
        const drawerAgg = await tx.cashDrawerLog.aggregate({
          where: { storeId: plan.storeId },
          _sum: { amount: true },
        });
        // Task 12-c: Decimal running balance (was `Number(_sum) + payAmount`).
        const drawerBalanceDec = toDec(drawerAgg._sum.amount ?? 0);
        await tx.cashDrawerLog.create({
          data: {
            storeId: plan.storeId,
            userId: session.userId,
            action: 'CASH_IN',
            amount: payNum,
            balance: round2(drawerBalanceDec.plus(payNum)),
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
          description: `Installment payment from ${plan.customer?.name ?? 'customer'} — Plan #${plan.id.slice(-6)} (KES ${payNum.toLocaleString()})`,
          referenceType: 'DEBT_PAYMENT_PLAN',
          referenceId: plan.id,
          totalDebit: payNum,
          totalCredit: payNum,
          isPosted: true,
          postedAt: new Date(),
          createdBy: session.userId,
          lines: {
            create: [
              {
                accountId: cashAccountId,
                debit: payNum,
                credit: 0,
                description: `Installment payment received — ${method}`,
              },
              {
                accountId: accounts.ACCOUNTS_RECEIVABLE,
                debit: 0,
                credit: payNum,
                description: `Reduce A/R for ${plan.customer?.name ?? 'customer'}`,
              },
            ],
          },
        },
      });
    }

    return { updatedInstallment, updatedPlan };
  }).catch((err: unknown) => {
    // Map the typed in-transaction claim conflicts to client-facing 400s
    // (a race loser is a retryable user error, not a server fault).
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
    action: 'DEBT_PLAN_INSTALLMENT_PAID',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Installment ${installment.installmentNumber} on plan ${id} paid KES ${payNum.toLocaleString()} via ${method}.`,
    storeId: plan.storeId,
    userId: session.userId,
    metadata: {
      planId: id,
      installmentId,
      amount: payNum,
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
  withFinancialAuth(payInstallmentHandler, WRITE_ROLES),
  'DEBT_PLAN_INSTALLMENT_PAY',
);
