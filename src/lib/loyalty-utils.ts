// Loyalty utility helpers for the MBUMAH HARDWARE POS customer loyalty system.
//
// Rules:
//   - 1 point per KES 100 spent (rounded down)
//   - 100 points redeem for KES 10 discount (calculateRedemptionValue)
//   - Minimum 100 points per redemption (enforced in the redeem API route)
//   - 4 tiers: BRONZE (0+), SILVER (500+), GOLD (2000+), PLATINUM (5000+)
//
// These helpers are pure (no DB access) so they can be used by both the API
// route handlers and the React client components (via re-export).

// ─── Tier constants ──────────────────────────────────────────────────────────

export const LOYALTY_TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const;
export type LoyaltyTierName = (typeof LOYALTY_TIERS)[number];

export const LOYALTY_TRANSACTION_TYPES = [
  'EARNED',
  'REDEEMED',
  'ADJUSTED',
  'EXPIRED',
] as const;
export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];

// Map legacy LoyaltyTransaction.transactionType values to the new `type` field.
const LEGACY_TYPE_MAP: Record<string, LoyaltyTransactionType> = {
  EARN: 'EARNED',
  REDEEM: 'REDEEMED',
  ADJUST: 'ADJUSTED',
  BONUS: 'EARNED', // bonus points are treated as earned
  EXPIRE: 'EXPIRED',
};

export function normalizeLegacyType(legacyType: string): LoyaltyTransactionType {
  return LEGACY_TYPE_MAP[legacyType] ?? 'EARNED';
}

// ─── Tier configuration ──────────────────────────────────────────────────────

export interface TierConfig {
  name: LoyaltyTierName;
  pointsRequired: number; // minimum points to enter this tier
  discountRate: number; // percentage discount applied at checkout
  color: string; // hex color used for badge gradient
  gradient: string; // tailwind gradient classes
  benefits: string[];
}

export const TIER_CONFIG: Record<LoyaltyTierName, TierConfig> = {
  BRONZE: {
    name: 'BRONZE',
    pointsRequired: 0,
    discountRate: 0,
    color: '#CD7F32',
    gradient: 'from-amber-700 via-amber-600 to-orange-700',
    benefits: [
      'Earn 1 point per KES 100 spent',
      'Birthday bonus points',
      'Access to member-only promotions',
    ],
  },
  SILVER: {
    name: 'SILVER',
    pointsRequired: 500,
    discountRate: 2,
    color: '#9CA3AF',
    gradient: 'from-slate-400 via-slate-300 to-slate-500',
    benefits: [
      'All Bronze benefits',
      '2% discount on all purchases',
      'Free delivery on orders above KES 5,000',
      'Early access to sales',
    ],
  },
  GOLD: {
    name: 'GOLD',
    pointsRequired: 2000,
    discountRate: 5,
    color: '#F59E0B',
    gradient: 'from-yellow-500 via-amber-400 to-yellow-600',
    benefits: [
      'All Silver benefits',
      '5% discount on all purchases',
      'Free delivery on all orders',
      'Priority customer support',
      'Exclusive quarterly bonus offers',
    ],
  },
  PLATINUM: {
    name: 'PLATINUM',
    pointsRequired: 5000,
    discountRate: 10,
    color: '#6366F1',
    gradient: 'from-violet-500 via-indigo-400 to-purple-600',
    benefits: [
      'All Gold benefits',
      '10% discount on all purchases',
      'Dedicated account manager',
      'Invitation to VIP events',
      'Annual gift voucher',
      'Extended 60-day returns',
    ],
  },
};

export const TIER_ORDER: LoyaltyTierName[] = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];

// ─── Pure calculation helpers ────────────────────────────────────────────────

/**
 * Calculate loyalty points earned for a given amount spent.
 * Rule: 1 point per KES 100 spent (rounded down).
 *
 * @param amountSpent - total amount spent in KES
 * @returns integer number of points earned (never negative)
 */
export function calculateEarnedPoints(amountSpent: number): number {
  if (!Number.isFinite(amountSpent) || amountSpent <= 0) return 0;
  return Math.floor(amountSpent / 100);
}

/**
 * Determine the loyalty tier for a given points balance.
 * Tiers: BRONZE (0+), SILVER (500+), GOLD (2000+), PLATINUM (5000+)
 *
 * @param points - current lifetime points balance
 * @returns the tier name (always one of LOYALTY_TIERS)
 */
export function getTierFromPoints(points: number): LoyaltyTierName {
  if (!Number.isFinite(points) || points < 0) return 'BRONZE';
  if (points >= 5000) return 'PLATINUM';
  if (points >= 2000) return 'GOLD';
  if (points >= 500) return 'SILVER';
  return 'BRONZE';
}

/**
 * Return the list of benefits for a given tier.
 */
export function getTierBenefits(tier: string): string[] {
  const tierName = (LOYALTY_TIERS as readonly string[]).includes(tier)
    ? (tier as LoyaltyTierName)
    : 'BRONZE';
  return TIER_CONFIG[tierName].benefits;
}

/**
 * Calculate the KES value of a given number of loyalty points.
 * Rule: 100 points = KES 10.
 *
 * @param points - number of points to redeem (must be >= 0)
 * @returns KES value as a number (e.g. 250 points → 25 KES)
 */
export function calculateRedemptionValue(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  // 100 points = KES 10 → 1 point = KES 0.10
  return (points / 100) * 10;
}

/**
 * Reverse-calculation: how many points are needed to redeem a target KES value.
 * Useful for the redeem dialog when the user wants a specific discount amount.
 *
 * @param kesAmount - target discount amount in KES
 * @returns number of points required (rounded up to nearest 100)
 */
export function pointsRequiredFor(kesAmount: number): number {
  if (!Number.isFinite(kesAmount) || kesAmount <= 0) return 0;
  // KES 10 = 100 points → 1 KES = 10 points
  const rawPoints = kesAmount * 10;
  // Round up to nearest 100 (minimum redemption unit)
  return Math.ceil(rawPoints / 100) * 100;
}

// ─── Tier progress ───────────────────────────────────────────────────────────

export interface TierProgress {
  current: LoyaltyTierName;
  next: LoyaltyTierName | null;
  pointsNeeded: number; // points still needed to reach `next`
  percentage: number; // 0-100 progress within current tier
}

/**
 * Calculate progress from the current tier to the next tier.
 *
 * @param points - current lifetime points balance
 * @returns progress metadata for the UI progress bar
 */
export function getNextTierProgress(points: number): TierProgress {
  const safePoints = Number.isFinite(points) && points >= 0 ? points : 0;
  const current = getTierFromPoints(safePoints);

  const currentIdx = TIER_ORDER.indexOf(current);
  const next = currentIdx < TIER_ORDER.length - 1 ? TIER_ORDER[currentIdx + 1] : null;

  if (!next) {
    // Already at the top tier.
    return {
      current,
      next: null,
      pointsNeeded: 0,
      percentage: 100,
    };
  }

  const currentMin = TIER_CONFIG[current].pointsRequired;
  const nextMin = TIER_CONFIG[next].pointsRequired;
  const span = nextMin - currentMin;
  const progressWithin = Math.max(0, safePoints - currentMin);
  const percentage = span > 0 ? Math.min(100, Math.round((progressWithin / span) * 100)) : 100;
  const pointsNeeded = Math.max(0, nextMin - safePoints);

  return { current, next, pointsNeeded, percentage };
}

// ─── Tier config listing (for the /api/loyalty/tiers endpoint) ───────────────

export interface TierPublicConfig {
  name: LoyaltyTierName;
  pointsRequired: number;
  discountRate: number;
  color: string;
  benefits: string[];
}

/**
 * Return the full tier configuration as a plain array (used by the
 * /api/loyalty/tiers GET endpoint when called without a storeId).
 */
export function getTierConfigList(): TierPublicConfig[] {
  return TIER_ORDER.map((name) => {
    const cfg = TIER_CONFIG[name];
    return {
      name: cfg.name,
      pointsRequired: cfg.pointsRequired,
      discountRate: cfg.discountRate,
      color: cfg.color,
      benefits: cfg.benefits,
    };
  });
}

// ─── Validation helpers ──────────────────────────────────────────────────────

export const MIN_REDEMPTION_POINTS = 100;
export const REDEMPTION_RATE_KES_PER_100_POINTS = 10;

/**
 * Validate a redemption request.
 * Returns `{ ok: true }` on success or `{ ok: false, error: string }` on failure.
 */
export function validateRedemption(
  pointsToRedeem: number,
  currentBalance: number,
): { ok: true; points: number; kesValue: number } | { ok: false; error: string } {
  if (!Number.isFinite(pointsToRedeem)) {
    return { ok: false, error: 'Points to redeem must be a valid number.' };
  }

  // Round to nearest 100 (the redemption unit)
  const rounded = Math.round(pointsToRedeem / 100) * 100;

  if (rounded < MIN_REDEMPTION_POINTS) {
    return {
      ok: false,
      error: `Minimum redemption is ${MIN_REDEMPTION_POINTS} points (KES ${REDEMPTION_RATE_KES_PER_100_POINTS}).`,
    };
  }

  if (rounded > currentBalance) {
    return {
      ok: false,
      error: `Insufficient points. You have ${currentBalance} points but tried to redeem ${rounded}.`,
    };
  }

  return {
    ok: true,
    points: rounded,
    kesValue: calculateRedemptionValue(rounded),
  };
}
