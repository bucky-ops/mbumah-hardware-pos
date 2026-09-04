// POST /api/gift-cards/[id]/redeem

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth } from '@/lib/auth';
// Task 12-c: canonical financial math (HALF_UP 2dp). Prisma Decimal
// `valueOf()` returns a STRING — the old `giftCard.currentBalance - amount`
// coerced through float, and the absolute-balance write was a double-spend
// race (two concurrent redemptions both passed the same stale read).
import { toDec, round2 } from '@/lib/utils/financialMath';

// Typed in-transaction failure for the atomic balance claim (count 0).
// Caught in the handler → client-facing 400 (same pattern as
// CreditLimitExceededError in src/app/api/transactions/route.ts).
class InsufficientGiftCardBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientGiftCardBalanceError';
  }
}

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

  // Task 12-c: Decimal coercion — garbage/NaN → 0, rejected below.
  const redeemAmountDec = toDec(amount);
  if (!redeemAmountDec.gt(0)) {
    return Response.json(
      { success: false, error: 'Redemption amount must be a positive number.' },
      { status: 400 }
    );
  }
  const redeemAmount = round2(redeemAmountDec);

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

  // Advisory fast-fail only — the AUTHORITATIVE guard is the conditional
  // updateMany inside the transaction below (gte predicate re-check).
  if (redeemAmountDec.gt(toDec(giftCard.currentBalance))) {
    return Response.json(
      { success: false, error: `Redemption amount (${redeemAmount}) exceeds current balance (${round2(giftCard.currentBalance)}).` },
      { status: 400 }
    );
  }

  // ── Task 12-c: ATOMIC redemption ────────────────────────────────────────
  // The old flow computed `newBalance = currentBalance - amount` from a
  // STALE pre-transaction read and wrote the ABSOLUTE value back — two
  // concurrent redemptions both passed the check and both drained the card
  // (double-spend). The `gte` predicate makes the balance check and
  // decrement one atomic operation; the race loser aborts with a 400.
  let redemption;
  let updatedGiftCard;
  try {
    [redemption, updatedGiftCard] = await db.$transaction(async (tx) => {
      const claimed = await tx.giftCard.updateMany({
        where: {
          id,
          status: { in: ['ACTIVE', 'PARTIALLY_REDEEMED'] },
          currentBalance: { gte: redeemAmount },
        },
        data: {
          currentBalance: { decrement: redeemAmount },
          lastRedeemedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new InsufficientGiftCardBalanceError(
          'Insufficient gift card balance (or concurrently redeemed). Refresh and retry.'
        );
      }

      // Re-read INSIDE the tx to observe the post-decrement balance for the
      // status/visibility flags (same as the transactions-route R2 pattern).
      const freshCard = await tx.giftCard.findUniqueOrThrow({ where: { id } });
      const newBalance = round2(freshCard.currentBalance);
      const newStatus = newBalance === 0 ? 'REDEEMED' : 'PARTIALLY_REDEEMED';

      // Auto-adjust visibility
      let isVisible = freshCard.isVisible;
      if (freshCard.autoAdjustItems) {
        isVisible = newBalance > 0;
      }

      const updated = await tx.giftCard.update({
        where: { id },
        data: {
          status: newStatus,
          isVisible,
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
      });

      const redemptionRow = await tx.giftCardRedemption.create({
        data: {
          giftCardId: id,
          transactionId: transactionId || null,
          amount: redeemAmount,
          redeemedBy: redeemedBy || null,
          notes: notes || null,
        },
      });

      return [redemptionRow, updated] as const;
    });
  } catch (err) {
    if (err instanceof InsufficientGiftCardBalanceError) {
      return Response.json(
        { success: false, error: 'Insufficient gift card balance.' },
        { status: 400 }
      );
    }
    throw err;
  }

  const newBalance = round2(updatedGiftCard.currentBalance);
  const newStatus = updatedGiftCard.status;

  await systemLog({
    action: 'GIFT_CARD_REDEEMED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Gift card ${giftCard.code} redeemed: ${redeemAmount} KES. New balance: ${newBalance}`,
    storeId: giftCard.storeId,
    metadata: {
      giftCardId: id,
      code: giftCard.code,
      redemptionId: redemption.id,
      amount: redeemAmount,
      previousBalance: round2(giftCard.currentBalance),
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

export const POST = withErrorBoundary(withSessionAuth(redeemGiftCardHandler), 'GIFT_CARD_REDEEM');
