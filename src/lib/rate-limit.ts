// In-memory rate limiter (simple Map-based, suitable for single-server)

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const limits = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits) {
    if (entry.resetAt < now) limits.delete(key);
  }
}, 5 * 60 * 1000);

export function isRateLimited(
  key: string,
  options: { max: number; windowMs: number } = { max: 5, windowMs: 15 * 60 * 1000 }
): { limited: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = limits.get(key);

  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + options.windowMs });
    return { limited: false, remaining: options.max - 1, resetAt: now + options.windowMs };
  }

  if (entry.count >= options.max) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { limited: false, remaining: options.max - entry.count, resetAt: entry.resetAt };
}
