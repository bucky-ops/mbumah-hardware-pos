// v2.16.0 subdomain workspaces: unit tests for the pure domain helpers.
// These are the Edge-safe functions consumed by src/proxy.ts and the
// workspace server resolver (spec Phase 4: "unit-testable helper functions").

import { describe, it, expect } from 'vitest';
import {
  parseHost,
  isLocalHost,
  isRawIpAddress,
  hostMatchesPattern,
  isHostAllowed,
  extractSubdomain,
  isReservedSubdomain,
  isRootDomain,
  resolveWorkspaceHostMode,
  shouldUseSubdomainMode,
  shouldUsePathMode,
  buildInternalPath,
  RESERVED_SUBDOMAINS,
} from '@/lib/workspace/config';

// Deterministic config: bypasses process.env so tests are order-independent.
const CFG = {
  rootDomain: 'mbumah.test',
  useSubdomains: true,
  mode: 'auto' as const,
  allowedHosts: [] as string[],
};

describe('parseHost', () => {
  it('strips ports and lowercases', () => {
    expect(parseHost('Juja-Main.Mbumah.Test:3000')).toBe('juja-main.mbumah.test');
  });

  it('handles bare hosts and trailing dots', () => {
    expect(parseHost('mbumah.test.')).toBe('mbumah.test');
    expect(parseHost('localhost')).toBe('localhost');
  });

  it('unwraps IPv6 brackets with port', () => {
    expect(parseHost('[::1]:3000')).toBe('::1');
  });

  it('returns empty for garbage', () => {
    expect(parseHost(null)).toBe('');
    expect(parseHost('')).toBe('');
    expect(parseHost('   ')).toBe('');
    expect(parseHost('[broken')).toBe('');
  });
});

describe('host classification', () => {
  it('detects localhost family', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('dev.localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('::1')).toBe(true);
    expect(isLocalHost('mbumah.test')).toBe(false);
  });

  it('detects raw IPs (LAN/offline mode)', () => {
    expect(isRawIpAddress('192.168.1.20')).toBe(true);
    expect(isRawIpAddress('10.0.0.5')).toBe(true);
    expect(isRawIpAddress('fe80::1')).toBe(true);
    expect(isRawIpAddress('mbumah.test')).toBe(false);
  });
});

describe('isReservedSubdomain', () => {
  it('rejects the spec reserved list', () => {
    for (const label of ['www', 'api', 'auth', 'admin', 'app', 'mail', 'status', 'assets', 'static', '_next', 'favicon', 'robots', 'sitemap', 'login', 'logout', 'chat', 'org', 'stores', 'branches']) {
      expect(isReservedSubdomain(label)).toBe(true);
    }
    expect(RESERVED_SUBDOMAINS.size).toBeGreaterThanOrEqual(19);
  });

  it('allows store labels', () => {
    expect(isReservedSubdomain('juja-main')).toBe(false);
    expect(isReservedSubdomain('thika')).toBe(false);
  });
});

describe('hostMatchesPattern', () => {
  it('matches exact and suffix-wildcard patterns', () => {
    expect(hostMatchesPattern('mbumah.test', 'mbumah.test')).toBe(true);
    expect(hostMatchesPattern('juja-main.mbumah.test', '*.mbumah.test')).toBe(true);
    expect(hostMatchesPattern('mbumah.test', '*.mbumah.test')).toBe(true);
    expect(hostMatchesPattern('a.b.mbumah.test', '*.mbumah.test')).toBe(true);
    expect(hostMatchesPattern('evil.io', '*.mbumah.test')).toBe(false);
    // Lookalike: suffix must align on a dot boundary.
    expect(hostMatchesPattern('evilm bumah.test', '*.mbumah.test')).toBe(false);
    expect(hostMatchesPattern('mbumah.test.evil.io', 'mbumah.test')).toBe(false);
  });
});

describe('isHostAllowed', () => {
  it('allows localhost, LAN IPs and configured root domains by default', () => {
    expect(isHostAllowed('localhost', CFG)).toBe(true);
    expect(isHostAllowed('terminal.localhost', CFG)).toBe(true);
    expect(isHostAllowed('127.0.0.1', CFG)).toBe(true);
    expect(isHostAllowed('192.168.1.20', CFG)).toBe(true);
    expect(isHostAllowed('mbumah.test', CFG)).toBe(true);
    expect(isHostAllowed('juja-main.mbumah.test', CFG)).toBe(true);
    expect(isHostAllowed('mbumah-hardware-pos.vercel.app', CFG)).toBe(true);
  });

  it('rejects unknown hosts (host header attacks)', () => {
    expect(isHostAllowed('evil.example.com', CFG)).toBe(false);
    expect(isHostAllowed('mbumah.test.evil.io', CFG)).toBe(false);
    expect(isHostAllowed('', CFG)).toBe(false);
  });

  it('honors an explicit ALLOWED_HOSTS list', () => {
    const custom = { ...CFG, allowedHosts: ['pos.internal', '*.pos.internal'] };
    expect(isHostAllowed('pos.internal', custom)).toBe(true);
    expect(isHostAllowed('nakuru.pos.internal', custom)).toBe(true);
    expect(isHostAllowed('juja-main.mbumah.test', custom)).toBe(false);
  });

  it('strips ports before validation', () => {
    expect(isHostAllowed('juja-main.mbumah.test:3000', CFG)).toBe(true);
  });
});

describe('extractSubdomain', () => {
  it('maps every seeded branch subdomain', () => {
    expect(extractSubdomain('juja-main.mbumah.test', CFG)).toBe('juja-main');
    expect(extractSubdomain('thika.mbumah.test', CFG)).toBe('thika');
    expect(extractSubdomain('ruiru.mbumah.test', CFG)).toBe('ruiru');
    expect(extractSubdomain('nairobi-cbd.mbumah.test', CFG)).toBe('nairobi-cbd');
    expect(extractSubdomain('nakuru.mbumah.test', CFG)).toBe('nakuru');
  });

  it('returns null for the root domain and non-matching hosts', () => {
    expect(extractSubdomain('mbumah.test', CFG)).toBeNull();
    expect(extractSubdomain('localhost', CFG)).toBeNull();
    expect(extractSubdomain('evil.example.com', CFG)).toBeNull();
    expect(extractSubdomain('mbumah.test.evil.io', CFG)).toBeNull();
  });

  it('returns null for reserved and malformed labels', () => {
    expect(extractSubdomain('api.mbumah.test', CFG)).toBeNull();
    expect(extractSubdomain('admin.mbumah.test', CFG)).toBeNull();
    expect(extractSubdomain('www.mbumah.test', CFG)).toBeNull();
    expect(extractSubdomain('-bad.mbumah.test', CFG)).toBeNull();
    expect(extractSubdomain('a.b.mbumah.test', CFG)).toBeNull(); // deep hosts are not slugs
  });

  it('strips ports before extraction', () => {
    expect(extractSubdomain('juja-main.mbumah.test:3000', CFG)).toBe('juja-main');
  });
});

describe('workspace mode resolution', () => {
  it('resolves subdomain mode for branch hosts', () => {
    expect(resolveWorkspaceHostMode('juja-main.mbumah.test', CFG)).toBe('subdomain');
    expect(shouldUseSubdomainMode('juja-main.mbumah.test', CFG)).toBe(true);
    expect(shouldUsePathMode('juja-main.mbumah.test', CFG)).toBe(false);
  });

  it('resolves organization/path mode for root, localhost and IPs', () => {
    for (const host of ['mbumah.test', 'localhost', '127.0.0.1', '192.168.1.20']) {
      expect(resolveWorkspaceHostMode(host, CFG)).toBe('organization');
      expect(shouldUsePathMode(host, CFG)).toBe(true);
    }
  });

  it('isRootDomain treats local/IP hosts as root', () => {
    expect(isRootDomain('mbumah.test', CFG)).toBe(true);
    expect(isRootDomain('juja-main.mbumah.test', CFG)).toBe(false);
    expect(isRootDomain('localhost', CFG)).toBe(true);
  });

  it('mode=off disables subdomain workspaces', () => {
    const off = { ...CFG, mode: 'off' as const };
    expect(resolveWorkspaceHostMode('juja-main.mbumah.test', off)).toBe('organization');
  });

  it('mode=path forces path mode even on branch hosts', () => {
    const path = { ...CFG, mode: 'path' as const };
    expect(resolveWorkspaceHostMode('juja-main.mbumah.test', path)).toBe('organization');
  });

  it('useSubdomains=false forces path mode', () => {
    const disabled = { ...CFG, useSubdomains: false };
    expect(resolveWorkspaceHostMode('juja-main.mbumah.test', disabled)).toBe('organization');
  });
});

describe('buildInternalPath', () => {
  it('rewrites subdomain requests to the path workspace', () => {
    expect(buildInternalPath('juja-main', '/')).toBe('/stores/juja-main');
    expect(buildInternalPath('juja-main', '/dashboard')).toBe('/stores/juja-main/dashboard');
    expect(buildInternalPath('juja-main', '/pos')).toBe('/stores/juja-main/pos');
  });

  it('refuses reserved or invalid labels', () => {
    expect(buildInternalPath('api', '/x')).toBeNull();
    expect(buildInternalPath('Admin', '/x')).toBeNull();
    expect(buildInternalPath('-x', '/x')).toBeNull();
  });
});
