// GET /api/products/search

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

async function searchProductsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const q = searchParams.get('q') || '';
  const storeId = searchParams.get('storeId');

  if (!q || q.length < 2) {
    return Response.json({ success: true, data: [] });
  }

  const where: Record<string, unknown> = {
    isActive: true,
    OR: [
      { name: { contains: q } },
      { sku: { contains: q } },
      { barcode: { contains: q } },
    ],
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

export const GET = withErrorBoundary(searchProductsHandler, 'PRODUCTS_SEARCH');
