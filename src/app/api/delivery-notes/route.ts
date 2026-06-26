// GET/POST /api/delivery-notes

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

function generateDeliveryNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `DN-${dateStr}-${seq}`;
}

async function getDeliveryNotesHandler(...args: unknown[]): Promise<Response> {
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
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';
  const search = searchParams.get('search') || '';

  const where: Record<string, unknown> = { storeId };

  if (status) {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { deliveryNumber: { contains: search } },
      { customerName: { contains: search } },
      { customerPhone: { contains: search } },
      { driverName: { contains: search } },
    ];
  }

  const validSortFields = ['deliveryNumber', 'customerName', 'status', 'createdAt', 'scheduledDate'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [deliveryNotes, total] = await Promise.all([
    db.deliveryNote.findMany({
      where,
      include: {
        _count: {
          select: { items: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.deliveryNote.count({ where }),
  ]);

  const result = deliveryNotes.map((dn) => {
    const { _count, ...dnData } = dn;
    return {
      ...dnData,
      itemCount: _count.items,
    };
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

async function createDeliveryNoteHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    transactionId,
    customerId,
    customerName,
    customerPhone,
    deliveryAddress,
    driverName,
    vehicleNumber,
    scheduledDate,
    notes,
    createdBy,
    items,
  } = body;

  if (!storeId || !customerName) {
    return Response.json(
      { success: false, error: 'storeId and customerName are required.' },
      { status: 400 }
    );
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: 'At least one delivery item is required.' },
      { status: 400 }
    );
  }

  // Validate items
  for (const item of items) {
    if (!item.productName || item.quantity === undefined || item.quantity <= 0) {
      return Response.json(
        { success: false, error: 'Each item must have productName and a positive quantity.' },
        { status: 400 }
      );
    }
  }

  // Generate unique delivery number
  let deliveryNumber = generateDeliveryNumber();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.deliveryNote.findUnique({ where: { deliveryNumber } });
    if (!existing) break;
    deliveryNumber = generateDeliveryNumber();
    attempts++;
  }

  // Check if transactionId already has a delivery note
  if (transactionId) {
    const existingDN = await db.deliveryNote.findUnique({ where: { transactionId } });
    if (existingDN) {
      return Response.json(
        { success: false, error: 'A delivery note already exists for this transaction.' },
        { status: 409 }
      );
    }
  }

  const deliveryNote = await db.deliveryNote.create({
    data: {
      storeId,
      transactionId: transactionId || null,
      deliveryNumber,
      customerId: customerId || null,
      customerName,
      customerPhone: customerPhone || null,
      deliveryAddress: deliveryAddress || null,
      driverName: driverName || null,
      vehicleNumber: vehicleNumber || null,
      status: 'PENDING',
      scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      notes: notes || null,
      createdBy: createdBy || null,
      items: {
        create: items.map((item: { productId?: string; productName: string; quantity: number; unitType?: string; notes?: string }) => ({
          productId: item.productId || null,
          productName: item.productName,
          quantity: item.quantity,
          unitType: item.unitType || 'PIECE',
          notes: item.notes || null,
        })),
      },
    },
    include: {
      items: true,
    },
  });

  await systemLog({
    action: 'DELIVERY_NOTE_CREATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Delivery note ${deliveryNumber} created for ${customerName}`,
    storeId,
    metadata: { deliveryNoteId: deliveryNote.id, deliveryNumber, itemCount: items.length },
  });

  return Response.json({ success: true, data: deliveryNote }, { status: 201 });
}

export const GET = withErrorBoundary(getDeliveryNotesHandler, 'DELIVERY_NOTES_LIST');
export const POST = withErrorBoundary(createDeliveryNoteHandler, 'DELIVERY_NOTES_CREATE');
