// BRANCH WORKSPACE TESTS - v2.18.0.0 correction release
//
// Two areas:
//   1. getBranchWorkspaceHref (src/lib/branch-workspace.ts): the safe link
//      builder behind the organization console's "Open branch workspace"
//      button. Pure functions - explicit deterministic inputs, no mocks.
//   2. resolveStoreContext (src/lib/workspace/server.ts): the server-side
//      resolver + authorization with @/lib/db mocked (same hoisted-mock
//      pattern as store-guard.test.ts). Covers the reasonCode vocabulary,
//      the missing-slug short-circuit and the schema-drift guard.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { storeFindFirst, storeMembershipFindFirst, storeMembershipFindMany, userFindUnique, securityEventCreate } =
  vi.hoisted(() => ({
    storeFindFirst: vi.fn(),
    storeMembershipFindFirst: vi.fn(),
    storeMembershipFindMany: vi.fn(),
    userFindUnique: vi.fn(),
    securityEventCreate: vi.fn(),
  }));

vi.mock('@/lib/db', () => ({
  db: {
    store: { findFirst: storeFindFirst },
    storeMembership: { findFirst: storeMembershipFindFirst, findMany: storeMembershipFindMany },
    user: { findUnique: userFindUnique },
    securityEvent: { create: securityEventCreate },
  },
}));

import { getBranchWorkspaceHref, isRawIpHost } from '@/lib/branch-workspace';
import { resolveStoreContext } from '@/lib/workspace/server';
import { extractSlugFromPathname } from '@/lib/workspace/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function activeStore(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    id: 'store_thika',
    name: 'MBUMAH HARDWARE - Thika',
    slug: 'thika',
    subdomain: 'thika' as string | null,
    code: 'THI',
    location: 'Thika',
    phone: null,
    email: null,
    brandingColor: '#B45309',
    status: 'ACTIVE',
    ...overrides,
  };
}

function sessionFor(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user_admin_1',
    email: 'admin@mbumahhardware.co.ke',
    role: 'SUPER_ADMIN',
    storeId: null as string | null,
    organizationId: 'org_mbumah',
    ...overrides,
  };
}

// Workspace env keys the resolver/config read; pinned per test for determinism.
const WORKSPACE_ENV_KEYS = [
  'NEXT_PUBLIC_ROOT_DOMAIN',
  'NEXT_PUBLIC_USE_SUBDOMAINS',
  'NEXT_PUBLIC_STORE_WORKSPACE_MODE',
  'ALLOWED_HOSTS',
  'TRUST_X_FORWARDED_HOST',
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  savedEnv = {};
  for (const key of WORKSPACE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  storeMembershipFindFirst.mockResolvedValue(null);
  storeMembershipFindMany.mockResolvedValue([]);
  userFindUnique.mockResolvedValue(null);
  securityEventCreate.mockResolvedValue({});
});

afterEach(() => {
  for (const key of WORKSPACE_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

// ---------------------------------------------------------------------------
// 1. getBranchWorkspaceHref - safe link builder
// ---------------------------------------------------------------------------

describe('getBranchWorkspaceHref - safe link builder (v2.18.0.0)', () => {
  const safeSubdomainInput = {
    mode: 'auto' as const,
    rootDomain: 'mbumah.co.ke',
    useSubdomains: true,
  };

  it('falls back to the path workspace on localhost (never a subdomain URL)', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'juja-main', subdomain: 'juja-main' },
        currentHost: 'localhost:3000',
        ...safeSubdomainInput,
      }),
    ).toBe('/stores/juja-main/dashboard');
  });

  it('falls back to the path workspace on 127.0.0.1', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'thika' },
        currentHost: '127.0.0.1:3000',
        ...safeSubdomainInput,
      }),
    ).toBe('/stores/thika/dashboard');
  });

  it('mode path always returns the path workspace', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'ruiru' },
        currentHost: 'app.mbumah.co.ke',
        mode: 'path',
        rootDomain: 'mbumah.co.ke',
        useSubdomains: true,
      }),
    ).toBe('/stores/ruiru/dashboard');
  });

  it('builds the absolute subdomain URL when every safety check passes', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'juja-main' },
        currentHost: 'app.mbumah.co.ke',
        mode: 'auto',
        rootDomain: 'mbumah.co.ke',
        useSubdomains: true,
        protocol: 'https:',
      }),
    ).toBe('https://juja-main.mbumah.co.ke/dashboard');
  });

  it('returns null when the slug is missing or empty', () => {
    expect(getBranchWorkspaceHref({ store: {}, currentHost: 'localhost:3000', ...safeSubdomainInput })).toBeNull();
    expect(
      getBranchWorkspaceHref({ store: { slug: '' }, currentHost: 'localhost:3000', ...safeSubdomainInput }),
    ).toBeNull();
    expect(
      getBranchWorkspaceHref({ store: { slug: null }, currentHost: 'localhost:3000', ...safeSubdomainInput }),
    ).toBeNull();
  });

  it('never builds a path from undefined or null slug data (broken data stays safe)', () => {
    const broken: Array<string | null | undefined> = [undefined, null, '', 'undefined', 'null', '   '];
    for (const slug of broken) {
      expect(
        getBranchWorkspaceHref({ store: { slug }, currentHost: 'localhost:3000', ...safeSubdomainInput }),
      ).toBeNull();
    }
    // A garbage subdomain field falls back to the (valid) slug, never to a
    // broken URL:
    const href = getBranchWorkspaceHref({
      store: { slug: 'thika', subdomain: 'undefined' },
      currentHost: 'app.mbumah.co.ke',
      ...safeSubdomainInput,
      protocol: 'https:',
    });
    expect(href).not.toMatch(/undefined|null/);
    expect(href).toBe('https://thika.mbumah.co.ke/dashboard');
  });

  it('reserved subdomains never become branch subdomain URLs (path fallback)', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'admin' },
        currentHost: 'app.mbumah.co.ke',
        ...safeSubdomainInput,
        protocol: 'https:',
      }),
    ).toBe('/stores/admin/dashboard');
  });

  it('returns null for inactive stores', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'thika', isActive: false },
        currentHost: 'localhost:3000',
        ...safeSubdomainInput,
      }),
    ).toBeNull();
  });

  it('mode off returns null; useSubdomains false forces path mode', () => {
    expect(getBranchWorkspaceHref({ store: { slug: 'thika' }, currentHost: 'app.mbumah.co.ke', mode: 'off' })).toBeNull();
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'thika' },
        currentHost: 'app.mbumah.co.ke',
        mode: 'auto',
        rootDomain: 'mbumah.co.ke',
        useSubdomains: false,
      }),
    ).toBe('/stores/thika/dashboard');
  });

  it('raw LAN and IPv6 hosts fall back to path mode even with subdomains enabled', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'nakuru' },
        currentHost: '192.168.1.20:3000',
        ...safeSubdomainInput,
      }),
    ).toBe('/stores/nakuru/dashboard');
    expect(
      getBranchWorkspaceHref({ store: { slug: 'nakuru' }, currentHost: '[::1]:3000', ...safeSubdomainInput }),
    ).toBe('/stores/nakuru/dashboard');
  });

  it('keeps an explicit http protocol for offline subdomain setups', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'thika' },
        currentHost: 'app.mbumah.test',
        mode: 'auto',
        rootDomain: 'mbumah.test',
        useSubdomains: true,
        protocol: 'http:',
      }),
    ).toBe('http://thika.mbumah.test/dashboard');
  });

  it('rejects an invalid root domain instead of building a broken absolute URL', () => {
    expect(
      getBranchWorkspaceHref({
        store: { slug: 'thika' },
        currentHost: 'app.example.com',
        mode: 'auto',
        rootDomain: 'not a domain',
        useSubdomains: true,
        protocol: 'https:',
      }),
    ).toBe('/stores/thika/dashboard');
  });

  it('isRawIpHost detects IPv4 and IPv6 hosts', () => {
    expect(isRawIpHost('192.168.1.20')).toBe(true);
    expect(isRawIpHost('10.0.0.7')).toBe(true);
    expect(isRawIpHost('::1')).toBe(true);
    expect(isRawIpHost('mbumah.co.ke')).toBe(false);
    expect(isRawIpHost('localhost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. resolveStoreContext - reasonCode + new detections
// ---------------------------------------------------------------------------

describe('resolveStoreContext - reasonCode + new detections (v2.18.0.0)', () => {
  it('resolves a path slug for an org-wide role', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'thika',
      session: sessionFor(),
    });
    expect(storeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'thika' } }),
    );
    expect(result.allowed).toBe(true);
    expect(result.mode).toBe('path');
    expect(result.store?.slug).toBe('thika');
    expect(result.reasonCode).toBeUndefined();
  });

  it('resolves a subdomain host when the root domain is configured', async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'mbumah.co.ke';
    storeFindFirst.mockResolvedValue(
      activeStore({
        id: 'store_juja_main',
        name: 'MBUMAH HARDWARE - Juja Main',
        slug: 'juja-main',
        subdomain: 'juja-main',
      }),
    );
    const result = await resolveStoreContext({
      host: 'juja-main.mbumah.co.ke',
      session: sessionFor(),
    });
    expect(result.allowed).toBe(true);
    expect(result.mode).toBe('subdomain');
    expect(result.store?.slug).toBe('juja-main');
  });

  it('falls back to the slug when the subdomain column is null', async () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'mbumah.co.ke';
    storeFindFirst.mockResolvedValue(activeStore({ subdomain: null }));
    const result = await resolveStoreContext({
      host: 'thika.mbumah.co.ke',
      session: sessionFor(),
    });
    expect(result.allowed).toBe(true);
    expect(result.store?.slug).toBe('thika');
    expect(result.store?.subdomain).toBeNull();
  });

  it('denies an inactive store with reasonCode store-inactive', async () => {
    storeFindFirst.mockResolvedValue(activeStore({ status: 'INACTIVE' }));
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'thika',
      session: sessionFor({ role: 'CASHIER', storeId: 'store_thika', userId: 'user_cashier_1' }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('STORE_INACTIVE');
    expect(result.reasonCode).toBe('store-inactive');
    expect(securityEventCreate).toHaveBeenCalledTimes(1);
  });

  it('denies a cashier probing another store with reasonCode user-not-allowed', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'thika',
      session: sessionFor({ role: 'CASHIER', storeId: 'store_nakuru', userId: 'user_cashier_1' }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_MEMBERSHIP');
    expect(result.reasonCode).toBe('user-not-allowed');
  });

  it('answers STORE_NOT_FOUND with reasonCode store-not-found (audited)', async () => {
    storeFindFirst.mockResolvedValue(null);
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'ghost-branch',
      session: sessionFor(),
    });
    expect(result.mode).toBe('not-found');
    expect(result.reason).toBe('STORE_NOT_FOUND');
    expect(result.reasonCode).toBe('store-not-found');
    expect(securityEventCreate).toHaveBeenCalledTimes(1);
  });

  it('answers unauthenticated with reasonCode unauthenticated (login flow)', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({ host: 'localhost:3000', slug: 'thika', session: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('UNAUTHENTICATED');
    expect(result.reasonCode).toBe('unauthenticated');
  });

  it('allows SUPER_ADMIN on any active store', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'thika',
      session: sessionFor({ role: 'SUPER_ADMIN', storeId: 'store_nakuru' }),
    });
    expect(result.allowed).toBe(true);
  });

  it('allows STORE_OWNER on any active store', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'thika',
      session: sessionFor({ role: 'STORE_OWNER', storeId: null }),
    });
    expect(result.allowed).toBe(true);
  });

  it('allows a warehouse manager only with an ACTIVE membership', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const session = sessionFor({ role: 'WAREHOUSE_MANAGER', storeId: null, userId: 'user_wh_1' });

    const denied = await resolveStoreContext({ host: 'localhost:3000', slug: 'thika', session });
    expect(denied.allowed).toBe(false);
    expect(denied.reasonCode).toBe('user-not-allowed');

    storeMembershipFindFirst.mockResolvedValue({ id: 'membership_1' });
    const allowed = await resolveStoreContext({ host: 'localhost:3000', slug: 'thika', session });
    expect(allowed.allowed).toBe(true);
    expect(storeMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_wh_1', storeId: 'store_thika', status: 'ACTIVE' },
      }),
    );
  });

  it('answers missing-slug without any DB call', async () => {
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: '   ',
      session: sessionFor(),
    });
    expect(result.mode).toBe('not-found');
    expect(result.reason).toBe('MISSING_SLUG');
    expect(result.reasonCode).toBe('missing-slug');
    expect(storeFindFirst).not.toHaveBeenCalled();
    expect(securityEventCreate).not.toHaveBeenCalled();
  });

  it('maps schema drift (Prisma P2022) to a calm not-found without leaking errors', async () => {
    const prismaError = Object.assign(new Error('Unknown column `Store.legacy_field` in select'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2022',
    });
    storeFindFirst.mockRejectedValue(prismaError);
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'thika',
      session: sessionFor(),
    });
    expect(result.mode).toBe('not-found');
    expect(result.reason).toBe('SCHEMA_DRIFT');
    expect(result.reasonCode).toBe('schema-drift');
    // No error text leaks into the result payload.
    expect(JSON.stringify(result)).not.toContain('Unknown column');
    // The denial is still recorded (the audit write is a separate query).
    expect(securityEventCreate).toHaveBeenCalledTimes(1);
    const details = JSON.parse(securityEventCreate.mock.calls[0][0].data.details) as Record<string, unknown>;
    expect(details.reason).toBe('SCHEMA_DRIFT');
    expect(details.host).toBe('localhost');
    expect(details.pathname).toBeNull();
  });

  it('re-throws non-Prisma errors (the route error boundary handles them)', async () => {
    storeFindFirst.mockRejectedValue(new Error('connection refused'));
    await expect(
      resolveStoreContext({ host: 'localhost:3000', slug: 'thika', session: sessionFor() }),
    ).rejects.toThrow('connection refused');
    expect(securityEventCreate).not.toHaveBeenCalled();
  });

  it('carries host/pathname/requestId into denial-log details', async () => {
    storeFindFirst.mockResolvedValue(null);
    await resolveStoreContext({
      host: 'mbumah.test:3000',
      slug: 'ghost',
      pathname: '/stores/ghost/dashboard',
      session: sessionFor(),
    });
    const details = JSON.parse(securityEventCreate.mock.calls[0][0].data.details) as Record<string, unknown>;
    expect(details.host).toBe('mbumah.test');
    expect(details.pathname).toBe('/stores/ghost/dashboard');
    expect(typeof details.requestId).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 3. Pathname slug derivation (v2.18.0.3 store-context correction)
// ---------------------------------------------------------------------------

describe('extractSlugFromPathname (v2.18.0.3)', () => {
  it('extracts the slug from path-mode workspace pathnames', () => {
    expect(extractSlugFromPathname('/stores/juja-main/dashboard')).toBe('juja-main');
    expect(extractSlugFromPathname('/stores/thika')).toBe('thika');
    expect(extractSlugFromPathname('/stores/nairobi-cbd/reports/export')).toBe('nairobi-cbd');
    expect(extractSlugFromPathname('/STORES/NAKURU/dashboard')).toBe('nakuru');
  });

  it('returns null for non-workspace or unterminated pathnames', () => {
    expect(extractSlugFromPathname('/dashboard')).toBeNull();
    expect(extractSlugFromPathname('/')).toBeNull();
    expect(extractSlugFromPathname('/stores/')).toBeNull();
    expect(extractSlugFromPathname('/stores')).toBeNull();
    expect(extractSlugFromPathname('')).toBeNull();
    expect(extractSlugFromPathname(null)).toBeNull();
    expect(extractSlugFromPathname(undefined)).toBeNull();
  });
});

describe('resolveStoreContext - pathname slug derivation (v2.18.0.3)', () => {
  it('resolves the store from a bare /stores/{slug}/... pathname without an explicit slug', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      pathname: '/stores/thika/dashboard',
      session: sessionFor(),
    });
    expect(storeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'thika' } }),
    );
    expect(result.allowed).toBe(true);
    expect(result.mode).toBe('path');
    expect(result.store?.slug).toBe('thika');
  });

  it('prefers the explicit slug over the pathname slug', async () => {
    storeFindFirst.mockResolvedValue(
      activeStore({ id: 'store_nakuru', name: 'MBUMAH HARDWARE - Nakuru', slug: 'nakuru' }),
    );
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: 'nakuru',
      pathname: '/stores/thika/dashboard',
      session: sessionFor(),
    });
    expect(storeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'nakuru' } }),
    );
    expect(result.store?.slug).toBe('nakuru');
  });

  it('does not short-circuit to missing-slug when the pathname carries the slug', async () => {
    storeFindFirst.mockResolvedValue(activeStore());
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: '',
      pathname: '/stores/thika/dashboard',
      session: sessionFor(),
    });
    expect(storeFindFirst).toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(result.store?.slug).toBe('thika');
  });

  it('still answers missing-slug with no DB call when neither slug nor pathname can resolve', async () => {
    const result = await resolveStoreContext({
      host: 'localhost:3000',
      slug: '   ',
      pathname: '/dashboard',
      session: sessionFor(),
    });
    expect(storeFindFirst).not.toHaveBeenCalled();
    expect(result.mode).toBe('not-found');
    expect(result.reasonCode).toBe('missing-slug');
  });
});
