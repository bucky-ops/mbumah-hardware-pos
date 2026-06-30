// GET  /api/financial/periods — list financial periods for a store (ordered by startDate desc).
// POST /api/financial/periods — create a new OPEN financial period.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { createFinancialPeriod } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

async function listPeriodsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const periods = await db.financialPeriod.findMany({
    where: { storeId },
    orderBy: { startDate: 'desc' },
    include: {
      _count: {
        select: {
          journalEntries: true,
          budgets: true,
          trialBalanceSnapshots: true,
        },
      },
    },
  });

  // For each period, fetch posted journal-entry totals for display.
  const enriched = await Promise.all(
    periods.map(async (p) => {
      const agg = await db.journalEntry.aggregate({
        where: {
          storeId,
          financialPeriodId: p.id,
          isPosted: true,
          isVoided: false,
        },
        _sum: { totalDebit: true, totalCredit: true },
        _count: true,
      });
      return {
        ...p,
        entryCount: p._count.journalEntries,
        budgetCount: p._count.budgets,
        snapshotCount: p._count.trialBalanceSnapshots,
        postedEntryCount: agg._count,
        postedTotalDebit: agg._sum.totalDebit?.toNumber() ?? 0,
        postedTotalCredit: agg._sum.totalCredit?.toNumber() ?? 0,
        // Strip the Prisma `_count` wrapper from the response (already projected above).
        _count: undefined,
      };
    }),
  );

  return Response.json({ success: true, data: enriched });
}

async function createPeriodHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { organizationId, storeId, periodName, startDate, endDate, createdByUserId } = body as {
    organizationId?: string;
    storeId?: string;
    periodName?: string;
    startDate?: string;
    endDate?: string;
    createdByUserId?: string;
  };

  if (!organizationId || !storeId) {
    return Response.json(
      { success: false, error: 'organizationId and storeId are required.' },
      { status: 400 },
    );
  }
  if (!periodName || !startDate || !endDate) {
    return Response.json(
      { success: false, error: 'periodName, startDate, and endDate are required.' },
      { status: 400 },
    );
  }
  if (!createdByUserId) {
    return Response.json(
      { success: false, error: 'createdByUserId is required for the audit trail.' },
      { status: 400 },
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json(
      { success: false, error: 'startDate and endDate must be valid ISO 8601 dates.' },
      { status: 400 },
    );
  }

  try {
    const period = await createFinancialPeriod({
      storeId,
      organizationId,
      periodName,
      startDate: start,
      endDate: end,
      userId: createdByUserId,
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    return Response.json({ success: true, data: period }, { status: 201 });
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
  withFinancialAuth(listPeriodsHandler, FINANCIAL_ROLES.READ),
  LogComponent.FINANCIAL,
);
export const POST = withErrorBoundary(
  withFinancialAuth(createPeriodHandler, FINANCIAL_ROLES.WRITE),
  LogComponent.FINANCIAL,
);
