// GET /api/trends/analysis
//
// Per-product sales trend analysis. Compares the recent period vs the
// previous period to compute growth % and direction (up/down/stable),
// surfaces top growing + top declining products, projects the next 7 days
// using a linear projection of recent daily averages, and also returns
// category-level aggregates.
//
// Query params:
//   - storeId : REQUIRED — scope to a store
//   - range   : 7d | 30d | 90d (default 30d)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type RangeKey = '7d' | '30d' | '90d';

interface ProductTrend {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  recentQty: number;
  previousQty: number;
  recentRevenue: number;
  previousRevenue: number;
  qtyGrowthPct: number | null;
  revenueGrowthPct: number | null;
  direction: 'up' | 'down' | 'stable' | 'new';
  projectedNext7dQty: number;
}

interface CategoryTrend {
  categoryId: string | null;
  categoryName: string | null;
  recentQty: number;
  recentRevenue: number;
  previousQty: number;
  previousRevenue: number;
  direction: 'up' | 'down' | 'stable' | 'new';
  growthPct: number | null;
}

function rangeToDays(range: RangeKey): number {
  switch (range) {
    case '7d':
      return 7;
    case '90d':
      return 90;
    case '30d':
    default:
      return 30;
  }
}

function computeDirection(
  recent: number,
  previous: number,
): 'up' | 'down' | 'stable' | 'new' {
  if (previous === 0 && recent > 0) return 'new';
  if (recent === 0 && previous === 0) return 'stable';
  const delta = recent - previous;
  // 5% threshold dampens noise
  const threshold = Math.max(previous * 0.05, 1);
  if (delta > threshold) return 'up';
  if (delta < -threshold) return 'down';
  return 'stable';
}

function growthPct(recent: number, previous: number): number | null {
  if (previous === 0) {
    return recent > 0 ? null : 0;
  }
  return ((recent - previous) / previous) * 100;
}

async function trendsAnalysisHandler(
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

  const rangeParam = (searchParams.get('range') || '30d') as RangeKey;
  const range: RangeKey = ['7d', '30d', '90d'].includes(rangeParam)
    ? rangeParam
    : '30d';
  const days = rangeToDays(range);

  const now = new Date();
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - days);
  const previousStart = new Date(recentStart);
  previousStart.setDate(previousStart.getDate() - days);

  // Fetch all sale items in the broader window (previous_start .. now)
  // We only need fields for aggregation, but we need the transaction's
  // createdAt to bucket into "previous" vs "recent".
  const sales = await db.salesTransaction.findMany({
    where: {
      storeId,
      createdAt: { gte: previousStart },
      transactionType: 'SALE',
      paymentStatus: { not: 'FAILED' },
    },
    select: {
      id: true,
      createdAt: true,
      items: {
        select: {
          productId: true,
          productName: true,
          quantity: true,
          lineTotal: true,
        },
      },
    },
    take: 50000,
  });

  // Build per-product aggregates for the two periods
  interface ProductAgg {
    productId: string;
    productName: string;
    recentQty: number;
    previousQty: number;
    recentRevenue: number;
    previousRevenue: number;
    // recent daily series for projection
    recentDaily: Map<string, number>; // yyyy-mm-dd -> qty
  }

  const agg = new Map<string, ProductAgg>();
  const categoryAgg = new Map<
    string,
    {
      categoryId: string | null;
      recentQty: number;
      previousQty: number;
      recentRevenue: number;
      previousRevenue: number;
    }
  >();

  // Pre-fetch products so we can join category info (one query, not N+1)
  const productIdsInSales = new Set<string>();
  for (const s of sales) {
    for (const it of s.items) productIdsInSales.add(it.productId);
  }
  const products = await db.product.findMany({
    where: { id: { in: Array.from(productIdsInSales) } },
    select: {
      id: true,
      name: true,
      sku: true,
      categoryId: true,
      category: { select: { id: true, name: true } },
    },
  });
  const productInfoMap = new Map(
    products.map((p) => [
      p.id,
      {
        sku: p.sku,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
      },
    ]),
  );

  for (const sale of sales) {
    const isRecent = sale.createdAt >= recentStart;
    for (const item of sale.items) {
      let entry = agg.get(item.productId);
      if (!entry) {
        entry = {
          productId: item.productId,
          productName: item.productName,
          recentQty: 0,
          previousQty: 0,
          recentRevenue: 0,
          previousRevenue: 0,
          recentDaily: new Map(),
        };
        agg.set(item.productId, entry);
      }
      if (isRecent) {
        entry.recentQty += item.quantity;
        entry.recentRevenue += item.lineTotal;
        const dayKey = sale.createdAt.toISOString().slice(0, 10);
        entry.recentDaily.set(dayKey, (entry.recentDaily.get(dayKey) || 0) + item.quantity);
      } else {
        entry.previousQty += item.quantity;
        entry.previousRevenue += item.lineTotal;
      }

      // category-level
      const info = productInfoMap.get(item.productId);
      const catKey = info?.categoryId ?? `uncat_${item.productId}`;
      let cat = categoryAgg.get(catKey);
      if (!cat) {
        cat = {
          categoryId: info?.categoryId ?? null,
          recentQty: 0,
          previousQty: 0,
          recentRevenue: 0,
          previousRevenue: 0,
        };
        categoryAgg.set(catKey, cat);
      }
      if (isRecent) {
        cat.recentQty += item.quantity;
        cat.recentRevenue += item.lineTotal;
      } else {
        cat.previousQty += item.quantity;
        cat.previousRevenue += item.lineTotal;
      }
    }
  }

  // Build the per-product trend list with linear projection
  const productTrends: ProductTrend[] = [];
  for (const [productId, e] of agg) {
    const info = productInfoMap.get(productId);
    // Linear projection: average daily qty over the recent period * 7
    const recentDayCount = e.recentDaily.size || 1;
    const avgDailyQty = e.recentQty / recentDayCount;
    const projectedNext7dQty = Math.round(avgDailyQty * 7 * 100) / 100;

    productTrends.push({
      productId,
      productName: e.productName,
      sku: info?.sku ?? '',
      categoryName: info?.categoryName ?? null,
      recentQty: e.recentQty,
      previousQty: e.previousQty,
      recentRevenue: e.recentRevenue,
      previousRevenue: e.previousRevenue,
      qtyGrowthPct: growthPct(e.recentQty, e.previousQty),
      revenueGrowthPct: growthPct(e.recentRevenue, e.previousRevenue),
      direction: computeDirection(e.recentQty, e.previousQty),
      projectedNext7dQty,
    });
  }

  // Sort: by recent revenue desc to surface meaningful products first
  productTrends.sort((a, b) => b.recentRevenue - a.recentRevenue);

  const topGrowing = productTrends
    .filter((t) => t.direction === 'up' || t.direction === 'new')
    .sort((a, b) => (b.qtyGrowthPct ?? 0) - (a.qtyGrowthPct ?? 0))
    .slice(0, 10);

  const topDeclining = productTrends
    .filter((t) => t.direction === 'down')
    .sort((a, b) => (a.qtyGrowthPct ?? 0) - (b.qtyGrowthPct ?? 0))
    .slice(0, 10);

  const categoryTrends: CategoryTrend[] = Array.from(categoryAgg.values()).map(
    (c) => ({
      categoryId: c.categoryId,
      categoryName:
        products.find((p) => p.categoryId === c.categoryId)?.category?.name ??
        (c.categoryId ? 'Uncategorised' : 'Uncategorised'),
      recentQty: c.recentQty,
      recentRevenue: c.recentRevenue,
      previousQty: c.previousQty,
      previousRevenue: c.previousRevenue,
      direction: computeDirection(c.recentQty, c.previousQty),
      growthPct: growthPct(c.recentQty, c.previousQty),
    }),
  );
  categoryTrends.sort((a, b) => b.recentRevenue - a.recentRevenue);

  // Overall projection for next 7 days across the whole store
  const totalRecentQty = productTrends.reduce((s, t) => s + t.recentQty, 0);
  const totalProjectedNext7dQty =
    Math.round((totalRecentQty / days) * 7 * 100) / 100;

  // ---- Store-wide 7-day forward forecast (revenue) ----
  // Build a daily revenue series over the recent window, fit a simple least-
  // squares linear trend, and project 7 days forward with confidence bands
  // derived from the residual standard deviation. This lights up the
  // dashboard "Sales Trend (7d)" forecast widget AND the reports forecast chart.
  const dailyRevenue = new Map<string, number>(); // yyyy-mm-dd -> revenue
  for (const sale of sales) {
    if (sale.createdAt < recentStart) continue;
    const dayKey = sale.createdAt.toISOString().slice(0, 10);
    const dayRevenue = sale.items.reduce((s, it) => s + it.lineTotal, 0);
    dailyRevenue.set(dayKey, (dailyRevenue.get(dayKey) || 0) + dayRevenue);
  }

  // Build an ordered series of [dayIndex, revenue] for the recent window.
  // dayIndex = 0 for the oldest day in the window, increments by 1 per day.
  const seriesPoints: Array<{ x: number; y: number }> = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const windowStartDay = new Date(recentStart);
  windowStartDay.setHours(0, 0, 0, 0);
  const todayFloor = new Date(now);
  todayFloor.setHours(0, 0, 0, 0);
  for (let d = new Date(windowStartDay); d <= todayFloor; d = new Date(d.getTime() + dayMs)) {
    const key = d.toISOString().slice(0, 10);
    seriesPoints.push({
      x: Math.round((d.getTime() - windowStartDay.getTime()) / dayMs),
      y: dailyRevenue.get(key) || 0,
    });
  }

  // Least-squares linear fit: y = a + b*x
  const forecast: Array<{ label: string; predicted: number; lower: number; upper: number }> = [];
  let forecastAvgDaily = 0;
  if (seriesPoints.length >= 2) {
    const n = seriesPoints.length;
    const sumX = seriesPoints.reduce((s, p) => s + p.x, 0);
    const sumY = seriesPoints.reduce((s, p) => s + p.y, 0);
    const sumXY = seriesPoints.reduce((s, p) => s + p.x * p.y, 0);
    const sumXX = seriesPoints.reduce((s, p) => s + p.x * p.x, 0);
    const denom = n * sumXX - sumX * sumX;
    const b = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0; // slope
    const a = sumY / n - b * (sumX / n); // intercept

    // Residual std dev for confidence band width
    const residuals = seriesPoints.map((p) => p.y - (a + b * p.x));
    const residualVariance =
      residuals.reduce((s, r) => s + r * r, 0) / Math.max(n - 2, 1);
    const residualStd = Math.sqrt(residualVariance);
    // Band width: 1.5 sigma, floored to 5% of mean to avoid zero-width bands
    const meanY = sumY / n;
    const bandWidth = Math.max(residualStd * 1.5, meanY * 0.05);
    forecastAvgDaily = meanY;

    // Project 7 days forward starting tomorrow
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const lastX = seriesPoints[seriesPoints.length - 1].x;
    for (let i = 1; i <= 7; i++) {
      const x = lastX + i;
      const predicted = Math.max(0, a + b * x);
      const projected = new Date(todayFloor.getTime() + i * dayMs);
      forecast.push({
        label: dayNames[projected.getDay()],
        predicted: Math.round(predicted),
        lower: Math.round(Math.max(0, predicted - bandWidth)),
        upper: Math.round(predicted + bandWidth),
      });
    }
  }

  return Response.json({
    success: true,
    data: {
      range,
      windowDays: days,
      recentStart: recentStart.toISOString(),
      previousStart: previousStart.toISOString(),
      summary: {
        totalProductsAnalyzed: productTrends.length,
        totalRecentQty,
        totalRecentRevenue: productTrends.reduce(
          (s, t) => s + t.recentRevenue,
          0,
        ),
        totalPreviousRevenue: productTrends.reduce(
          (s, t) => s + t.previousRevenue,
          0,
        ),
        overallRevenueGrowthPct: growthPct(
          productTrends.reduce((s, t) => s + t.recentRevenue, 0),
          productTrends.reduce((s, t) => s + t.previousRevenue, 0),
        ),
        projectedNext7dQty: totalProjectedNext7dQty,
        forecastAvgDailyRevenue: Math.round(forecastAvgDaily),
        forecast7dTotalRevenue: forecast.reduce((s, f) => s + f.predicted, 0),
      },
      topGrowing,
      topDeclining,
      categoryTrends,
      allProducts: productTrends,
      forecast,
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(trendsAnalysisHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'],
  }),
  'TRENDS_ANALYSIS',
);
