// PUT/DELETE /api/gift-cards/[id]

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function updateGiftCardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  // Check if gift card exists
  const existing = await db.giftCard.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  const { status, notes, expiresAt, issuedReason, minimumPurchase } = body;

  // If setting to REDEEMED, also zero out balance
  const updateData: Record<string, unknown> = {};
  if (status !== undefined) {
    const validStatuses = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return Response.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    updateData.status = status;
    if (status === 'REDEEMED') {
      updateData.currentBalance = 0;
    }
  }
  if (expiresAt !== undefined) {
    updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;
  }
  if (issuedReason !== undefined) {
    updateData.issuedReason = issuedReason;
  }
  if (minimumPurchase !== undefined) {
    updateData.minimumPurchase = minimumPurchase;
  }
  if (notes !== undefined) {
    // Store notes in system log since there's no notes field on GiftCard model
    await systemLog({
      action: 'GIFT_CARD_UPDATED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.INFO,
      message: `Gift card ${existing.code} updated. Notes: ${notes}`,
      storeId: existing.storeId,
      metadata: { giftCardId: id, code: existing.code, updates: updateData, notes },
    });
  }

  if (Object.keys(updateData).length === 0 && notes === undefined) {
    return Response.json(
      { success: false, error: 'No fields to update.' },
      { status: 400 }
    );
  }

  const giftCard = await db.giftCard.update({
    where: { id },
    data: updateData,
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  // Log update if no notes were provided (notes-only case logs above)
  if (notes === undefined) {
    await systemLog({
      action: 'GIFT_CARD_UPDATED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.INFO,
      message: `Gift card ${existing.code} updated`,
      storeId: existing.storeId,
      metadata: { giftCardId: id, code: existing.code, updates: updateData },
    });
  }

  return Response.json({ success: true, data: giftCard });
}

async function deleteGiftCardHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  // Check if gift card exists
  const existing = await db.giftCard.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  // Only allow deletion of CANCELLED or EXPIRED cards
  if (existing.status !== 'CANCELLED' && existing.status !== 'EXPIRED') {
    return Response.json(
      { success: false, error: 'Only CANCELLED or EXPIRED gift cards can be deleted.' },
      { status: 400 }
    );
  }

  // Hard delete the record
  await db.giftCard.delete({ where: { id } });

  await systemLog({
    action: 'GIFT_CARD_DELETED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Gift card ${existing.code} deleted`,
    storeId: existing.storeId,
    metadata: { giftCardId: id, code: existing.code, previousStatus: existing.status },
  });

  return Response.json({ success: true, message: 'Gift card deleted successfully.' });
}

export const PUT = withErrorBoundary(updateGiftCardHandler, 'GIFT_CARD_UPDATE');
export const DELETE = withErrorBoundary(deleteGiftCardHandler, 'GIFT_CARD_DELETE');
