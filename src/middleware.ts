// Next.js Middleware — Comprehensive security layer for /api/* routes
// Layers: Rate limiting → Request size → CSRF → Content-Type → Auth → Response headers

import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited, RATE_LIMIT_TIERS, type RateLimitTier } from '@/lib/rate-limit';
import { isCSRFValid, getClientIp, validateContentType, isRequestSizeValid, logSecurityEvent, SecurityEvent } from '@/lib/security';

// Routes that must remain accessible without a Bearer token
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/payments/mpesa/callback',
  '/api/security/csrf-token',
];

// Routes that don't need CSRF validation (webhook callbacks)
const CSRF_EXEMPT_PATHS = [
  '/api/payments/mpesa/callback',
];

// Determine rate limit tier based on route and method
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // Allow non-API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Health endpoint: allow without any checks
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);

  // ── Layer 1: Rate Limiting ─────────────────────────────────────
  const tier = getRateLimitTier(pathname, method);
  const rateLimitKey = `${tier}:${clientIp}:${pathname.split('/').slice(0, 3).join('/')}`;
  const rateLimitResult = isRateLimited(rateLimitKey, tier);

  if (rateLimitResult.limited) {
    try {
      await logSecurityEvent({
        event: SecurityEvent.RATE_LIMITED,
        message: `Rate limit exceeded on ${method} ${pathname}`,
        ipAddress: clientIp,
        metadata: { tier, retryAfter: rateLimitResult.retryAfter, method, resource: pathname, blocked: true },
      });
    } catch { /* ignore logging errors */ }

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
  if (!isRequestSizeValid(request, 1048576)) { // 1MB max
    try {
      await logSecurityEvent({
        event: SecurityEvent.INVALID_INPUT,
        message: `Request payload too large on ${method} ${pathname}`,
        ipAddress: clientIp,
        metadata: { reason: 'Request too large', method, resource: pathname, blocked: true },
      });
    } catch { /* ignore */ }

    return Response.json(
      { success: false, error: 'Request payload too large. Maximum size is 1MB.' },
      { status: 413 }
    );
  }

  // ── Layer 3: CSRF Protection ───────────────────────────────────
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isCSRFExempt = CSRF_EXEMPT_PATHS.some(p => pathname.startsWith(p));

  if (isStateChanging && !isCSRFExempt && !isCSRFValid(request)) {
    try {
      await logSecurityEvent({
        event: SecurityEvent.CSRF_FAILED,
        message: `CSRF validation failed on ${method} ${pathname}`,
        ipAddress: clientIp,
        metadata: {
          origin: request.headers.get('origin'),
          referer: request.headers.get('referer'),
          method,
          resource: pathname,
          blocked: true,
        },
      });
    } catch { /* ignore */ }

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

  // ── Layer 5: Authentication (existing) ─────────────────────────
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

  // Add rate limit info headers
  response.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
  response.headers.set('X-RateLimit-Reset', String(rateLimitResult.resetAt));
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_TIERS[tier].max));

  return response;
}

export const config = {
  matcher: '/api/:path*',
};
