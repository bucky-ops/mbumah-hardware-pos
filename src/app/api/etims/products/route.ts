// GET /api/etims/products?storeId=xxx&onlyUnregistered=true
//
// List products for the eTIMS Products tab. Returns a lightweight projection
// (id, sku, name, unitType, pricePerUnit, etimsItemCode, etimsRegisteredAt,
// etimsTaxType) suitable for the registration grid.
//
// Query params:
//   storeId          — required
//   onlyUnregistered — if "true", return only products with etimsItemCode=null
//   search           — optional substring match on name / sku
//   limit            — default 100, max 500
//
// Auth: any authenticated user with store access.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function listProductsHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  if (!storeId) {
    return Response.json({ success: false, error: 'storeId is required.' }, { status: 400 });
  }

  const onlyUnregistered = searchParams.get('onlyUnregistered') === 'true';
  const search = searchParams.get('search') || '';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10), 1), 500);

  const where: Record<string, unknown> = { storeId, isActive: true };
  if (onlyUnregistered) where.etimsItemCode = null;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { sku: { contains: search } },
      { barcode: { contains: search } },
    ];
  }

  const products = await db.product.findMany({
    where,
    select: {
      id: true,
      sku: true,
      name: true,
      unitType: true,
      pricePerUnit: true,
      etimsItemCode: true,
      etimsRegisteredAt: true,
      etimsTaxType: true,
    },
    orderBy: { name: 'asc' },
    take: limit,
  });

  return Response.json({
    success: true,
    data: products,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listProductsHandler),
  'ETIMS_PRODUCTS_LIST',
);
