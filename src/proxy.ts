// Next.js 16 Proxy - Comprehensive security layer for /api/* routes
// Migrated from deprecated "middleware" convention to "proxy" convention.
// Layers: Rate limiting → Request size → CSRF → Content-Type → Auth → Response headers
//
// IMPORTANT: This runs in Edge Runtime. NO imports that touch Prisma/Node.js APIs.
// All security logic is self-contained here.

import { type NextRequest, NextResponse } from 'next/server';
import {
  buildInternalPath,
  extractSubdomain,
  isHostAllowed,
  parseHost,
  resolveWorkspaceHostMode,
} from '@/lib/workspace/config';

// In-Memory Rate Limiter (Edge-compatible)

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
  MESSAGING: { max: 30, windowMs: 60 * 1000 },
  // Client error logger - generous enough to catch burst errors but prevents abuse.
  CLIENT_ERROR: { max: 5, windowMs: 60 * 1000 },
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

// CSRF Validation (Edge-compatible)

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
  if (origin && host) {
    // AUDIT REMEDIATION (F9-6): exact host equality. The previous
    // `origin.includes(host)` let hostile lookalike origins through, e.g.
    // `https://app.example.com.evil.io` contains `example.com`. Parse both
    // sides and compare hostname+port strings exactly; an unparseable Origin
    // or Host is treated as NON-matching (fail closed).
    try {
      const originHost = new URL(origin).host; // hostname[:port]
      const requestHost = new URL(`http://${host}`).host; // Host header may include port
      if (originHost === requestHost) return true;
    } catch {
      /* parse failure → treat as non-matching */
    }
  }

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

// Client IP Extraction

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

// Request Size Validation

function isRequestSizeValid(request: NextRequest, maxBytes: number): boolean {
  const contentLength = request.headers.get('Content-Length');
  if (!contentLength) return true;
  const length = parseInt(contentLength, 10);
  if (isNaN(length)) return true;
  return length <= maxBytes;
}

// Content-Type Validation

function validateContentType(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'DELETE') return true;
  const contentType = request.headers.get('Content-Type');
  if (!contentType) return false;
  return contentType.toLowerCase().includes('application/json');
}

// Routes Configuration

const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/payments/mpesa/callback',
  '/api/security/csrf-token',
  // Client error logger - errors can happen before/during auth (e.g. hydration
  // crashes on the login page). Must be public so the error boundary can
  // report crashes even when the user is not authenticated.
  '/api/logs/client-error',
  // AUDIT FIX (Finding 6.2): the OpenAPI contract is metadata-only (shapes,
  // no secrets, no data) - same public class as /api/health - so it must be
  // reachable without a session for Swagger UI / Postman / client-SDK gen.
  '/api/openapi',
];

const CSRF_EXEMPT_PATHS = [
  '/api/payments/mpesa/callback',
  // Client error logger - error boundaries use fire-and-forget fetch()
  // which cannot include a CSRF token (the page may be in a broken state).
  '/api/logs/client-error',
];

// Rate Limit Tier Resolution

function getRateLimitTier(pathname: string, method: string): RateLimitTier {
  if (pathname.startsWith('/api/auth/login')) return 'AUTH';
  if (pathname.startsWith('/api/auth/password-reset')) return 'PASSWORD_RESET';
  if (pathname === '/api/transactions' && method === 'POST') return 'PAYMENT';
  if (pathname.startsWith('/api/products/search')) return 'SEARCH';
  if (pathname.startsWith('/api/whatsapp')) return 'MESSAGING';
  if ((pathname.startsWith('/api/messages') || pathname.startsWith('/api/chat')) && method !== 'GET') return 'MESSAGING';
  if (pathname.startsWith('/api/logs/client-error')) return 'CLIENT_ERROR';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return 'READ';
  return 'WRITE';
}

// Workspace (subdomain) request helpers (v2.16.0)

/**
 * CORS headers for trusted origins. Credentials are allowed ONLY with an
 * exact origin echo (never a wildcard) per the subdomain-workspaces spec.
 */
function corsHeadersFor(origin: string | null, _host: string): Record<string, string> | null {
  if (!origin) return null;
  try {
    const originHost = parseHost(new URL(origin).host);
    // Trusted origins only: root domain, branch subdomains, localhost/LAN,
    // Vercel previews. Never a wildcard with credentials (spec requirement).
    if (!originHost || !isHostAllowed(originHost)) return null;
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Store-Id, X-Store-Slug, X-Store-Subdomain',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  } catch {
    return null;
  }
}

/**
 * Attach the workspace identity headers (x-store-subdomain / x-store-slug)
 * to a response/request chain. Advisory hints for server components and API
 * routes; authorization ALWAYS re-validates server-side (see
 * src/lib/workspace/server.ts).
 */
function withWorkspaceHeaders(subdomain: string | null): Record<string, string> {
  if (!subdomain) return {};
  return { 'x-store-subdomain': subdomain, 'x-store-slug': subdomain };
}

// Main Middleware

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  const requestHost = parseHost(request.headers.get('host'));

  // ------------------------------------------------------------------
  // PAGE ROUTES (v2.16.0 workspace pipeline)
  //
  // 1. Host header allowlist (reject host header attacks for pages too).
  // 2. Branch subdomain rewrite: {store}.{root}/anything is served by the
  //    internal path workspace /stores/{store}/anything without changing
  //    the visible URL. /api, /_next, and the public receipt route /r are
  //    excluded (matcher already excludes _next/static assets).
  // 3. Workspace identity headers (x-store-subdomain / x-store-slug).
  // ------------------------------------------------------------------
  if (!pathname.startsWith('/api/')) {
    if (!isHostAllowed(requestHost)) {
      return new Response('Invalid host.', { status: 403 });
    }

    const subdomain = extractSubdomain(requestHost);
    const mode = resolveWorkspaceHostMode(requestHost);

    if (subdomain && mode === 'subdomain' && !pathname.startsWith('/r/')) {
      const internal = buildInternalPath(subdomain, pathname);
      if (internal) {
        const url = request.nextUrl.clone();
        url.pathname = internal;
        const headers = new Headers(request.headers);
        headers.set('x-store-subdomain', subdomain);
        headers.set('x-store-slug', subdomain);
        return NextResponse.rewrite(url, { request: { headers } });
      }
    }

    const pageResponse = NextResponse.next();
    for (const [key, value] of Object.entries(withWorkspaceHeaders(subdomain))) {
      pageResponse.headers.set(key, value);
    }
    return pageResponse;
  }

  // ------------------------------------------------------------------
  // API ROUTES (existing security pipeline, unchanged behavior)
  // ------------------------------------------------------------------

  // OPTIONS preflight: answered here so cross-origin tooling and future
  // cross-subdomain clients never hit the auth/rate-limit layers with a
  // preflight. Only trusted origins get CORS headers (never a wildcard).
  if (method === 'OPTIONS') {
    const cors = corsHeadersFor(request.headers.get('origin'), request.headers.get('host') || '');
    if (!cors) return new Response(null, { status: 204 });
    return new Response(null, { status: 204, headers: cors });
  }

  // Health & CSRF token endpoints: allow without any checks
  // Health endpoints (/api/health, /api/health/db, /api/health/env) are public
  // so they can be curl'd from VERCEL_NEON_VERIFICATION.md without auth.
  if (
    pathname === '/api/health' ||
    pathname.startsWith('/api/health/') ||
    pathname === '/api/security/csrf-token'
  ) {
    return NextResponse.next();
  }

  // v2.14.0 Power-On Self-Test + self-heal: public in DEVELOPMENT only so
  // boot diagnostics and local healing work without a login. In production
  // the routes enforce their own SUPER_ADMIN gate in-file, so the proxy must
  // NOT bypass auth there.
  if (
    process.env.NODE_ENV !== 'production' &&
    (pathname === '/api/system/post' || pathname === '/api/system/heal')
  ) {
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);

  // Layer 1: Rate Limiting
  const tier = getRateLimitTier(pathname, method);
  const rateLimitKey = `${tier}:${clientIp}:${pathname.split('/').slice(0, 3).join('/')}`;
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

  // Layer 2: Request Size Validation
  if (!isRequestSizeValid(request, 1048576)) {
    return Response.json(
      { success: false, error: 'Request payload too large. Maximum size is 1MB.' },
      { status: 413 }
    );
  }

  // Layer 3: CSRF Protection
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isCSRFExempt = CSRF_EXEMPT_PATHS.some(p => pathname.startsWith(p));

  if (isStateChanging && !isCSRFExempt && !isCSRFValid(request)) {
    return Response.json(
      { success: false, error: 'CSRF validation failed. Please refresh the page and try again.' },
      { status: 403 }
    );
  }

  // Layer 4: Content-Type Validation
  if (isStateChanging && !validateContentType(request)) {
    return Response.json(
      { success: false, error: 'Content-Type must be application/json.' },
      { status: 415 }
    );
  }

  // Layer 5: Authentication
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

  // Layer 6: Continue with rate limit headers
  const response = NextResponse.next();

  response.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
  response.headers.set('X-RateLimit-Reset', String(rateLimitResult.resetAt));
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_TIERS[tier].max));

  return response;
}

export const config = {
  // API routes: full security pipeline.
  // Page routes: host validation + branch subdomain rewrite. Static Next.js
  // assets and common well-known files are excluded so the workspace
  // pipeline never runs in front of them.
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|logo.png|manifest.json|manifest.webmanifest|sw.js|offline.html|robots.txt|sitemap.xml|icons/|sounds/|screenshots/).*)',
  ],
};
