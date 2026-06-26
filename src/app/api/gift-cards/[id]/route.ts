// GET/PUT/DELETE /api/gift-cards/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

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
    'expiresAt', 'autoAdjustItems', 'isVisible', 'initialBalance',
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
  } else if (body.expiresAt === null || body.expiresAt === '') {
    // Allow clearing the expiry date
    updateData.expiresAt = null;
  }

  // Handle initialBalance update - must be >= currentBalance
  if (updateData.initialBalance !== undefined) {
    const newInitial = Number(updateData.initialBalance);
    if (isNaN(newInitial) || newInitial < 0) {
      return Response.json(
        { success: false, error: 'Initial balance must be a valid positive number.' },
        { status: 400 }
      );
    }
    if (newInitial < existing.currentBalance) {
      return Response.json(
        { success: false, error: `Initial balance cannot be less than current balance (${existing.currentBalance}).` },
        { status: 400 }
      );
    }
  }

  // If autoAdjustItems is being toggled on, adjust visibility based on current balance
  if (body.autoAdjustItems === true) {
    updateData.isVisible = existing.currentBalance > 0;
  }

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
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  // Check for hard delete flag
  const url = new URL(request.url);
  const hardDelete = url.searchParams.get('hardDelete') === 'true';

  const existing = await db.giftCard.findUnique({
    where: { id },
    include: { redemptions: true },
  });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  // Hard delete: permanently remove the gift card and all related records
  if (hardDelete) {
    // Only allow hard delete for cards that are already CANCELLED, EXPIRED, or REDEEMED
    if (existing.status === 'ACTIVE' || existing.status === 'PARTIALLY_REDEEMED') {
      return Response.json(
        { success: false, error: 'Cannot permanently delete an active or partially redeemed gift card. Cancel it first.' },
        { status: 400 }
      );
    }

    // Delete redemptions first (cascade should handle this, but be explicit)
    await db.giftCardRedemption.deleteMany({
      where: { giftCardId: id },
    });

    // Delete the gift card
    await db.giftCard.delete({
      where: { id },
    });

    await systemLog({
      action: 'GIFT_CARD_HARD_DELETED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.WARN,
      message: `Gift card ${existing.code} permanently deleted`,
      storeId: existing.storeId,
      metadata: {
        giftCardId: id,
        code: existing.code,
        previousStatus: existing.status,
        initialBalance: existing.initialBalance,
        currentBalance: existing.currentBalance,
        redemptionsCount: existing.redemptions.length,
      },
    });

    return Response.json({
      success: true,
      message: 'Gift card permanently deleted.',
    });
  }

  // Soft delete (cancel): default behavior
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
