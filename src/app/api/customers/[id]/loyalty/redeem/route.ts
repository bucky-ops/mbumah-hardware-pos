// POST /api/customers/[id]/loyalty/redeem
//
// Redeem loyalty points for a KES discount voucher.
//
// Rules (see src/lib/loyalty-utils.ts):
//   - 100 points = KES 10 discount
//   - Minimum 100 points per redemption
//   - Points must be rounded to the nearest 100
//   - Customer balance must be sufficient
//
// Atomic flow (db.$transaction):
//   1. Lock + reload the customer row to get the authoritative balance.
//   2. Validate the redemption against the live balance.
//   3. Decrement loyaltyPoints, increment totalLoyaltyRedeemed.
//   4. Insert a LoyaltyTransaction (type=REDEEMED) with the post-redeem balance.
//
// RBAC: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  getTierFromPoints,
  validateRedemption,
} from '@/lib/loyalty-utils';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RedeemRequestBody {
  points?: number;
  reason?: string;
  transactionId?: string;
}

async function redeemLoyaltyHandler(
  request: NextRequest,
  session: AuthSession,
  ...rest: unknown[]
): Promise<Response> {
  const context = rest[0] as RouteContext;
  const customerId = (await context.params).id;

  // ── Parse + validate body ──
  let body: RedeemRequestBody;
  try {
    body = (await request.json()) as RedeemRequestBody;
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const requestedPoints = Number(body.points);
  if (!Number.isFinite(requestedPoints)) {
    return Response.json(
      { success: false, error: '`points` must be a finite number.' },
      { status: 400 },
    );
  }

  const userReason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 500)
    : null;
  const linkedTransactionId =
    typeof body.transactionId === 'string' && body.transactionId.trim()
      ? body.transactionId.trim()
      : null;

  // ── Atomic redemption ──
  // We run the whole flow inside a transaction and re-read the customer with
  // the live balance so concurrent redemptions cannot overspend.
  const result = await db
    .$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: {
            id: true,
            name: true,
            storeId: true,
            loyaltyPoints: true,
            totalLoyaltyEarned: true,
            totalLoyaltyRedeemed: true,
          },
        });

        if (!customer) {
          throw new RedemptionError('Customer not found.', 404);
        }

        const validation = validateRedemption(requestedPoints, customer.loyaltyPoints);
        if (!validation.ok) {
          throw new RedemptionError(validation.error, 400);
        }

        const newBalance = customer.loyaltyPoints - validation.points;
        const newTotalRedeemed = customer.totalLoyaltyRedeemed + validation.points;
        const reason = userReason ?? `Redeemed ${validation.points} points for KES ${validation.kesValue.toFixed(2)} discount`;

        // Update customer balance + lifetime counters.
        const updated = await tx.customer.update({
          where: { id: customerId },
          data: {
            loyaltyPoints: newBalance,
            totalLoyaltyRedeemed: newTotalRedeemed,
            // Recompute tier from lifetime points (redemption doesn't change
            // the lifetime earned total, but be defensive in case the stored
            // tier drifted out of sync).
            loyaltyTier: getTierFromPoints(customer.totalLoyaltyEarned),
          },
          select: {
            id: true,
            storeId: true,
            loyaltyPoints: true,
            totalLoyaltyEarned: true,
            totalLoyaltyRedeemed: true,
            loyaltyTier: true,
          },
        });

        // Record the LoyaltyTransaction (both legacy `transactionType` and
        // the new `type` field so the existing /loyalty/transactions endpoint
        // and the new /customers/[id]/loyalty endpoint both surface it).
        const loyaltyTx = await tx.loyaltyTransaction.create({
          data: {
            storeId: customer.storeId,
            customerId,
            // Legacy field — points stored as negative for redemptions.
            points: -validation.points,
            transactionType: 'REDEEM',
            // New Phase-3 fields.
            type: 'REDEEMED',
            transactionId: linkedTransactionId,
            balanceAfter: newBalance,
            reason,
            description: reason,
            reference: 'LOYALTY_REDEMPTION',
            referenceId: linkedTransactionId,
            referenceType: linkedTransactionId ? 'SALE' : 'REDEMPTION',
            createdBy: session.userId,
          },
        });

        return {
          customer: updated,
          loyaltyTx,
          redeemedPoints: validation.points,
          discountKes: validation.kesValue,
          newBalance,
          reason,
          storeId: updated.storeId,
        };
      },
      { timeout: 10000, maxWait: 8000 },
    )
    .catch((err: unknown) => {
      if (err instanceof RedemptionError) return err;
      // Re-throw genuine DB / system errors so withErrorBoundary logs them.
      throw err;
    });

  if (result instanceof RedemptionError) {
    return Response.json(
      { success: false, error: result.message },
      { status: result.status },
    );
  }

  // ── Audit log (best-effort, non-blocking) ──
  void systemLog({
    action: 'LOYALTY_POINTS_REDEEMED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Customer ${customerId}: redeemed ${result.redeemedPoints} points for KES ${result.discountKes.toFixed(2)}`,
    storeId: result.storeId,
    userId: session.userId,
    metadata: {
      customerId,
      redeemedPoints: result.redeemedPoints,
      discountKes: result.discountKes,
      newBalance: result.newBalance,
      loyaltyTransactionId: result.loyaltyTx.id,
    },
  }).catch(() => {
    /* logging must never block the response */
  });

  return Response.json({
    success: true,
    data: {
      customerId,
      redeemedPoints: result.redeemedPoints,
      discountAmount: result.discountKes,
      newBalance: result.newBalance,
      reason: result.reason,
      loyaltyTransactionId: result.loyaltyTx.id,
      customer: result.customer,
    },
  });
}

// ── Helper: typed error thrown inside the tx that should NOT be treated as 500s
class RedemptionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RedemptionError';
    this.status = status;
  }
}

export const POST = withErrorBoundary(
  requireAuth(redeemLoyaltyHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER'],
  }),
  'CUSTOMER_LOYALTY_REDEEM',
);
