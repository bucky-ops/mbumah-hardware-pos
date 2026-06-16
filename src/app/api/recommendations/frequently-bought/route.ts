// GET /api/recommendations/frequently-bought
//
// Mine SaleItem records to find products frequently bought together with
// the supplied product(s). Powers the "Sell More" recommendation panel in
// the POS (e.g. cement → ballast/sand, paint → brush).
//
// Query params:
//   - productId    : single product id (mutually exclusive with productIds)
//   - productIds   : comma-separated list (cart-mode — products frequently
//                    bought WITH ANY of these)
//   - storeId      : scope the mining to a single store (recommended)
//   - limit        : default 8, max 20

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';

interface RecommendationItem {
  productId: string;
  name: string;
  sku: string;
  pricePerUnit: number;
  quantityInStock: number;
  coOccurrenceCount: number;
  categoryName: string | null;
}

async function frequentlyBoughtHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || '';
  const productIdParam = searchParams.get('productId') || '';
  const productIdsParam = searchParams.get('productIds') || '';
  const limitParam = parseInt(searchParams.get('limit') || '8', 10);
  const limit = Math.min(Math.max(limitParam || 8, 1), 20);

  // Build the seed list — prefer comma-separated list, fall back to single id
  let seedIds: string[] = [];
  if (productIdsParam) {
    seedIds = productIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (seedIds.length === 0 && productIdParam) {
    seedIds = [productIdParam.trim()];
  }

  if (seedIds.length === 0) {
    return Response.json(
      {
        success: false,
        error: 'Either productId or productIds query parameter is required.',
      },
      { status: 400 },
    );
  }

  // Validate that the seed products exist (and optionally belong to the store)
  const seedWhere: Record<string, unknown> = { id: { in: seedIds } };
  if (storeId) seedWhere.storeId = storeId;
  const seedProducts = await db.product.findMany({
    where: seedWhere,
    select: { id: true },
  });
  const validSeedIds = seedProducts.map((p) => p.id);
  if (validSeedIds.length === 0) {
    return Response.json({
      success: true,
      data: [] as RecommendationItem[],
      meta: { seedCount: seedIds.length, validSeedCount: 0 },
    });
  }

  // Step 1: find all SaleItems that include any of the seed products,
  //         and gather the distinct transaction ids.
  const seedSaleItems = await db.saleItem.findMany({
    where: { productId: { in: validSeedIds } },
    select: { transactionId: true },
    take: 5000, // cap to keep the query bounded
  });

  const transactionIds = Array.from(
    new Set(seedSaleItems.map((s) => s.transactionId)),
  );

  if (transactionIds.length === 0) {
    return Response.json({
      success: true,
      data: [] as RecommendationItem[],
      meta: { seedCount: validSeedIds.length, transactionsScanned: 0 },
    });
  }

  // Step 2: fetch ALL SaleItems for those transactions (excluding the seeds)
  const siblingSaleItems = await db.saleItem.findMany({
    where: {
      transactionId: { in: transactionIds },
      productId: { notIn: validSeedIds },
    },
    select: { productId: true },
    take: 20000,
  });

  // Step 3: aggregate co-occurrence counts
  const coOccurrenceMap = new Map<string, number>();
  for (const item of siblingSaleItems) {
    coOccurrenceMap.set(
      item.productId,
      (coOccurrenceMap.get(item.productId) || 0) + 1,
    );
  }

  if (coOccurrenceMap.size === 0) {
    return Response.json({
      success: true,
      data: [] as RecommendationItem[],
      meta: {
        seedCount: validSeedIds.length,
        transactionsScanned: transactionIds.length,
      },
    });
  }

  // Step 4: take top N by co-occurrence, then fetch product details
  const ranked = Array.from(coOccurrenceMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const topProductIds = ranked.map(([id]) => id);
  const products = await db.product.findMany({
    where: {
      id: { in: topProductIds },
      ...(storeId ? { storeId } : {}),
    },
    include: {
      category: { select: { name: true } },
    },
  });

  // Step 5: assemble response, preserving the ranking order
  const productMap = new Map(products.map((p) => [p.id, p]));
  const recommendations: RecommendationItem[] = ranked
    .map(([productId, coOccurrenceCount]) => {
      const p = productMap.get(productId);
      if (!p) return null;
      return {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        pricePerUnit: p.pricePerUnit,
        quantityInStock: p.quantityInStock,
        coOccurrenceCount,
        categoryName: p.category?.name ?? null,
      };
    })
    .filter((r): r is RecommendationItem => r !== null);

  return Response.json({
    success: true,
    data: recommendations,
    meta: {
      seedCount: validSeedIds.length,
      transactionsScanned: transactionIds.length,
      mode: seedIds.length > 1 ? 'cart' : 'single',
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(frequentlyBoughtHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  }),
  'RECOMMENDATIONS_FREQUENTLY_BOUGHT',
);
