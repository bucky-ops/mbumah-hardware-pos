// v2.18.1 branch-manager binding: post-login redirect tests.
//
// postLoginRedirect (src/lib/workspace/links.ts) is consumed by the login
// screen right after a successful sign-in. The matrix below proves the
// binding spec's redirect rules:
//   - organization roles land on the org console,
//   - warehouse managers go through the branch selector,
//   - BRANCH_MANAGER / CASHIER land in their OWN branch workspace, decided
//     by the database relation (User.storeId -> Store.slug), with the full
//     path/subdomain safety matrix applied by buildStoreWorkspaceUrl,
//   - unassigned branch-bound accounts are sent to /account/pending-branch
//     (never the org console, never another branch),
//   - users already inside a workspace context stay where they are.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { postLoginRedirect, resolveWorkspaceModeHint, type PostLoginUser } from '@/lib/workspace/links';

function stubWindow(host: string, pathname: string, protocol = 'http:') {
  vi.stubGlobal('window', {
    location: { host, pathname, protocol },
  });
}

function user(overrides: Partial<PostLoginUser>): PostLoginUser {
  return { role: 'CASHIER', ...overrides };
}

const PATH_MODE_ENVS = {
  NEXT_PUBLIC_USE_SUBDOMAINS: 'false',
  NEXT_PUBLIC_STORE_WORKSPACE_MODE: 'path',
  NEXT_PUBLIC_ROOT_DOMAIN: '',
};

const SUBDOMAIN_ENVS = {
  NEXT_PUBLIC_USE_SUBDOMAINS: 'true',
  NEXT_PUBLIC_STORE_WORKSPACE_MODE: 'auto',
  NEXT_PUBLIC_ROOT_DOMAIN: 'mbumah.test',
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('postLoginRedirect - organization roles (regression)', () => {
  it('sends SUPER_ADMIN, STORE_OWNER and ACCOUNTANT to the org console', () => {
    for (const role of ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT']) {
      expect(postLoginRedirect(user({ role, storeId: 'store_juja_main' }))).toBe('/org/dashboard');
    }
  });

  it('sends warehouse managers through the branch selector', () => {
    expect(postLoginRedirect(user({ role: 'WAREHOUSE_MANAGER', storeId: null }))).toBe('/branches/select');
  });

  it('returns null for unknown roles (default SPA behavior preserved)', () => {
    expect(postLoginRedirect(user({ role: 'INVENTORY_MANAGER', storeId: 'store_juja_main' }))).toBeNull();
  });

  it('returns null for a null user', () => {
    expect(postLoginRedirect(null)).toBeNull();
  });
});

describe('postLoginRedirect - branch-bound roles (v2.18.1)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_USE_SUBDOMAINS', PATH_MODE_ENVS.NEXT_PUBLIC_USE_SUBDOMAINS);
    vi.stubEnv('NEXT_PUBLIC_STORE_WORKSPACE_MODE', PATH_MODE_ENVS.NEXT_PUBLIC_STORE_WORKSPACE_MODE);
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', PATH_MODE_ENVS.NEXT_PUBLIC_ROOT_DOMAIN);
    stubWindow('localhost:3000', '/');
  });

  it('redirects a branch manager to their own branch workspace (path mode)', () => {
    const target = postLoginRedirect(
      user({
        role: 'BRANCH_MANAGER',
        storeId: 'store_juja_main',
        store: { id: 'store_juja_main', slug: 'juja-main', subdomain: 'juja-main', status: 'ACTIVE' },
      }),
    );
    expect(target).toBe('/stores/juja-main/dashboard');
  });

  it('redirects a branch manager on 127.0.0.1 to path mode', () => {
    stubWindow('127.0.0.1:3000', '/');
    const target = postLoginRedirect(
      user({
        role: 'BRANCH_MANAGER',
        storeId: 'store_thika',
        store: { id: 'store_thika', slug: 'thika', subdomain: 'thika', status: 'ACTIVE' },
      }),
    );
    expect(target).toBe('/stores/thika/dashboard');
  });

  it('redirects a cashier to their own branch workspace', () => {
    const target = postLoginRedirect(
      user({
        role: 'CASHIER',
        storeId: 'store_nakuru',
        store: { id: 'store_nakuru', slug: 'nakuru', subdomain: 'nakuru', status: 'ACTIVE' },
      }),
    );
    expect(target).toBe('/stores/nakuru/dashboard');
  });

  it('sends an unassigned branch manager to /account/pending-branch', () => {
    const target = postLoginRedirect(user({ role: 'BRANCH_MANAGER', storeId: null, store: null }));
    expect(target).toBe('/account/pending-branch');
  });

  it('sends an unassigned cashier to /account/pending-branch', () => {
    const target = postLoginRedirect(user({ role: 'CASHIER', storeId: null }));
    expect(target).toBe('/account/pending-branch');
  });

  it('keeps a branch-bound user on the root SPA when the assigned store has no slug', () => {
    // Missing slug is a configuration problem; the workspace gateway would
    // show "Store slug is not configured", so the root SPA (still pinned to
    // the user's store server-side) remains the safe landing.
    const target = postLoginRedirect(
      user({ role: 'BRANCH_MANAGER', storeId: 'store_thika', store: { id: 'store_thika', slug: null, subdomain: null } }),
    );
    expect(target).toBeNull();
  });

  it('never builds /stores/undefined or /stores/null links', () => {
    const target = postLoginRedirect(
      user({ role: 'CASHIER', storeId: 'store_x', store: { id: 'store_x', slug: undefined, subdomain: undefined } }),
    );
    expect(target).toBeNull();
  });
});

describe('postLoginRedirect - subdomain-capable hosts (v2.18.1)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_USE_SUBDOMAINS', SUBDOMAIN_ENVS.NEXT_PUBLIC_USE_SUBDOMAINS);
    vi.stubEnv('NEXT_PUBLIC_STORE_WORKSPACE_MODE', SUBDOMAIN_ENVS.NEXT_PUBLIC_STORE_WORKSPACE_MODE);
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', SUBDOMAIN_ENVS.NEXT_PUBLIC_ROOT_DOMAIN);
  });

  it('builds a subdomain URL from the root-domain host', () => {
    stubWindow('mbumah.test:3000', '/');
    const target = postLoginRedirect(
      user({
        role: 'BRANCH_MANAGER',
        storeId: 'store_thika',
        store: { id: 'store_thika', slug: 'thika', subdomain: 'thika', status: 'ACTIVE' },
      }),
    );
    expect(target).toBe('http://thika.mbumah.test/dashboard');
  });

  it('stays put when already on the branch subdomain', () => {
    stubWindow('thika.mbumah.test:3000', '/');
    const target = postLoginRedirect(
      user({
        role: 'BRANCH_MANAGER',
        storeId: 'store_thika',
        store: { id: 'store_thika', slug: 'thika', subdomain: 'thika', status: 'ACTIVE' },
      }),
    );
    expect(target).toBeNull();
  });

  it('falls back to path mode on raw IP hosts even with subdomains enabled', () => {
    stubWindow('192.168.1.20:3000', '/');
    const target = postLoginRedirect(
      user({
        role: 'BRANCH_MANAGER',
        storeId: 'store_thika',
        store: { id: 'store_thika', slug: 'thika', subdomain: 'thika', status: 'ACTIVE' },
      }),
    );
    expect(target).toBe('/stores/thika/dashboard');
  });
});

describe('postLoginRedirect - stay-put contexts (v2.18.1)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_USE_SUBDOMAINS', PATH_MODE_ENVS.NEXT_PUBLIC_USE_SUBDOMAINS);
    vi.stubEnv('NEXT_PUBLIC_STORE_WORKSPACE_MODE', PATH_MODE_ENVS.NEXT_PUBLIC_STORE_WORKSPACE_MODE);
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', PATH_MODE_ENVS.NEXT_PUBLIC_ROOT_DOMAIN);
  });

  it('keeps the user inside an existing path workspace', () => {
    stubWindow('localhost:3000', '/stores/thika/dashboard');
    expect(
      postLoginRedirect(
        user({ role: 'BRANCH_MANAGER', storeId: 'store_thika', store: { id: 'store_thika', slug: 'thika' } }),
      ),
    ).toBeNull();
  });

  it('keeps the user on the pending-branch page', () => {
    stubWindow('localhost:3000', '/account/pending-branch');
    expect(postLoginRedirect(user({ role: 'CASHIER', storeId: null }))).toBeNull();
  });
});

describe('resolveWorkspaceModeHint (v2.18.1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('passes through valid configured modes', () => {
    for (const mode of ['path', 'subdomain', 'auto', 'off'] as const) {
      vi.stubEnv('NEXT_PUBLIC_STORE_WORKSPACE_MODE', mode);
      expect(resolveWorkspaceModeHint()).toBe(mode);
    }
  });

  it('defaults to auto for unset or unknown values', () => {
    vi.stubEnv('NEXT_PUBLIC_STORE_WORKSPACE_MODE', '');
    expect(resolveWorkspaceModeHint()).toBe('auto');
    vi.stubEnv('NEXT_PUBLIC_STORE_WORKSPACE_MODE', 'turbo');
    expect(resolveWorkspaceModeHint()).toBe('auto');
  });
});
