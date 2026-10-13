// v2.16.0 subdomain workspaces: consistency between the three places that
// define branch workspaces (seed, client store-info, domains tooling config).
// A drift here breaks subdomain routing or receipts, so it is pinned by test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORE_LIST, getStoreBySlug } from '@/lib/store-info';
import { isReservedSubdomain } from '@/lib/workspace/config';

const repoRoot = join(__dirname, '..', '..', '..');
const domainsConfig = JSON.parse(
  readFileSync(join(repoRoot, 'scripts', 'domains', 'stores.config.json'), 'utf8'),
) as {
  stores: Array<{ id: string; slug: string; subdomain: string; name: string }>;
};

describe('workspace store definitions', () => {
  it('STORE_LIST, stores.config.json and the seed agree on every branch', () => {
    expect(domainsConfig.stores).toHaveLength(STORE_LIST.length);

    for (const configStore of domainsConfig.stores) {
      const info = STORE_LIST.find((s) => s.id === configStore.id);
      if (!info) throw new Error(`store ${configStore.id} missing from STORE_LIST`);
      expect(info.slug).toBe(configStore.slug);
      expect(info.subdomain).toBe(configStore.subdomain);

      // prisma/seed.ts sets the same values (spot-check via a text scan to
      // avoid pulling the whole seed + prisma client into the unit test).
      const seed = readFileSync(join(repoRoot, 'prisma', 'seed.ts'), 'utf8');
      expect(seed).toContain(`slug: '${configStore.slug}'`);
      expect(seed).toContain(`subdomain: '${configStore.subdomain}'`);
      expect(seed).toContain(`code: '${info.code}'`);
    }
  });

  it('no branch uses a reserved subdomain or an invalid slug', () => {
    const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
    for (const store of STORE_LIST) {
      expect(store.slug).toMatch(slugPattern);
      expect(store.subdomain).toMatch(slugPattern);
      expect(isReservedSubdomain(store.subdomain)).toBe(false);
      expect(store.brandingColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('getStoreBySlug resolves every workspace address', () => {
    for (const store of STORE_LIST) {
      expect(getStoreBySlug(store.slug)?.id).toBe(store.id);
      expect(getStoreBySlug(store.subdomain)?.id).toBe(store.id);
    }
    expect(getStoreBySlug('does-not-exist')).toBeUndefined();
  });
});
