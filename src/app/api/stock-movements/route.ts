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
//   both `note` (new spec) and `reason` (legacy). Either may be omitted —
//   EXCEPT for write-offs (negative quantity), where `reason` (min 3 chars)
//   is mandatory and a DAMAGED/STOLEN/EXPIRED `category` may be supplied.
//
// The POST handler creates a StockMovement record AND atomically updates
// Product.quantityInStock inside a single $transaction so the books always
// reconcile. PURCHASE movements optionally accept `unitCost` to recompute the
// weighted-average cost (WAC) of the product (issued stock uses current WAC).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent, StockMovementType } from '@/lib/types';
import { calculateWeightedAverageCost, getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { generateJournalEntryNumber } from '@/lib/helpers';
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

// AUDIT FIX (governance): recognized write-off classifications. StockMovement
// has no category column (schema untouched), so the classification supplied by
// the client is persisted inside the `notes` field as a `[WRITE_OFF: X]` prefix.
const WRITE_OFF_CATEGORIES = ['DAMAGED', 'STOLEN', 'EXPIRED'] as const;
type WriteOffCategory = (typeof WRITE_OFF_CATEGORIES)[number];

/**
 * Resolve the write-off classification for a negative-quantity movement:
 * an explicit `category` body field wins; otherwise it is detected from the
 * reason text. Returns null when nothing recognisable was supplied.
 */
function classifyWriteOff(category: unknown, reasonText: string): WriteOffCategory | null {
  const explicit = String(category || '').trim().toUpperCase();
  if (explicit) {
    return (WRITE_OFF_CATEGORIES as readonly string[]).includes(explicit)
      ? (explicit as WriteOffCategory)
      : null;
  }
  const haystack = reasonText.toUpperCase();
  if (haystack.includes('DAMAGE')) return 'DAMAGED';
  if (haystack.includes('STOLEN') || haystack.includes('THEFT')) return 'STOLEN';
  if (haystack.includes('EXPIRED') || haystack.includes('EXPIRY')) return 'EXPIRED';
  return null;
}

/** 2dp HALF_UP rounding for journal line amounts (mirrors account-helper.ts). */
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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
    category,
    unitCost,
  } = body as {
    productId?: string;
    type?: string;
    adjustmentType?: string;
    quantity?: number | string;
    reason?: string;
    note?: string;
    storeId?: string;
    // AUDIT FIX (governance): `category` carries the DAMAGED/STOLEN/EXPIRED
    // write-off classification. The old `performedBy` body field was removed:
    // actor identity MUST come from the authenticated session only.
    category?: string;
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

  // AUDIT FIX (TOCTOU/oversell): the old outside-the-tx stock pre-check was a
  // read-then-act race — it could not see concurrent decrements and is now
  // replaced by a conditional updateMany INSIDE the transaction below
  // (count === 0 → typed 409). Stock sufficiency is enforced atomically there.

  // ── Write-off governance (negative quantity) ──
  // AUDIT FIX (governance): a write-off previously required no reason and was
  // never classified or valued in the GL. Negative movements now REQUIRE a
  // documented reason (min 3 chars) and persist a DAMAGED/STOLEN/EXPIRED
  // classification (explicit `category` field, else detected from the reason).
  const reasonText = (reason || '').trim();
  const noteText = (note || '').trim();
  if (adjustmentQuantity < 0 && reasonText.length < 3) {
    return Response.json(
      {
        success: false,
        error: 'A reason (min 3 characters) is required for stock write-offs (negative quantity).',
      },
      { status: 400 },
    );
  }
  const writeOffCategory =
    adjustmentQuantity < 0 ? classifyWriteOff(category, reasonText) : null;
  if (
    adjustmentQuantity < 0 &&
    category !== undefined &&
    category !== null &&
    String(category).trim() !== '' &&
    writeOffCategory === null
  ) {
    // An explicit but unrecognised category must not be silently dropped.
    return Response.json(
      {
        success: false,
        error: `Invalid write-off category. Must be one of: ${WRITE_OFF_CATEGORIES.join(', ')}.`,
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

  // Compose a readable notes string: "[WRITE_OFF: X] reason — note". The
  // classification is encoded here because StockMovement has no category column.
  const writeOffPrefix = writeOffCategory ? `[WRITE_OFF: ${writeOffCategory}] ` : '';
  const composedNotes =
    writeOffPrefix +
    (reasonText && noteText
      ? `${reasonText} — ${noteText}`
      : reasonText || noteText || `Stock ${movementTypeValue.toLowerCase()}`);

  const result = await db.$transaction(async (tx) => {
    // AUDIT FIX (TOCTOU/oversell): the stock claim is a conditional updateMany
    // (row lock + atomic predicate re-check) replacing the blind decrement that
    // followed an outside-the-tx pre-check. It runs FIRST so a failed claim
    // aborts with NO StockMovement row (an early return after the create would
    // commit a movement that never moved stock). count === 0 → typed 409 below,
    // mirroring the transactions route pattern (transactions/route.ts:583-591).
    if (adjustmentQuantity < 0) {
      const claimed = await tx.product.updateMany({
        where: { id: productId, quantityInStock: { gte: Math.abs(adjustmentQuantity) } },
        data: { quantityInStock: { decrement: Math.abs(adjustmentQuantity) } },
      });
      if (claimed.count === 0) {
        return { ok: false as const, reason: 'insufficient_stock' as const };
      }
    }

    const movement = await tx.stockMovement.create({
      data: {
        storeId,
        productId,
        movementType: movementTypeValue,
        quantity: adjustmentQuantity,
        notes: composedNotes,
        // AUDIT FIX (governance): actor identity is session-only — the request
        // body must never be able to impersonate another user.
        performedBy: session.userId,
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
      // AUDIT FIX (write-off JE): shrinkage previously never touched the GL —
      // Inventory (1300) was only ever credited by POS COGS, so every write-off
      // drifted the books. Post a balanced JE in the SAME tx, following the
      // recordGoodsReceiptEntry style:
      //   Dr Cost of Goods Sold (5000) — the seeded expense account already
      //     used for inventory reductions (see recordSaleJournalEntry COGS leg)
      //   Cr Inventory (1300)
      // valued at the product's WAC (costPrice) × units written off — the same
      // Σ(wac × qty) valuation COGS uses elsewhere.
      const writeOffValue = roundMoney(Math.abs(adjustmentQuantity) * Number(product.costPrice));
      if (writeOffValue > 0) {
        const store = await tx.store.findUnique({
          where: { id: storeId },
          select: { organizationId: true },
        });
        const orgId = store?.organizationId || 'org_mbumah';
        const accounts = await getAccountIds(orgId, [
          ACCOUNT_CODES.COST_OF_GOODS_SOLD,
          ACCOUNT_CODES.INVENTORY,
        ]);
        await tx.journalEntry.create({
          data: {
            storeId,
            entryNumber: generateJournalEntryNumber(),
            description: `Stock write-off (${writeOffCategory || 'UNCLASSIFIED'}) — ${product.name}`,
            referenceType: 'STOCK_MOVEMENT',
            referenceId: movement.id,
            totalDebit: writeOffValue,
            totalCredit: writeOffValue,
            isPosted: true,
            postedAt: new Date(),
            createdBy: session.userId,
            lines: {
              create: [
                {
                  accountId: accounts.COST_OF_GOODS_SOLD,
                  debit: writeOffValue,
                  credit: 0,
                  description: `Write-off loss for ${product.sku} — ${composedNotes}`,
                },
                {
                  accountId: accounts.INVENTORY,
                  debit: 0,
                  credit: writeOffValue,
                  description: `Inventory reduced by ${Math.abs(adjustmentQuantity)} units (write-off)`,
                },
              ],
            },
          },
        });
      }
    }

    return { ok: true as const, movement };
  });

  if (!result.ok) {
    // Typed conflict (mirrors the store-transfers ship/receive/cancel pattern):
    // the atomic conditional decrement lost the race for available stock.
    return Response.json(
      {
        success: false,
        error: `Insufficient stock for "${product.name}". Needed: ${Math.abs(adjustmentQuantity)}.`,
      },
      { status: 409 },
    );
  }
  const movement = result.movement;

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
    // AUDIT FIX (governance): audit actor is session-only (was `performedBy || session.userId`,
    // letting the body override the recorded actor). Row carries actor, reason,
    // quantity and product identity for traceability.
    userId: session.userId,
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
      writeOffCategory: writeOffCategory || null,
    },
  });

  return Response.json(
    {
      success: true,
      data: {
        ...movement,
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
