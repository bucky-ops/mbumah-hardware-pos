// GET /api/analytics/payment-breakdown
//
// Returns the distribution of payment methods (CASH, MPESA, CARD, DEBT, SPLIT)
// for the selected period: count, total amount, and percentage of total.
//
// Uses Prisma groupBy on the paymentMethod field — this is supported on
// SQLite because it's a scalar column on SalesTransaction.
//
// Query params:
//   - storeId : REQUIRED
//   - period  : today | week | month | year   (default: week)
//
// Response:
//   { success, data: { methods: PaymentBreakdownRow[], totalRevenue, totalCount } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { getPeriodWindow, type AnalyticsPeriod } from '@/lib/analytics-utils';
// Task 12-b: Decimal-safe conversion — Prisma Decimal valueOf() returns a
// STRING, so `number + decimal` concatenates; accumulate via toDec().
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

const ALLOWED_PERIODS: AnalyticsPeriod[] = ['today', 'week', 'month', 'year'];

interface PaymentBreakdownRow {
  method: string;
  count: number;
  amount: number;
  percentage: number;
}

async function getPaymentBreakdownHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const periodParam = (searchParams.get('period') || 'week') as AnalyticsPeriod;
  const period: AnalyticsPeriod = ALLOWED_PERIODS.includes(periodParam)
    ? periodParam
    : 'week';

  const now = new Date();
  const window = getPeriodWindow(period, now);

  const grouped = await db.salesTransaction.groupBy({
    by: ['paymentMethod'],
    where: {
      storeId,
      createdAt: { gte: window.start, lte: window.end },
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    },
    _sum: { totalAmount: true },
    _count: true,
  });

  // Task 12-b: these are TENDER totals (money COLLECTED per payment method,
  // tax-INCLUSIVE) by design — the chart is labelled by payment method, and
  // tender ≠ revenue (VAT is owed to KRA). Only the accumulation was made
  // Decimal-safe; the basis is intentionally unchanged.
  const totalRevenue = grouped.reduce(
    (acc, g) => acc.plus(toDec(g._sum.totalAmount)),
    toDec(0),
  );
  const totalCount = grouped.reduce((s, g) => s + g._count, 0);

  // Ensure every known method appears in the response so the donut chart has
  // a stable set of slices even when there's no activity for that method.
  // Includes GIFT_CARD — gift-card sales are recorded as SalesTransaction
  // rows with paymentMethod='GIFT_CARD' when redeemed at checkout.
  const knownMethods = ['CASH', 'MPESA', 'CARD', 'DEBT', 'SPLIT', 'GIFT_CARD'];
  const byMethodMap = new Map<string, PaymentBreakdownRow>();
  for (const m of knownMethods) {
    byMethodMap.set(m, { method: m, count: 0, amount: 0, percentage: 0 });
  }
  for (const g of grouped) {
    const amount = round2(toDec(g._sum.totalAmount));
    const row: PaymentBreakdownRow = {
      method: g.paymentMethod,
      count: g._count,
      amount,
      percentage: 0,
    };
    byMethodMap.set(g.paymentMethod, row);
  }

  const methods = Array.from(byMethodMap.values())
    .map((r) => ({
      ...r,
      percentage: totalRevenue.gt(0) ? Math.round(r.amount / totalRevenue.toNumber() * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return Response.json({
    success: true,
    data: {
      period,
      methods,
      totalRevenue: round2(totalRevenue),
      totalCount,
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getPaymentBreakdownHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER'],
  }),
  'ANALYTICS_PAYMENT_BREAKDOWN',
);
