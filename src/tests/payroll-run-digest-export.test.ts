// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  payrollRunExportDecision,
  buildRunDigestExport,
} from '@/lib/hr/payroll/run-service';
import { payrollRunDigestToCsv } from '@/lib/hr/payroll/run-digest';

/**
 * v2.53.0: the run's filing file, on demand — GET /api/payroll/runs/[id]/digest-csv.
 *
 * Three layers:
 *   1. PURE gate: payrollRunExportDecision — APPROVED files the approval
 *      variant, POSTED/LOCKED file the posted variant, everything earlier
 *      (draft, pending approval, rejected, voided, failed) refuses honestly.
 *   2. Service seam: buildRunDigestExport — per-employee rows from
 *      PayrollDetail (names + codes + money), approver/poster label
 *      fallback ladders, payslip-range stamping on the posted variant,
 *      null for an empty run (the route turns that into a 404).
 *   3. Builder parity: the SAME payrollRunDigestToCsv the approval (v2.47.0)
 *      and posting (v2.48.0) emails use — filenames, CRLF framing and the
 *      formula-injection guard are inherited, never re-implemented.
 */

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    payrollRun: model(),
    payrollPeriod: model(),
    payrollDetail: model(),
    store: model(),
    user: model(),
    notification: model(),
  };
});

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/audit-trail', () => ({ auditTrail: { log: vi.fn().mockResolvedValue('audit-id') } }));
vi.mock('@/lib/accounting-helpers', () => ({ createJournalEntry: vi.fn() }));
vi.mock('@/lib/hr/attendance-service', () => ({ hasUnapprovedTimesheet: vi.fn() }));
vi.mock('@/lib/sequence', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, nextSequence: vi.fn(async () => 1) };
});
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' }) }));

/** Non-null helper that keeps the lint baseline clean (no `!` assertions). */
function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('unexpected null in test');
  return value;
}

const NOW = new Date('2026-10-17T08:30:00.000Z');

const RUN = {
  id: 'run-1',
  runType: 'REGULAR',
  status: 'POSTED',
  approvedByUserId: 'user-owner-1',
  approvedAt: new Date('2026-10-16T09:00:00.000Z'),
  postedByUserId: 'user-owner-1',
  postedAt: new Date('2026-10-16T10:00:00.000Z'),
  totalGross: 258000,
  totalDeductions: 60227.4,
  totalNet: 197772.6,
  employeeCount: 5,
};

const DETAILS = [
  {
    grossPay: 100000,
    totalDeductions: 24305,
    netPay: 75695,
    payslipNumber: 'PS-20261016-0001',
    employee: { firstName: 'Grace', lastName: 'Wanjiku', employeeCode: 'MBM-JUJ-E001' },
  },
  {
    grossPay: 85000,
    totalDeductions: 18000.5,
    netPay: 66999.5,
    payslipNumber: 'PS-20261016-0002',
    employee: { firstName: 'David', lastName: 'Otieno', employeeCode: null },
  },
];

describe('payrollRunExportDecision (pure status gate)', () => {
  it('APPROVED files the approval variant', () => {
    const d = payrollRunExportDecision('APPROVED');
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.variant).toBe('approval');
  });

  it('POSTED and LOCKED file the posted variant', () => {
    for (const status of ['POSTED', 'LOCKED']) {
      const d = payrollRunExportDecision(status);
      expect(d.ok).toBe(true);
      if (d.ok) expect(d.variant).toBe('posted');
    }
  });

  it('PENDING_APPROVAL refuses: nobody approved yet, an approval label would lie', () => {
    const d = payrollRunExportDecision('PENDING_APPROVAL');
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.status).toBe(400);
      expect(d.code).toBe('RUN_NOT_EXPORTABLE');
      expect(d.error).toContain('from approval onward');
    }
  });

  it('off-lifecycle statuses refuse honestly (draft / rejected / voided / failed)', () => {
    for (const status of ['DRAFT', 'REJECTED', 'VOIDED', 'FAILED']) {
      const d = payrollRunExportDecision(status);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe('RUN_NOT_EXPORTABLE');
    }
  });

  it('the refusal copy never names a downloadable file', () => {
    const d = payrollRunExportDecision('DRAFT');
    if (!d.ok) expect(d.error).not.toMatch(/\.csv/i);
  });
});

describe('buildRunDigestExport (service seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payrollDetail.findMany.mockResolvedValue([]);
    db.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'user-owner-1') return { name: 'System Administrator', email: 'admin@mbumahhardware.co.ke' };
      return null;
    });
  });

  it('maps PayrollDetail rows to per-employee digest rows (names, codes, money)', async () => {
    db.payrollDetail.findMany.mockResolvedValue(DETAILS);
    const csv = await buildRunDigestExport({ run: RUN, periodName: 'October 2026', storeName: 'Juja Main', now: NOW });
    expect(csv).not.toBeNull();
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Grace Wanjiku');
    expect(text).toContain('MBM-JUJ-E001');
    expect(text).toContain('David Otieno');
    expect(text).toContain('75695.00'); // csvMoney: fixed two decimals (grouping is the email's job)
  });

  it('an employee without a name falls back honestly, a null code ships empty', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      {
        grossPay: 1000,
        totalDeductions: 0,
        netPay: 1000,
        payslipNumber: null,
        employee: { firstName: '', lastName: '', employeeCode: null },
      },
    ]);
    const csv = await buildRunDigestExport({ run: RUN, periodName: 'October 2026', storeName: 'Juja Main', now: NOW });
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Unnamed employee');
  });

  it('the approver label resolves name → email → "Approver" (approval variant)', async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.payrollDetail.findMany.mockResolvedValue(DETAILS);
    const csv = await buildRunDigestExport({
      run: { ...RUN, status: 'APPROVED' },
      periodName: 'October 2026',
      storeName: 'Juja Main',
      now: NOW,
    });
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Approved by,Approver');
  });

  it('the posted variant stamps poster label, posted time and the payslip range', async () => {
    db.payrollDetail.findMany.mockResolvedValue(DETAILS);
    const csv = await buildRunDigestExport({ run: RUN, periodName: 'October 2026', storeName: 'Juja Main', now: NOW });
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Payroll posting summary');
    expect(text).toContain('Posted by,System Administrator');
    expect(text).toContain('Payslips issued,2 (PS-20261016-0001 - PS-20261016-0002)');
    expect(need(csv).filename).toContain('-posted');
  });

  it('the approval variant carries no payslip range and no -posted suffix', async () => {
    db.payrollDetail.findMany.mockResolvedValue(DETAILS);
    const csv = await buildRunDigestExport({
      run: { ...RUN, status: 'APPROVED' },
      periodName: 'October 2026',
      storeName: 'Juja Main',
      now: NOW,
    });
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Payroll approval summary');
    expect(text).not.toContain('Payslips issued');
    expect(need(csv).filename).not.toContain('-posted');
  });

  it('a single payslip range prints one number, not a dash pair', async () => {
    db.payrollDetail.findMany.mockResolvedValue([DETAILS[0]]);
    const csv = await buildRunDigestExport({ run: RUN, periodName: 'October 2026', storeName: 'Juja Main', now: NOW });
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Payslips issued,1 (PS-20261016-0001)');
  });

  it('an empty run returns null (the route answers with an honest 404)', async () => {
    db.payrollDetail.findMany.mockResolvedValue([]);
    const csv = await buildRunDigestExport({
      run: { ...RUN, totalGross: 0, totalDeductions: 0, totalNet: 0, employeeCount: 0 },
      periodName: 'October 2026',
      storeName: 'Juja Main',
      now: NOW,
    });
    expect(csv).toBeNull();
  });

  it('an off-lifecycle run never reaches the database', async () => {
    const csv = await buildRunDigestExport({
      run: { ...RUN, status: 'DRAFT' },
      periodName: 'October 2026',
      storeName: 'Juja Main',
      now: NOW,
    });
    expect(csv).toBeNull();
    expect(db.payrollDetail.findMany).not.toHaveBeenCalled();
  });

  it('rows are ordered by payslip number (deterministic filing order)', async () => {
    db.payrollDetail.findMany.mockResolvedValue([...DETAILS].reverse());
    await buildRunDigestExport({ run: RUN, periodName: 'October 2026', storeName: 'Juja Main', now: NOW });
    expect(need(db.payrollDetail.findMany.mock.calls[0]?.[0]).orderBy).toEqual([
      { payslipNumber: 'asc' },
      { employeeId: 'asc' },
    ]);
  });
});

describe('builder parity with the digest emails', () => {
  it('the route serves exactly what payrollRunDigestToCsv builds (CRLF framing, guarded cells)', () => {
    const csv = payrollRunDigestToCsv(
      [
        {
          employeeName: '=cmd|matrix!A1',
          employeeCode: 'MBM-JUJ-E001',
          gross: 1000,
          deductions: 0,
          net: 1000,
        },
      ],
      {
        periodName: 'October 2026',
        storeName: 'Juja Main',
        runType: 'REGULAR',
        employeeCount: 1,
        totalGross: 1000,
        totalDeductions: 0,
        totalNet: 1000,
        approvedByLabel: 'System Administrator',
        approvedAtIso: '2026-10-16T09:00:00.000Z',
      },
      NOW,
      'approval',
    );
    expect(csv).not.toBeNull();
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text.includes('\r\n')).toBe(true);
    // Formula-injection guard inherited from digest-csv: a hostile name is
    // neutralised with the leading apostrophe.
    expect(text).toContain("'=cmd|matrix!A1");
    expect(need(csv).filename).toBe('mbumah-payroll-october-2026-regular.csv');
  });
});
