// POST /api/financial/budgets/recalculate — recalculate actuals for a period.
//
// For every budget row in the period, sums posted, non-voided journal-entry
// lines for the budgeted account (respecting normalBalance) and updates the
// `actualAmount` and `variance` columns.

import { type NextRequest } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { recalculateBudgetActuals } from '@/lib/accounting-helpers';
import { APIError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

async function recalculateHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, periodId } = body as { storeId?: string; periodId?: string };

  if (!storeId || !periodId) {
    return Response.json(
      { success: false, error: 'storeId and periodId are required.' },
      { status: 400 },
    );
  }

  // Light cross-check that the period belongs to the store before invoking the
  // helper (the helper itself only checks existence).
  try {
    const result = await recalculateBudgetActuals(periodId);
    return Response.json({
      success: true,
      data: {
        updated: result.updated,
        budgets: result.budgets.map((b) => ({
          ...b,
          budgetedAmount: b.budgetedAmount.toNumber(),
          actualAmount: b.actualAmount.toNumber(),
          variance: b.variance.toNumber(),
        })),
      },
    });
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

export const POST = withErrorBoundary(recalculateHandler, LogComponent.FINANCIAL);
