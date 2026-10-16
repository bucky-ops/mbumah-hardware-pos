// PER-BRANCH REPORT DRILL-DOWN TESTS - v2.23.0
//
// Contracts under test:
//   • validateReportStore: only ORG-scope callers may narrow; the store must
//     belong to the caller's organization (fail-closed 404); BRANCH callers
//     are rejected outright (they are already scoped to their own store).
//   • headcountReport with { storeId }: the employee where-clause narrows to
//     the branch AND keeps the org-membership condition (a hostile storeId
//     can never WIDEN access).
//   • hrPerStoreForOrgConsole: ORG scope gets one aggregates-only row per
//     branch mirroring the tile definitions; BRANCH scope gets null.
//   • resolveScheduleStore: BRANCH managers are PINNED to their own store
//     (no scheduling digests for branches they cannot see); ORG scopes may
//     target any store of their organization or leave it org-wide.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn(),
    groupBy: vi.fn().mockResolvedValue([]),
  });
  return {
    employee: model(),
    store: model(),
    payrollDetail: model(),
    payrollRun: model(),
    attendanceRecord: model(),
    employeeDocument: model(),
    assetAssignment: model(),
    hrReportSchedule: model(),
  };
});

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { REPORT_SCHEDULE: 'HrReportSchedule' },
}));

import {
  validateReportStore,
  headcountReport,
  hrPerStoreForOrgConsole,
  StoreNarrowingError,
} from '@/lib/hr/reports';
import { resolveScheduleStore, HrScheduleError } from '@/lib/hr/report-schedule-service';

const orgSession = {
  userId: 'user-owner',
  email: 'owner@mbumah.co.ke',
  role: 'STORE_OWNER',
  storeId: null,
  organizationId: 'org-1',
} as const;

const branchSession = {
  userId: 'user-bm',
  email: 'bm@mbumah.co.ke',
  role: 'BRANCH_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

describe('validateReportStore (v2.23.0 drill-down)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a store of the caller organization for ORG scope', async () => {
    db.store.findFirst.mockResolvedValue({ id: 'store-2', name: 'Nakuru Branch' });
    const store = await validateReportStore(orgSession, 'ORG', 'store-2');
    expect(store).toEqual({ id: 'store-2', name: 'Nakuru Branch' });
    expect(db.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'store-2', organizationId: 'org-1' } }),
    );
  });

  it('rejects unknown / cross-organization stores fail-closed (404)', async () => {
    db.store.findFirst.mockResolvedValue(null);
    await expect(validateReportStore(orgSession, 'ORG', 'store-evil')).rejects.toMatchObject({
      name: 'StoreNarrowingError',
      code: 'STORE_NOT_FOUND',
      status: 404,
    });
  });

  it('rejects narrowing for BRANCH scope (already scoped, 403)', async () => {
    await expect(validateReportStore(branchSession, 'BRANCH', 'store-2')).rejects.toBeInstanceOf(
      StoreNarrowingError,
    );
    await expect(validateReportStore(branchSession, 'BRANCH', 'store-2')).rejects.toMatchObject({
      code: 'STORE_NARROWING_FORBIDDEN',
      status: 403,
    });
  });

  it('passes through when no storeId is given', async () => {
    expect(await validateReportStore(orgSession, 'ORG', null)).toBeNull();
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });
});

describe('headcountReport with storeId narrowing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('narrows to the branch while keeping org membership (cannot widen)', async () => {
    db.employee.findMany.mockResolvedValue([]);
    db.employee.count.mockResolvedValue(0);
    const period = { from: new Date('2026-01-01'), to: new Date('2026-10-16') };
    await headcountReport(orgSession, period, { storeId: 'store-2' });
    const where = db.employee.findMany.mock.calls[0][0].where;
    expect(where.storeId).toBe('store-2');
    expect(where.store).toEqual({ organizationId: 'org-1' });
  });

  it('does not narrow when no storeId is supplied', async () => {
    db.employee.findMany.mockResolvedValue([]);
    db.employee.count.mockResolvedValue(0);
    const period = { from: new Date('2026-01-01'), to: new Date('2026-10-16') };
    await headcountReport(orgSession, period);
    const where = db.employee.findMany.mock.calls[0][0].where;
    expect(where.storeId).toBeUndefined();
    expect(where.store).toEqual({ organizationId: 'org-1' });
  });
});

describe('hrPerStoreForOrgConsole (v2.23.0)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for BRANCH scope (their tile already covers their store)', async () => {
    expect(await hrPerStoreForOrgConsole(branchSession)).toBeNull();
  });

  it('returns one aggregates-only row per store mirroring the tile math', async () => {
    db.store.findMany.mockResolvedValue([
      { id: 'store-1', name: 'Juja Main' },
      { id: 'store-2', name: 'Nakuru Branch' },
    ]);
    db.employee.groupBy.mockResolvedValue([
      { storeId: 'store-1', _count: { _all: 5 } },
      { storeId: 'store-2', _count: { _all: 2 } },
    ]);
    db.payrollDetail.groupBy.mockResolvedValue([
      {
        storeId: 'store-1',
        _sum: { grossPay: 100000, nssf: 2160, housingLevy: 1500 },
      },
    ]);
    db.attendanceRecord.count
      .mockResolvedValueOnce(200) // store-1 recorded
      .mockResolvedValueOnce(10) // store-1 absent -> 5%
      .mockResolvedValueOnce(40) // store-2 recorded
      .mockResolvedValueOnce(0); // store-2 absent -> 0%
    db.employeeDocument.count.mockResolvedValue(1);
    db.assetAssignment.count.mockResolvedValue(2);
    db.payrollRun.findFirst.mockImplementation(async ({ where }: { where: { storeId: string } }) =>
      where.storeId === 'store-1'
        ? { status: 'POSTED', createdAt: new Date('2026-10-01'), payrollPeriod: { name: 'October 2026' } }
        : null,
    );

    const rows = (await hrPerStoreForOrgConsole(orgSession))!;
    expect(rows).toHaveLength(2);
    const juja = rows.find((r) => r.storeId === 'store-1')!;
    expect(juja.storeName).toBe('Juja Main');
    expect(juja.headcountActive).toBe(5);
    // Cost = gross + nssf + housing levy (same mirror as the org tile).
    expect(juja.monthEmploymentCost).toBe(103660);
    expect(juja.monthAbsenceRatePct).toBe(5); // 10/200
    expect(juja.latestPayroll).toMatchObject({ status: 'POSTED', periodName: 'October 2026' });
    expect(juja.expiryAlerts).toEqual({ documentsExpiring90Days: 1, assetsOverdue: 2 });
    const nakuru = rows.find((r) => r.storeId === 'store-2')!;
    expect(nakuru.headcountActive).toBe(2);
    expect(nakuru.monthEmploymentCost).toBe(0);
    expect(nakuru.latestPayroll).toBeNull();
    // Aggregates only — no employee names or national IDs anywhere.
    expect(JSON.stringify(rows)).not.toMatch(/Mary|Wanjiku|nationalId/);
  });
});

describe('resolveScheduleStore (v2.23.0 scope enforcement)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pins BRANCH managers to their own store and rejects others (403)', async () => {
    expect(await resolveScheduleStore(branchSession, null)).toBe('store-1');
    expect(await resolveScheduleStore(branchSession, 'store-1')).toBe('store-1');
    await expect(resolveScheduleStore(branchSession, 'store-2')).rejects.toMatchObject({
      name: 'HrScheduleError',
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    });
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });

  it('validates ORG-scope targets against the organization (404 unknown)', async () => {
    db.store.findFirst.mockResolvedValueOnce({ id: 'store-2' });
    expect(await resolveScheduleStore(orgSession, 'store-2')).toBe('store-2');
    db.store.findFirst.mockResolvedValueOnce(null);
    await expect(resolveScheduleStore(orgSession, 'store-evil')).rejects.toMatchObject({
      code: 'STORE_NOT_FOUND',
      status: 404,
    });
    expect(await resolveScheduleStore(orgSession, null)).toBeNull();
    await expect(resolveScheduleStore(orgSession, 'store-evil')).rejects.toBeInstanceOf(HrScheduleError);
  });
});
