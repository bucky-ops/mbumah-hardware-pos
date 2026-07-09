// GET /api/auth/dev-bypass
//
// Development & preview bypass — authenticates as SUPER_ADMIN without a password.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  SECURITY GUARD                                                         │
// │  ─────────────────────────────────────────────────────────────────────  │
// │  The bypass is ONLY enabled when ANY of the following is true:          │
// │    1. NODE_ENV === 'development'   (local `bun run dev`)                │
// │    2. VERCEL_ENV === 'preview'     (Vercel preview/branch deployments)  │
// │    3. ALLOW_DEV_BYPASS === true    (explicit opt-in via env var)        │
// │                                                                         │
// │  In production (VERCEL_ENV === 'production' && NODE_ENV === 'production'│
// │  && ALLOW_DEV_BYPASS falsy), the route returns 403 — even if an attacker│
// │  discovers the endpoint.                                                │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  AUTH CONTRACT (consistent with /api/auth/login)                        │
// │  ─────────────────────────────────────────────────────────────────────  │
// │  This route does NOT use JWT or HTTP-only cookies. It uses the SAME     │
// │  custom crypto-token mechanism as the login route:                      │
// │    • crypto.getRandomValues(32 bytes) → hex token                       │
// │    • db.session.create({ userId, token, ipAddress, userAgent, ... })    │
// │    • returns { success, data: { user, token, expiresAt } }             │
// │  The client stores `token` in localStorage as `mbt_token` and sends it  │
// │  via the `Authorization: Bearer <token>` header on subsequent requests. │
// │  This keeps the bypass flow identical to login — logout, session        │
// │  validation, and 401-handling all work unchanged.                       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  USAGE                                                                  │
// │  ─────────────────────────────────────────────────────────────────────  │
// │  • GET /api/auth/dev-bypass?probe=1                                     │
// │      → { success: true, data: { enabled: boolean } }                    │
// │      No side effects. Used by the login UI to decide whether to render  │
// │      the "Dev Bypass" button.                                           │
// │                                                                         │
// │  • GET /api/auth/dev-bypass                                             │
// │      → Creates a SUPER_ADMIN session and returns the token.             │
// │      → { success: true, data: { user, token, expiresAt } }              │
// │      → 403 if bypass is disabled in this environment.                   │
// └─────────────────────────────────────────────────────────────────────────┘

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Email of the seeded super admin (prisma/seed.ts → user_super_admin).
// Used as the primary lookup; falls back to the first SUPER_ADMIN-role user.
const SUPER_ADMIN_EMAIL = 'admin@mbumahhardware.co.ke';

/**
 * True when the dev-bypass route is allowed in the current environment.
 *
 * Evaluated per-request (not at module load) so that flipping
 * ALLOW_DEV_BYPASS in Vercel env vars takes effect on the next cold start
 * without a code change.
 */
function isBypassEnabled(): boolean {
  return (
    env.NODE_ENV === 'development' ||
    env.VERCEL_ENV === 'preview' ||
    env.ALLOW_DEV_BYPASS === true
  );
}

/**
 * Cryptographically secure session token — identical to /api/auth/login.
 * Uses the Web Crypto API (available in Next.js server runtime / Edge / Node).
 */
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolve the super-admin user to impersonate.
 *
 * Primary: the seeded super admin by email.
 * Fallback: the first active user whose role is SUPER_ADMIN (in case the
 * seed email was changed). Throws if no super admin exists at all — the
 * caller (withErrorBoundary) will surface a 500 with a clear message.
 */
async function resolveSuperAdmin() {
  const byEmail = await db.user.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
    include: { organization: true, store: true },
  });
  if (byEmail && byEmail.isActive && byEmail.role === 'SUPER_ADMIN') {
    return byEmail;
  }

  const fallback = await db.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    include: { organization: true, store: true },
  });
  if (!fallback) {
    throw new Error(
      'Dev bypass failed: no active SUPER_ADMIN user found in the database. ' +
        'Run `bun run db:seed` to create the default super admin.',
    );
  }
  return fallback;
}

async function devBypassHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const url = new URL(request.url);
  const isProbe = url.searchParams.get('probe') === '1';

  // ── Probe mode: report enabled-state without side effects ──────────────
  if (isProbe) {
    return Response.json({
      success: true,
      data: { enabled: isBypassEnabled() },
    });
  }

  // ── Full mode: hard security guard ──────────────────────────────────────
  if (!isBypassEnabled()) {
    return Response.json(
      {
        success: false,
        error:
          'Dev bypass is disabled in this environment. Set ALLOW_DEV_BYPASS=true, ' +
          'deploy to a Vercel preview branch, or run locally with NODE_ENV=development.',
      },
      { status: 403 },
    );
  }

  // ── Resolve super admin ─────────────────────────────────────────────────
  const user = await resolveSuperAdmin();

  // ── Create session (mirrors /api/auth/login exactly) ───────────────────
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour session

  const session = await db.session.create({
    data: {
      userId: user.id,
      token,
      ipAddress:
        request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        null,
      userAgent: request.headers.get('user-agent') || null,
      expiresAt,
    },
  });

  // ── Update lastLoginAt + clear any residual lockout ────────────────────
  await db.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      lockedUntil: null,
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
    },
  });

  // ── Audit log (clearly tagged as a dev bypass) ─────────────────────────
  try {
    await systemLog({
      action: 'LOGIN_SUCCESS',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN, // WARN because passwordless bypass is sensitive
      message: `DEV BYPASS login as ${user.name} (${user.email})`,
      userId: user.id,
      storeId: user.storeId || undefined,
      metadata: {
        reason: 'DEV_BYPASS',
        email: user.email,
        role: user.role,
        sessionId: session.id,
        environment: env.NODE_ENV,
        vercelEnv: env.VERCEL_ENV ?? null,
      },
    });
  } catch {
    /* ignore logging errors — bypass must still succeed */
  }

  // ── Build auth-user payload (same shape as /api/auth/login) ────────────
  const authUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    storeId: user.storeId,
    isActive: user.isActive,
    organization: {
      id: user.organization.id,
      name: user.organization.name,
      taxPin: user.organization.taxPin,
    },
    store: user.store
      ? {
          id: user.store.id,
          name: user.store.name,
          location: user.store.location,
        }
      : null,
  };

  return Response.json({
    success: true,
    data: {
      user: authUser,
      token: session.token,
      expiresAt: session.expiresAt,
    },
  });
}

export const GET = withErrorBoundary(devBypassHandler, 'AUTH_DEV_BYPASS');
