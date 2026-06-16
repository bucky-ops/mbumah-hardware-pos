// Next.js Middleware — Comprehensive security layer for /api/* routes
// Layers: Rate limiting → Request size → CSRF → Content-Type → Auth → Response headers
//
// IMPORTANT: This runs in Edge Runtime. NO imports that touch Prisma/Node.js APIs.
// All security logic is self-contained here.

import { NextRequest, NextResponse } from 'next/server';

// ── In-Memory Rate Limiter (Edge-compatible) ─────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
  blocked: boolean;
  blockedUntil: number;
}

const limits = new Map<string, RateLimitEntry>();

const RATE_LIMIT_TIERS: Record<string, { max: number; windowMs: number }> = {
  AUTH: { max: 5, windowMs: 15 * 60 * 1000 },
  PASSWORD_RESET: { max: 3, windowMs: 60 * 60 * 1000 },
  PAYMENT: { max: 20, windowMs: 60 * 1000 },
  READ: { max: 100, windowMs: 60 * 1000 },
  WRITE: { max: 30, windowMs: 60 * 1000 },
  SEARCH: { max: 30, windowMs: 60 * 1000 },
  MESSAGING: { max: 10, windowMs: 60 * 1000 },
};

type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

// Cleanup expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of limits) {
    if (entry.resetAt < now && !entry.blocked) limits.delete(key);
    if (entry.blocked && entry.blockedUntil < now) limits.delete(key);
  }
}

function isRateLimited(key: string, tier: RateLimitTier): { limited: boolean; remaining: number; resetAt: number; retryAfter?: number } {
  cleanup();
  const options = RATE_LIMIT_TIERS[tier];
  const now = Date.now();
  const entry = limits.get(key);

  if (entry?.blocked && entry.blockedUntil > now) {
    return { limited: true, remaining: 0, resetAt: entry.blockedUntil, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + options.windowMs, blocked: false, blockedUntil: 0 });
    return { limited: false, remaining: options.max - 1, resetAt: now + options.windowMs };
  }

  if (entry.count >= options.max) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { limited: false, remaining: options.max - entry.count, resetAt: entry.resetAt };
}

// ── CSRF Validation (Edge-compatible) ────────────────────────────────────────

function isCSRFValid(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  // Check custom header X-CSRF-Token matching cookie csrf_token
  const csrfHeader = request.headers.get('X-CSRF-Token');
  const csrfCookie = request.cookies.get('csrf_token')?.value;
  if (csrfHeader && csrfCookie && csrfHeader === csrfCookie) return true;

  // Check Origin header against Host
  const origin = request.headers.get('Origin');
  const host = request.headers.get('Host');
  if (origin && host && origin.includes(host)) return true;

  // Check Referer header
  const referer = request.headers.get('Referer');
  if (referer && host) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) return true;
    } catch { /* skip */ }
  }

  // Allow in development without Origin/Referer
  if (process.env.NODE_ENV === 'development' && !origin && !referer) return true;

  return false;
}

// ── Client IP Extraction ────────────────────────────────────────────────────

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips[0]) return ips[0];
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

// ── Request Size Validation ─────────────────────────────────────────────────

function isRequestSizeValid(request: NextRequest, maxBytes: number): boolean {
  const contentLength = request.headers.get('Content-Length');
  if (!contentLength) return true;
  const length = parseInt(contentLength, 10);
  if (isNaN(length)) return true;
  return length <= maxBytes;
}

// ── Content-Type Validation ─────────────────────────────────────────────────

function validateContentType(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE') return true;
  const contentType = request.headers.get('Content-Type');
  if (!contentType) return false;
  return contentType.toLowerCase().includes('application/json');
}

// ── Routes Configuration ────────────────────────────────────────────────────

const PUBLIC_PATHS = [
  '/api/auth/login',
  // '/api/auth/logout' removed from PUBLIC_PATHS (M-07): requires auth token
  '/api/payments/mpesa/callback',
  '/api/security/csrf-token',
];

const CSRF_EXEMPT_PATHS = [
  '/api/payments/mpesa/callback',
];

// ── Rate Limit Tier Resolution ──────────────────────────────────────────────

function getRateLimitTier(pathname: string, method: string): RateLimitTier {
  if (pathname.startsWith('/api/auth/login')) return 'AUTH';
  if (pathname.startsWith('/api/auth/password-reset')) return 'PASSWORD_RESET';
  if (pathname === '/api/transactions' && method === 'POST') return 'PAYMENT';
  if (pathname.startsWith('/api/products/search')) return 'SEARCH';
  if (pathname.startsWith('/api/whatsapp')) return 'MESSAGING';
  if (pathname.startsWith('/api/messages') && method !== 'GET') return 'MESSAGING';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'READ';
  return 'WRITE';
}

// ── Main Middleware ─────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Allow non-API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Health & CSRF token endpoints: allow without any checks
  if (pathname === '/api/health' || pathname === '/api/security/csrf-token') {
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);

  // ── Layer 1: Rate Limiting ─────────────────────────────────────
  const tier = getRateLimitTier(pathname, method);
  const rateLimitKey = `${tier}:${clientIp}`; // M-10: aggregate per IP per tier, not per path
  const rateLimitResult = isRateLimited(rateLimitKey, tier);

  if (rateLimitResult.limited) {
    return Response.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitResult.retryAfter || 60),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetAt),
        },
      }
    );
  }

  // ── Layer 2: Request Size Validation ───────────────────────────
  if (!isRequestSizeValid(request, 1048576)) {
    return Response.json(
      { success: false, error: 'Request payload too large. Maximum size is 1MB.' },
      { status: 413 }
    );
  }

  // ── Layer 3: CSRF Protection ───────────────────────────────────
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isCSRFExempt = CSRF_EXEMPT_PATHS.some(p => pathname.startsWith(p));

  if (isStateChanging && !isCSRFExempt && !isCSRFValid(request)) {
    return Response.json(
      { success: false, error: 'CSRF validation failed. Please refresh the page and try again.' },
      { status: 403 }
    );
  }

  // ── Layer 4: Content-Type Validation ───────────────────────────
  if (isStateChanging && !validateContentType(request)) {
    return Response.json(
      { success: false, error: 'Content-Type must be application/json.' },
      { status: 415 }
    );
  }

  // ── Layer 5: Authentication ────────────────────────────────────
  const isPublicPath = PUBLIC_PATHS.some(p => pathname.startsWith(p));

  if (!isPublicPath) {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const token = authHeader.slice(7);
    if (!token || token.trim().length === 0) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }
  }

  // ── Layer 6: Continue with rate limit headers ──────────────────
  const response = NextResponse.next();

  response.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
  response.headers.set('X-RateLimit-Reset', String(rateLimitResult.resetAt));
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_TIERS[tier].max));

  // ── Security Response Headers (H-04) ──────────────────────────
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS — only in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
