// GET /api/analytics/top-products
//
// Returns the top-selling products by revenue for the selected period.
// Uses an in-memory aggregation over recent sale items (SQLite does not
// support groupBy on relations cleanly, so we do it the same way the existing
// /api/dashboard route does — fetch transactions, then fetch their items).
//
// Query params:
//   - storeId : REQUIRED
//   - limit   : default 10 (max 50)
//   - period  : today | week | month | year   (default: week)
//
// Response:
//   { success, data: { products: TopProduct[], totalRevenue, totalQty } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { getPeriodWindow, type AnalyticsPeriod } from '@/lib/analytics-utils';
// Task 12-b: Prisma Decimal valueOf() returns a STRING — all accumulation runs
// through toDec(); revenue is the VAT-exclusive net per line; emit 2dp HALF_UP
// numbers via round2().
import { toDec, round2 } from '@/lib/utils/financialMath';

/**
 * NET (VAT-exclusive) revenue for a sale line. `lineTotal` is VAT-inclusive
 * gross; extract the VAT component at the line's own rate:
 *   net = lineTotal − lineTotal × taxRate / (100 + taxRate)
 * Rate 0 (exempt) → the line total as-is. VAT is owed to KRA, not revenue.
 */
const lineNetRevenue = (lineTotal: Parameters<typeof toDec>[0], taxRate: Parameters<typeof toDec>[0]) => {
  const gross = toDec(lineTotal);
  const rate = toDec(taxRate);
  if (rate.lte(0)) return gross;
  return gross.minus(gross.mul(rate).div(rate.plus(100)));
};

export const dynamic = 'force-dynamic';

const ALLOWED_PERIODS: AnalyticsPeriod[] = ['today', 'week', 'month', 'year'];

interface TopProductResult {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  categoryId: string | null;
  quantitySold: number;
  revenue: number;
  avgPrice: number;
  transactionsCount: number;
  trend: 'up' | 'down' | 'stable' | 'new';
}

async function getTopProductsHandler(
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

  const limitRaw = parseInt(searchParams.get('limit') || '10', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;

  const now = new Date();
  const window = getPeriodWindow(period, now);

  // Pull transactions in the window
  const txs = await db.salesTransaction.findMany({
    where: {
      storeId,
      createdAt: { gte: window.start, lte: window.end },
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    },
    select: {
      id: true,
      createdAt: true,
    },
    take: 50000,
  });

  if (txs.length === 0) {
    return Response.json({
      success: true,
      data: {
        period,
        products: [] as TopProductResult[],
        totalRevenue: 0,
        totalQty: 0,
      },
    });
  }

  const txIds = txs.map((t) => t.id);
  const saleItems = await db.saleItem.findMany({
    where: { transactionId: { in: txIds } },
    select: {
      productId: true,
      productName: true,
      quantity: true,
      lineTotal: true,
      taxRate: true, // Task 12-b: needed to derive the VAT-exclusive line net
      pricePerUnit: true,
      product: {
        select: {
          sku: true,
          categoryId: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
  });

  // Aggregate by productId — all accumulators Decimal (Task 12-b).
  const agg = new Map<
    string,
    {
      productName: string;
      sku: string;
      categoryId: string | null;
      categoryName: string | null;
      quantitySold: ReturnType<typeof toDec>;
      revenue: ReturnType<typeof toDec>;
      transactionsCount: number;
      priceSum: ReturnType<typeof toDec>;
      priceCount: number;
    }
  >();

  for (const si of saleItems) {
    const qty = toDec(si.quantity);
    // VAT-inclusive lineTotal → VAT-exclusive net at the line's own rate.
    const net = lineNetRevenue(si.lineTotal, si.taxRate);
    const price = toDec(si.pricePerUnit);
    let entry = agg.get(si.productId);
    if (!entry) {
      entry = {
        productName: si.productName,
        sku: si.product?.sku ?? '',
        categoryId: si.product?.categoryId ?? null,
        categoryName: si.product?.category?.name ?? null,
        quantitySold: toDec(0),
        revenue: toDec(0),
        transactionsCount: 0,
        priceSum: toDec(0),
        priceCount: 0,
      };
      agg.set(si.productId, entry);
    }
    entry.quantitySold = entry.quantitySold.plus(qty);
    entry.revenue = entry.revenue.plus(net);
    entry.transactionsCount += 1;
    entry.priceSum = entry.priceSum.plus(price);
    entry.priceCount += 1;
  }

  // Determine trend by comparing the first half vs second half of the window.
  // Split transactions into two time buckets, then re-aggregate per product.
  const windowMs = window.end.getTime() - window.start.getTime();
  const midpoint = new Date(window.start.getTime() + windowMs / 2);
  const firstHalfTxIds = txs.filter((t) => new Date(t.createdAt) < midpoint).map((t) => t.id);
  const secondHalfTxIds = txs.filter((t) => new Date(t.createdAt) >= midpoint).map((t) => t.id);

  const [firstHalfItems, secondHalfItems] = await Promise.all([
    firstHalfTxIds.length > 0
      ? db.saleItem.findMany({
          where: { transactionId: { in: firstHalfTxIds } },
          select: { productId: true, quantity: true },
        })
      : Promise.resolve([]),
    secondHalfTxIds.length > 0
      ? db.saleItem.findMany({
          where: { transactionId: { in: secondHalfTxIds } },
          select: { productId: true, quantity: true },
        })
      : Promise.resolve([]),
  ]);

  const firstHalfQty = new Map<string, ReturnType<typeof toDec>>();
  for (const si of firstHalfItems) {
    firstHalfQty.set(si.productId, (firstHalfQty.get(si.productId) || toDec(0)).plus(toDec(si.quantity)));
  }
  const secondHalfQty = new Map<string, ReturnType<typeof toDec>>();
  for (const si of secondHalfItems) {
    secondHalfQty.set(si.productId, (secondHalfQty.get(si.productId) || toDec(0)).plus(toDec(si.quantity)));
  }

  const products: TopProductResult[] = Array.from(agg.entries())
    .map(([productId, e]) => {
      const recent = secondHalfQty.get(productId) || toDec(0);
      const previous = firstHalfQty.get(productId) || toDec(0);
      let trend: TopProductResult['trend'] = 'stable';
      if (previous.isZero() && recent.gt(0)) trend = 'new';
      else if (recent.gt(previous.mul(1.1))) trend = 'up';
      else if (recent.lt(previous.mul(0.9))) trend = 'down';
      return {
        productId,
        productName: e.productName,
        sku: e.sku,
        categoryName: e.categoryName,
        categoryId: e.categoryId,
        quantitySold: round2(e.quantitySold),
        revenue: round2(e.revenue),
        avgPrice: e.priceCount > 0 ? round2(e.priceSum.div(e.priceCount)) : 0,
        transactionsCount: e.transactionsCount,
        trend,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);

  const totalRevenue = round2(products.reduce((s, p) => s + p.revenue, 0));
  const totalQty = round2(products.reduce((s, p) => s + p.quantitySold, 0));

  return Response.json({
    success: true,
    data: {
      period,
      products,
      totalRevenue,
      totalQty,
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getTopProductsHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER'],
  }),
  'ANALYTICS_TOP_PRODUCTS',
);
