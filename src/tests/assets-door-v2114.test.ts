import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.114.0 — "the assets half of the alert opens its door".
 *
 * Three layers:
 *  1. SERVICE (db-mocked): listAssets' overdue window mirrors the panel's
 *     assetsOverdue count EXACTLY (ASSIGNED + dueReturnOn in the past) and
 *     wins over any conflicting status filter; an explicit storeId narrows
 *     the list only for an org-scope actor whose organization owns the store
 *     (or whose session store matches) — fail-closed, silent otherwise.
 *  2. LINK BUILDER (pure): buildOverdueAssetsHref — encoded, relative,
 *     never throws, empty-safe.
 *  3. SOURCE CONTRACTS (read the bytes): the route parses ?storeId= and
 *     ?overdue=1; the /hr/assets page seeds lazily, mirrors filters into the
 *     URL, shows the "(from link)" chip and the store-scope notice; the
 *     panel's assets door is gated on ASSET_LIST_READ_ROLES (mirrors
 *     hr.asset.manage — a door that 403s is a lie) and zero halves never
 *     render as links.
 */

const db = vi.hoisted(() => ({
  assetAssignment: { findMany: vi.fn() },
  store: { findFirst: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));

import { listAssets } from '@/lib/hr/asset-service';
import { buildOverdueAssetsHref } from '@/lib/workspace/links';
import { ASSET_LIST_READ_ROLES } from '@/lib/app-config';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const ORG_SESSION = {
  userId: 'user-1',
  role: 'STORE_OWNER',
  storeId: null,
  organizationId: 'org-1',
} as Parameters<typeof listAssets>[0];

const BRANCH_SESSION = {
  userId: 'user-2',
  role: 'BRANCH_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listAssets>[0];

const ROW = {
  id: 'asset-1',
  employeeId: 'emp-1',
  storeId: 'store-1',
  assetName: 'Barcode scanner',
  assetTag: 'MBM-AST-014',
  serialNumber: null,
  assignedOn: new Date('2026-09-01T00:00:00Z'),
  dueReturnOn: new Date('2026-10-10T00:00:00Z'),
  returnedOn: null,
  conditionOut: 'New, boxed',
  conditionIn: null,
  recoveryAuthorizedByUserId: null,
  status: 'ASSIGNED',
  notes: null,
  employee: { firstName: 'Ada', lastName: 'One' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listAssets — the overdue window mirrors the panel count exactly', () => {
  it('overdue=1 pins status ASSIGNED + dueReturnOn in the past (the assetsOverdue definition)', async () => {
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(ORG_SESSION, { overdue: true });
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('ASSIGNED');
    expect(where.dueReturnOn.lt).toBeInstanceOf(Date);
    expect(where.deletedAt).toBeNull();
    // org-scope actor with no storeId: the employee scope is the organization
    expect(where.employee).toEqual({ store: { organizationId: 'org-1' } });
  });

  it('overdue wins over a conflicting status filter — the door never lies', async () => {
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(ORG_SESSION, { status: 'LOST', overdue: true });
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('ASSIGNED');
    expect(where.dueReturnOn).toBeDefined();
  });

  it('without overdue, the status filter passes through untouched', async () => {
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(ORG_SESSION, { status: 'LOST' });
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('LOST');
    expect(where.dueReturnOn).toBeUndefined();
  });

  it('maps rows to DTOs with the computed overdue flag and storeId carried', async () => {
    db.assetAssignment.findMany.mockResolvedValue([ROW]);
    const rows = await listAssets(ORG_SESSION, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeName).toBe('Ada One');
    expect(rows[0].storeId).toBe('store-1');
    expect(typeof rows[0].overdue).toBe('boolean');
  });
});

describe('listAssets — the storeId param is scope the server decides', () => {
  it('org-scope actor + a store inside the organization: the list narrows to that store', async () => {
    db.store.findFirst.mockResolvedValue({ id: 'store-2' });
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(ORG_SESSION, { storeId: 'store-2' });
    expect(db.store.findFirst).toHaveBeenCalledWith({
      where: { id: 'store-2', organizationId: 'org-1' },
      select: { id: true },
    });
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.employee).toEqual({ store: { organizationId: 'org-1' }, storeId: 'store-2' });
  });

  it('org-scope actor + a foreign store: fail-closed, silently session-scoped', async () => {
    db.store.findFirst.mockResolvedValue(null);
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(ORG_SESSION, { storeId: 'store-other-org' });
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.employee).toEqual({ store: { organizationId: 'org-1' } });
  });

  it('branch-scope actor + their own store: narrows (idempotent with the session scope)', async () => {
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(BRANCH_SESSION, { storeId: 'store-1' });
    expect(db.store.findFirst).not.toHaveBeenCalled();
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.employee).toEqual({ storeId: 'store-1' });
  });

  it('branch-scope actor + another store: the request never widens scope', async () => {
    db.assetAssignment.findMany.mockResolvedValue([]);
    await listAssets(BRANCH_SESSION, { storeId: 'store-2' });
    expect(db.store.findFirst).not.toHaveBeenCalled();
    const where = db.assetAssignment.findMany.mock.calls[0][0].where;
    expect(where.employee).toEqual({ storeId: 'store-1' });
  });
});

describe('buildOverdueAssetsHref — the panel\u2019s assets door', () => {
  it('encodes overdue=1 + storeId, relative and honest', () => {
    expect(buildOverdueAssetsHref('store_juja_main')).toBe('/hr/assets?overdue=1&storeId=store_juja_main');
    expect(buildOverdueAssetsHref('store a&b')).toBe('/hr/assets?overdue=1&storeId=store+a%26b');
    expect(buildOverdueAssetsHref('')).toBe('/hr/assets?overdue=1&storeId=');
  });
});

describe('ASSET_LIST_READ_ROLES — the door mirrors the permission the list guards', () => {
  it('exactly the roles hr.asset.manage answers (plus the bypassing super admin)', () => {
    expect(ASSET_LIST_READ_ROLES).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER']);
  });
  it('the accountant is deliberately absent — payroll + reports, not assets', () => {
    expect(ASSET_LIST_READ_ROLES).not.toContain('ACCOUNTANT');
  });
});

describe('source contracts — the route, the page, the panel', () => {
  it('the assets route parses storeId and overdue from the query', () => {
    const route = src('src/app/api/hr/assets/route.ts');
    expect(route).toContain("url.searchParams.get('storeId') ?? undefined");
    expect(route).toContain("overdue: url.searchParams.get('overdue') === '1'");
    // the guard key is unchanged — the door's promise and the server agree
    expect(route).toContain("hrGuard('hr.asset.manage')");
  });

  it('the /hr/assets page seeds lazily, mirrors, and stays honest about links', () => {
    const page = src('src/app/(shell)/hr/assets/page.tsx');
    expect(page).toContain("useState(() => readParam('storeId'))");
    expect(page).toContain("useState(() => readParam('overdue') === '1')");
    expect(page).toContain("params.set('overdue', '1')");
    expect(page).toContain('window.history.replaceState(null');
    expect(page).toContain('data-testid="hr-assets-overdue-toggle"');
    expect(page).toContain('from link');
    // the store-scope notice — the same honesty the employees list rides on
    expect(page).toContain('data-testid="hr-assets-store-notice"');
    expect(page).toContain('the server never widens scope on request alone');
  });

  it('the panel renders the assets door, gated on the roles the list answers', () => {
    const panel = src('src/components/finance/people-payroll-by-branch.tsx');
    expect(panel).toContain('buildOverdueAssetsHref(row.storeId)');
    expect(panel).toContain('data-testid="people-payroll-assets-door"');
    expect(panel).toContain('ASSET_LIST_READ_ROLES.includes(role || \'\')');
    // zero halves never render as links — both doors sit behind a > 0 check
    expect(panel).toMatch(/assets > 0 && canOpenAssets/);
    // the un-gated text degrade survives verbatim
    expect(panel).toContain('Overdue asset assignments: ${assets} — see the Assets page');
  });
});
