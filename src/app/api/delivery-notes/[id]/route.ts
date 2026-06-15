// GET/PUT /api/delivery-notes/[id]

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getDeliveryNoteHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const deliveryNote = await db.deliveryNote.findUnique({
    where: { id },
    include: {
      items: true,
      transaction: {
        select: {
          id: true,
          receiptNumber: true,
          totalAmount: true,
          paymentStatus: true,
        },
      },
    },
  });

  if (!deliveryNote) {
    return Response.json(
      { success: false, error: 'Delivery note not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: deliveryNote });
}

async function updateDeliveryNoteHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.deliveryNote.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Delivery note not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'customerName', 'customerPhone', 'deliveryAddress',
    'driverName', 'vehicleNumber', 'notes',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // Handle status changes
  if (body.status) {
    const validStatuses = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(body.status)) {
      return Response.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    updateData.status = body.status;

    // Set deliveredAt when status changes to DELIVERED
    if (body.status === 'DELIVERED' && existing.status !== 'DELIVERED') {
      updateData.deliveredAt = new Date();
    }
  }

  if (body.scheduledDate !== undefined) {
    updateData.scheduledDate = body.scheduledDate ? new Date(body.scheduledDate) : null;
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const deliveryNote = await db.deliveryNote.update({
    where: { id },
    data: updateData,
    include: {
      items: true,
    },
  });

  await systemLog({
    action: 'DELIVERY_NOTE_UPDATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Delivery note ${existing.deliveryNumber} updated`,
    storeId: existing.storeId,
    metadata: { deliveryNoteId: id, updatedFields: Object.keys(updateData), previousStatus: existing.status },
  });

  return Response.json({ success: true, data: deliveryNote });
}

export const GET = withErrorBoundary(getDeliveryNoteHandler, 'DELIVERY_NOTE_DETAIL');
export const PUT = withErrorBoundary(updateDeliveryNoteHandler, 'DELIVERY_NOTE_UPDATE');
