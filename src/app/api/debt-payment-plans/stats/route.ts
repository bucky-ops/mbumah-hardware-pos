// GET /api/debt-payment-plans/stats?storeId=...
//
// Summary stats for the Debt Payment Plans dashboard:
//   - totalActivePlans
//   - totalOutstandingBalance
//   - plansWithOverdueInstallments
//   - completedThisMonth
//   - totalCollectedThisMonth
//   - totalPendingApproval

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth } from '@/lib/auth';
import { toNumber } from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

async function statsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Active = ACTIVE or PAUSED (in-progress) plans.
  // Task 12-d: DEFAULTED plan balances are also tracked separately — they
  // are the most at-risk exposure and were previously invisible on the
  // dashboard (Outstanding counted only ACTIVE/PAUSED plans).
  const [activePlans, pendingPlans, completedThisMonthRows, overduePlans, defaultedPlans] = await Promise.all([
    db.debtPaymentPlan.findMany({
      where: { storeId, status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true, balance: true },
    }),
    db.debtPaymentPlan.count({
      where: { storeId, status: 'PENDING_APPROVAL' },
    }),
    db.debtPaymentPlan.findMany({
      where: {
        storeId,
        status: 'COMPLETED',
        completedAt: { gte: startOfMonth, lt: endOfMonth },
      },
      select: { id: true, totalAmount: true },
    }),
    db.debtPaymentPlan.findMany({
      where: { storeId, installmentsOverdue: { gt: 0 } },
      select: { id: true },
    }),
    db.debtPaymentPlan.findMany({
      where: { storeId, status: 'DEFAULTED' },
      select: { id: true, balance: true },
    }),
  ]);

  // Total collected this month = sum of installment amountPaid increases that
  // happened this month. We approximate this by summing all DebtPayment rows
  // for the underlying debt ledgers of this store's plans this month.
  // Cheaper alternative: aggregate installment amountPaid where paidAt in month.
  const collectedThisMonthRows = await db.debtPlanInstallment.findMany({
    where: {
      paidAt: { gte: startOfMonth, lt: endOfMonth },
      plan: { storeId },
    },
    select: { amountPaid: true, amountDue: true, status: true },
  });

  const totalOutstandingBalance = activePlans.reduce(
    (sum, p) => sum + toNumber(p.balance),
    0,
  );

  // Task 12-d: DEFAULTED exposure — visible separately so the dashboard can
  // surface at-risk balances that the Outstanding card intentionally excludes.
  const totalDefaultedOutstanding = defaultedPlans.reduce(
    (sum, p) => sum + toNumber(p.balance),
    0,
  );

  // Collected this month = sum of (each installment's amountPaid) — this is
  // a reasonable lower bound for cash collected against plans this month.
  // (We could refine further with a payment ledger, but this is accurate
  // enough for dashboard stats.)
  const totalCollectedThisMonth = collectedThisMonthRows.reduce(
    (sum, i) => sum + toNumber(i.amountPaid),
    0,
  );

  return Response.json({
    success: true,
    data: {
      totalActivePlans: activePlans.length,
      totalOutstandingBalance,
      totalDefaultedOutstanding,
      plansWithOverdueInstallments: overduePlans.length,
      completedThisMonth: completedThisMonthRows.length,
      totalCollectedThisMonth,
      totalPendingApproval: pendingPlans,
    },
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(statsHandler, READ_ROLES),
  'DEBT_PLANS_STATS',
);
