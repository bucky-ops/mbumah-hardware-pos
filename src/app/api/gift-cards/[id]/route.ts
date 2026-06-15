// GET/PUT/DELETE /api/gift-cards/[id]

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getGiftCardHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const giftCard = await db.giftCard.findUnique({
    where: { id },
    include: {
      store: { select: { id: true, name: true, location: true } },
      issuedByUser: { select: { id: true, name: true, email: true } },
      issuedToCustomer: { select: { id: true, name: true, phone: true, email: true } },
      redemptions: {
        orderBy: { createdAt: 'desc' },
        include: {
          transaction: { select: { id: true, receiptNumber: true, totalAmount: true } },
        },
      },
    },
  });

  if (!giftCard) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: giftCard });
}

async function updateGiftCardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.giftCard.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'reason', 'notes', 'recipientName', 'recipientPhone', 'recipientEmail',
    'expiresAt', 'autoAdjustItems', 'isVisible',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // Handle toggleVisibility shortcut
  if (body.toggleVisibility === true) {
    updateData.isVisible = !existing.isVisible;
  }

  // Handle expiresAt conversion
  if (updateData.expiresAt) {
    updateData.expiresAt = new Date(updateData.expiresAt as string);
  }

  // If autoAdjustItems is being toggled on, adjust visibility based on current balance
  if (body.autoAdjustItems === true) {
    updateData.isVisible = existing.currentBalance > 0;
  }

  // If autoAdjustItems is being toggled off, keep current visibility
  // (no change needed)

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const giftCard = await db.giftCard.update({
    where: { id },
    data: updateData,
    include: {
      store: { select: { id: true, name: true } },
      issuedByUser: { select: { id: true, name: true } },
      issuedToCustomer: { select: { id: true, name: true, phone: true } },
    },
  });

  await systemLog({
    action: 'GIFT_CARD_UPDATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Gift card ${existing.code} updated`,
    storeId: existing.storeId,
    metadata: { giftCardId: id, code: existing.code, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: giftCard });
}

async function deleteGiftCardHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.giftCard.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  if (existing.status !== 'ACTIVE' && existing.status !== 'PARTIALLY_REDEEMED') {
    return Response.json(
      { success: false, error: `Cannot cancel gift card with status "${existing.status}". Only ACTIVE or PARTIALLY_REDEEMED cards can be cancelled.` },
      { status: 400 }
    );
  }

  const giftCard = await db.giftCard.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: {
      store: { select: { id: true, name: true } },
    },
  });

  await systemLog({
    action: 'GIFT_CARD_CANCELLED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Gift card ${existing.code} cancelled. Remaining balance: ${existing.currentBalance}`,
    storeId: existing.storeId,
    metadata: { giftCardId: id, code: existing.code, previousStatus: existing.status, remainingBalance: existing.currentBalance },
  });

  return Response.json({
    success: true,
    message: 'Gift card cancelled successfully.',
    data: giftCard,
  });
}

export const GET = withErrorBoundary(getGiftCardHandler, 'GIFT_CARD_DETAIL');
export const PUT = withErrorBoundary(updateGiftCardHandler, 'GIFT_CARD_UPDATE');
export const DELETE = withErrorBoundary(deleteGiftCardHandler, 'GIFT_CARD_CANCEL');
