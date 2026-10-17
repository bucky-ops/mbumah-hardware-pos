// MBUMAH HARDWARE POS - notification feed tenant-free read contract (v2.57.0)
//
// The feed's user-addressed sections (SECURITY alerts, HR digest copies,
// leave + payroll copies) are addressed BY USER ID - the tenant extension
// must never narrow them to the browsing store. They historically ran under
// runWithoutTenant, but inside a Next.js production request the hardened
// client's interceptor could observe the OUTER runWithTenant context and
// silently AND-narrow the query anyway: every org-wide row (storeId NULL)
// vanished from the bell while the same query ran correctly in isolation.
// The fix: those sections read via rawDb (the un-intercepted base client),
// making the bypass unconditional instead of ALS-timing-dependent.
//
// This contract test pins BOTH halves: the route MUST use rawDb for the
// three sections, and MUST NOT use the hardened db client for them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, rawDb } from '@/lib/db';

const ROOT = join(__dirname, '..', '..');
const ROUTE = readFileSync(
  join(ROOT, 'src/app/api/notifications/route.ts'),
  'utf8',
);
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const routeCode = stripComments(ROUTE);

describe('notification feed tenant-free reads (v2.57.0)', () => {
  it('rawDb is a distinct client from the hardened db', () => {
    expect(rawDb).toBeDefined();
    expect(rawDb).not.toBe(db);
  });

  it('all three user-addressed sections read via rawDb.notification', () => {
    const uses = routeCode.match(/rawDb\.notification\.findMany/g) ?? [];
    expect(uses).toHaveLength(3);
  });

  it('no hardened db.notification read remains in the feed route', () => {
    expect(routeCode).not.toMatch(/\bdb\.notification\./);
  });

  it('the db.ts contract names the leak and the user-addressed scope', () => {
    const dbSrc = readFileSync(join(ROOT, 'src/lib/db.ts'), 'utf8');
    expect(dbSrc).toContain('export const rawDb = baseClient;');
    expect(dbSrc).toContain('MUST NOT be used for');
    expect(dbSrc).toContain('runWithTenant');
  });

  it('every rawDb use stays inside a runWithoutTenant wrapper (intent kept)', () => {
    // Each rawDb.findMany call site should sit inside a runWithoutTenant(()
    // wrapper - the wrapper is now documentation + defense-in-depth, and
    // its removal would signal a refactor worth re-reviewing.
    const wrapped = routeCode.match(/runWithoutTenant\(\(\) =>\s*\n?\s*rawDb\.notification\.findMany/g) ?? [];
    expect(wrapped).toHaveLength(3);
  });
});
