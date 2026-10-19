import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  approvePayrollRun,
  createPayrollRun,
  decidePayrollCorrection,
  disbursePayrollRun,
  lockPayrollRun,
  postPayrollRun,
  preparePayrollRun,
  rejectPayrollRun,
  requestPayrollCorrection,
  submitPayrollRun,
  PayrollLifecycleError,
} from '@/lib/hr/payroll/run-service';
import { computePayslip } from '@/lib/hr/payroll/engine';
import { createJournalEntry } from '@/lib/accounting-helpers';
import { hasUnapprovedTimesheet } from '@/lib/hr/attendance-service';

/**
 * Phase 4.6 contracts (v2.18.9): run state machine, maker-checker, gate
 * blocking (timesheet + consent), idempotent balanced posting, payslip
 * issuance, and reverse-and-replace corrections.
 */

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn(),
  });
  const payrollRun = { ...model(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
  const payrollPeriod = model();
  const payrollDetail = model();
  const rateTable = model();
  const employee = model();
  const consentRecord = model();
  const attendanceRecord = model();
  const salaryStructure = model();
  const leaveRequest = model();
  const account = model();
  const payrollCorrection = model();
  const base = {
    payrollRun,
    payrollPeriod,
    payrollDetail,
    rateTable,
    employee,
    consentRecord,
    attendanceRecord,
    salaryStructure,
    leaveRequest,
    account,
    payrollCorrection,
    // v2.138.0: the verdict trail — prepare appends one row per attempt.
    payrollRunGateEvent: model(),
  };
  // $transaction receives the same shape so tx.* assertions observe the calls.
  Object.assign(base, {
    $transaction: vi.fn(async (fn: (tx: typeof base) => Promise<unknown>) => fn(base)),
  });
  return base;
});

vi.mock('@/lib/db', () => ({
  db,
  // Pass-through: tests exercise the logic, not the AsyncLocalStorage guard.
  // Signature matches db.ts: withImmutabilityBypass(fn, reason?).
  withImmutabilityBypass:
    <T,>(fn: () => Promise<T>, _reason?: string): Promise<T> =>
      fn(),
}));
vi.mock('@/lib/audit-trail', () => ({
  auditTrail: { log: vi.fn().mockResolvedValue('audit-id') },
}));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/accounting-helpers', () => ({
  createJournalEntry: vi.fn(),
}));
vi.mock('@/lib/hr/attendance-service', () => ({
  hasUnapprovedTimesheet: vi.fn(),
}));

vi.mock('@/lib/sequence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sequence')>();
  let seq = 1;
  return {
    ...actual,
    nextSequence: vi.fn(async () => seq++),
  };
});

const CTX = { storeId: 'store-1', organizationId: 'org-1', actorId: 'user-1' };

const PERIOD = {
  id: 'period-1',
  storeId: 'store-1',
  name: 'January 2026',
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-01-31T23:59:59Z'),
  payDate: new Date('2026-02-01T00:00:00Z'),
  status: 'DRAFT',
};

function runFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    payrollPeriodId: 'period-1',
    storeId: 'store-1',
    runType: 'REGULAR',
    status: 'DRAFT',
    initiatedBy: 'user-1',
    preparedByUserId: null,
    submittedById: null,
    approvedByUserId: null,
    rejectedByUserId: null,
    rejectionReason: null,
    postedAt: null,
    journalEntryId: null,
    idempotencyKey: null,
    employeeCount: 0,
    totalGross: 0,
    totalDeductions: 0,
    totalNet: 0,
    errorMessage: null,
    payrollPeriod: PERIOD,
    ...overrides,
  };
}

const RATE_TABLES = [
  {
    id: 'rt-paye',
    type: 'PAYE',
    code: 'PAYE-2026',
    label: 'PAYE bands 2026',
    basis: 'MONTHLY',
    effectiveFrom: new Date('2025-12-01T00:00:00Z'),
    effectiveTo: null,
    rows: [
      { order: 1, lowerBoundCents: 0, upperBoundCents: 2_400_000, rateBps: 1_000, flatAmountCents: null, reliefCents: null, employerMatchBps: null },
      { order: 2, lowerBoundCents: 2_400_000, upperBoundCents: null, rateBps: 2_500, flatAmountCents: null, reliefCents: null, employerMatchBps: null },
    ],
  },
  {
    id: 'rt-relief',
    type: 'PERSONAL_RELIEF',
    code: 'RELIEF-2026',
    label: 'Personal relief',
    basis: 'MONTHLY',
    effectiveFrom: new Date('2025-12-01T00:00:00Z'),
    effectiveTo: null,
    rows: [
      { order: 1, lowerBoundCents: 0, upperBoundCents: null, rateBps: null, flatAmountCents: null, reliefCents: 240_000, employerMatchBps: null },
    ],
  },
  {
    id: 'rt-nssf1',
    type: 'NSSF_TIER1',
    code: 'NSSF-T1',
    label: 'NSSF Tier I',
    basis: 'MONTHLY',
    effectiveFrom: new Date('2025-12-01T00:00:00Z'),
    effectiveTo: null,
    rows: [
      { order: 1, lowerBoundCents: 0, upperBoundCents: 800_000, rateBps: 600, flatAmountCents: null, reliefCents: null, employerMatchBps: 600 },
    ],
  },
  {
    id: 'rt-nssf2',
    type: 'NSSF_TIER2',
    code: 'NSSF-T2',
    label: 'NSSF Tier II',
    basis: 'MONTHLY',
    effectiveFrom: new Date('2025-12-01T00:00:00Z'),
    effectiveTo: null,
    rows: [
      { order: 1, lowerBoundCents: 800_000, upperBoundCents: 7_200_000, rateBps: 600, flatAmountCents: null, reliefCents: null, employerMatchBps: 600 },
    ],
  },
  {
    id: 'rt-shif',
    type: 'SHIF',
    code: 'SHIF-2026',
    label: 'SHIF',
    basis: 'MONTHLY',
    effectiveFrom: new Date('2025-12-01T00:00:00Z'),
    effectiveTo: null,
    rows: [
      { order: 1, lowerBoundCents: 0, upperBoundCents: null, rateBps: 250, flatAmountCents: 30_000, reliefCents: null, employerMatchBps: null },
    ],
  },
  {
    id: 'rt-ahl',
    type: 'HOUSING_LEVY',
    code: 'AHL-2026',
    label: 'Housing levy',
    basis: 'MONTHLY',
    effectiveFrom: new Date('2025-12-01T00:00:00Z'),
    effectiveTo: null,
    rows: [
      { order: 1, lowerBoundCents: 0, upperBoundCents: null, rateBps: 150, flatAmountCents: null, reliefCents: null, employerMatchBps: 150 },
    ],
  },
];

const EMPLOYEE = {
  id: 'emp-1',
  storeId: 'store-1',
  employeeNo: 'EMP-001',
  firstName: 'Jane',
  lastName: 'Wanjiku',
  status: 'ACTIVE',
  deletedAt: null,
  basicSalary: '20000', // KES → 2,000,000 cents
  hourlyRate: null,
};

function seedHappyPrepare() {
  db.payrollRun.findFirst.mockResolvedValue(runFixture());
  db.rateTable.findMany.mockResolvedValue(RATE_TABLES);
  db.employee.findMany.mockResolvedValue([EMPLOYEE]);
  db.consentRecord.findFirst.mockResolvedValue({ id: 'consent-1' });
  (hasUnapprovedTimesheet as ReturnType<typeof vi.fn>).mockResolvedValue(false);
  db.salaryStructure.findFirst.mockResolvedValue(null);
  db.attendanceRecord.findMany.mockResolvedValue([]);
  db.leaveRequest.findMany.mockResolvedValue([]);
  db.payrollDetail.create.mockResolvedValue({});
}

describe('run creation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a second active run for the same period and type', async () => {
    db.payrollPeriod.findFirst.mockResolvedValue(PERIOD);
    db.payrollRun.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      createPayrollRun(CTX, { payrollPeriodId: 'period-1' }),
    ).rejects.toMatchObject({ code: 'RUN_ALREADY_EXISTS' });
  });

  it('replays by idempotency key without creating a second run', async () => {
    const existing = runFixture({ idempotencyKey: 'ext-key-1' });
    db.payrollRun.findUnique.mockResolvedValue(existing);
    const { run, replay } = await createPayrollRun(CTX, {
      payrollPeriodId: 'period-1',
      idempotencyKey: 'ext-key-1',
    });
    expect(replay).toBe(true);
    expect(run.id).toBe('run-1');
    expect(db.payrollRun.create).not.toHaveBeenCalled();
  });
});

describe('state machine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses submit with zero payslips (must prepare first)', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ employeeCount: 0 }));
    await expect(submitPayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'NOT_PREPARED' });
  });

  it('captures the submitter on the handover (v2.85.0: its own columns)', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ employeeCount: 3 }));
    db.payrollRun.update.mockResolvedValue(runFixture({ status: 'PENDING_APPROVAL' }));
    const updated = await submitPayrollRun(CTX, 'run-1');
    expect(updated.status).toBe('PENDING_APPROVAL');
    expect(db.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_APPROVAL',
          submittedById: 'user-1',
          submittedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('the handover no longer borrows the Prepared stamp (v2.85.0 split)', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ employeeCount: 3 }));
    db.payrollRun.update.mockResolvedValue(runFixture({ status: 'PENDING_APPROVAL' }));
    await submitPayrollRun(CTX, 'run-1');
    const data = (db.payrollRun.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(data).not.toHaveProperty('preparedByUserId');
    expect(data).not.toHaveProperty('preparedAt');
  });

  it('blocks approval from DRAFT (state machine)', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'DRAFT' }));
    await expect(approvePayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('enforces maker-checker: the preparer cannot approve', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'PENDING_APPROVAL', preparedByUserId: 'user-1' }));
    await expect(approvePayrollRun(CTX, 'run-1')).rejects.toMatchObject({
      code: 'MAKER_CHECKER_VIOLATION',
      status: 403,
    });
  });

  it('maker-checker binds the submitter too — the handover is the boundary (v2.85.0)', async () => {
    db.payrollRun.findFirst.mockResolvedValue(
      runFixture({ status: 'PENDING_APPROVAL', preparedByUserId: 'user-2', submittedById: 'user-1' }),
    );
    await expect(approvePayrollRun(CTX, 'run-1')).rejects.toMatchObject({
      code: 'MAKER_CHECKER_VIOLATION',
      status: 403,
    });
  });

  it('a different approver can approve the submitted run', async () => {
    db.payrollRun.findFirst.mockResolvedValue(
      runFixture({ status: 'PENDING_APPROVAL', preparedByUserId: 'user-1' }),
    );
    db.payrollRun.update.mockResolvedValue(runFixture({ status: 'APPROVED', approvedByUserId: 'user-2' }));
    // v2.47.0: approvePayrollRun returns { run, digest } — the digest fan-out
    // is best-effort (this mock has no store/user/notification models, so it
    // resolves null via the catch) and must never fail the approval itself.
    const { run: updated, digest } = await approvePayrollRun({ ...CTX, actorId: 'user-2' }, 'run-1');
    expect(updated.status).toBe('APPROVED');
    expect(digest).toBeNull();
  });

  it('requires a rejection reason of at least 10 characters', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'PENDING_APPROVAL' }));
    await expect(rejectPayrollRun(CTX, 'run-1', 'too short')).rejects.toMatchObject({
      code: 'MISSING_REJECTION_REASON',
    });
  });

  it('lock only from POSTED; VOIDED is terminal', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'APPROVED' }));
    await expect(lockPayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'VOIDED' }));
    await expect(approvePayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('disburse only from POSTED or LOCKED', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'DRAFT' }));
    await expect(disbursePayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('prepare gates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks on unapproved timesheets with a per-employee reason code', async () => {
    seedHappyPrepare();
    (hasUnapprovedTimesheet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await expect(preparePayrollRun(CTX, 'run-1')).rejects.toMatchObject({
      code: 'PAYROLL_GATES_FAILED',
      status: 422,
    });
    try {
      await preparePayrollRun(CTX, 'run-1');
    } catch (error) {
      const lifecycle = error as PayrollLifecycleError;
      expect(lifecycle.issues?.[0]).toMatchObject({
        code: 'TIMESHEET_NOT_APPROVED',
        employeeName: 'Jane Wanjiku',
      });
    }
  });

  it('blocks on missing consent', async () => {
    seedHappyPrepare();
    db.consentRecord.findFirst.mockResolvedValue(null);
    await expect(preparePayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'PAYROLL_GATES_FAILED' });
  });

  it('blocks when a statutory rate table is missing', async () => {
    seedHappyPrepare();
    db.rateTable.findMany.mockResolvedValue(RATE_TABLES.filter((t) => t.type !== 'SHIF'));
    await expect(preparePayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'RATE_TABLE_MISSING' });
  });

  it('computes payslips through the engine and stores KES + integer-cent trace', async () => {
    seedHappyPrepare();
    const result = await preparePayrollRun(CTX, 'run-1');
    expect(result.prepared).toBe(1);
    // v2.85.0: the Prepared stamp lives with the compute step — the run row
    // records WHO calculated the payslips and WHEN, not at the later handover.
    expect(db.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ preparedByUserId: 'user-1', preparedAt: expect.any(Date) }),
      }),
    );

    const expected = computePayslip({
      employee: {
        employeeId: 'emp-1',
        employeeCode: 'EMP-001',
        fullName: 'Jane Wanjiku',
        basicSalaryCents: 2_000_000,
        houseAllowanceCents: 0,
        transportAllowanceCents: 0,
        medicalAllowanceCents: 0,
        otherAllowancesCents: 0,
        hourlyRateCents: null,
        payeExempt: false,
        nssfExempt: false,
        nhifExempt: false,
        housingExempt: false,
      },
      period: {
        periodYear: 2026,
        periodMonth: 1,
        workedDays: 0,
        standardWorkingDays: 23,
        overtime: [],
        casualDays: 0,
        casualDayRateCents: 0,
        commissionCents: 0,
        otherDeductionsCents: 0,
        unpaidLeaveDays: 0,
        nightAllowanceCents: 0,
      },
      rates: new Map(
        RATE_TABLES.map((t) => [
          t.type,
          {
            id: t.id,
            type: t.type,
            code: t.code,
            label: t.label,
            basis: t.basis,
            effectiveFrom: t.effectiveFrom.toISOString(),
            effectiveTo: null,
            rows: t.rows,
          },
        ]),
      ),
      consentGranted: true,
    });

    const createCall = db.payrollDetail.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.basicSalary).toBe(20000); // KES
    expect(createCall.data.netPay).toBe(Math.round(expected.netCents) / 100);
    expect(createCall.data.payslipNumber).toBeUndefined(); // numbers assigned at POST
    const trace = JSON.parse(createCall.data.computationTrace as string);
    expect(trace.netCents).toBe(expected.netCents);
    expect(trace.grossCents).toBe(expected.grossCents);

    // Run totals stored in KES, run stays DRAFT.
    expect(db.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeCount: 1, errorMessage: null }),
      }),
    );
  });
});

describe('posting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createJournalEntry as ReturnType<typeof vi.fn>).mockReset();
  });

  function seedPostedScenario() {
    const detail = {
      id: 'detail-1',
      employeeId: 'emp-1',
      computationTrace: JSON.stringify({
        earnings: [{ code: 'BASIC', label: 'Basic salary', amountCents: 2_000_000 }],
        deductions: [
          { code: 'NSSF_T1', label: 'NSSF Tier I', amountCents: 48_000 },
          { code: 'NSSF_T2', label: 'NSSF Tier II', amountCents: 72_000 },
          { code: 'SHIF', label: 'SHIF', amountCents: 50_000 },
          { code: 'AHL', label: 'AHL', amountCents: 30_000 },
          { code: 'PAYE', label: 'PAYE', amountCents: 100_000 },
        ],
        employerContributions: [
          { code: 'NSSF_T1_ER', label: 'NSSF ER', amountCents: 48_000 },
          { code: 'NSSF_T2_ER', label: 'NSSF ER', amountCents: 72_000 },
          { code: 'AHL_ER', label: 'AHL ER', amountCents: 30_000 },
        ],
        grossCents: 2_000_000,
        totalDeductionsCents: 300_000,
        netCents: 1_700_000,
        trace: [],
        rateTableIds: ['rt-paye'],
      }),
      payslipNumber: null,
      payslipIssuedAt: null,
    };
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'APPROVED' }));
    db.payrollDetail.findMany.mockResolvedValue([detail]);
    db.account.findMany.mockResolvedValue(
      ['5200', '5210', '5215', '2210', '2215', '2220', '2225', '2250', '2240'].map((code) => ({
        id: `acc-${code}`,
        code,
      })),
    );
    (createJournalEntry as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'je-1',
      entryNumber: 'JE-0001',
    });
    db.payrollDetail.update.mockResolvedValue({});
    db.payrollRun.update.mockResolvedValue(runFixture({ status: 'POSTED', journalEntryId: 'je-1' }));
    return detail;
  }

  it('posts one balanced, idempotently-keyed journal and issues payslip numbers', async () => {
    seedPostedScenario();
    const result = await postPayrollRun(CTX, 'run-1');
    expect(result.replay).toBe(false);
    expect(result.journalEntryId).toBe('je-1');

    const call = (createJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      idempotencyKey: string;
      lines: Array<{ debit: number; credit: number }>;
    };
    expect(call.idempotencyKey).toBe('payroll-run:run-1');
    const debit = call.lines.reduce((s, l) => s + l.debit, 0);
    const credit = call.lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
    // Debits: gross 20,000 + employer NSSF (480+720) + employer housing (300) KES.
    expect(debit).toBeCloseTo(20000 + (48_000 + 72_000 + 30_000) / 100, 2);

    // Payslip number issued in PS-YYYYMMDD-NNNN form.
    const slipUpdate = db.payrollDetail.update.mock.calls[0][0] as { data: { payslipNumber: string } };
    expect(slipUpdate.data.payslipNumber).toMatch(/^PS-\d{8}-\d{4}$/);

    // Replacement-linked corrections flip to APPLIED after posting.
    expect(db.payrollCorrection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { replacementRunId: 'run-1', status: 'APPROVED' } }),
    );
  });

  it('replay returns the same journal without creating a second entry', async () => {
    seedPostedScenario();
    db.payrollRun.findFirst.mockResolvedValue(runFixture({ status: 'POSTED', journalEntryId: 'je-1' }));
    const result = await postPayrollRun(CTX, 'run-1');
    expect(result.replay).toBe(true);
    expect(createJournalEntry).not.toHaveBeenCalled();
  });

  it('blocks when payroll accounts are missing from the chart of accounts', async () => {
    seedPostedScenario();
    db.account.findMany.mockResolvedValue([{ id: 'acc-5200', code: '5200' }]);
    await expect(postPayrollRun(CTX, 'run-1')).rejects.toMatchObject({ code: 'MISSING_CHART_ACCOUNT' });
    expect(createJournalEntry).not.toHaveBeenCalled();
  });
});

describe('corrections (reverse and replace)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (createJournalEntry as ReturnType<typeof vi.fn>).mockReset();
    // Guard against the run-creation describe's findUnique replay mock leaking.
    db.payrollRun.findUnique.mockResolvedValue(null);
  });

  const postedDetail = {
    id: 'detail-1',
    employeeId: 'emp-1',
    storeId: 'store-1',
    payslipNumber: 'PS-20260201-0001',
    netPay: '17000',
    computationTrace: JSON.stringify({
      earnings: [{ code: 'BASIC', label: 'Basic salary', amountCents: 2_000_000 }],
      deductions: [
        { code: 'NSSF_T1', label: 'NSSF Tier I', amountCents: 48_000 },
        { code: 'NSSF_T2', label: 'NSSF Tier II', amountCents: 72_000 },
        { code: 'SHIF', label: 'SHIF', amountCents: 50_000 },
        { code: 'AHL', label: 'AHL', amountCents: 30_000 },
        { code: 'PAYE', label: 'PAYE', amountCents: 100_000 },
      ],
      employerContributions: [
        { code: 'NSSF_T1_ER', label: 'NSSF ER', amountCents: 48_000 },
        { code: 'NSSF_T2_ER', label: 'NSSF ER', amountCents: 72_000 },
        { code: 'AHL_ER', label: 'AHL ER', amountCents: 30_000 },
      ],
      grossCents: 2_000_000,
      totalDeductionsCents: 300_000,
      netCents: 1_700_000,
      trace: [],
      rateTableIds: ['rt-paye'],
    }),
  };

  it('refuses corrections against a run that is not posted/locked', async () => {
    db.payrollDetail.findFirst.mockResolvedValue({
      ...postedDetail,
      payrollRun: { id: 'run-1', status: 'APPROVED' },
    });
    await expect(
      requestPayrollCorrection(CTX, {
        originalDetailId: 'detail-1',
        correctionType: 'UNDERPAYMENT',
        amountCents: 100_000,
        reason: 'Missed overtime hours on the 14th.',
      }),
    ).rejects.toMatchObject({ code: 'CORRECTION_TARGET_IMMUTABLE' });
  });

  it('refuses a second pending correction for the same payslip', async () => {
    db.payrollDetail.findFirst.mockResolvedValue({
      ...postedDetail,
      payrollRun: { id: 'run-1', status: 'POSTED' },
    });
    db.payrollCorrection.findFirst.mockResolvedValue({ id: 'pending-1' });
    await expect(
      requestPayrollCorrection(CTX, {
        originalDetailId: 'detail-1',
        correctionType: 'UNDERPAYMENT',
        amountCents: 100_000,
        reason: 'Missed overtime hours on the 14th.',
      }),
    ).rejects.toMatchObject({ code: 'CORRECTION_PENDING' });
  });

  it('maker-checker: the requester cannot decide their own correction', async () => {
    db.payrollCorrection.findFirst.mockResolvedValue({
      id: 'corr-1',
      storeId: 'store-1',
      status: 'PENDING',
      requestedByUserId: 'user-1',
      correctionType: 'REVERSAL',
      amountCents: 0,
      reason: 'Payslip issued for the wrong employee.',
      originalDetail: postedDetail,
      run: { id: 'run-1', payrollPeriodId: 'period-1', payrollPeriod: PERIOD },
    });
    await expect(
      decidePayrollCorrection(CTX, 'corr-1', 'APPROVED'),
    ).rejects.toMatchObject({ code: 'MAKER_CHECKER_VIOLATION' });
  });

  it('REVERSAL approval posts the swapped (balanced) journal lines', async () => {
    db.payrollCorrection.findFirst.mockResolvedValue({
      id: 'corr-1',
      storeId: 'store-1',
      status: 'PENDING',
      requestedByUserId: 'user-1',
      correctionType: 'REVERSAL',
      amountCents: 0,
      reason: 'Payslip issued for the wrong employee.',
      originalDetail: postedDetail,
      run: { id: 'run-1', payrollPeriodId: 'period-1', payrollPeriod: PERIOD },
    });
    db.account.findMany.mockResolvedValue(
      ['5200', '5210', '5215', '2210', '2215', '2220', '2225', '2250', '2240'].map((code) => ({
        id: `acc-${code}`,
        code,
      })),
    );
    (createJournalEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'je-9', entryNumber: 'JE-9' });
    db.payrollCorrection.update.mockResolvedValue({ id: 'corr-1', status: 'APPLIED' });

    const updated = await decidePayrollCorrection({ ...CTX, actorId: 'user-2' }, 'corr-1', 'APPROVED');
    expect(updated.status).toBe('APPLIED');

    const call = (createJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      idempotencyKey: string;
      lines: Array<{ debit: number; credit: number }>;
    };
    expect(call.idempotencyKey).toBe('payroll-correction:corr-1');
    const debit = call.lines.reduce((s, l) => s + l.debit, 0);
    const credit = call.lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
    // Reversal debits what the original credited (net payable 17,000 KES among them).
    expect(debit).toBeCloseTo(20000 + (48_000 + 72_000 + 30_000) / 100, 2);
  });

  it('UNDERPAYMENT approval posts the delta and opens a replacement run', async () => {
    db.payrollCorrection.findFirst.mockResolvedValue({
      id: 'corr-2',
      storeId: 'store-1',
      status: 'PENDING',
      requestedByUserId: 'user-1',
      correctionType: 'UNDERPAYMENT',
      amountCents: 125_000,
      reason: 'Missed 6 weekend overtime hours on the 14th.',
      originalDetail: postedDetail,
      run: { id: 'run-1', payrollPeriodId: 'period-1', payrollPeriod: PERIOD },
    });
    db.account.findFirst.mockResolvedValue({ id: 'acc-x' });
    (createJournalEntry as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'je-10', entryNumber: 'JE-10' });
    db.payrollPeriod.findFirst.mockResolvedValue(PERIOD);
    db.payrollRun.findFirst.mockResolvedValue(null); // no duplicate supplementary run
    db.payrollRun.create.mockResolvedValue({ id: 'run-replacement' });
    db.payrollCorrection.update.mockResolvedValue({ id: 'corr-2', status: 'APPROVED' });

    const updated = await decidePayrollCorrection({ ...CTX, actorId: 'user-2' }, 'corr-2', 'APPROVED');
    expect(updated.status).toBe('APPROVED');

    const jeCall = (createJournalEntry as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      idempotencyKey: string;
      lines: Array<{ debit: number; credit: number }>;
    };
    expect(jeCall.idempotencyKey).toBe('payroll-correction:corr-2');
    expect(jeCall.lines.reduce((s, l) => s + l.debit, 0)).toBeCloseTo(1250, 2);

    const runCreate = db.payrollRun.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(runCreate.data.runType).toBe('SUPPLEMENTARY');
    expect(runCreate.data.idempotencyKey).toBe('payroll-correction-replacement:corr-2');
  });
});
