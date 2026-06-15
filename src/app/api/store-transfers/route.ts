// GET/POST /api/store-transfers

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

function generateTransferNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 99999)).padStart(5, '0');
  return `XFR-${dateStr}-${random}`;
}

async function getStoreTransfersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const status = searchParams.get('status');
  const fromStoreId = searchParams.get('fromStoreId');
  const toStoreId = searchParams.get('toStoreId');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = {
    OR: [{ fromStoreId: storeId }, { toStoreId: storeId }],
  };

  if (status) {
    where.status = status;
  }

  if (fromStoreId) {
    where.fromStoreId = fromStoreId;
  }

  if (toStoreId) {
    where.toStoreId = toStoreId;
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

  const validSortFields = ['transferNumber', 'status', 'createdAt', 'shippedAt', 'receivedAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [transfers, total] = await Promise.all([
    db.storeTransfer.findMany({
      where,
      include: {
        fromStore: { select: { id: true, name: true, location: true } },
        toStore: { select: { id: true, name: true, location: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, quantityInStock: true } },
          },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.storeTransfer.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: transfers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createStoreTransferHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    fromStoreId,
    toStoreId,
    items,
    requestedBy,
    notes,
  } = body;

  if (!fromStoreId || !toStoreId || !items || !Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: 'fromStoreId, toStoreId, and items (non-empty array) are required.' },
      { status: 400 }
    );
  }

  if (fromStoreId === toStoreId) {
    return Response.json(
      { success: false, error: 'fromStoreId and toStoreId must be different.' },
      { status: 400 }
    );
  }

  // Validate stores exist
  const [fromStore, toStore] = await Promise.all([
    db.store.findUnique({ where: { id: fromStoreId } }),
    db.store.findUnique({ where: { id: toStoreId } }),
  ]);

  if (!fromStore) {
    return Response.json(
      { success: false, error: 'Origin store not found.' },
      { status: 404 }
    );
  }

  if (!toStore) {
    return Response.json(
      { success: false, error: 'Destination store not found.' },
      { status: 404 }
    );
  }

  // Validate items
  for (const item of items) {
    if (!item.productId || !item.quantity || item.quantity <= 0) {
      return Response.json(
        { success: false, error: 'Each item must have productId and a positive quantity.' },
        { status: 400 }
      );
    }
  }

  // Generate unique transfer number
  let transferNumber = generateTransferNumber();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.storeTransfer.findUnique({ where: { transferNumber } });
    if (!existing) break;
    transferNumber = generateTransferNumber();
    attempts++;
  }

  const transfer = await db.storeTransfer.create({
    data: {
      transferNumber,
      fromStoreId,
      toStoreId,
      status: 'PENDING',
      requestedBy: requestedBy || null,
      notes: notes || null,
      items: {
        create: items.map((item: { productId: string; quantity: number; unitType?: string; notes?: string }) => ({
          productId: item.productId,
          quantity: parseFloat(String(item.quantity)),
          receivedQty: 0,
          unitType: item.unitType || 'PIECE',
          notes: item.notes || null,
        })),
      },
    },
    include: {
      fromStore: { select: { id: true, name: true, location: true } },
      toStore: { select: { id: true, name: true, location: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
    },
  });

  await systemLog({
    action: 'STORE_TRANSFER_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Store transfer ${transferNumber} created: ${fromStore.name} → ${toStore.name}`,
    storeId: fromStoreId,
    userId: requestedBy || undefined,
    metadata: {
      transferId: transfer.id,
      transferNumber,
      fromStoreId,
      toStoreId,
      itemCount: items.length,
    },
  });

  return Response.json({ success: true, data: transfer }, { status: 201 });
}

export const GET = withErrorBoundary(getStoreTransfersHandler, 'STORE_TRANSFERS_LIST');
export const POST = withErrorBoundary(createStoreTransferHandler, 'STORE_TRANSFERS_CREATE');
