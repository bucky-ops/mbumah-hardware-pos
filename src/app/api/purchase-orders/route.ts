// GET/POST /api/purchase-orders

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getPurchaseOrdersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
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
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = { storeId };

  if (supplierId) where.supplierId = supplierId;
  if (status) where.status = status;

  const [purchaseOrders, total] = await Promise.all([
    db.purchaseOrder.findMany({
      where,
      include: {
        supplier: {
          select: { id: true, name: true, phone: true, email: true },
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
    const { _count, ...poData } = po;
    return { ...poData, itemCount: _count.items };
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

async function createPurchaseOrderHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, supplierId, items, notes, expectedDate, createdBy } = body;

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

    const supplier = await db.supplier.findFirst({
    where: { id: supplierId, storeId, isActive: true },
  });
  if (!supplier) {
    return Response.json(
      { success: false, error: 'Supplier not found or inactive.' },
      { status: 404 }
    );
  }

    const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const existingCount = await db.purchaseOrder.count({
    where: { storeId, poNumber: { startsWith: `PO-${dateStr}` } },
  });
  const poNumber = `PO-${dateStr}-${String(existingCount + 1).padStart(4, '0')}`;

    let totalAmount = 0;
  const poItems = items.map((item: { productId: string; quantity: number; unitPrice: number; notes?: string }) => {
    const totalPrice = item.quantity * item.unitPrice;
    totalAmount += totalPrice;
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice,
      notes: item.notes || null,
    };
  });

  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      storeId,
      poNumber,
      supplierId,
      totalAmount,
      notes: notes || null,
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      createdBy: createdBy || null,
      items: {
        create: poItems,
      },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, unitType: true } },
        },
      },
    },
  });

  await systemLog({
    action: 'PURCHASE_ORDER_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Purchase Order ${poNumber} created for supplier "${supplier.name}"`,
    storeId,
    metadata: { poId: purchaseOrder.id, poNumber, supplierId, totalAmount, itemCount: items.length },
  });

  return Response.json({ success: true, data: purchaseOrder }, { status: 201 });
}

export const GET = withErrorBoundary(getPurchaseOrdersHandler, 'PURCHASE_ORDERS_LIST');
export const POST = withErrorBoundary(createPurchaseOrderHandler, 'PURCHASE_ORDERS_CREATE');
