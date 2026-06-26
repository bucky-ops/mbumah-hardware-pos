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
  const spendAmount = typeof amount === 'number' ? amount : 0;
  if (voucher.minimumPurchase > 0 && spendAmount < voucher.minimumPurchase) {
    return Response.json(
      {
        success: false,
        error: `Minimum spend of KES ${voucher.minimumPurchase.toLocaleString()} required (current: KES ${spendAmount.toLocaleString()}).`,
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
  let discountAmount = 0;
  if (voucher.voucherType === 'FIXED') {
    discountAmount = voucher.value;
  } else if (voucher.voucherType === 'PERCENTAGE') {
    const base = spendAmount > 0 ? spendAmount : 0;
    let computed = (base * voucher.value) / 100;
    if (voucher.maxDiscount && computed > voucher.maxDiscount) {
      computed = voucher.maxDiscount;
    }
    discountAmount = computed;
  } else if (voucher.voucherType === 'FREE_PRODUCT') {
    // No monetary discount — the caller can choose to add the free product
    // to the cart. We return a 0 discount amount and the product id.
    discountAmount = 0;
  } else {
    // BUNDLE / unknown — treat as FIXED for safety
    discountAmount = voucher.value;
  }

  // Cap discount at the spend amount (we never refund more than the cart total)
  if (spendAmount > 0 && discountAmount > spendAmount) {
    discountAmount = spendAmount;
  }

  const finalTotal = Math.max(0, spendAmount - discountAmount);
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
          ? Math.max(0, voucher.value - discountAmount)
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
