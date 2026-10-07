// GET /api/products/search

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withSessionAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function searchProductsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const q = searchParams.get('q') || '';
  const storeId = searchParams.get('storeId');

  if (!q || q.length < 2) {
    return Response.json({ success: true, data: [] });
  }

  // Case handling is provider-aware: PostgreSQL `contains` is case-SENSITIVE
  // (a transfer/POS search for "nail" found no "4-inch Nails" in production),
  // so Postgres gets `mode: 'insensitive'`. SQLite (the laptop deployment
  // kits) rejects the `mode` argument at runtime, but its ASCII contains is
  // already case-insensitive there — so it just uses the plain form.
  const isPostgres = (process.env.DATABASE_URL || '').trim().toLowerCase().startsWith('postgres');
  const ci = () => (isPostgres ? { contains: q, mode: 'insensitive' as const } : { contains: q });

  const where: Record<string, unknown> = {
    isActive: true,
    OR: [{ name: ci() }, { sku: ci() }, { barcode: ci() }],
  };

  if (storeId) {
    where.storeId = storeId;
  }

  const products = await db.product.findMany({
    where,
    select: {
      id: true,
      storeId: true,
      categoryId: true,
      sku: true,
      barcode: true,
      name: true,
      description: true,
      unitType: true,
      quantityInStock: true,
      reorderLevel: true,
      pricePerUnit: true,
      costPrice: true,
      taxRate: true,
      isRental: true,
      isBundle: true,
      isActive: true,
      imageUrl: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { id: true, name: true, color: true, icon: true } },
    },
    take: 20,
    orderBy: { name: 'asc' },
  });

  return Response.json({ success: true, data: products });
}

// AUDIT FIX (Task 3-d): session-validated (was Bearer-presence only).
// Any store role — POS product search is a CASHIER 'products: read' action.
export const GET = withErrorBoundary(
  withSessionAuth(searchProductsHandler),
  'PRODUCTS_SEARCH',
);
