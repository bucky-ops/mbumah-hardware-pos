// GET /api/reports/fast-moving

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withSessionAuth } from '@/lib/auth';
// Task 12-b: Prisma Decimal valueOf() returns a STRING — `number + decimal`
// concatenates. Accumulation runs through toDec(); numbers emitted at the end.
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

async function getFastMovingProductsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const limit = parseInt(searchParams.get('limit') || '20');
  const categoryId = searchParams.get('categoryId');

  // Default to last 30 days if no date range provided
  const endDate = dateTo ? new Date(dateTo) : new Date();
  const startDate = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Set end of day for endDate
  endDate.setHours(23, 59, 59, 999);
  startDate.setHours(0, 0, 0, 0);

  // Query sale items aggregated by product within the date range
  const saleItems = await db.saleItem.findMany({
    where: {
      transaction: {
        storeId,
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    },
    select: {
      productId: true,
      productName: true,
      quantity: true,
      lineTotal: true,
      product: {
        select: {
          sku: true,
          quantityInStock: true,
          category: {
            select: { name: true },
          },
        },
      },
    },
  });

  // Aggregate by product — Decimal accumulators (Task 12-b).
  const productMap = new Map<string, {
    productId: string;
    productName: string;
    sku: string;
    totalQuantitySold: ReturnType<typeof toDec>;
    totalRevenue: ReturnType<typeof toDec>;
    saleCount: number;
    category: string | null;
    currentStock: number;
  }>();

  for (const item of saleItems) {
    const existing = productMap.get(item.productId);
    if (existing) {
      existing.totalQuantitySold = existing.totalQuantitySold.plus(toDec(item.quantity));
      existing.totalRevenue = existing.totalRevenue.plus(toDec(item.lineTotal));
      existing.saleCount += 1;
    } else {
      productMap.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        sku: item.product.sku,
        totalQuantitySold: toDec(item.quantity),
        totalRevenue: toDec(item.lineTotal),
        saleCount: 1,
        category: item.product.category?.name || null,
        currentStock: toDec(item.product.quantityInStock).toNumber(),
      });
    }
  }

  // Convert to array and sort by sale frequency (total quantity sold)
  let fastMovingProducts = Array.from(productMap.values());

  // Filter by category if specified
  if (categoryId) {
    fastMovingProducts = fastMovingProducts.filter((_p) => {
      // We need to check the product's categoryId; the aggregated data doesn't have it
      // This is handled below with a secondary filter
      return true; // We'll filter after
    });

    // Get products in the specified category
    const categoryProducts = await db.product.findMany({
      where: { storeId, categoryId, isActive: true },
      select: { id: true },
    });
    const categoryProductIds = new Set(categoryProducts.map((p) => p.id));
    fastMovingProducts = fastMovingProducts.filter((p) => categoryProductIds.has(p.productId));
  }

  // Sort by total quantity sold descending — numeric comparison via Decimal.
  fastMovingProducts.sort((a, b) => b.totalQuantitySold.comparedTo(a.totalQuantitySold));

  // Limit results
  fastMovingProducts = fastMovingProducts.slice(0, limit);

  // Calculate summary stats — Decimal sums, plain numbers at the boundary.
  const totalProductsAnalyzed = productMap.size;
  const totalUnitsSold = Array.from(productMap.values())
    .reduce((acc, p) => acc.plus(p.totalQuantitySold), toDec(0))
    .toNumber();
  const totalRevenue = round2(
    Array.from(productMap.values()).reduce((acc, p) => acc.plus(p.totalRevenue), toDec(0)),
  );

  return Response.json({
    success: true,
    data: {
      period: {
        from: startDate.toISOString(),
        to: endDate.toISOString(),
      },
      summary: {
        totalProductsSold: totalProductsAnalyzed,
        totalUnitsSold,
        totalRevenue,
      },
      products: fastMovingProducts.map((p) => ({
        ...p,
        totalQuantitySold: p.totalQuantitySold.toNumber(),
        totalRevenue: round2(p.totalRevenue),
      })),
    },
  });
}

// AUDIT FIX (Task 3-d): session-validated (was Bearer-presence only).
// Any store role — stock-turnover visibility is operational, not margin-bearing.
export const GET = withErrorBoundary(
  withSessionAuth(getFastMovingProductsHandler),
  'FAST_MOVING_REPORT',
);
