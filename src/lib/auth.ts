// Authentication helpers for API route protection
//
// Usage patterns:
//
//   1. requireAuth(handler)                       — any authenticated user
//   2. requireAuth(handler, { roles: ['SUPER_ADMIN'] }) — role-restricted
//   3. requireStoreAccess(handler)                — scoping to own store
//
// The middleware (src/middleware.ts) guarantees a Bearer token header is
// present on protected routes. These helpers perform the full DB-backed
// validation.

import { type NextRequest } from 'next/server';
import { db, runWithTenant, runWithoutTenant } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthSession {
  userId: string;
  email: string;
  role: string;
  storeId: string | null;
  organizationId: string;
}

// ── Core session extraction ──────────────────────────────────────────────────

/**
 * Extract the Bearer token from the request, validate it against the database,
 * and return a typed session object. Returns `null` when the token is missing,
 * invalid, expired, or the user is deactivated.
 */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<AuthSession | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          storeId: true,
          organizationId: true,
          isActive: true,
        },
      },
    },
  });

  // No session found
  if (!session || !session.user || !session.user.isActive) return null;

  // Expired — clean it up
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    storeId: session.user.storeId,
    organizationId: session.user.organizationId,
  };
}

// ── Tenant scoping helper ────────────────────────────────────────────────────
//
// Wraps a handler in the appropriate ORM-level tenant context so that every
// store-scoped Prisma query inside it is automatically filtered by `storeId`
// (see src/lib/db.ts). SUPER_ADMIN users (and users without a store
// assignment) run without tenant enforcement so they can access cross-store /
// org-level data. Non-admin users are scoped to their own store.
function runWithSessionTenant<T>(
  session: AuthSession,
  fn: () => Promise<T>,
): Promise<T> {
  if (session.role === 'SUPER_ADMIN' || !session.storeId) {
    return runWithoutTenant(fn);
  }
  return runWithTenant(session.storeId, fn);
}

// ── Route wrapper: requireAuth ───────────────────────────────────────────────

type AuthedHandler = (
  request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
) => Promise<Response>;

interface RequireAuthOptions {
  roles?: string[];
}

/**
 * Wraps an API route handler with authentication (and optional role) checking.
 *
 * ```ts
 * export const GET = requireAuth(async (request, session) => { ... });
 * export const POST = requireAuth(handler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] });
 * ```
 */
export function requireAuth(
  handler: AuthedHandler,
  options?: RequireAuthOptions
) {
  return async (...args: unknown[]): Promise<Response> => {
    const request = args[0] as NextRequest;
    const session = await getSessionFromRequest(request);

    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    if (options?.roles && options.roles.length > 0) {
      if (!options.roles.includes(session.role)) {
        // Log unauthorized access attempt
        try {
          await systemLog({
            action: 'ACCESS_DENIED',
            component: LogComponent.AUTH,
            severity: LogSeverity.WARN,
            message: `User ${session.email} (role: ${session.role}) attempted access requiring roles: ${options.roles.join(', ')}`,
            userId: session.userId,
            storeId: session.storeId || undefined,
            metadata: { requiredRoles: options.roles, actualRole: session.role },
          });
        } catch {
          /* ignore logging errors */
        }

        return Response.json(
          { success: false, error: 'Insufficient permissions.' },
          { status: 403 }
        );
      }
    }

    // Run the handler inside the ORM-level tenant context so every
    // store-scoped Prisma query is automatically filtered by storeId.
    return runWithSessionTenant(session, () =>
      handler(request, session, ...args.slice(1))
    );
  };
}

// ── Role middleware ──────────────────────────────────────────────────────────

/**
 * Returns a function that checks whether the authenticated user has one of the
 * specified roles. Useful as a composable guard before handler logic.
 *
 * ```ts
 * const adminOnly = requireRole('SUPER_ADMIN', 'STORE_OWNER');
 * // Inside a handler:
 * const roleError = adminOnly(session);
 * if (roleError) return roleError;
 * ```
 */
export function requireRole(...roles: string[]) {
  return (session: AuthSession): Response | null => {
    if (!roles.includes(session.role)) {
      return Response.json(
        { success: false, error: 'Insufficient permissions.' },
        { status: 403 }
      );
    }
    return null;
  };
}

// ── Store-scoped access ─────────────────────────────────────────────────────

type StoreScopedHandler = (
  request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
) => Promise<Response>;

/**
 * Wraps a handler so that non-SUPER_ADMIN users can only access data belonging
 * to their own store. The handler receives the session (with `storeId` set).
 *
 * SUPER_ADMIN users are allowed to pass through and can query any store.
 *
 * ```ts
 * export const GET = requireStoreAccess(async (request, session) => { ... });
 * ```
 */
export function requireStoreAccess(handler: StoreScopedHandler) {
  return async (...args: unknown[]): Promise<Response> => {
    const request = args[0] as NextRequest;
    const session = await getSessionFromRequest(request);

    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    // SUPER_ADMIN can access any store's data
    if (session.role === 'SUPER_ADMIN') {
      return handler(request, session, ...args.slice(1));
    }

    // Non-admin must have a store assignment
    if (!session.storeId) {
      return Response.json(
        {
          success: false,
          error: 'You are not assigned to a store. Contact an administrator.',
        },
        { status: 403 }
      );
    }

    // Enforce that query params or body storeId matches the user's store
    const { searchParams } = new URL(request.url);
    const requestedStoreId =
      searchParams.get('storeId') || searchParams.get('store');

    if (requestedStoreId && requestedStoreId !== session.storeId) {
      try {
        await systemLog({
          action: 'CROSS_STORE_ACCESS_DENIED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `User ${session.email} attempted to access store ${requestedStoreId} (assigned: ${session.storeId})`,
          userId: session.userId,
          storeId: session.storeId,
          metadata: {
            requestedStoreId,
            assignedStoreId: session.storeId,
          },
        });
      } catch {
        /* ignore */
      }

      return Response.json(
        { success: false, error: 'You can only access data from your own store.' },
        { status: 403 }
      );
    }

    // Run the handler inside the ORM-level tenant context. Non-admin users
    // are scoped to their own store; SUPER_ADMIN runs without enforcement.
    return runWithSessionTenant(session, () =>
      handler(request, session, ...args.slice(1))
    );
  };
}

// ── Financial-route auth wrapper ─────────────────────────────────────────────
//
// Composable auth + role guard for financial API routes. Wraps an existing
// handler (typically already wrapped by `withErrorBoundary`) and enforces:
//   1. Authentication — a valid Bearer session must be present (401 otherwise).
//   2. Role membership — the user's role must be in `allowedRoles` (403 otherwise).
//
// Unlike `requireAuth`, this wrapper does NOT change the handler's signature —
// the wrapped handler keeps its `(...args: unknown[]) => Promise<Response>`
// shape, so it composes cleanly with the existing financial route handlers
// that extract `request = args[0]` and `context = args[1]`.
//
// Usage:
//   export const GET = withFinancialAuth(
//     withErrorBoundary(handler, LogComponent.FINANCIAL),
//     FINANCIAL_ROLES.READ,
//   );
//
// ISO 27001: A.9.4.1 — Access restriction (users can only access financial
//                       data appropriate to their role)
// ISO 27001: A.9.2.5 — Review of user access rights (role matrix is explicit)

/** Roles permitted to READ financial data (trial balance, accounts, reports). */
export const FINANCIAL_ROLES = {
  READ: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'],
  WRITE: ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'],
  AUDIT: ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'],
} as const;

type FinancialHandler = (...args: unknown[]) => Promise<Response>;

export function withFinancialAuth(
  handler: FinancialHandler,
  allowedRoles: readonly string[],
): FinancialHandler {
  return async (...args: unknown[]): Promise<Response> => {
    const request = args[0] as NextRequest;
    const session = await getSessionFromRequest(request);

    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 },
      );
    }

    if (!allowedRoles.includes(session.role)) {
      // Log the unauthorized access attempt for the security audit trail.
      try {
        await systemLog({
          action: 'FINANCIAL_ACCESS_DENIED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `User ${session.email} (role: ${session.role}) attempted financial access requiring: ${allowedRoles.join(', ')}`,
          userId: session.userId,
          storeId: session.storeId || undefined,
          metadata: {
            requiredRoles: allowedRoles,
            actualRole: session.role,
            path: new URL(request.url).pathname,
            method: request.method,
          },
        });
      } catch {
        /* logging must never block the auth decision */
      }

      return Response.json(
        {
          success: false,
          error: 'Insufficient permissions for financial operations.',
        },
        { status: 403 },
      );
    }

    // Authorized — delegate to the wrapped handler. The handler keeps its
    // original signature and is responsible for its own storeId filtering
    // (financial routes accept storeId as a query param, and SUPER_ADMIN can
    // query cross-store).
    return handler(...args);
  };
}

