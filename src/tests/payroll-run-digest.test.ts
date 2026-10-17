// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYROLL_APPROVED_METADATA_MARKER,
  formatKesMoney,
  formatApprovedStamp,
  payrollRunApprovalCopy,
  payrollRunDigestToCsv,
  type PayrollRunDigestEmployeeRow,
  type PayrollRunDigestMeta,
} from '@/lib/hr/payroll/run-digest';
import { notifyPayrollRunApproved } from '@/lib/hr/payroll/run-service';

/**
 * v2.47.0: payroll-run APPROVAL digest — copy builder + per-employee CSV
 * attachment (the v2.46.0 attachment machinery pointed at the run ledger).
 *
 * Two layers:
 *   1. PURE module (this file, DOM env fine): copy, CSV, money/stamp
 *      formatting, injection guard, filename slugs, empty-run null.
 *   2. Service seams (node env file): recipient resolution, email payload,
 *      in-app rows, fail-soft guarantee.
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
    count: vi.fn(),
  });
  const base = {
    payrollRun: model(),
    payrollPeriod: model(),
    payrollDetail: model(),
    store: model(),
    user: model(),
    notification: model(),
  };
  return base;
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
const sendEmailMock = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' }));
vi.mock('@/lib/email-service', () => ({ sendEmail: sendEmailMock }));

/** Non-null helper that keeps the lint baseline clean (no `!` assertions). */
function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('unexpected null in test');
  return value;
}

const META: PayrollRunDigestMeta = {
  periodName: 'October 2026',
  storeName: 'MBUMAH HARDWARE - Juja Main',
  runType: 'REGULAR',
  employeeCount: 4,
  totalGross: 345000,
  totalDeductions: 51650.5,
  totalNet: 293349.5,
  approvedByLabel: 'Grace Wanjiku',
  approvedAtIso: '2026-10-17T08:52:00.000Z',
};

const ROWS: PayrollRunDigestEmployeeRow[] = [
  { employeeName: 'David Otieno', employeeCode: 'MBM-JUJ-E001', gross: 100000, deductions: 15000, net: 85000 },
  { employeeName: 'Grace Achieng', employeeCode: 'MBM-JUJ-E002', gross: 90000, deductions: 13500, net: 76500 },
];

describe('formatKesMoney', () => {
  it('groups thousands deterministically with 2 decimals', () => {
    expect(formatKesMoney(345000)).toBe('Ksh 345,000.00');
    expect(formatKesMoney(293349.5)).toBe('Ksh 293,349.50');
    expect(formatKesMoney(0)).toBe('Ksh 0.00');
  });

  it('keeps negatives readable and tolerates non-finite input', () => {
    expect(formatKesMoney(-1234.5)).toBe('Ksh -1,234.50');
    expect(formatKesMoney(Number.NaN)).toBe('Ksh 0.00');
  });
});

describe('formatApprovedStamp', () => {
  it('renders a UTC stamp from an ISO string', () => {
    expect(formatApprovedStamp('2026-10-17T08:52:00.000Z')).toBe('2026-10-17 08:52 UTC');
  });

  it('passes through garbage rather than throwing', () => {
    expect(formatApprovedStamp('not-a-date')).toBe('not-a-date');
  });
});

describe('payrollRunApprovalCopy', () => {
  it('carries the same headline numbers in every channel', () => {
    const copy = payrollRunApprovalCopy(META);
    expect(copy.title).toBe('Payroll approved — October 2026');
    expect(copy.message).toContain('4 employee(s)');
    expect(copy.message).toContain('Net Ksh 293,349.50');
    expect(copy.message).toContain('Grace Wanjiku');
    expect(copy.emailSubject).toContain('October 2026');
    expect(copy.emailSubject).toContain('MBUMAH HARDWARE - Juja Main');
    expect(copy.emailSubject).toContain('Ksh 293,349.50 net');
    expect(copy.emailText).toContain('Gross: Ksh 345,000.00');
    expect(copy.emailText).toContain('Net: Ksh 293,349.50');
    expect(copy.emailHtml).toContain('Payroll approved — October 2026');
    expect(copy.emailHtml).toContain('Ksh 345,000.00');
  });

  it('names the next step (post, then disburse) in text and HTML', () => {
    const copy = payrollRunApprovalCopy(META);
    expect(copy.emailText).toContain('post the run');
    expect(copy.emailHtml).toContain('post the run');
  });

  it('states the privacy contract (no national IDs, bank details or line items)', () => {
    const copy = payrollRunApprovalCopy(META);
    expect(copy.emailText).toContain('never contains national IDs');
    expect(copy.emailHtml).toContain('never contains national IDs');
  });

  it('escapes hostile meta values in the HTML subject surface', () => {
    const copy = payrollRunApprovalCopy({
      ...META,
      storeName: 'Store <script>alert("x")</script>',
      approvedByLabel: "Bob & <b>Co</b>",
    });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
    expect(copy.emailHtml).toContain('Bob &amp; &lt;b&gt;Co&lt;/b&gt;');
  });

  it('stays INFO/NORMAL (quiet bell rows; failures escalate in the feed mapper)', () => {
    const copy = payrollRunApprovalCopy(META);
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });
});

describe('payrollRunDigestToCsv', () => {
  const at = new Date('2026-10-17T08:52:00.000Z');

  it('builds header block, summary and per-employee rows', () => {
    const csv = need(payrollRunDigestToCsv(ROWS, META, at));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('Report,Payroll approval summary');
    expect(text).toContain('Organization,MBUMAH HARDWARE - Juja Main');
    expect(text).toContain('Period,October 2026');
    expect(text).toContain('Run type,REGULAR');
    expect(text).toContain('Approved by,Grace Wanjiku');
    expect(text).toContain('Approved-UTC,2026-10-17T08:52:00.000Z');
    expect(text).toContain('Employees,4');
    expect(text).toContain('Gross (KES),345000.00');
    expect(text).toContain('Deductions (KES),51650.50');
    expect(text).toContain('Net (KES),293349.50');
    expect(text).toContain('Employee,Staff number,Gross (KES),Deductions (KES),Net (KES)');
    expect(text).toContain('David Otieno,MBM-JUJ-E001,100000.00,15000.00,85000.00');
    expect(text).toContain('Grace Achieng,MBM-JUJ-E002,90000.00,13500.00,76500.00');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('measures byteSize on the raw UTF-8 bytes (not base64 length)', () => {
    const csv = need(payrollRunDigestToCsv(ROWS, META, at));
    const decoded = Buffer.from(csv.content, 'base64');
    expect(csv.byteSize).toBe(decoded.byteLength);
  });

  it('slugs the filename from period + run type', () => {
    const csv = need(payrollRunDigestToCsv(ROWS, META, at));
    expect(csv.filename).toBe('mbumah-payroll-october-2026-regular.csv');
    const csv2 = need(payrollRunDigestToCsv(ROWS, { ...META, periodName: 'Leave year 2026!', runType: 'OFF_CYCLE' }, at));
    expect(csv2.filename).toBe('mbumah-payroll-leave-year-2026-off-cycle.csv');
  });

  it('guards CSV formula injection on employee names (OWASP)', () => {
    const hostile: PayrollRunDigestEmployeeRow[] = [
      { employeeName: '=HYPERLINK("http://evil","pay")', employeeCode: '+SUM(A1)', gross: 1, deductions: 0, net: 1 },
    ];
    const csv = need(payrollRunDigestToCsv(hostile, META, at));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).toContain(`'+SUM(A1)`);
  });

  it('escapes embedded quotes and commas per RFC-4180', () => {
    const quoted: PayrollRunDigestEmployeeRow[] = [
      { employeeName: 'Otieno, "David" Jr', employeeCode: null, gross: 1, deductions: 0, net: 1 },
    ];
    const csv = need(payrollRunDigestToCsv(quoted, META, at));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain('"Otieno, ""David"" Jr",,1.00,0.00,1.00');
  });

  it('returns null for an approved empty run (never ships an empty spreadsheet)', () => {
    expect(payrollRunDigestToCsv([], { ...META, employeeCount: 0, totalGross: 0, totalDeductions: 0, totalNet: 0 }, at)).toBeNull();
  });

  it('still builds the summary-only file when totals exist but rows are missing', () => {
    const csv = need(payrollRunDigestToCsv([], META, at));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain('Net (KES),293349.50');
    expect(text).not.toContain('Employee,Staff number');
  });
});

describe('notifyPayrollRunApproved (service seams)', () => {

  const RUN = {
    id: 'run-1',
    payrollPeriodId: 'period-1',
    runType: 'REGULAR',
    approvedAt: new Date('2026-10-17T08:52:00.000Z'),
    approvedByUserId: 'approver-1',
    preparedByUserId: 'maker-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.payrollRun.findUnique.mockResolvedValue({
      employeeCount: 2,
      totalGross: 190000,
      totalDeductions: 28500,
      totalNet: 161500,
      approvedAt: RUN.approvedAt,
      preparedByUserId: 'maker-1',
    });
    db.store.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE - Juja Main' });
    db.payrollPeriod.findUnique.mockResolvedValue({ name: 'October 2026' });
    db.payrollDetail.findMany.mockResolvedValue([
      {
        grossPay: 100000,
        totalDeductions: 15000,
        netPay: 85000,
        employee: { firstName: 'David', lastName: 'Otieno', employeeCode: 'MBM-JUJ-E001' },
      },
      {
        grossPay: 90000,
        totalDeductions: 13500,
        netPay: 76500,
        employee: { firstName: 'Grace', lastName: 'Achieng', employeeCode: 'MBM-JUJ-E002' },
      },
    ]);
    db.user.findUnique.mockResolvedValue({ id: 'approver-1', name: 'Grace Wanjiku', email: 'approver@x.y' });
    db.user.findMany.mockResolvedValue([
      { id: 'approver-1', email: 'approver@x.y' },
      { id: 'maker-1', email: 'maker@x.y' },
      { id: 'owner-1', email: 'owner@x.y' },
    ]);
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('excludes the actor and keeps the maker in the audience', async () => {
    const result = await notifyPayrollRunApproved({ run: RUN, storeId: 'store-1', actorId: 'approver-1' });
    // approver-1 (actor) is removed; maker + owner remain.
    expect(result.notifiedUsers).toBe(2);
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{ userId: string }>;
    expect(created.map((r) => r.userId).sort()).toEqual(['maker-1', 'owner-1']);
    expect(result.emailRecipients).toBe(2);
  });

  it('sends ONE envelope with the CSV attached and the metadata stamp', async () => {
    const result = await notifyPayrollRunApproved({ run: RUN, storeId: 'store-1', actorId: 'approver-1' });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const params = sendEmailMock.mock.calls[0][0];
    expect(params.to).toEqual(['maker@x.y', 'owner@x.y']);
    expect(params.type).toBe('PAYROLL_APPROVED');
    expect(params.subject).toContain('October 2026');
    expect(params.attachments).toHaveLength(1);
    expect(params.attachments[0].filename).toBe('mbumah-payroll-october-2026-regular.csv');
    expect(params.metadata.runId).toBe('run-1');
    expect(params.metadata.csvFilename).toBe('mbumah-payroll-october-2026-regular.csv');
    expect(params.metadata.csvBytes).toBe(result.csvByteSize);
    expect(result.emailStatus).toBe('SENT');
  });

  it('writes in-app rows with the payroll_approved kind marker', async () => {
    await notifyPayrollRunApproved({ run: RUN, storeId: 'store-1', actorId: 'approver-1' });
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{ metadata: string; category: string }>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.category).toBe('HR');
      const meta = JSON.parse(row.metadata);
      expect(meta.kind).toBe(PAYROLL_APPROVED_METADATA_MARKER);
      expect(meta.runId).toBe('run-1');
      expect(meta.emailStatus).toBe('SENT');
    }
  });

  it('skips the email when recipients have no addresses but still rings bells', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'a1', email: null },
      { id: 'a2', email: '' },
    ]);
    const result = await notifyPayrollRunApproved({ run: RUN, storeId: 'store-1', actorId: 'approver-1' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.emailStatus).toBe('SKIPPED');
    expect(result.notifiedUsers).toBe(2);
  });

  it('reports FAILED without throwing when the email send fails', async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured - email send skipped.' });
    const result = await notifyPayrollRunApproved({ run: RUN, storeId: 'store-1', actorId: 'approver-1' });
    expect(result.emailStatus).toBe('FAILED');
    expect(result.emailError).toContain('RESEND_API_KEY');
    // In-app rows still go out with the honest FAILED stamp.
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{ metadata: string }>;
    expect(JSON.parse(rows[0].metadata).emailStatus).toBe('FAILED');
  });
});
