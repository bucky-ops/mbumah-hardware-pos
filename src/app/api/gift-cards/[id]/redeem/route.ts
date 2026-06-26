// POST /api/gift-cards/[id]/redeem

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function redeemGiftCardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const { amount, transactionId, redeemedBy, notes } = body;

  if (!amount || amount <= 0) {
    return Response.json(
      { success: false, error: 'Redemption amount must be a positive number.' },
      { status: 400 }
    );
  }

  const giftCard = await db.giftCard.findUnique({ where: { id } });
  if (!giftCard) {
    return Response.json(
      { success: false, error: 'Gift card not found.' },
      { status: 404 }
    );
  }

  if (giftCard.status !== 'ACTIVE' && giftCard.status !== 'PARTIALLY_REDEEMED') {
    return Response.json(
      { success: false, error: `Cannot redeem gift card with status "${giftCard.status}". Only ACTIVE or PARTIALLY_REDEEMED cards can be redeemed.` },
      { status: 400 }
    );
  }

  // Check expiry
  if (giftCard.expiresAt && new Date(giftCard.expiresAt) < new Date()) {
    // Auto-expire the card
    await db.giftCard.update({
      where: { id },
      data: { status: 'EXPIRED' },
    });
    return Response.json(
      { success: false, error: 'This gift card has expired.' },
      { status: 400 }
    );
  }

  if (amount > giftCard.currentBalance) {
    return Response.json(
      { success: false, error: `Redemption amount (${amount}) exceeds current balance (${giftCard.currentBalance}).` },
      { status: 400 }
    );
  }

  const newBalance = giftCard.currentBalance - amount;
  const newStatus = newBalance === 0 ? 'REDEEMED' : 'PARTIALLY_REDEEMED';

  // Auto-adjust visibility
  let isVisible = giftCard.isVisible;
  if (giftCard.autoAdjustItems) {
    isVisible = newBalance > 0;
  }

  // Create redemption and update gift card in a transaction
  const [redemption, updatedGiftCard] = await db.$transaction([
    db.giftCardRedemption.create({
      data: {
        giftCardId: id,
        transactionId: transactionId || null,
        amount,
        redeemedBy: redeemedBy || null,
        notes: notes || null,
      },
    }),
    db.giftCard.update({
      where: { id },
      data: {
        currentBalance: newBalance,
        status: newStatus,
        isVisible,
        lastRedeemedAt: new Date(),
      },
      include: {
        store: { select: { id: true, name: true } },
        issuedByUser: { select: { id: true, name: true } },
        issuedToCustomer: { select: { id: true, name: true, phone: true } },
        redemptions: {
          orderBy: { createdAt: 'desc' },
          include: {
            transaction: { select: { id: true, receiptNumber: true } },
          },
        },
      },
    }),
  ]);

  await systemLog({
    action: 'GIFT_CARD_REDEEMED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Gift card ${giftCard.code} redeemed: ${amount} KES. New balance: ${newBalance}`,
    storeId: giftCard.storeId,
    metadata: {
      giftCardId: id,
      code: giftCard.code,
      redemptionId: redemption.id,
      amount,
      previousBalance: giftCard.currentBalance,
      newBalance,
      newStatus,
      transactionId: transactionId || null,
    },
  });

  return Response.json({
    success: true,
    data: { giftCard: updatedGiftCard, redemption },
  });
}

export const POST = withErrorBoundary(redeemGiftCardHandler, 'GIFT_CARD_REDEEM');
