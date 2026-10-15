import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildP10,
  employmentCostReport,
  headcountReport,
  hrSummaryForOrgConsole,
  p10ToCSV,
  parsePeriod,
  resolveReportScope,
} from '@/lib/hr/reports';

/**
 * Phase 4.8 contracts (v2.20.0): report scoping (hr.report.branch vs
 * hr.report.all), aggregate-only payloads (no names / raw ids), employer
 * statutory mirroring, and P10 REPRODUCING FROM STORED LINES (posted runs
 * only, nothing recomputed).
 */

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
    aggregate: vi.fn(),
  });
  return {
    employee: model(),
    store: model(),
    payrollDetail: model(),
    payrollRun: model(),
    attendanceRecord: model(),
    leaveRequest: model(),
    employeeDocument: model(),
    assetAssignment: model(),
    applicant: model(),
  };
});

const hrAudit = vi.hoisted(() => vi.fn().mockResolvedValue('audit-id'));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit,
  HrEntityType: { DATA_EXPORT: 'DataExport', APPLICANT: 'Applicant', EMPLOYEE: 'Employee', DISCIPLINARY_CASE: 'DisciplinaryCase' },
}));

const branchSession = {
  userId: 'user-bm',
  email: 'bm@mbumah.co.ke',
  role: 'BRANCH_MANAGER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as const;

const orgSession = {
  userId: 'user-owner',
  email: 'owner@mbumah.co.ke',
  role: 'STORE_OWNER',
  storeId: null,
  organizationId: 'org-1',
} as const;

describe('report scoping', () => {
  it('maps roles to scopes (fail-closed)', () => {
    expect(resolveReportScope(orgSession)).toBe('ORG');
    expect(resolveReportScope(branchSession)).toBe('BRANCH');
    expect(resolveReportScope({ ...branchSession, role: 'CASHIER' } as never)).toBeNull();
    expect(resolveReportScope({ ...branchSession, role: 'BRANCH_MANAGER', storeId: null } as never)).toBeNull();
  });
});

describe('headcount report', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates statuses, hires/exits, and per-branch counts by NAME', async () => {
    db.employee.findMany.mockResolvedValue([
      { status: 'ACTIVE', hireDate: new Date('2024-01-01'), terminationDate: null },
      { status: 'ON_LEAVE', hireDate: new Date('2024-02-01'), terminationDate: null },
      { status: 'ACTIVE', hireDate: new Date('2020-01-01'), terminationDate: null },
    ]);
    db.employee.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    db.employee.groupBy
      .mockResolvedValueOnce([{ employmentType: 'PERMANENT', _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ storeId: 'store-1', _count: { _all: 3 } }]);
    db.store.findMany.mockResolvedValue([{ id: 'store-1', name: 'Juja Main' }]);

    const report = await headcountReport(branchSession, parsePeriod('2026-01-01', '2026-06-30'));
    expect(report?.active).toBe(2);
    expect(report?.onLeave).toBe(1);
    expect(report?.byStore[0].storeName).toBe('Juja Main');
    const json = JSON.stringify(report);
    expect(json).not.toContain('store-1'); // no raw ids in payload
  });

  it('scopes branch managers to their store', async () => {
    db.employee.findMany.mockResolvedValue([]);
    db.employee.count.mockResolvedValue(0);
    await headcountReport(branchSession, parsePeriod());
    const where = db.employee.findMany.mock.calls[0][0].where;
    expect(where.storeId).toBe('store-1');
  });
});

describe('employment cost report', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sums gross + employer statutory (NSSF + AHL match) from stored lines', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      {
        grossPay: new Prisma.Decimal(100000),
        netPay: new Prisma.Decimal(70000),
        totalDeductions: new Prisma.Decimal(30000),
        nssf: new Prisma.Decimal(2160),
        housingLevy: new Prisma.Decimal(1500),
        payrollRun: { payrollPeriod: { startDate: new Date('2026-01-01'), name: 'January 2026' } },
      },
      {
        grossPay: new Prisma.Decimal(50000),
        netPay: new Prisma.Decimal(35000),
        totalDeductions: new Prisma.Decimal(15000),
        nssf: new Prisma.Decimal(1080),
        housingLevy: new Prisma.Decimal(750),
        payrollRun: { payrollPeriod: { startDate: new Date('2026-01-01'), name: 'January 2026' } },
      },
    ]);

    const report = await employmentCostReport(orgSession, parsePeriod('2026-01-01', '2026-12-31'));
    expect(report?.totalGross).toBe(150000);
    // Employer match = (2160+1500) + (1080+750) = 5490
    expect(report?.totalEmployerStatutory).toBe(5490);
    expect(report?.totalCost).toBe(155490);
    expect(report?.monthly).toHaveLength(1);
    expect(report?.monthly[0].totalCost).toBe(155490);
  });
});

describe('P10 from stored lines', () => {
  const line = (employeeCode: string, overrides: Record<string, unknown> = {}) => ({
    grossPay: new Prisma.Decimal(100000),
    netPay: new Prisma.Decimal(70000),
    paye: new Prisma.Decimal(12000),
    nssf: new Prisma.Decimal(2160),
    nhif: new Prisma.Decimal(1700),
    housingLevy: new Prisma.Decimal(1500),
    payeArrears: new Prisma.Decimal(0),
    payrollRunId: 'run-1',
    employee: { employeeCode, employmentType: 'PERMANENT' },
    ...overrides,
  });

  beforeEach(() => vi.clearAllMocks());

  it('groups posted lines by employeeCode and sums stored figures only', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      line('MBM-JUJ-E001'),
      line('MBM-JUJ-E001', { payrollRunId: 'run-2' }),
      line('MBM-JUJ-E002', { employee: { employeeCode: 'MBM-JUJ-E002', employmentType: 'CASUAL' } }),
    ]);

    const p10 = await buildP10(orgSession, 2026);
    expect(p10?.rows).toHaveLength(2);
    const e1 = p10?.rows.find((r) => r.employeeCode === 'MBM-JUJ-E001');
    expect(e1?.months).toBe(2);
    expect(e1?.grossPay).toBe(200000);
    expect(e1?.paye).toBe(24000);
    expect(p10?.totals.grossPay).toBe(300000);
    expect(p10?.sourceRuns).toBe(2);
  });

  it('produces a CSV with a TOTAL row and no names/ids', async () => {
    db.payrollDetail.findMany.mockResolvedValue([line('MBM-JUJ-E001')]);
    const p10 = (await buildP10(orgSession, 2026))!;
    const csv = p10ToCSV(p10);
    expect(csv.split('\r\n')[0]).toContain('Employee Code');
    expect(csv).toContain('TOTAL');
    expect(csv).not.toContain('Otieno');
  });

  it('reads only POSTED/LOCKED runs of the requested year', async () => {
    db.payrollDetail.findMany.mockResolvedValue([]);
    await buildP10(orgSession, 2025);
    const where = db.payrollDetail.findMany.mock.calls[0][0].where;
    expect(where.payrollRun.status['in']).toEqual(['POSTED', 'LOCKED']);
    expect(where.payrollRun.payrollPeriod.startDate.gte).toEqual(new Date(Date.UTC(2025, 0, 1)));
    expect(where.payrollRun.payrollPeriod.startDate.lt).toEqual(new Date(Date.UTC(2026, 0, 1)));
  });
});

describe('org console HR summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes tiles: headcount, month cost, absence rate, payroll status, expiry alerts', async () => {
    db.employee.count.mockResolvedValue(12);
    db.payrollDetail.findMany.mockResolvedValue([
      { grossPay: new Prisma.Decimal(100000), nssf: new Prisma.Decimal(2160), housingLevy: new Prisma.Decimal(1500) },
    ]);
    db.attendanceRecord.groupBy.mockResolvedValue([
      { status: 'PRESENT', _count: { _all: 200 } },
      { status: 'ABSENT', _count: { _all: 10 } },
    ]);
    db.employeeDocument.count.mockResolvedValue(3);
    db.assetAssignment.count.mockResolvedValue(2);
    db.payrollRun.findFirst.mockResolvedValue({
      status: 'POSTED',
      createdAt: new Date('2026-10-01'),
      payrollPeriod: { name: 'October 2026' },
    });

    const summary = await hrSummaryForOrgConsole(orgSession);
    expect(summary?.headcountActive).toBe(12);
    expect(summary?.monthEmploymentCost).toBe(103660);
    expect(summary?.monthAbsenceRatePct).toBe(4.8); // 10/210
    expect(summary?.latestPayroll?.status).toBe('POSTED');
    expect(summary?.expiryAlerts).toEqual({ documentsExpiring90Days: 3, assetsOverdue: 2 });
  });
});
