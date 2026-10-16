// Authentication helpers for API route protection
//
// Usage patterns:
//
//   1. requireAuth(handler) - any authenticated user
//   2. requireAuth(handler, { roles: ['SUPER_ADMIN'] }) - role-restricted
//   3. requireStoreAccess(handler) - scoping to own store
//
// The middleware (src/middleware.ts) guarantees a Bearer token header is
// present on protected routes. These helpers perform the full DB-backed
// validation.
//
// Enforcement model (defense-in-depth)
//
//   Layer 1  src/proxy.ts - cheap edge check: Bearer PRESENCE only
//                                      (rejects empty headers, not junk tokens).
//   Layer 2  these wrappers - DB-backed session validation on every
//                                      route (401) + optional role membership
//                                      (403, SecurityEvent-style log).
//   Layer 3  assertPermission() - fine-grained PERMISSION_MATRIX
//                                      action/resource checks (see
//                                      src/lib/types.ts + use-permissions.ts).
//   Layer 4  src/lib/db.ts tenancy - ORM-level storeId filtering so a valid
//                                      session can only touch its own store.
//
// A route is properly guarded only when Layers 2+ are applied in-file; the
// proxy is a convenience, never the security boundary.

import { type NextRequest } from 'next/server';
// v2.24.0: cookies() for the RSC session path (getSessionFromCookies).
import { cookies } from 'next/headers';
import { db, runWithTenant, runWithoutTenant } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent, hasPermission, type UserRole } from '@/lib/types';
// v2.12.2 (PR B - RBAC): feature-level permission keys + friendly denial copy.
// permissions.ts is PURE (no server-only imports) so this stays safe.
import {
  hasFeaturePermission,
  PERMISSION_DENIED_MESSAGES,
  type FeaturePermissionKey,
} from '@/lib/permissions';
// v2.12.2 (PR B - RBAC): tamper-evident AuditLog entries for denials/overrides.
import { auditTrail } from '@/lib/audit-trail';

// Types

export interface AuthSession {
  userId: string;
  email: string;
  role: string;
  storeId: string | null;
  organizationId: string;
  /** v2.44.0: first sign-in password rotation pending (User.mustChangePassword).
   *  OPTIONAL — legacy session constructions (service helpers, test mocks)
   *  omit it; `undefined` is treated as "no rotation pending". The two real
   *  session readers (getSessionFromRequest / getSessionFromCookies) always
   *  populate it from the DB row. */
  mustChangePassword?: boolean;
}

// Core session extraction

/**
 * Extract the Bearer token from the request, validate it against the database,
 * and return a typed session object. Returns `null` when the token is missing,
 * invalid, expired, or the user is deactivated.
 */
export async function getSessionFromRequest(
  request: NextRequest
): Promise<AuthSession | null> {
  // v2.16.0 WORKSPACE COOKIE FALLBACK: the SPA keeps its Bearer token in
  // localStorage (origin-scoped). When a shared session cookie domain is
  // configured (NEXTAUTH_COOKIE_DOMAIN, e.g. ".mbumah.test"), the login
  // route ALSO sets an `mbt_token` cookie so a branch subdomain can adopt
  // the root-domain session without a second login. Authorization header
  // always wins; the cookie is only a bootstrap fallback.
  const authHeader = request.headers.get('authorization');
  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }
  if (!token || token.trim().length === 0) {
    token = request.cookies.get('mbt_token')?.value ?? null;
  }
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
          mustChangePassword: true,
        },
      },
    },
  });

  // No session found
  if (!session || !session.user || !session.user.isActive) return null;

  // Expired - clean it up
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // v2.12.2 (PR B - RBAC) privilege-abuse lockout enforcement
  // A user who burned the abuse counter (5+ permission denials in 10 minutes,
  // see noteDeniedAndMaybeLock below) is locked out of the API for 15 minutes:
  // resolving their session yields null → every guarded route answers 401.
  // The durable record of WHY is the SecurityEvent(ACCOUNT_LOCKED) row + the
  // SUPER_ADMIN notifications written at lock time.
  if (isAccountLocked(session.user.id)) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    storeId: session.user.storeId,
    organizationId: session.user.organizationId,
    mustChangePassword: session.user.mustChangePassword,
  };
}

/**
 * v2.44.0: FIRST SIGN-IN PASSWORD ROTATION — the server-side half.
 *
 * A session whose user still carries `mustChangePassword = true` (freshly
 * provisioned with a temporary password, or force-reset by an admin) may
 * ONLY reach the allowlisted endpoints: change their own password, check
 * who they are, log out, and load the CSRF token. Everything else guarded
 * by requireAuth / withSessionAuth / requireStoreAccess answers
 *
 *     403 { code: 'PASSWORD_CHANGE_REQUIRED' }
 *
 * so a leaked temporary password is useless until it is rotated — and the
 * client (api.ts) reacts to that exact code by flipping the SPA to the
 * forced "Set a new password" screen.
 *
 * The session row is re-read from the DB on EVERY request (opaque token),
 * so clearing the flag takes effect immediately — no token to refresh.
 */
export const PASSWORD_CHANGE_REQUIRED_CODE = 'PASSWORD_CHANGE_REQUIRED' as const;

/** Paths a rotation-pending session may still call (suffix match on pathname). */
export const PASSWORD_ROTATION_EXEMPT_PATHS: readonly string[] = [
  '/api/profile/password', // the rotation itself (POST /api/profile/password)
  '/api/auth/me', // client hydration / who-am-I
  '/api/auth/verify', // thin session passthrough used by QA + health probes
  '/api/auth/logout', // the escape hatch
  '/api/security/csrf-token', // needed to POST the rotation at all
  '/api/client-error', // client error reporting must not loop
];

export function isPasswordRotationExemptPath(pathname: string): boolean {
  return PASSWORD_ROTATION_EXEMPT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Returns the 403 response when the session still owes a password rotation
 * and the request is not allowlisted; `null` when the request may proceed.
 */
export function assertPasswordRotation(
  request: NextRequest,
  session: AuthSession,
): Response | null {
  if (!session.mustChangePassword) return null;
  const pathname = new URL(request.url).pathname;
  if (isPasswordRotationExemptPath(pathname)) return null;
  return Response.json(
    {
      success: false,
      code: PASSWORD_CHANGE_REQUIRED_CODE,
      error: 'Set a new password before continuing.',
    },
    { status: 403 },
  );
}

/**
 * v2.24.0: React Server Component session resolution (cookies() path).
 *
 * Same lookup semantics as getSessionFromRequest (Session row by mbt_token,
 * active user, not expired, not abuse-locked) but reads the cookie via
 * next/headers so SERVER COMPONENTS can render session-scoped HTML directly -
 * e.g. the /employees/me home page now server-renders its dashboard payload
 * (docs/hr/self-service.md Lighthouse remediation) instead of skeleton ->
 * hydrate -> fetch -> re-render, which gated LCP behind ~2 extra seconds.
 *
 * There is no Authorization header in an RSC render, so only the cookie
 * fallback applies here (the SPA sets mbt_token on login; Bearer-only
 * clients keep using the API routes).
 */
export async function getSessionFromCookies(): Promise<AuthSession | null> {
  const token = (await cookies()).get('mbt_token')?.value ?? null;
  if (!token || token.trim().length === 0) return null;

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
          mustChangePassword: true,
        },
      },
    },
  });

  if (!session || !session.user || !session.user.isActive) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (isAccountLocked(session.user.id)) return null;

  return {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    storeId: session.user.storeId,
    organizationId: session.user.organizationId,
    mustChangePassword: session.user.mustChangePassword,
  };
}

// Tenant scoping helper
//
// Wraps a handler in the appropriate ORM-level tenant context so that every
// store-scoped Prisma query inside it is automatically filtered by `storeId`
// (see src/lib/db.ts). SUPER_ADMIN users (and users without a store
// assignment) run without tenant enforcement so they can access cross-store /
// org-level data. Non-admin users are scoped to their own store.
function runWithSessionTenant<T>(
  session: AuthSession,
  fn: () => Promise<T>,
  tenantOverride?: string | null,
): Promise<T> {
  // v2.16.0: a VALIDATED explicit tenant (the request's ?storeId that passed
  // assertStoreScope via org-wide role or an active StoreMembership) wins so
  // multi-store users get ORM-level scoping to the workspace they opened,
  // not their primary store.
  if (tenantOverride !== undefined && tenantOverride !== null) {
    return runWithTenant(tenantOverride, fn);
  }
  if (session.role === 'SUPER_ADMIN' || !session.storeId) {
    return runWithoutTenant(fn);
  }
  return runWithTenant(session.storeId, fn);
}

// Shared role sets (PERMISSION_MATRIX-aligned)

/** Manager-or-above: matrix grants create/update on catalog, customers,
 *  campaigns, tax config only to these roles (CASHIER/ACCOUNTANT excluded). */
export const MANAGER_PLUS_ROLES: readonly string[] = [
  'SUPER_ADMIN',
  'STORE_OWNER',
  'BRANCH_MANAGER',
];

/** Owner-or-above: org-level configuration (stores/branches, system config). */
export const OWNER_ROLES: readonly string[] = ['SUPER_ADMIN', 'STORE_OWNER'];

// Route wrapper: requireAuth

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

    // v2.44.0: first sign-in password rotation — a rotation-pending session
    // only reaches the exempt allowlist (see assertPasswordRotation).
    const rotationDue = assertPasswordRotation(request, session);
    if (rotationDue) return rotationDue;

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

    // v2.17.8 (Task 44 - security/RBAC hardening): requireAuth previously
    // skipped store-scope validation, so (a) a non-admin session WITHOUT a
    // store assignment ran the handler in runWithoutTenant - no ORM tenancy
    // at all - and (b) cross-store ?storeId= probes were silently answered
    // instead of rejected + security-logged. requireAuth now enforces the
    // SAME policy as withSessionAuth / requireStoreAccess (403 + SecurityEvent
    // on probes, 403 for unassignable sessions). SUPER_ADMIN passes through.
    const storeScopeDenied = await assertStoreScope(request, session);
    if (storeScopeDenied) return storeScopeDenied;

    // Run the handler inside the ORM-level tenant context so every
    // store-scoped Prisma query is automatically filtered by storeId.
    return runWithSessionTenant(session, () =>
      handler(request, session, ...args.slice(1))
    );
  };
}

// Role middleware

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
 * withSessionAuth - the mechanical remediation for the audit's SYS-1 finding:
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
 *  `roles` - allowed role names; SUPER_ADMIN always bypasses. */
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

    // v2.44.0: first sign-in password rotation (exempt paths pass through).
    const rotationDue = assertPasswordRotation(request, session);
    if (rotationDue) return rotationDue;

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

    // R7/R9 (v2.5): shared store-scope validation - a non-admin whose
    // explicit `storeId`/`store` query param points at ANOTHER store gets a
    // clear 403 (instead of a silently empty list) and the probe is recorded
    // in the security feed. SUPER_ADMIN passes through untouched.
    const storeScopeDenied = await assertStoreScope(request, session);
    if (storeScopeDenied) return storeScopeDenied;

    return runWithSessionTenant(session, () => handler(...args));
  };
}

// Store-scope validation (R7/R9 - QA 2026-09, v2.5)
//
// Rejects (403) and SECURITY-LOGS any request from a non-SUPER_ADMIN session
// whose explicit `storeId`/`store` query param points at ANOTHER store.
//
// Why: v2.4.1 made the ORM layer (injectTenant) always-narrow so cross-store
// reads return empty lists - but an empty list is a SILENT denial. Several
// list routes (debt, customers, transactions, reports, …) accept a storeId
// query param and are wrapped in withSessionAuth WITHOUT requireStoreAccess,
// so a probing user got an empty grid with no explanation and no trace.
// Centralising the check here gives BOTH wrappers (withSessionAuth,
// requireStoreAccess) the same behaviour:
//
//   • clear 403 "You can only access data from your own store." (R7)
//   • a SecurityEvent (UNAUTHORIZED_ACCESS, blocked) + a systemLog
//     (CROSS_STORE_ACCESS_DENIED) so probing shows up in the security feed
//     and the ops log (R9)
//
// SUPER_ADMIN is exempt (org-wide role). Sessions without a store assignment
// are still rejected - they can never be safely scoped.
/** Minimal session shape needed for store-scope decisions. Full AuthSession
 *  satisfies it; route-local structural session types (which omit
 *  organizationId) satisfy it too. */
export type StoreScopeSession = Pick<
  AuthSession,
  'userId' | 'email' | 'role' | 'storeId'
>;

async function denyCrossStoreAccess(
  request: NextRequest,
  session: StoreScopeSession,
  requestedStoreId: string,
): Promise<Response> {
  const path = new URL(request.url).pathname;

  // Ops log (existing behaviour from requireStoreAccess, now shared).
  try {
    await systemLog({
      action: 'CROSS_STORE_ACCESS_DENIED',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN,
      message: `User ${session.email} attempted to access store ${requestedStoreId} (assigned: ${session.storeId})`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: {
        requestedStoreId,
        assignedStoreId: session.storeId,
        path,
        method: request.method,
      },
    });
  } catch {
    /* logging must never block the auth decision */
  }

  // Security feed (R9): record the probe so it is visible in the security
  // dashboard even when the ops log is filtered away. The event is filed
  // against the TARGETED store (so that branch's admins see attempts against
  // their data) with both ids in details.
  try {
    await db.securityEvent.create({
      data: {
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'WARN',
        userId: session.userId,
        storeId: requestedStoreId,
        resource: path,
        action: `${request.method} ${path}`,
        details: JSON.stringify({
          requestedStoreId,
          assignedStoreId: session.storeId,
          role: session.role,
          email: session.email,
        }),
        userAgent: request.headers.get('user-agent') || undefined,
        ipAddress:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          undefined,
        blocked: true,
      },
    });
  } catch {
    /* logging must never block the auth decision */
  }

  return Response.json(
    { success: false, error: 'You can only access data from your own store.' },
    { status: 403 }
  );
}

/**
 * Validate that a non-SUPER_ADMIN session is not probing another store via
 * explicit query params. Returns a 403 Response (already security-logged) to
 * pass straight through, or `null` when the request may proceed.
 */
export async function assertStoreScope(
  request: NextRequest,
  session: AuthSession,
): Promise<Response | null> {
  if (session.role === 'SUPER_ADMIN') return null;

  if (!session.storeId) {
    return Response.json(
      {
        success: false,
        error: 'You are not assigned to a store. Contact an administrator.',
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedStoreId =
    searchParams.get('storeId') || searchParams.get('store');

  if (requestedStoreId && requestedStoreId !== session.storeId) {
    // v2.16.0 WORKSPACES: organization-wide roles may open any branch, and
    // multi-store members (e.g. WAREHOUSE_MANAGER) may open their ASSIGNED
    // branches via an active StoreMembership. Everyone else is denied and
    // security-logged (existing behavior).
    if (session.role === 'STORE_OWNER') return null;

    const membership = await db.storeMembership.findFirst({
      where: {
        userId: session.userId,
        storeId: requestedStoreId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (membership) return null;

    return denyCrossStoreAccess(request, session, requestedStoreId);
  }

  return null;
}

// Body storeId validation (v2.17.8 - Task 44)
//
// assertStoreScope only inspects QUERY params. Several mutating routes accept
// storeId in the JSON body (stock movements, debt reminders, M-Pesa STK push,
// KRA submissions, gift-card redemption, ...), and Prisma `create` is
// deliberately NOT intercepted by injectTenant (creates are writes, not reads
// of existing tenant rows) - so a cross-store body storeId would have been a
// REAL cross-tenant write through those routes. This helper applies the same
// policy to a body-supplied store id:
//
//   SUPER_ADMIN / STORE_OWNER ........ pass (org-wide roles, as assertStoreScope)
//   active StoreMembership .......... pass (multi-store members)
//   requested === session.storeId ... pass
//   no store assignment ............. 403 (cannot be safely scoped)
//   anything else ................... 403 + SecurityEvent (denyCrossStoreAccess)
//
// Absent/empty values are a pass: the route's own fallback (session storeId)
// applies, and requireAuth/withSessionAuth already reject unassignable
// sessions before the handler runs.
export async function assertBodyStoreScope(
  request: NextRequest,
  session: StoreScopeSession,
  requestedStoreId: string | null | undefined,
): Promise<Response | null> {
  if (!requestedStoreId) return null;
  if (requestedStoreId === session.storeId) return null;
  if (session.role === 'SUPER_ADMIN') return null;
  if (!session.storeId) {
    return Response.json(
      {
        success: false,
        error: 'You are not assigned to a store. Contact an administrator.',
      },
      { status: 403 }
    );
  }
  if (session.role === 'STORE_OWNER') return null;

  const membership = await db.storeMembership.findFirst({
    where: {
      userId: session.userId,
      storeId: requestedStoreId,
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (membership) return null;

  return denyCrossStoreAccess(request, session, requestedStoreId);
}

// [id] 404 classification + denied-attempt audit (v2.17.8 - Task 44)
//
// Policy: a store-scoped [id] route answers 404 when the record is missing
// OR belongs to another store (ORM tenancy narrows the unique lookup), and
// 403 only for role/scope denials. The 404 must not leak WHICH case happened
// to the caller (no enumeration oracle) - but the security feed needs the
// distinction so IDOR probing by id is visible. auditRecordMiss classifies a
// 404: only when the record EXISTS outside the caller's tenant does it write
// a SecurityEvent (UNAUTHORIZED_ACCESS, blocked) plus a
// CROSS_TENANT_RESOURCE_DENIED ops log. Truly-missing ids stay silent (no
// noise for stale links). Auditing must never change the response.
export async function auditRecordMiss(options: {
  request: NextRequest;
  session: StoreScopeSession;
  resourceId: string;
  /** Model/resource label for the audit trail, e.g. 'product'. */
  resource: string;
  /**
   * Bypassed lookup that answers whether the id exists at all and which store
   * owns it. Implement with runWithoutTenant(() => db.<model>.findUnique({
   * where: { id }, select: { storeId: true } })) so the ORM tenant filter
   * (which produced the 404) does not also blind the probe.
   */
  probe: () => Promise<{ storeId: string | null } | null>;
}): Promise<void> {
  try {
    // SUPER_ADMIN runs without tenant enforcement - a miss is just a miss.
    if (options.session.role === 'SUPER_ADMIN') return;

    const foreign = await options.probe();
    if (!foreign || foreign.storeId === options.session.storeId) return;

    const path = new URL(options.request.url).pathname;

    await systemLog({
      action: 'CROSS_TENANT_RESOURCE_DENIED',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN,
      message: `User ${options.session.email} requested ${options.resource} ${options.resourceId} which belongs to another store.`,
      userId: options.session.userId,
      storeId: options.session.storeId || undefined,
      metadata: {
        resource: options.resource,
        resourceId: options.resourceId,
        recordStoreId: foreign.storeId,
        assignedStoreId: options.session.storeId,
        path,
        method: options.request.method,
      },
    }).catch(() => {});

    await db.securityEvent
      .create({
        data: {
          eventType: 'UNAUTHORIZED_ACCESS',
          severity: 'WARN',
          userId: options.session.userId,
          storeId: options.session.storeId,
          resource: path,
          action: `${options.request.method} ${path}`,
          details: JSON.stringify({
            type: 'CROSS_TENANT_RESOURCE_DENIED',
            resource: options.resource,
            resourceId: options.resourceId,
            recordStoreId: foreign.storeId,
            assignedStoreId: options.session.storeId,
            role: options.session.role,
            email: options.session.email,
          }),
          userAgent: options.request.headers.get('user-agent') || undefined,
          ipAddress:
            options.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            undefined,
          blocked: true,
        },
      })
      .catch(() => {});
  } catch {
    /* auditing must never change the response */
  }
}

// Store-scoped access

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

    // v2.44.0: first sign-in password rotation (exempt paths pass through).
    const rotationDue = assertPasswordRotation(request, session);
    if (rotationDue) return rotationDue;

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

    // R7/R9 (v2.5): shared store-scope validation - replaces the previous
    // inline no-store-assignment + query-param checks (identical 403 bodies,
    // now with the SecurityEvent feed write added).
    const storeScopeDenied = await assertStoreScope(request, session);
    if (storeScopeDenied) return storeScopeDenied;

    // v2.16.0 WORKSPACES: when the request targets a DIFFERENT store than the
    // session's primary one (validated just above by assertStoreScope), run
    // the ORM tenancy against THAT store so branch workspaces show the right
    // branch's data instead of an empty primary-store filter.
    let tenantOverride: string | null | undefined;
    if (session.role !== 'SUPER_ADMIN') {
      const requested = new URL(request.url).searchParams.get('storeId') || new URL(request.url).searchParams.get('store');
      if (requested && requested !== session.storeId) {
        tenantOverride = requested;
      }
    }

    // Run the handler inside the ORM-level tenant context. Non-admin users
    // are scoped to their own store; SUPER_ADMIN runs without enforcement.
    return runWithSessionTenant(session, () =>
      handler(request, session, ...args.slice(1)), tenantOverride
    );
  };
}

// Permission-matrix enforcement (Task 3-d)
//
// The PERMISSION_MATRIX in src/lib/types.ts was previously consulted only by
// the client (use-permissions.ts). `assertPermission` exposes it server-side
// so handlers can make fine-grained action/resource decisions; SUPER_ADMIN is
// always allowed (the matrix already lists every action for that role, but the
// bypass is kept explicit so new matrix entries can never lock out admins).

/** Check `action` on `resource` for a session's role against
 *  PERMISSION_MATRIX. Returns `{ allowed, reason? }` - never throws. */
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

// Financial-route auth wrapper
//
// Composable auth + role guard for financial API routes. Wraps an existing
// handler (typically already wrapped by `withErrorBoundary`) and enforces:
//   1. Authentication - a valid Bearer session must be present (401 otherwise).
//   2. Role membership - the user's role must be in `allowedRoles` (403 otherwise).
//
// Unlike `requireAuth`, this wrapper does NOT change the handler's signature -
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
// ISO 27001: A.9.4.1 - Access restriction (users can only access financial
//                       data appropriate to their role)
// ISO 27001: A.9.2.5 - Review of user access rights (role matrix is explicit)

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

    // Authorized - delegate to the wrapped handler. The handler keeps its
    // original signature and is responsible for its own storeId filtering
    // (financial routes accept storeId as a query param, and SUPER_ADMIN can
    // query cross-store).
    return handler(...args);
  };
}


// v2.12.2 - v2.12.5 (PR B, Task REL-ROADMAP-B1) FEATURE PERMISSION ENFORCEMENT
//
// Server-side counterpart of src/lib/permissions.ts (which stays pure and
// client-importable). This block provides:
//
//   1. requireFeaturePermission(key) - composable guard in the requireRole()
//      style: returns a 403 Response shaped { code:'PERMISSION_DENIED',
//      permission, message } or null when allowed.
//   2. recordPermissionDenied(...) - durable SecurityEvent + ops systemLog +
//      hash-chained AuditLog row. NEVER creates Notifications (single denials
//      are noise; the abuse engine below owns notification).
//   3. noteDeniedAndMaybeLock(...) - sliding-window abuse counter. ≥5
//      denials in a trailing 10 minutes → 15-minute in-memory lock + Security
//      Event (ACCOUNT_LOCKED, ERROR) + Notification to every active
//      SUPER_ADMIN of the org. The lock is ENFORCED in getSessionFromRequest
//      (returns null → 401 while locked).
//   4. isAccountLocked(userId) - lock-map probe (used by #1's enforcement
//      point above and available for login-route UX).
//
// SERVERLESS LIMITATION (documented, accepted for v2.12.x)
// The denial counter and the lock map are MODULE-SCOPE in-memory state. On
// Vercel serverless each warm instance keeps its own map, so (a) a user can
// split denials across instances to delay the lock, and (b) a lock set on one
// instance does not propagate to others until cold-start. This is BEST-EFFORT
// rate-shaping, not a hard control. The DURABLE evidence trail is the
// SecurityEvent feed (PERMISSION_DENIED / HIGH_RISK_ATTEMPT / ACCOUNT_LOCKED
// rows), which phase C's audit + abuse UI reads. A shared store (Redis/DB) is
// the post-2.13 follow-up if abuse becomes an operational problem.

// Abuse state (per serverless instance - see limitation note above)

/** Sliding-window denial timestamps per userId. */
const denialWindowMs = 10 * 60 * 1000; // trailing 10 minutes
const denialThreshold = 5;             // ≥5 denials in the window → lock
const lockDurationMs = 15 * 60 * 1000; // 15-minute lockout

const denialTimestamps = new Map<string, number[]>();
const lockMap = new Map<string, number>(); // userId → lockedUntil (epoch ms)

// Periodic sweep so long-lived instances don't grow the maps unbounded.
const ABUSE_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const abuseSweeper = setInterval(() => {
  const now = Date.now();
  for (const [userId, stamps] of denialTimestamps) {
    const alive = stamps.filter((t) => now - t < denialWindowMs);
    if (alive.length === 0) denialTimestamps.delete(userId);
    else denialTimestamps.set(userId, alive);
  }
  for (const [userId, until] of lockMap) {
    if (until <= now) lockMap.delete(userId);
  }
}, ABUSE_SWEEP_INTERVAL_MS);
// Never keep the event loop alive just for the sweeper (serverless freeze).
if (typeof abuseSweeper.unref === 'function') abuseSweeper.unref();

/** Whether the user is currently locked out by the privilege-abuse engine. */
export function isAccountLocked(userId: string): boolean {
  const until = lockMap.get(userId);
  if (!until) return false;
  if (until <= Date.now()) {
    lockMap.delete(userId);
    return false;
  }
  return true;
}

/** Minutes remaining on an abuse lock (0 when not locked). For UX copy. */
export function accountLockRemainingMinutes(userId: string): number {
  const until = lockMap.get(userId);
  if (!until || until <= Date.now()) return 0;
  return Math.ceil((until - Date.now()) / 60000);
}

/** Best-effort client IP for security records (mirrors denyCrossStoreAccess). */
function clientIpFromRequest(request: NextRequest): string | undefined {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
  );
}

// 1. Feature-permission guard

/**
 * Composable feature-permission guard in the `requireRole(...)` style.
 *
 * ```ts
 * const denied = requireFeaturePermission('pos.void')(session);
 * if (denied) return denied;
 * ```
 *
 * Denial body: { success:false, code:'PERMISSION_DENIED', permission:key,
 * message: PERMISSION_DENIED_MESSAGES[key] ?? generic }. SUPER_ADMIN always
 * passes (hasFeaturePermission short-circuits for the admin role).
 *
 * NOTE: this guard returns the Response - it does NOT write the denial
 * SecurityEvent itself. Routes that should feed the abuse engine call
 * recordPermissionDenied(...) + noteDeniedAndMaybeLock(...) explicitly (see
 * the transactions / users routes), keeping read-level strips (dashboard,
 * products cost) silent.
 */
export function requireFeaturePermission(key: FeaturePermissionKey) {
  return (session: AuthSession): Response | null => {
    if (hasFeaturePermission(session.role, key)) return null;
    return Response.json(
      {
        success: false,
        code: 'PERMISSION_DENIED',
        permission: key,
        message:
          PERMISSION_DENIED_MESSAGES[key] ??
          'You do not have permission to perform this action.',
      },
      { status: 403 }
    );
  };
}

// 2. Durable denial record (SecurityEvent + systemLog + AuditLog)

export interface RecordPermissionDeniedOptions {
  session: AuthSession;
  /** The FEATURE_PERMISSIONS key that was denied (e.g. 'pos.discount.gt5'). */
  permission: string;
  request: NextRequest;
  /** Override the resource path (defaults to the request pathname). */
  resource?: string;
  /** SecurityEvent.eventType - 'PERMISSION_DENIED' (default) or 'HIGH_RISK_ATTEMPT'. */
  kind?: 'PERMISSION_DENIED' | 'HIGH_RISK_ATTEMPT';
}

/**
 * Durably record one permission denial. Writes:
 *   • SecurityEvent { eventType: kind ?? 'PERMISSION_DENIED', severity WARN,
 *     blocked: true, resource: path, details: {role, permission, email} }
 *   • systemLog ACCESS_DENIED (ops log - same pattern as denyCrossStoreAccess)
 *   • auditTrail.log(action 'PERMISSION_DENIED') - hash-chained AuditLog row
 *
 * IMPORTANT: this function deliberately does NOT create Notification rows.
 * Single denials are operational noise; only the abuse engine
 * (noteDeniedAndMaybeLock) notifies SUPER_ADMINs, and only at lock time.
 * Logging failures are swallowed - a denial must never 500 the route.
 */
export async function recordPermissionDenied(
  opts: RecordPermissionDeniedOptions
): Promise<void> {
  const { session, permission, request, kind = 'PERMISSION_DENIED' } = opts;
  const path = opts.resource ?? new URL(request.url).pathname;
  const ipAddress = clientIpFromRequest(request);
  const userAgent = request.headers.get('user-agent') || undefined;

  // SecurityEvent - the durable, dashboard-visible record.
  try {
    await db.securityEvent.create({
      data: {
        eventType: kind,
        severity: 'WARN',
        userId: session.userId,
        storeId: session.storeId || undefined,
        resource: path,
        action: `${request.method} ${path}`,
        details: JSON.stringify({
          role: session.role,
          permission,
          email: session.email,
        }),
        userAgent,
        ipAddress,
        blocked: true,
      },
    });
  } catch {
    /* logging must never block the auth decision */
  }

  // Ops log - consistent with the existing ACCESS_DENIED breadcrumbs.
  try {
    await systemLog({
      action: 'ACCESS_DENIED',
      component: LogComponent.AUTH,
      severity: LogSeverity.WARN,
      message: `Permission denied: ${session.email} (role: ${session.role}) lacks '${permission}'.`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: { permission, path, method: request.method, kind },
    });
  } catch {
    /* ignore logging errors */
  }

  // Tamper-evident AuditLog row (hash-chained). action is a free-form string
  // on AuditEventOptions; 'PERMISSION_DENIED' keeps denial queries trivial
  // (auditTrail.query({ action: 'PERMISSION_DENIED' })).
  try {
    await auditTrail.log({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERMISSION_DENIED',
      resourceType: 'Permission',
      resourceId: permission,
      reason: `Role '${session.role}' denied feature permission '${permission}'`,
      storeId: session.storeId || undefined,
      ipAddress,
      userAgent,
      metadata: { permission, path, method: request.method, kind },
    });
  } catch {
    /* ignore logging errors */
  }

  // v2.12.7 (PR C): privilege-abuse PATTERN detection
  // Beyond the hard-lockout engine (noteDeniedAndMaybeLock, called by the
  // routes themselves), slow-drip abuse patterns get their own detector:
  // a cashier repeatedly denied 'pos.discount.gt5' (4x in 1 hour) pages the
  // BRANCH_MANAGERs + SUPER_ADMINs once per hour and writes a
  // PRIVILEGE_ABUSE_PATTERN SecurityEvent. Best-effort - a detector failure
  // must never turn a 403 into a 500.
  try {
    const { noteDiscountSpam } = await import('@/lib/abuse');
    await noteDiscountSpam({
      session,
      permission,
      ipAddress,
      userAgent,
    });
  } catch {
    /* abuse detection must never block the denial response */
  }
}

// 3. Abuse engine: sliding window + lockout + SUPER_ADMIN notification

export interface NoteDeniedOptions {
  session: AuthSession;
  request: NextRequest;
  /** The permission key that was just denied (audit context). */
  permission: string;
}

/**
 * Feed the abuse counter after a denial and lock the account when it trips.
 *
 * Sliding window per userId: every call appends `now` and prunes timestamps
 * older than 10 minutes. At ≥5 entries the user is locked for 15 minutes:
 *   • in-memory lockMap entry (ENFORCED by getSessionFromRequest → 401)
 *   • SecurityEvent ACCOUNT_LOCKED (severity ERROR, details include reason)
 *   • Notification rows for EVERY active SUPER_ADMIN of the org
 *     (type WARNING / category SECURITY / priority URGENT - see the
 *     Notification model's documented type set)
 *
 * Returns { locked } so callers can tailor their response copy if they wish.
 * Per-instance limitation: see the block comment at the top of this section.
 */
export async function noteDeniedAndMaybeLock(
  opts: NoteDeniedOptions
): Promise<{ locked: boolean }> {
  const { session, request, permission } = opts;
  const now = Date.now();

  const stamps = (denialTimestamps.get(session.userId) ?? []).filter(
    (t) => now - t < denialWindowMs
  );
  stamps.push(now);
  denialTimestamps.set(session.userId, stamps);

  if (stamps.length < denialThreshold || isAccountLocked(session.userId)) {
    return { locked: isAccountLocked(session.userId) };
  }

  // Trip: lock the account
  const lockedUntil = now + lockDurationMs;
  lockMap.set(session.userId, lockedUntil);
  denialTimestamps.delete(session.userId); // fresh window after the lock

  const lockedMinutes = Math.round(lockDurationMs / 60000);
  const ipAddress = clientIpFromRequest(request);

  // SecurityEvent ACCOUNT_LOCKED (ERROR) - the durable record.
  try {
    await db.securityEvent.create({
      data: {
        eventType: 'ACCOUNT_LOCKED',
        severity: 'ERROR',
        userId: session.userId,
        storeId: session.storeId || undefined,
        resource: new URL(request.url).pathname,
        action: 'PRIVILEGE_ABUSE_LOCKOUT',
        details: JSON.stringify({
          reason: 'Privilege abuse: 5+ permission denials in 10 minutes',
          lockedMinutes: lockedMinutes,
          lastPermission: permission,
          role: session.role,
          email: session.email,
        }),
        userAgent: request.headers.get('user-agent') || undefined,
        ipAddress,
        blocked: true,
      },
    });
  } catch {
    /* never block the lockout on logging */
  }

  // Notify every active SUPER_ADMIN of the org (durable Notification rows -
  // the notification center's Security filter reads these in phase 2/3).
  try {
    const superAdmins = await db.user.findMany({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true,
        organizationId: session.organizationId,
      },
      select: { id: true },
    });

    if (superAdmins.length > 0) {
      await db.notification.createMany({
        data: superAdmins.map((admin) => ({
          userId: admin.id,
          storeId: session.storeId || null,
          title: 'Privilege abuse attempt',
          message: `${session.email} (role: ${session.role}) hit ${denialThreshold} permission denials in 10 minutes and was locked out for ${lockedMinutes} minutes. Last denied permission: ${permission}.`,
          type: 'WARNING',
          category: 'SECURITY',
          priority: 'URGENT',
          actionUrl: '/dashboard?tab=security',
          actionLabel: 'Review security events',
          metadata: JSON.stringify({
            kind: 'PRIVILEGE_ABUSE_LOCKOUT',
            targetUserId: session.userId,
            targetEmail: session.email,
            targetRole: session.role,
            permission,
            lockedMinutes,
            windowMinutes: denialWindowMs / 60000,
          }),
        })),
      });
    }
  } catch {
    /* never block the lockout on notifications */
  }

  // Ops log breadcrumb.
  try {
    await systemLog({
      action: 'ACCOUNT_LOCKED',
      component: LogComponent.AUTH,
      severity: LogSeverity.ERROR,
      message: `Account ${session.email} locked for ${lockedMinutes} minutes after ${denialThreshold} permission denials in 10 minutes.`,
      userId: session.userId,
      storeId: session.storeId || undefined,
      metadata: { permission, lockedMinutes, email: session.email, role: session.role },
    });
  } catch {
    /* ignore logging errors */
  }

  return { locked: true };
}
