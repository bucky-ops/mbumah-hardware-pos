// GET /api/stock-movements  — list paginated stock movements with product details
// POST /api/stock-movements — create a manual stock adjustment (PURCHASE, ADJUSTMENT, RETURN, TRANSFER)
//
// Auth (GET):  any authenticated user (requireStoreAccess — store-scoped).
// Auth (POST): SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER (role-restricted via requireAuth).
//
// Backward compatibility:
//   GET accepts both `type` (new spec) and `movementType` (legacy) query params.
//   GET accepts both `offset` (new spec) and `page` (legacy) for pagination.
//   POST accepts both `type` (new spec) and `adjustmentType` (legacy), and
//   both `note` (new spec) and `reason` (legacy). Either may be omitted.
//
// The POST handler creates a StockMovement record AND atomically updates
// Product.quantityInStock inside a single $transaction so the books always
// reconcile. PURCHASE movements optionally accept `unitCost` to recompute the
// weighted-average cost (WAC) of the product (issued stock uses current WAC).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent, StockMovementType } from '@/lib/types';
import { calculateWeightedAverageCost } from '@/lib/account-helper';
import { requireAuth, requireStoreAccess, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Valid movement types per the task spec. We also accept RENTAL_OUT /
// RENTAL_RETURN on the GET path for legacy callers, but the POST handler
// restricts creations to the four manual types below.
const MANUAL_MOVEMENT_TYPES: string[] = [
  StockMovementType.PURCHASE,
  StockMovementType.ADJUSTMENT,
  StockMovementType.RETURN,
  StockMovementType.TRANSFER,
];

// ── GET /api/stock-movements ────────────────────────────────────────────────

async function getStockMovementsHandler(
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

  // `type` (new) takes precedence over `movementType` (legacy).
  const movementType = searchParams.get('type') || searchParams.get('movementType') || '';
  const productId = searchParams.get('productId') || '';
  const performedBy = searchParams.get('performedBy') || '';
  const dateFrom = searchParams.get('dateFrom') || searchParams.get('startDate') || '';
  const dateTo = searchParams.get('dateTo') || searchParams.get('endDate') || '';

  // `limit` defaults to 50; clamp to a sane max to prevent abuse.
  const requestedLimit = parseInt(searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 500)
    : 50;

  // `offset` (new spec) takes precedence over `page` (legacy).
  const offsetParam = searchParams.get('offset');
  const pageParam = searchParams.get('page');
  let offset = 0;
  if (offsetParam !== null) {
    offset = Math.max(0, parseInt(offsetParam, 10) || 0);
  } else if (pageParam !== null) {
    offset = Math.max(0, (parseInt(pageParam, 10) || 1) - 1) * limit;
  }

  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

  const where: Record<string, unknown> = { storeId };

  if (productId) where.productId = productId;
  if (movementType) where.movementType = movementType;
  if (performedBy) where.performedBy = performedBy;

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
      skip: offset,
      take: limit,
    }),
    db.stockMovement.count({ where }),
  ]);

  // Summary by movement type for the filtered window — useful for the UI
  // to render type counters next to the filter chips.
  const summaryWhere: Record<string, unknown> = { storeId };
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    summaryWhere.createdAt = createdAt;
  }

  const movementTypeSummary = await db.stockMovement.groupBy({
    by: ['movementType'],
    where: summaryWhere,
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
      offset,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      // Echo `page` for legacy callers that read `pagination.page`.
      page: Math.floor(offset / limit) + 1,
    },
  });
}

// ── POST /api/stock-movements ───────────────────────────────────────────────

async function createStockAdjustmentHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const body = await request.json();

  const {
    productId,
    // `type` (new spec) takes precedence over `adjustmentType` (legacy).
    type,
    adjustmentType,
    quantity,
    // `reason` is the headline label (e.g. "DAMAGE", "COUNT_ADJUSTMENT");
    // `note` is free-form text. Both are persisted: reason → notes (joined).
    reason,
    note,
    storeId: bodyStoreId,
    performedBy,
    unitCost,
  } = body as {
    productId?: string;
    type?: string;
    adjustmentType?: string;
    quantity?: number | string;
    reason?: string;
    note?: string;
    storeId?: string;
    performedBy?: string;
    unitCost?: number | string;
  };

  if (!productId) {
    return Response.json(
      { success: false, error: 'productId is required.' },
      { status: 400 },
    );
  }

  const movementTypeValue = type || adjustmentType;
  if (!movementTypeValue) {
    return Response.json(
      { success: false, error: 'type is required (PURCHASE | ADJUSTMENT | RETURN | TRANSFER).' },
      { status: 400 },
    );
  }

  if (!MANUAL_MOVEMENT_TYPES.includes(movementTypeValue)) {
    return Response.json(
      {
        success: false,
        error: `Invalid movement type. Manual adjustments must be one of: ${MANUAL_MOVEMENT_TYPES.join(', ')}.`,
      },
      { status: 400 },
    );
  }

  // Resolve storeId: prefer the body (SUPER_ADMIN cross-store), fall back to
  // the session's storeId for store-scoped users.
  const storeId = bodyStoreId || session.storeId;
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId could not be determined from the request or session.' },
      { status: 400 },
    );
  }

  const adjustmentQuantity = parseFloat(String(quantity));
  if (!Number.isFinite(adjustmentQuantity) || adjustmentQuantity === 0) {
    return Response.json(
      { success: false, error: 'quantity must be a non-zero number.' },
      { status: 400 },
    );
  }

  // PURCHASE represents receiving new stock at a known unit cost — it MUST
  // carry a unitCost so we can blend the WAC. Other movement types issue
  // stock at the current WAC and don't need a unitCost.
  const parsedUnitCost =
    unitCost !== undefined && unitCost !== null && unitCost !== ''
      ? parseFloat(String(unitCost))
      : null;

  if (movementTypeValue === StockMovementType.PURCHASE) {
    if (adjustmentQuantity < 0) {
      return Response.json(
        {
          success: false,
          error: 'PURCHASE movements must have a positive quantity (use ADJUSTMENT to issue stock).',
        },
        { status: 400 },
      );
    }
    if (parsedUnitCost === null || Number.isNaN(parsedUnitCost) || parsedUnitCost < 0) {
      return Response.json(
        { success: false, error: 'PURCHASE movements require a non-negative unitCost so the WAC can be recomputed.' },
        { status: 400 },
      );
    }
  }

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) {
    return Response.json(
      { success: false, error: 'Product not found.' },
      { status: 404 },
    );
  }

  // Guard against negative stock for issuances.
  const currentStockNum = Number(product.quantityInStock);
  if (adjustmentQuantity < 0 && currentStockNum + adjustmentQuantity < 0) {
    return Response.json(
      {
        success: false,
        error: `Insufficient stock. Current: ${currentStockNum}, Adjustment: ${adjustmentQuantity}`,
      },
      { status: 400 },
    );
  }

  // ── WAC recompute (PURCHASE only) ──
  let newWac: number | null = null;
  if (movementTypeValue === StockMovementType.PURCHASE && parsedUnitCost !== null) {
    const wac = calculateWeightedAverageCost({
      currentStock: currentStockNum,
      currentWac: Number(product.costPrice),
      incomingStock: adjustmentQuantity,
      incomingUnitCost: parsedUnitCost,
    });
    newWac = wac.newWac;
  }

  // Compose a readable notes string: "reason | note" if both supplied.
  const reasonText = (reason || '').trim();
  const noteText = (note || '').trim();
  const composedNotes =
    reasonText && noteText
      ? `${reasonText} — ${noteText}`
      : reasonText || noteText || `Stock ${movementTypeValue.toLowerCase()}`;

  const result = await db.$transaction(async (tx) => {
    const movement = await tx.stockMovement.create({
      data: {
        storeId,
        productId,
        movementType: movementTypeValue,
        quantity: adjustmentQuantity,
        notes: composedNotes,
        performedBy: performedBy || session.userId,
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

    // Atomic stock-level update — keeps StockMovement and Product.quantityInStock
    // consistent regardless of concurrent requests.
    if (adjustmentQuantity > 0) {
      await tx.product.update({
        where: { id: productId },
        data: {
          quantityInStock: { increment: adjustmentQuantity },
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
    message: `Stock ${movementTypeValue.toLowerCase()}: ${product.name} by ${adjustmentQuantity > 0 ? '+' : ''}${adjustmentQuantity}. New stock: ${updatedProduct?.quantityInStock}`,
    storeId,
    userId: performedBy || session.userId,
    metadata: {
      productId,
      productName: product.name,
      sku: product.sku,
      movementType: movementTypeValue,
      quantity: adjustmentQuantity,
      previousStock: product.quantityInStock,
      newStock: updatedProduct?.quantityInStock,
      previousWac: product.costPrice,
      newWac: updatedProduct?.costPrice,
      unitCost: parsedUnitCost,
      reason: reasonText,
      note: noteText,
    },
  });

  return Response.json(
    {
      success: true,
      data: {
        ...result,
        previousStock: product.quantityInStock,
        newStock: updatedProduct?.quantityInStock,
        previousWac: product.costPrice,
        newWac: updatedProduct?.costPrice,
      },
    },
    { status: 201 },
  );
}

export const GET = withErrorBoundary(
  requireStoreAccess(getStockMovementsHandler),
  'STOCK_MOVEMENTS_LIST',
);

export const POST = withErrorBoundary(
  requireAuth(createStockAdjustmentHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'],
  }),
  'STOCK_ADJUSTMENT',
);
