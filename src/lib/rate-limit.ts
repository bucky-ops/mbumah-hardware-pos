// Enhanced in-memory rate limiter with multiple tiers and sliding window
// Suitable for single-server deployment. For distributed, use Redis.

interface RateLimitEntry {
  count: number;
  resetAt: number;
  blocked: boolean;
  blockedUntil: number;
}

const limits = new Map<string, RateLimitEntry>();

// Rate limit tiers
export const RATE_LIMIT_TIERS = {
  // Authentication endpoints - strict
  AUTH: { max: 5, windowMs: 15 * 60 * 1000 },         // 5 req / 15 min
  // Password reset - very strict  
  PASSWORD_RESET: { max: 3, windowMs: 60 * 60 * 1000 }, // 3 req / hour
  // Checkout/payment - moderate
  PAYMENT: { max: 20, windowMs: 60 * 1000 },            // 20 req / min
  // General API read - generous
  READ: { max: 100, windowMs: 60 * 1000 },              // 100 req / min
  // General API write - moderate
  WRITE: { max: 30, windowMs: 60 * 1000 },              // 30 req / min
  // Search endpoints
  SEARCH: { max: 30, windowMs: 60 * 1000 },             // 30 req / min
  // WhatsApp/messaging - strict
  MESSAGING: { max: 10, windowMs: 60 * 1000 },          // 10 req / min
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

// Auto-cleanup expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of limits) {
        if (entry.resetAt < now && !entry.blocked) limits.delete(key);
        if (entry.blocked && entry.blockedUntil < now) limits.delete(key);
      }
    }, CLEANUP_INTERVAL);
  }
}
startCleanup();

export interface RateLimitResult {
  limited: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/**
 * Check if a request should be rate limited.
 * @param key - Unique identifier (e.g., IP address, user ID, or composite key)
 * @param tier - Predefined rate limit tier, or custom options
 */
export function isRateLimited(
  key: string,
  tier: RateLimitTier | { max: number; windowMs: number } = 'READ'
): RateLimitResult {
  const options = typeof tier === 'string' ? RATE_LIMIT_TIERS[tier] : tier;
  const now = Date.now();
  const entry = limits.get(key);

  // Check if currently blocked (from brute force detection)
  if (entry?.blocked && entry.blockedUntil > now) {
    return {
      limited: true,
      remaining: 0,
      resetAt: entry.blockedUntil,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  // No entry or expired window — start fresh
  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + options.windowMs, blocked: false, blockedUntil: 0 });
    return { limited: false, remaining: options.max - 1, resetAt: now + options.windowMs };
  }

  // Increment count
  if (entry.count >= options.max) {
    return {
      limited: true,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  entry.count++;
  return { limited: false, remaining: options.max - entry.count, resetAt: entry.resetAt };
}

/**
 * Temporarily block a key (for brute force protection)
 * @param key - The rate limit key to block
 * @param durationMs - How long to block (default 30 minutes)
 */
export function blockKey(key: string, durationMs: number = 30 * 60 * 1000): void {
  const now = Date.now();
  const entry = limits.get(key);
  limits.set(key, {
    count: entry?.count || 0,
    resetAt: entry?.resetAt || now + durationMs,
    blocked: true,
    blockedUntil: now + durationMs,
  });
}

/**
 * Get current rate limit status for a key without incrementing
 */
export function getRateLimitStatus(key: string): RateLimitResult | null {
  const entry = limits.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (entry.blocked && entry.blockedUntil > now) {
    return {
      limited: true,
      remaining: 0,
      resetAt: entry.blockedUntil,
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }
  
  return {
    limited: entry.count >= (RATE_LIMIT_TIERS.READ.max),
    remaining: Math.max(0, RATE_LIMIT_TIERS.READ.max - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Reset rate limit for a key (e.g., after successful login)
 */
export function resetRateLimit(key: string): void {
  limits.delete(key);
}
