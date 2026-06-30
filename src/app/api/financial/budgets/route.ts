// GET  /api/financial/budgets — list budgets for a store (+optional period).
// POST /api/financial/budgets — upsert a budget for an account within a period.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { setBudget } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

async function listBudgetsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }
  const periodId = searchParams.get('periodId') || undefined;

  const where: { storeId: string; periodId?: string } = { storeId };
  if (periodId) where.periodId = periodId;

  const budgets = await db.budget.findMany({
    where,
    orderBy: { account: { code: 'asc' } },
    include: {
      account: {
        select: { id: true, code: true, name: true, type: true, normalBalance: true, subType: true },
      },
      period: {
        select: { id: true, periodName: true, startDate: true, endDate: true, status: true },
      },
    },
  });

  const data = budgets.map((b) => ({
    id: b.id,
    storeId: b.storeId,
    periodId: b.periodId,
    accountId: b.accountId,
    budgetedAmount: b.budgetedAmount.toNumber(),
    actualAmount: b.actualAmount.toNumber(),
    variance: b.variance.toNumber(),
    notes: b.notes,
    createdById: b.createdById,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    account: b.account,
    period: b.period,
  }));

  return Response.json({ success: true, data });
}

async function setBudgetHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, periodId, accountId, budgetedAmount, notes, createdById } = body as {
    storeId?: string;
    periodId?: string;
    accountId?: string;
    budgetedAmount?: number | string;
    notes?: string;
    createdById?: string;
  };

  if (!storeId || !periodId || !accountId) {
    return Response.json(
      { success: false, error: 'storeId, periodId, and accountId are required.' },
      { status: 400 },
    );
  }
  if (budgetedAmount === undefined) {
    return Response.json(
      { success: false, error: 'budgetedAmount is required.' },
      { status: 400 },
    );
  }
  if (!createdById) {
    return Response.json(
      { success: false, error: 'createdById is required for the audit trail.' },
      { status: 400 },
    );
  }

  try {
    const budget = await setBudget({
      storeId,
      periodId,
      accountId,
      budgetedAmount,
      notes,
      userId: createdById,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    return Response.json(
      {
        success: true,
        data: {
          ...budget,
          budgetedAmount: budget.budgetedAmount.toNumber(),
          actualAmount: budget.actualAmount.toNumber(),
          variance: budget.variance.toNumber(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof APIError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.statusCode },
      );
    }
    throw error;
  }
}

export const GET = withErrorBoundary(
  withFinancialAuth(listBudgetsHandler, FINANCIAL_ROLES.READ),
  LogComponent.FINANCIAL,
);
export const POST = withErrorBoundary(
  withFinancialAuth(setBudgetHandler, FINANCIAL_ROLES.WRITE),
  LogComponent.FINANCIAL,
);
