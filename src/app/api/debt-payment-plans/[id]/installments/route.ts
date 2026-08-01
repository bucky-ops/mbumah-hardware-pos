// GET /api/debt-payment-plans/[id]/installments
//
// List all installments for a plan, ordered by installment number.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth } from '@/lib/auth';
import { toNumber } from '@/lib/debt-plan-utils';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function listInstallmentsHandler(...args: unknown[]): Promise<Response> {
  const _request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const plan = await db.debtPaymentPlan.findUnique({
    where: { id },
    select: { id: true, storeId: true, status: true },
  });

  if (!plan) {
    return Response.json(
      { success: false, error: 'Payment plan not found.' },
      { status: 404 },
    );
  }

  const installments = await db.debtPlanInstallment.findMany({
    where: { planId: id },
    orderBy: { installmentNumber: 'asc' },
  });

  const serialized = installments.map((i) => ({
    ...i,
    amountDue: toNumber(i.amountDue),
    amountPaid: toNumber(i.amountPaid),
    lateFeeApplied: toNumber(i.lateFeeApplied),
  }));

  return Response.json({ success: true, data: serialized });
}

export const GET = withErrorBoundary(
  withFinancialAuth(listInstallmentsHandler, READ_ROLES),
  'DEBT_PLAN_INSTALLMENTS_LIST',
);
