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
//
// ── Enforcement model (defense-in-depth) ────────────────────────────────────
//
//   Layer 1  src/proxy.ts            — cheap edge check: Bearer PRESENCE only
//                                      (rejects empty headers, not junk tokens).
//   Layer 2  these wrappers          — DB-backed session validation on every
//                                      route (401) + optional role membership
//                                      (403, SecurityEvent-style log).
//   Layer 3  assertPermission()      — fine-grained PERMISSION_MATRIX
//                                      action/resource checks (see
//                                      src/lib/types.ts + use-permissions.ts).
//   Layer 4  src/lib/db.ts tenancy   — ORM-level storeId filtering so a valid
//                                      session can only touch its own store.
//
// A route is properly guarded only when Layers 2+ are applied in-file; the
// proxy is a convenience, never the security boundary.

import { type NextRequest } from 'next/server';
import { db, runWithTenant, runWithoutTenant } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent, hasPermission, type UserRole } from '@/lib/types';

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

// ── Shared role sets (PERMISSION_MATRIX-aligned) ─────────────────────────────

/** Manager-or-above: matrix grants create/update on catalog, customers,
 *  campaigns, tax config only to these roles (CASHIER/ACCOUNTANT excluded). */
export const MANAGER_PLUS_ROLES: readonly string[] = [
  'SUPER_ADMIN',
  'STORE_OWNER',
  'BRANCH_MANAGER',
];

/** Owner-or-above: org-level configuration (stores/branches, system config). */
export const OWNER_ROLES: readonly string[] = ['SUPER_ADMIN', 'STORE_OWNER'];

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

/**
 * withSessionAuth — the mechanical remediation for the audit's SYS-1 finding:
 * dozens of money-moving routes exported handlers wrapped ONLY in
 * `withErrorBoundary`, so the edge proxy's non-empty-Bearer check was the
 * only gate (any junk token passed). This wrapper keeps the handler's
 * `(...args: unknown[])` signature (composes with `withErrorBoundary`) while
 * enforcing:
 *   1. Full DB-backed session validation (401 on missing/invalid/expired).
 *   2. Optional role membership (403 + SecurityEvent-style log otherwise).
 *   3. ORM-level tenant context for the handler body.
 *
 * Usage:
 *   export const POST = withErrorBoundary(
 *     withSessionAuth(createHandler, FINANCIAL_ROLES.WRITE),
 *     'EXPENSES_CREATE',
 *   );
 */
/** Options accepted by `withSessionAuth` / `requireStoreAccess` (Task 3-d).
 *  `roles` — allowed role names; SUPER_ADMIN always bypasses. */
export interface SessionGuardOptions {
  roles?: readonly string[];
}

/** Type guard: distinguishes the legacy positional role-list form from the
 *  options object (Array.isArray cannot narrow `readonly string[]`). */
function isRoleList(
  value: readonly string[] | SessionGuardOptions | undefined
): value is readonly string[] {
  return Array.isArray(value);
}

/** Normalize the legacy positional `readonly string[]` form and the new
 *  `{ roles }` options-object form into one shape. Backward compatible. */
function normalizeRoleOptions(
  rolesOrOptions?: readonly string[] | SessionGuardOptions
): SessionGuardOptions {
  if (!rolesOrOptions) return {};
  if (isRoleList(rolesOrOptions)) return { roles: rolesOrOptions };
  return rolesOrOptions;
}

export function withSessionAuth(
  handler: FinancialHandler,
  rolesOrOptions?: readonly string[] | SessionGuardOptions
): FinancialHandler {
  const { roles: allowedRoles } = normalizeRoleOptions(rolesOrOptions);

  return async (...args: unknown[]): Promise<Response> => {
    const request = args[0] as NextRequest;
    const session = await getSessionFromRequest(request);

    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    if (
      allowedRoles &&
      allowedRoles.length > 0 &&
      session.role !== 'SUPER_ADMIN' && // SUPER_ADMIN always bypasses role gates
      !allowedRoles.includes(session.role)
    ) {
      try {
        await systemLog({
          action: 'ACCESS_DENIED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `User ${session.email} (role: ${session.role}) attempted access requiring: ${allowedRoles.join(', ')}`,
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
          error: `Insufficient permissions. Requires one of: ${allowedRoles.join(', ')}.`,
        },
        { status: 403 }
      );
    }

    return runWithSessionTenant(session, () => handler(...args));
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
export function requireStoreAccess(
  handler: StoreScopedHandler,
  rolesOrOptions?: readonly string[] | SessionGuardOptions
) {
  const { roles: allowedRoles } = normalizeRoleOptions(rolesOrOptions);

  return async (...args: unknown[]): Promise<Response> => {
    const request = args[0] as NextRequest;
    const session = await getSessionFromRequest(request);

    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }

    // Task 3-d: optional role gate, enforced after session validation and
    // before store-access resolution. SUPER_ADMIN always bypasses.
    if (
      allowedRoles &&
      allowedRoles.length > 0 &&
      session.role !== 'SUPER_ADMIN' &&
      !allowedRoles.includes(session.role)
    ) {
      try {
        await systemLog({
          action: 'ACCESS_DENIED',
          component: LogComponent.AUTH,
          severity: LogSeverity.WARN,
          message: `User ${session.email} (role: ${session.role}) attempted access requiring: ${allowedRoles.join(', ')}`,
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
        /* ignore logging errors */
      }
      return Response.json(
        {
          success: false,
          error: `Insufficient permissions. Requires one of: ${allowedRoles.join(', ')}.`,
        },
        { status: 403 }
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

// ── Permission-matrix enforcement (Task 3-d) ───────────────────────────────────
//
// The PERMISSION_MATRIX in src/lib/types.ts was previously consulted only by
// the client (use-permissions.ts). `assertPermission` exposes it server-side
// so handlers can make fine-grained action/resource decisions; SUPER_ADMIN is
// always allowed (the matrix already lists every action for that role, but the
// bypass is kept explicit so new matrix entries can never lock out admins).

/** Check `action` on `resource` for a session's role against
 *  PERMISSION_MATRIX. Returns `{ allowed, reason? }` — never throws. */
export function assertPermission(
  session: { role: string },
  action: string,
  resource: string
): { allowed: boolean; reason?: string } {
  if (session.role === 'SUPER_ADMIN') return { allowed: true };

  const allowed = hasPermission(session.role as UserRole, resource, action);
  return allowed
    ? { allowed: true }
    : {
        allowed: false,
        reason: `Role '${session.role}' lacks permission '${action}' on resource '${resource}'.`,
      };
}

/** Convenience: `assertPermission` in the file's Response-error style.
 *  Returns a ready-to-return 403 Response when denied, `null` when allowed:
 *
 * ```ts
 * const denied = hasPermissionOr403(session, 'update', 'products');
 * if (denied) return denied;
 * ```
 */
export function hasPermissionOr403(
  session: { role: string },
  action: string,
  resource: string
): Response | null {
  const result = assertPermission(session, action, resource);
  if (result.allowed) return null;
  return Response.json(
    { success: false, error: result.reason ?? 'Insufficient permissions.' },
    { status: 403 }
  );
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

