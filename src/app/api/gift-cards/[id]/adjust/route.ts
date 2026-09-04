// POST /api/gift-cards/[id]/adjust

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
// Task 12-c: canonical financial math. Prisma Decimal `valueOf()` returns a
// STRING — `giftCard.currentBalance + amount` used to STRING-CONCATENATE
// ("500.00" + 100 → "500.00100") instead of adding.
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function adjustGiftCardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const { amount, reason } = body;

  if (amount === undefined || amount === null || amount === 0) {
    return Response.json(
      { success: false, error: 'Adjustment amount must be a non-zero number.' },
      { status: 400 }
    );
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return Response.json(
      { success: false, error: 'A reason for the adjustment is required.' },
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
      { success: false, error: `Cannot adjust gift card with status "${giftCard.status}". Only ACTIVE or PARTIALLY_REDEEMED cards can be adjusted.` },
      { status: 400 }
    );
  }

  const previousStatus = giftCard.status as string;

  // Task 12-c: Decimal arithmetic (was `giftCard.currentBalance + amount` —
  // a number + Prisma-Decimal STRING concat). Rounded HALF_UP to 2dp.
  const adjustAmtDec = toDec(amount);
  // toDecimalPlaces(2) uses the global HALF_UP rounding owned by financialMath.
  const newBalanceDec = toDec(giftCard.currentBalance).plus(adjustAmtDec).toDecimalPlaces(2);
  const newBalance = round2(newBalanceDec);

  if (newBalanceDec.isNegative()) {
    return Response.json(
      { success: false, error: `Adjustment would result in a negative balance (${newBalance}). Current balance: ${round2(giftCard.currentBalance)}, adjustment: ${adjustAmtDec.toNumber()}.` },
      { status: 400 }
    );
  }

  // Determine new status
  let newStatus = giftCard.status;
  if (newBalanceDec.isZero()) {
    newStatus = 'REDEEMED';
  } else if (previousStatus === 'REDEEMED' && newBalanceDec.gt(0)) {
    // If card was fully redeemed and we're adding balance back
    newStatus = 'PARTIALLY_REDEEMED';
  }

  // Auto-adjust visibility
  let isVisible = giftCard.isVisible;
  if (giftCard.autoAdjustItems) {
    if (adjustAmtDec.gt(0)) {
      // Increasing balance - make visible
      isVisible = true;
    } else {
      // Decreasing balance
      isVisible = newBalanceDec.gt(0);
    }
  }

  const updatedGiftCard = await db.giftCard.update({
    where: { id },
    data: {
      currentBalance: newBalance,
      status: newStatus,
      isVisible,
    },
    include: {
      store: { select: { id: true, name: true } },
      issuedByUser: { select: { id: true, name: true } },
      issuedToCustomer: { select: { id: true, name: true, phone: true } },
      redemptions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  const adjustmentType = adjustAmtDec.gt(0) ? 'INCREASE' : 'DECREASE';

  await systemLog({
    action: 'GIFT_CARD_BALANCE_ADJUSTED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Gift card ${giftCard.code} balance adjusted: ${adjustAmtDec.gt(0) ? '+' : ''}${adjustAmtDec.toNumber()} KES. Reason: ${reason}. New balance: ${newBalance}`,
    storeId: giftCard.storeId,
    metadata: {
      giftCardId: id,
      code: giftCard.code,
      adjustmentType,
      adjustmentAmount: adjustAmtDec.toNumber(),
      previousBalance: round2(giftCard.currentBalance),
      newBalance,
      newStatus,
      reason,
      visibilityChanged: giftCard.isVisible !== isVisible,
      newVisibility: isVisible,
    },
  });

  return Response.json({
    success: true,
    data: updatedGiftCard,
  });
}

export const POST = withErrorBoundary(withSessionAuth(adjustGiftCardHandler, FINANCIAL_ROLES.WRITE), 'GIFT_CARD_ADJUST');
