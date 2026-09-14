// ─────────────────────────────────────────────────────────────────────────────
// Sliding-window in-memory rate limiter.
//
// SECURITY NOTES
//  • Applied to /api/auth/login to blunt credential-stuffing / brute force.
//  • Single-instance memory store: correct for a single serverless region or
//    long-running node; swap `hit()` for Upstash/Redis for multi-region Vercel.
//  • Returns Retry-After so well-behaved clients back off; 429 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(windowMs: number) {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, opts: { limit: number; windowMs: number }): RateLimitResult {
  sweep(opts.windowMs);
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);

  if (bucket.hits.length >= opts.limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((opts.windowMs - (now - oldest)) / 1000)),
    };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: opts.limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Client IP for limiter keys — x-forwarded-for (Vercel/gateway), fallback 127.0.0.1 */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "127.0.0.1";
}
