// GET /api/loyalty/stats
//
// Aggregate loyalty stats across the store (or org-wide for SUPER_ADMIN):
//   - totalMembers — distinct customers with at least 1 loyalty transaction
//   - totalPointsOutstanding — sum of customer.loyaltyPoints
//   - totalPointsEarned — sum of customer.totalLoyaltyEarned
//   - totalPointsRedeemed — sum of customer.totalLoyaltyRedeemed
//   - redemptionRate — totalRedeemed / totalEarned (0-1, guarded for divide-by-0)
//   - tierBreakdown — count of customers in each tier (BRONZE/SILVER/GOLD/PLATINUM)
//   - topMembers — top 5 customers by current loyaltyPoints balance
//
// RBAC: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { LOYALTY_TIERS } from '@/lib/loyalty-utils';

export const dynamic = 'force-dynamic';

interface TierBreakdown {
  tier: string;
  count: number;
}

interface TopMember {
  id: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
  loyaltyTier: string;
  totalLoyaltyEarned: number;
}

interface LoyaltyStatsResponse {
  totalMembers: number;
  totalPointsOutstanding: number;
  totalPointsEarned: number;
  totalPointsRedeemed: number;
  redemptionRate: number;
  tierBreakdown: TierBreakdown[];
  topMembers: TopMember[];
}

async function getLoyaltyStatsHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  // SUPER_ADMIN can query any store (or all stores when storeId is omitted).
  // Non-admin users are scoped to their own store by `requireAuth`'s tenant
  // context, so we accept whatever storeId they pass (or default to their own).
  const requestedStoreId = searchParams.get('storeId');
  const storeId =
    session.role === 'SUPER_ADMIN'
      ? requestedStoreId || undefined
      : session.storeId || requestedStoreId || undefined;

  // ── Build the `where` clause for customer queries ──
  const customerWhere: Record<string, unknown> = {};
  if (storeId) customerWhere.storeId = storeId;

  // ── Run all aggregations in parallel ──
  const [
    totalMembersResult,
    pointsAggregate,
    tierGroups,
    topMembersRaw,
    earnedTxAggregate,
    redeemedTxAggregate,
  ] = await Promise.all([
    // Total members = distinct customers with at least 1 loyalty transaction
    db.loyaltyTransaction.groupBy({
      by: ['customerId'],
      where: storeId ? { storeId } : undefined,
      _count: { _all: true },
    }),

    // Sum of customer loyalty balances + lifetime counters
    db.customer.aggregate({
      where: customerWhere,
      _sum: {
        loyaltyPoints: true,
        totalLoyaltyEarned: true,
        totalLoyaltyRedeemed: true,
      },
      _count: { _all: true },
    }),

    // Tier breakdown (group by stored loyaltyTier field)
    db.customer.groupBy({
      by: ['loyaltyTier'],
      where: customerWhere,
      _count: { _all: true },
    }),

    // Top 5 members by current loyaltyPoints
    db.customer.findMany({
      where: customerWhere,
      orderBy: { loyaltyPoints: 'desc' },
      take: 5,
      select: {
        id: true,
        name: true,
        phone: true,
        loyaltyPoints: true,
        loyaltyTier: true,
        totalLoyaltyEarned: true,
      },
    }),

    // Earned points (from LoyaltyTransaction table) — points > 0
    db.loyaltyTransaction.aggregate({
      where: {
        ...(storeId ? { storeId } : {}),
        points: { gt: 0 },
      },
      _sum: { points: true },
      _count: { _all: true },
    }),

    // Redeemed points (from LoyaltyTransaction table) — points < 0
    db.loyaltyTransaction.aggregate({
      where: {
        ...(storeId ? { storeId } : {}),
        points: { lt: 0 },
      },
      _sum: { points: true },
      _count: { _all: true },
    }),
  ]);

  const totalEarnedFromTx = Math.abs(earnedTxAggregate._sum.points || 0);
  const totalRedeemedFromTx = Math.abs(redeemedTxAggregate._sum.points || 0);

  // Prefer the customer lifetime counters (denormalized) for the headline
  // numbers — they are always in sync with the customer record. Fall back to
  // the LoyaltyTransaction aggregates if the denormalized totals are zero
  // (e.g. for legacy customers created before Phase 3).
  const totalPointsEarned =
    pointsAggregate._sum.totalLoyaltyEarned || totalEarnedFromTx;
  const totalPointsRedeemed =
    pointsAggregate._sum.totalLoyaltyRedeemed || totalRedeemedFromTx;

  const redemptionRate =
    totalPointsEarned > 0 ? totalPointsRedeemed / totalPointsEarned : 0;

  // Build the tier breakdown, ensuring every standard tier is represented
  // (even if zero customers are in it).
  const tierBreakdown: TierBreakdown[] = LOYALTY_TIERS.map((tier) => {
    const group = tierGroups.find((g) => g.loyaltyTier === tier);
    return { tier, count: group?._count._all ?? 0 };
  });

  // Append any non-standard tiers that exist in the DB (defensive).
  for (const g of tierGroups) {
    if (!LOYALTY_TIERS.includes(g.loyaltyTier as (typeof LOYALTY_TIERS)[number])) {
      tierBreakdown.push({ tier: g.loyaltyTier, count: g._count._all });
    }
  }

  const topMembers: TopMember[] = topMembersRaw.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    loyaltyPoints: c.loyaltyPoints,
    loyaltyTier: c.loyaltyTier,
    totalLoyaltyEarned: c.totalLoyaltyEarned,
  }));

  const stats: LoyaltyStatsResponse = {
    totalMembers: totalMembersResult.length,
    totalPointsOutstanding: pointsAggregate._sum.loyaltyPoints || 0,
    totalPointsEarned,
    totalPointsRedeemed,
    redemptionRate,
    tierBreakdown,
    topMembers,
  };

  return Response.json({ success: true, data: stats, storeId: storeId || null });
}

export const GET = withErrorBoundary(
  requireAuth(getLoyaltyStatsHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'],
  }),
  'LOYALTY_STATS',
);
