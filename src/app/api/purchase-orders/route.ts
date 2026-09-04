// GET/POST /api/purchase-orders

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import { withSequenceRetry } from '@/lib/sequence';

export const dynamic = 'force-dynamic';

// Default VAT rate for Kenya
const KENYA_VAT_RATE = 16;

async function getPurchaseOrdersHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const supplierId = searchParams.get('supplierId');
  const status = searchParams.get('status');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = { storeId };

  if (supplierId) where.supplierId = supplierId;
  if (status) where.status = status;

  if (dateFrom || dateTo) {
    const orderDate: Record<string, Date> = {};
    if (dateFrom) orderDate.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      orderDate.lte = to;
    }
    where.orderDate = orderDate;
  }

  const [purchaseOrders, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      include: {
        supplier: {
          select: { id: true, name: true, phone: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true },
        },
        approvedBy: {
          select: { id: true, name: true },
        },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.purchaseOrder.count({ where }),
  ]);

  const result = purchaseOrders.map((po) => {
    const { _count, ...poData } = po as typeof po & { _count?: { items: number } };
    return { ...poData, itemCount: _count?.items ?? 0 };
  });

  return Response.json({
    success: true,
    data: result,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createPurchaseOrderHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const body = await request.json();

  const { storeId, supplierId, items, notes, expectedDate } = body;

  if (!storeId || !supplierId) {
    return Response.json(
      { success: false, error: 'storeId and supplierId are required.' },
      { status: 400 }
    );
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: 'At least one item is required.' },
      { status: 400 }
    );
  }

  // Validate supplier exists and is active
  const supplier = await db.supplier.findFirst({
    where: { id: supplierId, storeId, isActive: true },
  });
  if (!supplier) {
    return Response.json(
      { success: false, error: 'Supplier not found or inactive.' },
      { status: 404 }
    );
  }

  // Validate all products exist and belong to the store
  const productIds = items.map((item: { productId: string }) => item.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
    select: { id: true, name: true, sku: true, unitType: true, costPrice: true },
  });

  if (products.length !== productIds.length) {
    const foundIds = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id: string) => !foundIds.has(id));
    return Response.json(
      { success: false, error: `Products not found or inactive: ${missing.join(', ')}` },
      { status: 404 }
    );
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  // F1-5 remediation: validate quantities/costs BEFORE computing totals.
  // Negative/zero/NaN/Infinity values used to flow straight into Decimal
  // columns and corrupt supplier-spend reporting.
  for (const item of items as Array<{ productId: string; quantity: number; unitCost: number }>) {
    const qty = Number(item.quantity);
    const cost = Number(item.unitCost);
    if (!Number.isFinite(qty) || qty <= 0) {
      return Response.json(
        { success: false, error: `Invalid quantity for product ${item.productId}: must be a positive finite number.` },
        { status: 400 }
      );
    }
    if (!Number.isFinite(cost) || cost < 0) {
      return Response.json(
        { success: false, error: `Invalid unitCost for product ${item.productId}: must be a non-negative finite number.` },
        { status: 400 }
      );
    }
  }

  // F1-6 remediation: PO creation is retried on P2002 (concurrent double-
  // submit) with a re-allocated per-store sequence number. The schema's
  // uniqueness is now @@unique([storeId, poNumber]) — matching the per-store
  // counter — so store B no longer collides with store A's numbers.
  // F1-5 remediation: money rounded 2dp per line BEFORE header summation
  // (the old path summed raw IEEE-754 products into Decimal columns).
  const { created: purchaseOrder, poNumber, subTotal, taxAmount, totalAmount } = await withSequenceRetry(async () => {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const existingCount = await db.purchaseOrder.count({
      where: { storeId, poNumber: { startsWith: `PO-${dateStr}` } },
    });
    const poNumber = `PO-${dateStr}-${String(existingCount + 1).padStart(4, '0')}`;

    let subTotal = 0;
    const poItems = items.map((item: { productId: string; quantity: number; unitCost: number; notes?: string }) => {
      const product = productMap.get(item.productId);
      const totalCost = Math.round(item.quantity * item.unitCost * 100) / 100;
      subTotal += totalCost;
      return {
        productId: item.productId,
        productName: product?.name || 'Unknown Product',
        quantity: item.quantity,
        unitCost: item.unitCost,
        totalCost,
        notes: item.notes || null,
      };
    });
    subTotal = Math.round(subTotal * 100) / 100;

    const taxAmount = Math.round(subTotal * (KENYA_VAT_RATE / 100) * 100) / 100;
    const totalAmount = Math.round((subTotal + taxAmount) * 100) / 100;

    const created = await db.purchaseOrder.create({
      data: {
        storeId,
        poNumber,
        supplierId,
        status: 'DRAFT',
        subTotal,
        taxAmount,
        totalAmount,
        notes: notes || null,
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        // F1-3/SYS-2: creator identity from the session, not the body.
        createdById: session.userId,
        items: {
          create: poItems,
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unitType: true } },
          },
        },
      },
    });

    return { created, poNumber, subTotal, taxAmount, totalAmount };
  });

  await systemLog({
    action: 'PURCHASE_ORDER_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Purchase Order ${poNumber} created for supplier "${supplier.name}"`,
    storeId,
    metadata: { poId: purchaseOrder.id, poNumber, supplierId, totalAmount, subTotal, taxAmount, itemCount: items.length },
  });

  return Response.json({ success: true, data: purchaseOrder }, { status: 201 });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getPurchaseOrdersHandler),
  'PURCHASE_ORDERS_LIST',
);
export const POST = withErrorBoundary(
  requireStoreAccess(createPurchaseOrderHandler),
  'PURCHASE_ORDERS_CREATE',
);
