// GET/POST /api/store-transfers
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • SYS-1/P0-3: both endpoints were unauthenticated (any non-empty Bearer
//     passed the proxy). Now wrapped in `requireStoreAccess`.
//   • SYS-2/F1-3: `requestedBy` previously came from the request body —
//     spoofable. Now derived from the authenticated session.
//   • F3-5: a non-admin can only create transfers FROM their own store.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

function generateTransferNumber(): string {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  // crypto.randomBytes instead of Math.random — receipt/transfer numbers must
  // not be predictable (they are referenced in payment descriptions) and the
  // larger space reduces birthday collisions (SYS-7).
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `XFR-${dateStr}-${random}`;
}

async function getStoreTransfersHandler(
  request: NextRequest,
  _session: AuthSession,
  ..._args: unknown[]
): Promise<Response> {
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

async function createStoreTransferHandler(
  request: NextRequest,
  session: AuthSession,
  ..._args: unknown[]
): Promise<Response> {
  const body = await request.json();

  const {
    fromStoreId,
    toStoreId,
    items,
    notes,
  } = body;

  // SYS-2/F3-5: actor identity from the session; non-admins may only dispatch
  // transfers from their own store (the `requestedBy` body field is ignored).

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

  // F3-5 (store binding): non-admin users may only originate transfers from
  // the store they are assigned to. SUPER_ADMIN may create cross-store flows.
  const requestedBy = session.userId;
  if (session.role !== 'SUPER_ADMIN' && session.storeId && session.storeId !== fromStoreId) {
    return Response.json(
      { success: false, error: 'You can only create transfers from your own store.' },
      { status: 403 }
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

export const GET = withErrorBoundary(requireStoreAccess(getStoreTransfersHandler) as (...args: unknown[]) => Promise<Response>, 'STORE_TRANSFERS_LIST');
export const POST = withErrorBoundary(requireStoreAccess(createStoreTransferHandler) as (...args: unknown[]) => Promise<Response>, 'STORE_TRANSFERS_CREATE');
