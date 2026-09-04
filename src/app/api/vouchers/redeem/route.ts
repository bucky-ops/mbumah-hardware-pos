// POST /api/vouchers/redeem
//
// Redeem a voucher by its code (case-insensitive). Validates status,
// expiry, usage limit, and minimum spend. For FIXED vouchers the discount
// is the voucher's value; for PERCENTAGE vouchers the discount is computed
// from `amount` and capped at `maxDiscount` when set. Records a
// VoucherRedemption, then increments `currentUses` and (when usage limit
// reached) marks the voucher as USED.
//
// Body:
//   { code, storeId, customerId?, transactionId?, amount? }
//
// Returns: { success, discountAmount, voucher, newBalance? }
//   - newBalance is only returned for FIXED vouchers (value - discount)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
// Task 12-c: canonical financial math (HALF_UP 2dp). The percentage discount
// was `(base * voucher.value) / 100` — a float mul/div against Prisma Decimal
// fields (valueOf() returns a STRING) with a Math.max cap; now exact Decimal
// with Decimal.min caps. Import order matters: financialMath owns the global
// decimal.js config (HALF_UP) and must load before any Decimal arithmetic.
import { toDec, round2, max0 } from '@/lib/utils/financialMath';
import Decimal from 'decimal.js';

export const dynamic = 'force-dynamic';

interface RedeemBody {
  code: string;
  storeId: string;
  customerId?: string;
  transactionId?: string;
  amount?: number;
}

async function redeemVoucherByCodeHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const body = (await request.json()) as RedeemBody;
  const { code, storeId, customerId, transactionId, amount } = body;

  if (!code || !storeId) {
    return Response.json(
      { success: false, error: 'code and storeId are required.' },
      { status: 400 },
    );
  }

  // Look up the voucher by code (case-insensitive). SQLite's `mode:
  // insensitive` is supported by Prisma 4+; we fall back to equals if the
  // runtime throws.
  let voucher;
  try {
    voucher = await db.voucher.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });
  } catch {
    voucher = await db.voucher.findUnique({ where: { code } });
  }

  if (!voucher) {
    return Response.json(
      { success: false, error: `No voucher found for code "${code}".` },
      { status: 404 },
    );
  }

  if (voucher.storeId !== storeId) {
    return Response.json(
      { success: false, error: 'This voucher does not belong to this store.' },
      { status: 403 },
    );
  }

  // Status checks
  if (voucher.status !== 'ACTIVE') {
    return Response.json(
      {
        success: false,
        error: `Voucher is not active (current status: ${voucher.status}).`,
      },
      { status: 400 },
    );
  }

  // Expiry checks
  const now = new Date();
  if (voucher.startDate && new Date(voucher.startDate) > now) {
    return Response.json(
      { success: false, error: 'This voucher is not yet valid.' },
      { status: 400 },
    );
  }
  if (voucher.endDate && new Date(voucher.endDate) < now) {
    await db.voucher
      .update({ where: { id: voucher.id }, data: { status: 'EXPIRED' } })
      .catch(() => {});
    return Response.json(
      { success: false, error: 'This voucher has expired.' },
      { status: 400 },
    );
  }

  // Usage limit checks
  if (voucher.maxUses > 0 && voucher.currentUses >= voucher.maxUses) {
    await db.voucher
      .update({ where: { id: voucher.id }, data: { status: 'EXPIRED' } })
      .catch(() => {});
    return Response.json(
      { success: false, error: 'This voucher has reached its maximum usage limit.' },
      { status: 400 },
    );
  }

  // Minimum spend check
  // Task 12-c: spend stays a JS number for the response field (unchanged),
  // while the math runs on its exact Decimal twin.
  const spendAmount = typeof amount === 'number' ? amount : 0;
  const spendDec = toDec(spendAmount);
  const minimumPurchaseDec = toDec(voucher.minimumPurchase);
  if (minimumPurchaseDec.gt(0) && spendDec.lt(minimumPurchaseDec)) {
    return Response.json(
      {
        success: false,
        error: `Minimum spend of KES ${round2(voucher.minimumPurchase).toLocaleString()} required (current: KES ${spendAmount.toLocaleString()}).`,
      },
      { status: 400 },
    );
  }

  // Per-user usage cap (only enforceable when customerId provided)
  if (customerId && voucher.maxUsesPerUser > 0) {
    const userRedemptions = await db.voucherRedemption.count({
      where: { voucherId: voucher.id, redeemedBy: customerId },
    });
    if (userRedemptions >= voucher.maxUsesPerUser) {
      return Response.json(
        {
          success: false,
          error: `This customer has already redeemed this voucher the maximum number of times (${voucher.maxUsesPerUser}).`,
        },
        { status: 400 },
      );
    }
  }

  // Compute discount
  // Task 12-c: all discount math in exact Decimal; caps via Decimal.min.
  const valueDec = toDec(voucher.value);
  let discountDec = toDec(0);
  if (voucher.voucherType === 'FIXED') {
    discountDec = valueDec;
  } else if (voucher.voucherType === 'PERCENTAGE') {
    const baseDec = spendDec.gt(0) ? spendDec : toDec(0);
    // discount = round2(spend × value / 100) — HALF_UP (was float mul/div).
    let computedDec = toDec(round2(baseDec.mul(valueDec).div(100)));
    if (voucher.maxDiscount !== null && voucher.maxDiscount !== undefined) {
      // Cap at maxDiscount via Decimal min (was float `>` comparison).
      computedDec = Decimal.min(computedDec, toDec(voucher.maxDiscount));
    }
    discountDec = computedDec;
  } else if (voucher.voucherType === 'FREE_PRODUCT') {
    // No monetary discount — the caller can choose to add the free product
    // to the cart. We return a 0 discount amount and the product id.
    discountDec = toDec(0);
  } else {
    // BUNDLE / unknown — treat as FIXED for safety
    discountDec = valueDec;
  }

  // Cap discount at the spend amount (we never refund more than the cart total)
  if (spendDec.gt(0)) {
    discountDec = Decimal.min(discountDec, spendDec);
  }

  const discountAmount = round2(discountDec);
  const finalTotal = round2(max0(spendDec.minus(discountDec)));
  const newUses = voucher.currentUses + 1;
  const reachedLimit = voucher.maxUses > 0 && newUses >= voucher.maxUses;

  // Persist redemption + update voucher atomically
  const [redemption, updatedVoucher] = await db.$transaction([
    db.voucherRedemption.create({
      data: {
        voucherId: voucher.id,
        transactionId: transactionId || null,
        redeemedBy: customerId || session.userId,
        originalTotal: spendAmount,
        discountAmount,
        finalTotal,
      },
    }),
    db.voucher.update({
      where: { id: voucher.id },
      data: {
        currentUses: newUses,
        status: reachedLimit ? 'EXPIRED' : voucher.status,
      },
    }),
  ]);

  await systemLog({
    action: 'VOUCHER_REDEEMED_BY_CODE',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Voucher ${voucher.code} redeemed for KES ${discountAmount} discount`,
    userId: session.userId,
    storeId,
    metadata: {
      voucherId: voucher.id,
      voucherCode: voucher.code,
      voucherType: voucher.voucherType,
      redemptionId: redemption.id,
      discountAmount,
      originalTotal: spendAmount,
      finalTotal,
      customerId: customerId || null,
      transactionId: transactionId || null,
    },
  });

  return Response.json({
    success: true,
    data: {
      discountAmount,
      voucher: updatedVoucher,
      redemption,
      newBalance:
        voucher.voucherType === 'FIXED'
          ? round2(max0(valueDec.minus(discountDec)))
          : undefined,
    },
  });
}

export const POST = withErrorBoundary(
  requireAuth(redeemVoucherByCodeHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  }),
  'VOUCHER_REDEEM_BY_CODE',
);
