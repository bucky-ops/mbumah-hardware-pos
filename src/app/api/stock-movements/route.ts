// GET/POST /api/stock-movements

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent, StockMovementType } from '@/lib/types';
import { calculateWeightedAverageCost } from '@/lib/account-helper';

export const dynamic = 'force-dynamic';

async function getStockMovementsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const productId = searchParams.get('productId') || '';
  const movementType = searchParams.get('movementType') || '';
  const performedBy = searchParams.get('performedBy') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (productId) {
    where.productId = productId;
  }

  if (movementType) {
    where.movementType = movementType;
  }

  if (performedBy) {
    where.performedBy = performedBy;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  const validSortFields = ['createdAt', 'quantity', 'movementType'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [movements, total] = await Promise.all([
    db.stockMovement.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unitType: true,
            quantityInStock: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.stockMovement.count({ where }),
  ]);

  // Summary by movement type
  const movementTypeSummary = await db.stockMovement.groupBy({
    by: ['movementType'],
    where: { storeId, ...(dateFrom || dateTo ? { createdAt: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)) } : {}) } } : {}) },
    _sum: { quantity: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: movements,
    summary: movementTypeSummary.map((m) => ({
      type: m.movementType,
      count: m._count,
      totalQuantity: m._sum.quantity || 0,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createStockAdjustmentHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    productId,
    adjustmentType,
    quantity,
    reason,
    performedBy,
    unitCost,
  } = body;

  if (!storeId || !productId || !quantity || !adjustmentType) {
    return Response.json(
      { success: false, error: 'storeId, productId, quantity, and adjustmentType are required.' },
      { status: 400 }
    );
  }

  const validTypes = [
    StockMovementType.PURCHASE,
    StockMovementType.ADJUSTMENT,
    StockMovementType.TRANSFER,
    StockMovementType.RETURN,
  ];

  if (!validTypes.includes(adjustmentType)) {
    return Response.json(
      { success: false, error: `Invalid adjustment type. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const adjustmentQuantity = parseFloat(String(quantity));

  if (adjustmentQuantity === 0) {
    return Response.json(
      { success: false, error: 'Quantity cannot be zero.' },
      { status: 400 }
    );
  }

  // PURCHASE movements represent receiving new stock at a known unit cost —
  // they MUST carry a unitCost so we can blend the WAC. Other movement types
  // (ADJUSTMENT / TRANSFER / RETURN) issue stock at the current WAC and don't
  // need a unitCost.
  const parsedUnitCost =
    unitCost !== undefined && unitCost !== null ? parseFloat(String(unitCost)) : null;

  if (adjustmentType === StockMovementType.PURCHASE) {
    if (adjustmentQuantity < 0) {
      return Response.json(
        { success: false, error: 'PURCHASE movements must have a positive quantity (use ADJUSTMENT to issue stock).' },
        { status: 400 }
      );
    }
    if (parsedUnitCost === null || isNaN(parsedUnitCost) || parsedUnitCost < 0) {
      return Response.json(
        { success: false, error: 'PURCHASE movements require a non-negative unitCost so the WAC can be recomputed.' },
        { status: 400 }
      );
    }
  }

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    return Response.json(
      { success: false, error: 'Product not found.' },
      { status: 404 }
    );
  }

    if (adjustmentQuantity < 0 && product.quantityInStock + adjustmentQuantity < 0) {
    return Response.json(
      { success: false, error: `Insufficient stock. Current: ${product.quantityInStock}, Adjustment: ${adjustmentQuantity}` },
      { status: 400 }
    );
  }

  // ── WAC recompute (PURCHASE only) ──
  // For PURCHASE we blend the incoming cost with the on-hand WAC. For other
  // movement types we leave costPrice unchanged (issuances don't change the
  // per-unit cost; transfers/returns move at the existing WAC).
  let newWac: number | null = null;
  if (adjustmentType === StockMovementType.PURCHASE && parsedUnitCost !== null) {
    const wac = calculateWeightedAverageCost({
      currentStock: product.quantityInStock,
      currentWac: product.costPrice,
      incomingStock: adjustmentQuantity,
      incomingUnitCost: parsedUnitCost,
    });
    newWac = wac.newWac;
  }

  const result = await db.$transaction(async (tx) => {
        const movement = await tx.stockMovement.create({
      data: {
        storeId,
        productId,
        movementType: adjustmentType,
        quantity: adjustmentQuantity,
        notes: reason || `Stock ${adjustmentType.toLowerCase()}`,
        performedBy: performedBy || null,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            unitType: true,
            quantityInStock: true,
          },
        },
      },
    });

        if (adjustmentQuantity > 0) {
      await tx.product.update({
        where: { id: productId },
        data: {
          quantityInStock: { increment: adjustmentQuantity },
          // Persist the new blended WAC for PURCHASE movements. For other
          // movement types (ADJUSTMENT / TRANSFER / RETURN) we leave
          // costPrice untouched.
          ...(newWac !== null ? { costPrice: newWac } : {}),
        },
      });
    } else {
      await tx.product.update({
        where: { id: productId },
        data: { quantityInStock: { decrement: Math.abs(adjustmentQuantity) } },
      });
    }

    return movement;
  });

    const updatedProduct = await db.product.findUnique({
    where: { id: productId },
    select: { quantityInStock: true, costPrice: true },
  });

  await systemLog({
    action: 'STOCK_ADJUSTMENT',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Stock ${adjustmentType.toLowerCase()}: ${product.name} by ${adjustmentQuantity > 0 ? '+' : ''}${adjustmentQuantity}. New stock: ${updatedProduct?.quantityInStock}`,
    storeId,
    userId: performedBy || undefined,
    metadata: {
      productId,
      productName: product.name,
      sku: product.sku,
      adjustmentType,
      quantity: adjustmentQuantity,
      previousStock: product.quantityInStock,
      newStock: updatedProduct?.quantityInStock,
      previousWac: product.costPrice,
      newWac: updatedProduct?.costPrice,
      unitCost: parsedUnitCost,
      reason,
    },
  });

  return Response.json({
    success: true,
    data: {
      ...result,
      previousStock: product.quantityInStock,
      newStock: updatedProduct?.quantityInStock,
      previousWac: product.costPrice,
      newWac: updatedProduct?.costPrice,
    },
  }, { status: 201 });
}

export const GET = withErrorBoundary(getStockMovementsHandler, 'STOCK_MOVEMENTS_LIST');
export const POST = withErrorBoundary(createStockAdjustmentHandler, 'STOCK_ADJUSTMENT');
