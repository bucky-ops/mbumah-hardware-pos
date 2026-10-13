// MBUMAH HARDWARE POS - Server-side workspace store context (v2.16.0)
//
// Resolves and AUTHORIZES the store workspace for a request. Used by:
//   - GET /api/me/store-context (the SPA bootstrap on any workspace origin)
//   - future server components / server actions that need the workspace store
//
// Security properties (spec: "Never rely only on the rewritten path"):
//   - The store is resolved from the DB by subdomain or slug, never from a
//     client-supplied storeId.
//   - Authorization is enforced HERE on every call: role rules + active
//     StoreMembership rows. Denied attempts are audit-logged.
//   - The x-store-id / x-store-slug headers set by the proxy are advisory
//     hints only; this module re-derives everything from the Host header or
//     an explicit slug parameter.

import { db } from '@/lib/db';
import type { AuthSession } from '@/lib/auth';
import { getRequestId } from '@/lib/request-context';
import { extractSubdomain, parseHost, resolveWorkspaceHostMode } from './config';

export interface StoreSummary {
  id: string;
  name: string;
  slug: string | null;
  subdomain: string | null;
  code: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  brandingColor: string | null;
  status: string;
  isActive: boolean;
}

export type WorkspaceContextMode =
  | 'subdomain'
  | 'path'
  | 'organization'
  | 'denied'
  | 'not-found';

export interface StoreContextResult {
  mode: WorkspaceContextMode;
  store?: StoreSummary;
  allowed: boolean;
  /** Read-only financial view (ACCOUNTANT workspaces). */
  readOnly?: boolean;
  reason?: string;
  /**
   * Stable, client-safe machine code derived from `reason` (v2.18.0.0).
   * The API payload passes it through so the gateway can render one calm
   * message per cause without parsing the internal reason strings.
   */
  reasonCode?: string;
  /** The workspace address style detected from the host. */
  hostMode: 'subdomain' | 'path' | 'organization';
  subdomain: string | null;
}

/** Roles with implicit access to every ACTIVE store in the organization. */
const ORG_WIDE_ROLES = new Set(['SUPER_ADMIN', 'STORE_OWNER']);

/**
 * Map an internal reason to the stable client-safe reasonCode vocabulary
 * (v2.18.0.0). Purely additive: the internal `reason` values are unchanged
 * and stay the audit-facing source of truth.
 */
function reasonCodeFor(reason: string | undefined): string | undefined {
  switch (reason) {
    case 'STORE_NOT_FOUND':
      return 'store-not-found';
    case 'STORE_INACTIVE':
      return 'store-inactive';
    case 'NO_MEMBERSHIP':
    case 'ROLE_NOT_PERMITTED':
      return 'user-not-allowed';
    case 'UNAUTHENTICATED':
      return 'unauthenticated';
    case 'MISSING_SLUG':
      return 'missing-slug';
    case 'SCHEMA_DRIFT':
      return 'schema-drift';
    default:
      return undefined;
  }
}

/**
 * True for Prisma known request errors (P2xxx codes, e.g. P2022 = a column
 * the query selects does not exist, the local-database schema-drift signal).
 * Duck-typed so this module keeps working without a runtime Prisma import.
 */
function isPrismaKnownRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'PrismaClientKnownRequestError') return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code);
}

function toStoreSummary(store: {
  id: string;
  name: string;
  slug: string | null;
  subdomain: string | null;
  code: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  brandingColor: string | null;
  status: string;
}): StoreSummary {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    subdomain: store.subdomain,
    code: store.code,
    location: store.location,
    phone: store.phone,
    email: store.email,
    brandingColor: store.brandingColor,
    status: store.status,
    isActive: store.status === 'ACTIVE',
  };
}

/**
 * Active store ids a user can reach beyond their primary User.storeId.
 * Cheap (indexed on userId+status); call sites cache per request.
 */
export async function getAccessibleStoreIds(
  userId: string,
  primaryStoreId: string | null,
): Promise<string[]> {
  const memberships = await db.storeMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { storeId: true },
  });
  const ids = new Set<string>(memberships.map((m) => m.storeId));
  if (primaryStoreId) ids.add(primaryStoreId);
  return Array.from(ids);
}

async function logDeniedWorkspaceAccess(
  session: AuthSession | null,
  attempted: { subdomain: string | null; slug: string | null; storeId?: string },
  resource: string,
  reason: string,
  extras?: { host?: string | null; pathname?: string | null },
): Promise<void> {
  try {
    await db.securityEvent.create({
      data: {
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'WARN',
        userId: session?.userId ?? null,
        storeId: attempted.storeId ?? null,
        resource,
        action: `WORKSPACE_ACCESS ${attempted.subdomain || attempted.slug || 'unknown'}`,
        details: JSON.stringify({
          reason,
          subdomain: attempted.subdomain,
          slug: attempted.slug,
          role: session?.role ?? 'anonymous',
          email: session?.email ?? null,
          // v2.18.0.0: richer, still non-sensitive correlation fields.
          host: extras?.host ?? null,
          pathname: extras?.pathname ?? null,
          requestId: getRequestId(),
        }),
        userAgent: null,
        ipAddress: null,
        blocked: true,
      },
    });
  } catch {
    // Audit logging must never block the access decision.
  }
}

/**
 * Resolve + authorize the workspace store.
 *
 * @param input.host        request Host header (subdomain detection)
 * @param input.slug        explicit slug from the path (/stores/{slug}/...)
 * @param input.pathname    optional request pathname (denial-log detail only)
 * @param input.session     authenticated session or null (unauthenticated)
 * @param input.auditDenials set false only for pre-auth probes that must not
 *                          write audit rows (e.g. the login page bootstrap)
 */
export async function resolveStoreContext(input: {
  host: string | null;
  slug?: string | null;
  pathname?: string | null;
  session: AuthSession | null;
  auditDenials?: boolean;
}): Promise<StoreContextResult> {
  const host = parseHost(input.host);
  const subdomain = extractSubdomain(host);
  const hostMode = resolveWorkspaceHostMode(host);
  const audit = input.auditDenials !== false;
  const extras = { host, pathname: input.pathname ?? null };

  // 1. A slug that is present but empty/whitespace is a configuration or
  //    link-building bug, not a database question: answer calmly WITHOUT a
  //    DB call (v2.18.0.0 missing-slug detection).
  if (typeof input.slug === 'string' && input.slug.trim() === '' && !subdomain) {
    return {
      mode: 'not-found',
      allowed: false,
      reason: 'MISSING_SLUG',
      reasonCode: reasonCodeFor('MISSING_SLUG'),
      hostMode,
      subdomain,
    };
  }
  const requestedSlug = typeof input.slug === 'string' ? input.slug.trim() : '';

  // 1b. Nothing to resolve: root-domain request (or subdomains disabled).
  if (!subdomain && !requestedSlug) {
    return { mode: 'organization', allowed: true, hostMode, subdomain: null };
  }

  // 2. Resolve the store: subdomain wins over an explicit slug (the proxy
  //    rewrote {sub}.root/x to /stores/{sub}/x, so both point at the same
  //    store; a forged mismatched pair resolves by the trusted host first).
  //    Schema drift (v2.18.0.0): a local database missing a column the
  //    query selects (Prisma P2022 or any known request error) is answered
  //    as a calm not-found WITHOUT leaking the error text. Other errors
  //    re-throw to the route's error boundary as before.
  let store: Parameters<typeof toStoreSummary>[0] | null = null;
  try {
    store = await db.store.findFirst({
      where: subdomain
        ? { OR: [{ subdomain }, { slug: subdomain }] }
        : { slug: requestedSlug || undefined },
      select: {
        id: true,
        name: true,
        slug: true,
        subdomain: true,
        code: true,
        location: true,
        phone: true,
        email: true,
        brandingColor: true,
        status: true,
      },
    });
  } catch (error) {
    if (isPrismaKnownRequestError(error)) {
      if (audit) {
        await logDeniedWorkspaceAccess(
          input.session,
          { subdomain, slug: requestedSlug || null },
          'workspace',
          'SCHEMA_DRIFT',
          extras,
        );
      }
      return {
        mode: 'not-found',
        allowed: false,
        reason: 'SCHEMA_DRIFT',
        reasonCode: reasonCodeFor('SCHEMA_DRIFT'),
        hostMode,
        subdomain,
      };
    }
    throw error;
  }

  if (!store) {
    if (audit) {
      await logDeniedWorkspaceAccess(
        input.session,
        { subdomain, slug: requestedSlug || null },
        'workspace',
        'STORE_NOT_FOUND',
        extras,
      );
    }
    return {
      mode: 'not-found',
      allowed: false,
      reason: 'STORE_NOT_FOUND',
      reasonCode: reasonCodeFor('STORE_NOT_FOUND'),
      hostMode,
      subdomain,
    };
  }

  // 3. Unauthenticated: let the client render its login screen (same origin),
  //    which redirects back into this workspace after login.
  if (!input.session) {
    return {
      mode: hostMode === 'subdomain' ? 'subdomain' : 'path',
      store: toStoreSummary(store),
      allowed: false,
      reason: 'UNAUTHENTICATED',
      reasonCode: reasonCodeFor('UNAUTHENTICATED'),
      hostMode,
      subdomain,
    };
  }

  // 4. Inactive stores: SUPER_ADMIN diagnostic view only.
  if (store.status !== 'ACTIVE' && input.session.role !== 'SUPER_ADMIN') {
    if (audit) {
      await logDeniedWorkspaceAccess(
        input.session,
        { subdomain, slug: input.slug ?? null, storeId: store.id },
        store.id,
        'STORE_INACTIVE',
        extras,
      );
    }
    return {
      mode: 'denied',
      allowed: false,
      reason: 'STORE_INACTIVE',
      reasonCode: reasonCodeFor('STORE_INACTIVE'),
      store: toStoreSummary(store),
      hostMode,
      subdomain,
    };
  }

  // 5. Authorization.
  const role = input.session.role;
  let allowed = false;
  let readOnly = false;
  let reason = 'ROLE_NOT_PERMITTED';

  if (ORG_WIDE_ROLES.has(role)) {
    allowed = true;
  } else if (role === 'ACCOUNTANT') {
    // Permitted read-only financial mode for branch workspaces.
    allowed = true;
    readOnly = true;
  } else if (input.session.storeId && input.session.storeId === store.id) {
    allowed = true;
  } else {
    // Multi-store members (e.g. WAREHOUSE_MANAGER): active membership required.
    const membership = await db.storeMembership.findFirst({
      where: { userId: input.session.userId, storeId: store.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (membership) allowed = true;
    else reason = 'NO_MEMBERSHIP';
  }

  if (!allowed && audit) {
    await logDeniedWorkspaceAccess(
      input.session,
      { subdomain, slug: input.slug ?? null, storeId: store.id },
      store.id,
      reason,
      extras,
    );
  }

  return {
    mode: allowed ? (hostMode === 'subdomain' ? 'subdomain' : 'path') : 'denied',
    store: toStoreSummary(store),
    allowed,
    readOnly: allowed ? readOnly : false,
    reason: allowed ? undefined : reason,
    reasonCode: allowed ? undefined : reasonCodeFor(reason),
    hostMode,
    subdomain,
  };
}

/** Shape of GET /api/me/store-context for the client bootstrap. */
export interface StoreContextPayload {
  mode: StoreContextResult['mode'];
  allowed: boolean;
  readOnly: boolean;
  reason?: string;
  reasonCode?: string;
  hostMode: StoreContextResult['hostMode'];
  store?: StoreSummary;
  rootDomain: string;
  memberships: string[];
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    storeId: string | null;
  } | null;
}

export async function buildStoreContextPayload(input: {
  host: string | null;
  slug?: string | null;
  pathname?: string | null;
  session: AuthSession | null;
}): Promise<StoreContextPayload> {
  const result = await resolveStoreContext(input);

  let memberships: string[] = [];
  let user: StoreContextPayload['user'] = null;

  if (input.session) {
    const rows = await db.storeMembership.findMany({
      where: { userId: input.session.userId, status: 'ACTIVE' },
      select: { storeId: true },
    });
    memberships = rows.map((r) => r.storeId);
    if (input.session.storeId) memberships.push(input.session.storeId);
    memberships = Array.from(new Set(memberships));

    const dbUser = await db.user.findUnique({
      where: { id: input.session.userId },
      select: { id: true, email: true, name: true, role: true, storeId: true },
    });
    if (dbUser) user = dbUser;
  }

  return {
    mode: result.mode,
    allowed: result.allowed,
    readOnly: result.readOnly ?? false,
    reason: result.reason,
    reasonCode: result.reasonCode,
    hostMode: result.hostMode,
    store: result.store,
    rootDomain: (process.env.NEXT_PUBLIC_ROOT_DOMAIN || '').toLowerCase(),
    memberships,
    user,
  };
}
