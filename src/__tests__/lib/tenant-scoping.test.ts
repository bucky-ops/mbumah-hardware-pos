// SECURITY REGRESSION TESTS — ORM-level tenant scoping (injectTenant)
//
// Background (QA 2026-09, v2.4.1): injectTenant previously RESPECTED any
// explicitly-passed `where.storeId` on the assumption that route-level
// `requireStoreAccess` validation would reject cross-store requests first.
// Several GET routes (debt, customers, transactions, …) accept a `storeId`
// query param WITHOUT that validation — so a store-scoped CASHIER could read
// another branch's customers/debt ledgers by simply changing the query param
// (reproduced live against production: Nakuru cashier reading Juja + Thika
// customers). The fix makes injectTenant ALWAYS narrow: pass-through only
// when the explicit filter equals the tenant store (string equality), else
// AND a tenant filter so a query can only shrink, never widen, its scope.

import { describe, it, expect } from 'vitest';
import { injectTenant, runWithTenant, runWithoutTenant } from '@/lib/db';

const TENANT = 'store_nakuru';
const OTHER = 'store_juja_main';

// Helper: run injectTenant inside an active tenant context.
function scoped(args: Record<string, unknown>) {
  return runWithTenant(TENANT, () => injectTenant(args as never)) as unknown as Record<
    string,
    unknown
  >;
}

describe('injectTenant — cross-tenant scoping (SECURITY)', () => {
  it('passes through when no tenant context is active (login/seeding)', () => {
    const args = { where: { storeId: OTHER } };
    expect(injectTenant(args as never)).toBe(args);
  });

  it('passes through under runWithoutTenant (SUPER_ADMIN / org-level jobs)', () => {
    const args = { where: { storeId: OTHER } };
    const out = runWithoutTenant(() => injectTenant(args as never));
    expect(out).toBe(args);
  });

  it('injects storeId when the query has no where clause', () => {
    expect(scoped({})).toEqual({ where: { storeId: TENANT } });
  });

  it('injects storeId when where is null', () => {
    expect(scoped({ where: null })).toEqual({ where: { storeId: TENANT } });
  });

  it('merges tenant scope into an existing where without one (AND shape)', () => {
    const out = scoped({ where: { status: 'OUTSTANDING' } });
    const where = out.where as { status?: string; storeId?: string; AND?: unknown[] };
    expect(where.status).toBe('OUTSTANDING');
    expect(where.storeId).toBeUndefined();
    expect(where.AND).toEqual([{ storeId: TENANT }]);
  });

  it('passes through when the caller filters on their OWN store', () => {
    const args = { where: { storeId: TENANT, status: 'OUTSTANDING' } };
    const out = scoped(args);
    expect(out).toEqual(args); // identical — ANDing would be a no-op
  });

  it('AND-narrows when the caller requests ANOTHER store (the v2.4.1 leak)', () => {
    const out = scoped({ where: { storeId: OTHER } });
    const where = out.where as { storeId?: string; AND?: unknown[] };
    // Original filter preserved…
    expect(where.storeId).toBe(OTHER);
    // …but the tenant constraint is ANDed, so the DB-level result is empty.
    expect(where.AND).toEqual([{ storeId: TENANT }]);
  });

  it('AND-narrows non-string storeId filter shapes (e.g. { in: [...] })', () => {
    const shape = { in: [TENANT, OTHER] };
    const out = scoped({ where: { storeId: shape } });
    const where = out.where as { storeId?: unknown; AND?: unknown[] };
    expect(where.storeId).toBe(shape);
    expect(where.AND).toEqual([{ storeId: TENANT }]);
  });

  it('preserves an existing AND clause when narrowing', () => {
    const out = scoped({
      where: { storeId: OTHER, AND: [{ balance: { gt: 0 } }] },
    });
    const where = out.where as { AND?: unknown[] };
    expect(where.AND).toHaveLength(2);
    expect(where.AND).toContainEqual({ storeId: TENANT });
    expect(where.AND).toContainEqual({ balance: { gt: 0 } });
  });

  it('does not mutate the caller args object', () => {
    const args = { where: { storeId: OTHER } };
    scoped(args);
    expect(args.where).toEqual({ storeId: OTHER });
  });
});
