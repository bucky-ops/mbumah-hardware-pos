// POST /api/gift-cards/redeem — redeem a gift card BY CODE (no card ID needed)
//
// WHY THIS ROUTE EXISTS: the POS "Pay with Gift Card" dialog has always
// called `giftCardsApi.redeemByCode({ code, storeId, amount })`, but that
// method — and any endpoint behind it — was never implemented. The click
// threw "giftCardsApi.redeemByCode is not a function" (minified in
// production as "u.giftCardsApi.redeemByCode is not a function"), so gift
// card payment at the till was completely broken. This route implements the
// missing server half; the matching client method lands in the same release
// (v2.6.3) in src/lib/api.ts.
//
// SEMANTICS (intentionally different from POST /api/gift-cards/[id]/redeem):
//   • Resolves the card by its human-readable CODE (case-insensitive).
//   • "Apply up to" capping: the applied discount is
//       min(requested amount ?? full balance, current balance)
//     because the POS dialog promises "the available balance will be applied
//     as a discount; any unused balance remains on the card". The ID-based
//     route instead rejects amount > balance (exact-amount redemptions,
//     e.g. back-office operations).
//   • Store-scoped: a card can only be redeemed at the store that issued it.
//   • The balance claim is ATOMIC (conditional updateMany + gte predicate,
//     same double-spend guard as Task 12-c in the [id] route).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest } from '@/lib/auth';
import { toDec, round2 } from '@/lib/utils/financialMath';

class InsufficientGiftCardBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientGiftCardBalanceError';
  }
}

export const dynamic = 'force-dynamic';

interface RedeemByCodeBody {
  code?: unknown;
  storeId?: unknown;
  amount?: unknown;
  transactionId?: unknown;
  notes?: unknown;
}

async function redeemGiftCardByCodeHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = (await request.json()) as RedeemByCodeBody;

  // ── 1. Validate input ───────────────────────────────────────────────────
  const rawCode = typeof body.code === 'string' ? body.code.trim() : '';
  if (!rawCode) {
    return Response.json(
      { success: false, error: 'Gift card code is required.' },
      { status: 400 }
    );
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }

  // The POS dialog uppercases the input; still resolve case-insensitively
  // WITHOUT Prisma's Postgres-only `mode: 'insensitive'` — this repo runs a
  // dual provider (Postgres prod / SQLite local), so we match candidate
  // casings with a plain `in` filter instead.
  const candidates = Array.from(new Set([rawCode, rawCode.toUpperCase(), rawCode.toLowerCase()]));
  const giftCard = await db.giftCard.findFirst({
    where: { code: { in: candidates } },
  });

  if (!giftCard) {
    return Response.json(
      { success: false, error: 'Invalid gift card code.' },
      { status: 404 }
    );
  }

  // ── 2. Store scoping — a card redeems only where it was issued ─────────
  const requestedStoreId = typeof body.storeId === 'string' ? body.storeId : '';
  if (requestedStoreId && giftCard.storeId !== requestedStoreId) {
    return Response.json(
      { success: false, error: 'This gift card was issued by another store and cannot be redeemed here.' },
      { status: 400 }
    );
  }

  // ── 3. Status + expiry gates (same policy as the [id] route) ───────────
  if (giftCard.status !== 'ACTIVE' && giftCard.status !== 'PARTIALLY_REDEEMED') {
    return Response.json(
      { success: false, error: `Cannot redeem gift card with status "${giftCard.status}". Only ACTIVE or PARTIALLY_REDEEMED cards can be redeemed.` },
      { status: 400 }
    );
  }

  if (giftCard.expiresAt && new Date(giftCard.expiresAt) < new Date()) {
    await db.giftCard.update({
      where: { id: giftCard.id },
      data: { status: 'EXPIRED' },
    });
    return Response.json(
      { success: false, error: 'This gift card has expired.' },
      { status: 400 }
    );
  }

  const balanceDec = toDec(giftCard.currentBalance);
  if (balanceDec.lte(0)) {
    return Response.json(
      { success: false, error: 'This gift card has no remaining balance.' },
      { status: 400 }
    );
  }

  // ── 4. "Apply up to" capping ────────────────────────────────────────────
  // requested = body.amount ?? full remaining balance; applied = min(requested, balance).
  // Garbage/NaN amounts (toDec → 0) fall back to the full balance so a
  // malformed payload can never brick a redemption at the till.
  const rawAmount: number | string | null =
    typeof body.amount === 'number' || typeof body.amount === 'string'
      ? body.amount
      : null;
  const requestedDec = rawAmount === null ? balanceDec : toDec(rawAmount);
  const effectiveDec = balanceDec.lt(requestedDec) ? balanceDec : requestedDec;
  if (!effectiveDec.gt(0)) {
    return Response.json(
      { success: false, error: 'Redemption amount must be a positive number.' },
      { status: 400 }
    );
  }
  const redeemAmount = round2(effectiveDec);

  const transactionId = typeof body.transactionId === 'string' ? body.transactionId : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  // ── 5. ATOMIC balance claim (identical double-spend guard) ─────────────
  let redemption;
  let updatedGiftCard;
  try {
    [redemption, updatedGiftCard] = await db.$transaction(async (tx) => {
      const claimed = await tx.giftCard.updateMany({
        where: {
          id: giftCard.id,
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

      const freshCard = await tx.giftCard.findUniqueOrThrow({ where: { id: giftCard.id } });
      const newBalance = round2(freshCard.currentBalance);
      const newStatus = newBalance === 0 ? 'REDEEMED' : 'PARTIALLY_REDEEMED';

      let isVisible = freshCard.isVisible;
      if (freshCard.autoAdjustItems) {
        isVisible = newBalance > 0;
      }

      const updated = await tx.giftCard.update({
        where: { id: giftCard.id },
        data: {
          status: newStatus,
          isVisible,
        },
        include: {
          store: { select: { id: true, name: true } },
          issuedByUser: { select: { id: true, name: true } },
          issuedToCustomer: { select: { id: true, name: true, phone: true } },
        },
      });

      const redemptionRow = await tx.giftCardRedemption.create({
        data: {
          giftCardId: giftCard.id,
          transactionId,
          amount: redeemAmount,
          redeemedBy: session.userId,
          notes,
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
    message: `Gift card ${giftCard.code} redeemed by code at POS: ${redeemAmount} KES. New balance: ${newBalance}`,
    storeId: giftCard.storeId,
    metadata: {
      giftCardId: giftCard.id,
      code: giftCard.code,
      redemptionId: redemption.id,
      amount: redeemAmount,
      previousBalance: round2(giftCard.currentBalance),
      newBalance,
      newStatus,
      transactionId,
      redeemedByUserId: session.userId,
      redeemMode: 'BY_CODE',
    },
  });

  return Response.json({
    success: true,
    data: {
      giftCard: updatedGiftCard,
      redemption,
      // The POS dialog applies this as a cart discount — it is the capped
      // applied amount, NOT the requested amount.
      discountAmount: redeemAmount,
      remainingBalance: newBalance,
    },
  });
}

export const POST = withErrorBoundary(withSessionAuth(redeemGiftCardByCodeHandler), 'GIFT_CARD_REDEEM_BY_CODE');
