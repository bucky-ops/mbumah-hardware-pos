// GET /api/products/low-stock
//
// Returns products at or below their reorder level — the inventory
// "watchlist" used by the Low-Stock Alert Panel. Each item includes:
//   • product details (name, sku, unitType, category)
//   • current stock + reorder level + min/max thresholds
//   • supplier info (resolved from the most recent PurchaseOrder that
//     contained this product) — null if the product has never been
//     ordered through a PO
//   • the date the product was last restocked (most recent PURCHASE
//     StockMovement)
//
// Sort order (urgency):
//   1. Out-of-stock (quantity <= 0) first
//   2. Then by stock deficit (reorderLevel - quantityInStock), largest
//      deficit first
//
// Auth: any authenticated user (requireStoreAccess — store-scoped).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getLowStockProductsHandler(
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

  // Optional filter — when `includeNear=true` we widen the threshold to
  // `quantityInStock <= reorderLevel * 1.5` so the panel can also surface
  // items that are *approaching* the reorder level (yellow band).
  const includeNear = searchParams.get('includeNear') === 'true';
  const nearFactor = includeNear ? 1.5 : 1;

  const products = await db.product.findMany({
    where: {
      storeId,
      isActive: true,
      // SQLite doesn't support field-to-field comparison operators in
      // Prisma's `where` for `<=` against another column, so we fetch all
      // active products for the store and filter in JS. Stores typically
      // have hundreds, not millions, of SKUs, so this is acceptable.
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Filter to products at or below the (widened) reorder threshold.
  const lowStock = products.filter((p) => {
    const stock = Number(p.quantityInStock);
    const reorder = Number(p.reorderLevel);
    return stock <= reorder * nearFactor;
  });

  if (lowStock.length === 0) {
    return Response.json({
      success: true,
      data: [],
      summary: {
        total: 0,
        outOfStock: 0,
        belowReorder: 0,
        nearReorder: 0,
      },
    });
  }

  // Resolve supplier + last-restock info in parallel for each product.
  // We fetch the most recent PurchaseOrderItem (joined to its PO+supplier)
  // and the most recent PURCHASE StockMovement for each product id.
  const productIds = lowStock.map((p) => p.id);

  const [lastPoItems, lastPurchaseMovements] = await Promise.all([
    db.purchaseOrderItem.findMany({
      where: { productId: { in: productIds } },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
            orderDate: true,
            status: true,
            supplier: {
              select: { id: true, name: true, phone: true, email: true, paymentTerms: true },
            },
          },
        },
      },
      orderBy: { purchaseOrder: { orderDate: 'desc' } },
    }),
    db.stockMovement.findMany({
      where: {
        productId: { in: productIds },
        movementType: 'PURCHASE',
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        productId: true,
        quantity: true,
        createdAt: true,
        notes: true,
      },
    }),
  ]);

  // Index — only the LATEST PO item per product (most recent PO date).
  const supplierByProductId = new Map<string, (typeof lastPoItems)[number]>();
  for (const item of lastPoItems) {
    const existing = supplierByProductId.get(item.productId);
    if (!existing ||
        new Date(item.purchaseOrder.orderDate) > new Date(existing.purchaseOrder.orderDate)) {
      supplierByProductId.set(item.productId, item);
    }
  }

  // Index — most recent PURCHASE movement per product.
  const lastRestockByProductId = new Map<string, (typeof lastPurchaseMovements)[number]>();
  for (const m of lastPurchaseMovements) {
    if (!lastRestockByProductId.has(m.productId)) {
      lastRestockByProductId.set(m.productId, m);
    }
  }

  // Build the response rows with derived urgency fields.
  const rows = lowStock.map((p) => {
    const stock = Number(p.quantityInStock);
    const reorder = Number(p.reorderLevel);
    const deficit = Math.max(0, reorder - stock);

    let urgency: 'OUT_OF_STOCK' | 'BELOW_REORDER' | 'NEAR_REORDER';
    if (stock <= 0) urgency = 'OUT_OF_STOCK';
    else if (stock <= reorder) urgency = 'BELOW_REORDER';
    else urgency = 'NEAR_REORDER';

    const poItem = supplierByProductId.get(p.id) || null;
    const lastRestock = lastRestockByProductId.get(p.id) || null;

    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      unitType: p.unitType,
      category: p.category,
      quantityInStock: stock,
      reorderLevel: reorder,
      minimumStockLevel: p.minimumStockLevel,
      maximumStockLevel: p.maximumStockLevel,
      costPrice: Number(p.costPrice),
      pricePerUnit: Number(p.pricePerUnit),
      deficit,
      urgency,
      // Suggested reorder qty: bring stock up to 1.5× reorder level (a
      // sensible default for hardware retail) — caller can override.
      suggestedReorderQty: Math.max(0, Math.ceil(reorder * 1.5 - stock)),
      supplier: poItem
        ? {
            id: poItem.purchaseOrder.supplier.id,
            name: poItem.purchaseOrder.supplier.name,
            phone: poItem.purchaseOrder.supplier.phone,
            email: poItem.purchaseOrder.supplier.email,
            paymentTerms: poItem.purchaseOrder.supplier.paymentTerms,
            lastPoNumber: poItem.purchaseOrder.poNumber,
            lastPoDate: poItem.purchaseOrder.orderDate,
            lastPoStatus: poItem.purchaseOrder.status,
            lastUnitCost: Number(poItem.unitCost),
          }
        : null,
      lastRestockedAt: lastRestock?.createdAt || null,
      lastRestockQuantity: lastRestock ? Number(lastRestock.quantity) : null,
    };
  });

  // Sort by urgency (out-of-stock first, then by largest deficit).
  const urgencyRank: Record<string, number> = {
    OUT_OF_STOCK: 0,
    BELOW_REORDER: 1,
    NEAR_REORDER: 2,
  };
  rows.sort((a, b) => {
    const rankDiff = urgencyRank[a.urgency] - urgencyRank[b.urgency];
    if (rankDiff !== 0) return rankDiff;
    return b.deficit - a.deficit;
  });

  const summary = {
    total: rows.length,
    outOfStock: rows.filter((r) => r.urgency === 'OUT_OF_STOCK').length,
    belowReorder: rows.filter((r) => r.urgency === 'BELOW_REORDER').length,
    nearReorder: rows.filter((r) => r.urgency === 'NEAR_REORDER').length,
  };

  return Response.json({
    success: true,
    data: rows,
    summary,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getLowStockProductsHandler),
  'PRODUCTS_LOW_STOCK',
);
