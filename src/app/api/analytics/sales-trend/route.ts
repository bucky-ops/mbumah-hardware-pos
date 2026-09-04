// GET /api/analytics/sales-trend
//
// Returns revenue/transaction series for charting the sales trend over a
// selected period (today/week/month/year). Uses Prisma groupBy where possible
// and falls back to in-memory aggregation for hourly buckets (SQLite does not
// expose EXTRACT(HOUR FROM ...) via groupBy).
//
// Query params:
//   - period  : today | week | month | year   (default: week)
//   - storeId : REQUIRED — scope to a store
//
// Response:
//   { success, data: { period, buckets: AggregatedBucket[], summary } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import {
  aggregateSalesByPeriod,
  getPeriodWindow,
  getPreviousPeriodWindow,
  type AnalyticsPeriod,
  type TransactionSlice,
} from '@/lib/analytics-utils';
// Task 12-b: Decimal-safe conversion at the Prisma boundary; buckets emit
// NET (VAT-exclusive) revenue rounded 2dp HALF_UP via round2.
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

const ALLOWED_PERIODS: AnalyticsPeriod[] = ['today', 'week', 'month', 'year'];

async function getSalesTrendHandler(
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
  const prevWindow = getPreviousPeriodWindow(period, now);

  // Pull raw transactions for both windows in parallel.
  const [currentTx, previousTx] = await Promise.all([
    db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: window.start, lte: window.end },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        taxAmount: true, // Task 12-b: needed for the VAT-exclusive revenue basis
        paymentMethod: true,
        paymentStatus: true,
        transactionType: true,
      },
      take: 50000,
    }),
    db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: prevWindow.start, lte: prevWindow.end },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        taxAmount: true, // Task 12-b: needed for the VAT-exclusive revenue basis
        paymentMethod: true,
        paymentStatus: true,
        transactionType: true,
      },
      take: 50000,
    }),
  ]);

  // Items sold per bucket — pull sale items for the current window.
  // We do this in a separate query and join by transactionId timestamp bucket
  // so we don't have to round-trip every SaleItem through JSON.
  let itemsSoldByBucket: Record<string, number> = {};
  if (currentTx.length > 0) {
    const saleItems = await db.saleItem.findMany({
      where: { transactionId: { in: currentTx.map((t) => t.id) } },
      select: { transactionId: true, quantity: true },
    });
    const txIdToBucketKey = new Map<string, string>();
    for (const t of currentTx) {
      const d = new Date(t.createdAt);
      const { key } = window.keyOf(d);
      txIdToBucketKey.set(t.id, key);
    }
    itemsSoldByBucket = {};
    // Task 12-b: quantities accumulated in Decimal (was float `Number(si.quantity)`).
    const itemsSoldDecByBucket: Record<string, ReturnType<typeof toDec>> = {};
    for (const si of saleItems) {
      const key = txIdToBucketKey.get(si.transactionId);
      if (!key) continue;
      itemsSoldDecByBucket[key] = (itemsSoldDecByBucket[key] || toDec(0)).plus(toDec(si.quantity));
    }
    for (const [key, dec] of Object.entries(itemsSoldDecByBucket)) {
      itemsSoldByBucket[key] = dec.toNumber();
    }
  }

  // Task 12-b: slices carry taxAmount so aggregation can emit NET revenue
  // (totalAmount − taxAmount); Decimal-safe conversion at the boundary.
  const currentSlices: TransactionSlice[] = currentTx.map((t) => ({
    id: t.id,
    createdAt: t.createdAt,
    totalAmount: toDec(t.totalAmount).toNumber(),
    taxAmount: toDec(t.taxAmount).toNumber(),
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    transactionType: t.transactionType,
  }));

  const buckets = aggregateSalesByPeriod(currentSlices, period, now);
  for (const b of buckets) {
    b.itemsSold = itemsSoldByBucket[b.key] || 0;
  }

  const previousSlices: TransactionSlice[] = previousTx.map((t) => ({
    id: t.id,
    createdAt: t.createdAt,
    totalAmount: toDec(t.totalAmount).toNumber(),
    taxAmount: toDec(t.taxAmount).toNumber(),
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    transactionType: t.transactionType,
  }));
  const prevBuckets = aggregateSalesByPeriod(previousSlices, period, now);

  const totalRevenue = buckets.reduce((s, b) => s + b.revenue, 0);
  const totalTransactions = buckets.reduce((s, b) => s + b.transactions, 0);
  const totalItemsSold = buckets.reduce((s, b) => s + b.itemsSold, 0);
  const prevTotalRevenue = prevBuckets.reduce((s, b) => s + b.revenue, 0);
  const prevTotalTransactions = prevBuckets.reduce((s, b) => s + b.transactions, 0);
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
  const prevAvgOrderValue = prevTotalTransactions > 0 ? prevTotalRevenue / prevTotalTransactions : 0;

  const revenueChangePct = prevTotalRevenue > 0
    ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100
    : totalRevenue > 0 ? 100 : 0;
  const txChangePct = prevTotalTransactions > 0
    ? ((totalTransactions - prevTotalTransactions) / prevTotalTransactions) * 100
    : totalTransactions > 0 ? 100 : 0;
  const aovChangePct = prevAvgOrderValue > 0
    ? ((avgOrderValue - prevAvgOrderValue) / prevAvgOrderValue) * 100
    : avgOrderValue > 0 ? 100 : 0;

  // Previous-period series (for the dashed comparison line) — re-bucketed to
  // the current window's labels so the chart can overlay them 1:1.
  const previousSeries = prevBuckets.map((b, i) => ({
    label: buckets[i]?.label ?? b.label,
    value: round2(b.revenue),
  }));

  return Response.json({
    success: true,
    data: {
      period,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        bucket: window.bucket,
      },
      buckets: buckets.map((b) => ({
        ...b,
        revenue: round2(b.revenue),
        avgOrderValue: round2(b.avgOrderValue),
      })),
      previousSeries,
      summary: {
        totalRevenue: round2(totalRevenue),
        totalTransactions,
        totalItemsSold,
        avgOrderValue: round2(avgOrderValue),
        previousTotalRevenue: round2(prevTotalRevenue),
        previousTotalTransactions: prevTotalTransactions,
        previousAvgOrderValue: round2(prevAvgOrderValue),
        revenueChangePct: Math.round(revenueChangePct * 100) / 100,
        transactionsChangePct: Math.round(txChangePct * 100) / 100,
        aovChangePct: Math.round(aovChangePct * 100) / 100,
      },
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getSalesTrendHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER'],
  }),
  'ANALYTICS_SALES_TREND',
);
