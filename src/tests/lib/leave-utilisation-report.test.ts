import { describe, it, expect, vi, beforeEach } from 'vitest';
import { leaveUtilisationReport, leaveUtilisationToCSV, resolveReportScope } from '@/lib/hr/reports';

/**
 * v2.35.0 contracts: leave entitlement utilisation & liability report —
 * scoping (fail-closed), spec-compliant row shape (employeeCode + job title,
 * no names / raw ids), balance math (available = allocated + carried − used −
 * pending), flag classification, noise filtering, rollups, and RFC-4180 CSV
 * with a TOTAL row.
 */

const db = vi.hoisted(() => ({
  employeeLeaveBalance: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue('audit-id'),
  HrEntityType: { DATA_EXPORT: 'DataExport' },
}));

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

const bal = (over: Record<string, unknown> = {}) => {
  const { employeeCode, jobTitle, ...rest } = over;
  return {
    allocatedDays: 0,
    carryForwardDays: 0,
    usedDays: 0,
    pendingDays: 0,
    encashedDays: 0,
    employee: {
      employeeCode: (employeeCode as string) ?? 'EMP-001',
      jobTitle: (jobTitle as string) ?? 'Cashier',
      employmentType: 'PERMANENT',
      store: { name: 'Juja' },
    },
    leaveType: { name: 'Annual', code: 'ANNUAL' },
    ...rest,
  };
};

describe('leave utilisation report scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.employeeLeaveBalance.findMany.mockResolvedValue([]);
  });

  it('maps roles to scopes (fail-closed)', () => {
    expect(resolveReportScope(orgSession)).toBe('ORG');
    expect(resolveReportScope(branchSession)).toBe('BRANCH');
    expect(resolveReportScope({ ...branchSession, role: 'CASHIER' } as never)).toBeNull();
  });

  it('returns null for a scopeless session', async () => {
    const out = await leaveUtilisationReport({ ...branchSession, role: 'CASHIER' } as never, 2026);
    expect(out).toBeNull();
    expect(db.employeeLeaveBalance.findMany).not.toHaveBeenCalled();
  });

  it('narrowing to BRANCH filters by the manager store; ORG by organization', async () => {
    db.employeeLeaveBalance.findMany.mockResolvedValue([]);
    await leaveUtilisationReport(branchSession, 2026);
    const branchWhere = db.employeeLeaveBalance.findMany.mock.calls[0][0].where;
    expect(branchWhere.leaveYear).toBe(2026);
    expect(branchWhere.employee).toMatchObject({ status: 'ACTIVE', deletedAt: null, storeId: 'store-1' });
    await leaveUtilisationReport(orgSession, 2026);
    const orgWhere = db.employeeLeaveBalance.findMany.mock.calls[2][0].where;
    expect(orgWhere.employee).toMatchObject({ status: 'ACTIVE', deletedAt: null });
    expect(JSON.stringify(orgWhere.employee.store)).toContain('organizationId');
  });

  it('BRANCH scope cannot narrow to another store (storeId ignored)', async () => {
    await leaveUtilisationReport(branchSession, 2026, { storeId: 'store-9' });
    const where = db.employeeLeaveBalance.findMany.mock.calls[0][0].where;
    expect(where.employee).toMatchObject({ storeId: 'store-1' });
  });
});

describe('leave utilisation math and flags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes available/committed, classifies flags, filters zero rows, aggregates rollups', async () => {
    db.employeeLeaveBalance.findMany
      .mockResolvedValueOnce([
        // Over-drawn: 10 allocated, 12 used -> available -2, committed 120%
        bal({ allocatedDays: 10, usedDays: 12, employeeCode: 'EMP-002' }),
        // Normal: 20 + 2 carried, 10 used + 1 pending -> available 11, committed 50%
        bal({ allocatedDays: 20, carryForwardDays: 2, usedDays: 10, pendingDays: 1, encashedDays: 0.5 }),
        // Zero row: no entitlement, no activity -> filtered out
        bal({}),
      ])
      .mockResolvedValueOnce([{ leaveYear: 2025 }, { leaveYear: 2024 }]);

    const out = await leaveUtilisationReport(orgSession, 2026);
    expect(out).not.toBeNull();
    if (!out) throw new Error('report missing');
    const dto = out;

    // Noise filter: only 2 live rows.
    expect(dto.rows).toHaveLength(2);
    expect(dto.totals.tracked).toBe(2);

    // Rows sorted by store, then code: EMP-001 before EMP-002.
    expect(dto.rows[0].employeeCode).toBe('EMP-001');
    expect(dto.rows[1].employeeCode).toBe('EMP-002');

    const normal = dto.rows[0];
    expect(normal.available).toBe(11);
    expect(normal.committedPct).toBe(50);
    expect(normal.flag).toBe('OPEN');

    const overdrawn = dto.rows[1];
    expect(overdrawn.available).toBe(-2);
    expect(overdrawn.committedPct).toBe(120);
    expect(overdrawn.flag).toBe('OVERDRAWN');

    // Totals: entitlement 32, used 22, pending 1, available 9.
    expect(dto.totals.entitlement).toBe(32);
    expect(dto.totals.used).toBe(22);
    expect(dto.totals.pending).toBe(1);
    expect(dto.totals.available).toBe(9);
    expect(dto.totals.committedPct).toBe(Math.round(((22 + 1) / 32) * 1000) / 10);
    expect(dto.totals.overdrawn).toBe(1);
    expect(dto.totals.exhausted).toBe(0);

    // byType aggregates the single ANNUAL type; byStore the single branch.
    expect(dto.byType).toHaveLength(1);
    expect(dto.byType[0].code).toBe('ANNUAL');
    expect(dto.byType[0].available).toBe(9);
    expect(dto.byStore).toHaveLength(1);
    expect(dto.byStore[0].store).toBe('Juja');

    // Year list: distinct years desc + requested year first when absent.
    expect(dto.years[0]).toBe(2026);
    expect(dto.years).toContain(2025);
  });

  it('classifies EXHAUSTED and LOW flags', async () => {
    db.employeeLeaveBalance.findMany
      .mockResolvedValueOnce([
        // EXHAUSTED: exactly zero available.
        bal({ allocatedDays: 5, usedDays: 5 }),
        // LOW: 80%+ committed but still available (10 alloc, 9 used).
        bal({ allocatedDays: 10, usedDays: 9 }),
      ])
      .mockResolvedValueOnce([]);
    const dto = await leaveUtilisationReport(orgSession, 2026);
    if (!dto) throw new Error('report missing');
    expect(dto.rows.map((r) => r.flag)).toEqual(['EXHAUSTED', 'LOW']);
  });

  it('spec shape: rows never carry names or raw ids', async () => {
    db.employeeLeaveBalance.findMany
      .mockResolvedValueOnce([bal({ allocatedDays: 10, usedDays: 1 })])
      .mockResolvedValueOnce([]);
    const dto = await leaveUtilisationReport(orgSession, 2026);
    if (!dto) throw new Error('report missing');
    const json = JSON.stringify(dto.rows);
    expect(json).not.toContain('id');
    expect(json).not.toContain('name"');
  });
});

describe('leave utilisation CSV', () => {
  it('emits RFC-4180 rows with a TOTAL line (CRLF)', () => {
    const dto = {
      scope: 'ORG',
      year: 2026,
      years: [2026],
      rows: [
        {
          employeeCode: 'EMP-001',
          jobTitle: 'Cashier',
          employmentType: 'PERMANENT',
          storeName: 'Juja',
          typeName: 'Annual',
          typeCode: 'ANNUAL',
          allocated: 20,
          carried: 2,
          used: 10,
          pending: 1,
          encashed: 0,
          available: 11,
          committedPct: 50,
          flag: 'OPEN',
        },
      ],
      totals: { entitlement: 22, used: 10, pending: 1, available: 11, committedPct: 50, overdrawn: 0, exhausted: 0, low: 0, tracked: 1 },
      byType: [],
      byStore: [],
    };
    const csv = leaveUtilisationToCSV(dto as never);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Employee,Job title,Employment type,Branch,Leave type,Allocated,Carried forward,Used,Pending,Encashed,Available,Committed %,Flag');
    expect(lines[1].startsWith('EMP-001,Cashier,PERMANENT,Juja,Annual,')).toBe(true);
    expect(lines[2].startsWith('TOTAL,')).toBe(true);
    expect(csv).toContain('11.0');
    expect(csv).toContain('OPEN');
  });
});
