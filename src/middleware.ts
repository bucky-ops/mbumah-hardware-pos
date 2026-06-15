// Next.js Middleware — lightweight auth gate for /api/* routes
// Full token validation happens in route handlers via requireAuth (lib/auth.ts).
// This layer only ensures the Authorization header is present on protected routes
// and blocks clearly unauthenticated requests early.

import { NextRequest, NextResponse } from 'next/server';

// Routes that must remain accessible without a Bearer token
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/payments/mpesa/callback',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths without any auth check
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Only protect API routes — everything else passes through
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Health endpoint: allow but strip env detail (handled in the route itself)
  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  // Check for Authorization header with Bearer token
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

  // Token exists — the real validation (DB lookup, expiry, role) happens in
  // the route handler through `requireAuth` or `getSessionFromRequest`.
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
