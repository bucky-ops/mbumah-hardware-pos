// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYROLL_POSTED_METADATA_MARKER,
  payrollRunPostedCopy,
  payrollRunDigestToCsv,
  type PayrollRunDigestEmployeeRow,
  type PayrollRunPostedMeta,
} from '@/lib/hr/payroll/run-digest';
import { notifyPayrollRunPosted } from '@/lib/hr/payroll/run-service';

/**
 * v2.48.0: payroll-run POSTING digest — the approval-digest machinery
 * pointed at the moment the ledger closes (journal entry + payslips
 * issued). Companion to payroll-run-digest.test.ts (the approval side).
 *
 * Two layers:
 *   1. PURE module: posted copy (sky surface family, payslip range,
 *      privacy contract), the posted CSV variant (header labels, payslip
 *      row, -posted filename suffix, inherited injection guard) and the
 *      unchanged-by-default approval variant (regression guard).
 *   2. Service seams: recipient resolution (actor excluded, maker kept),
 *      one email envelope with the posted CSV + metadata stamp, in-app
 *      rows with the payroll_posted marker, honest SKIPPED/FAILED.
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

const POSTED_META: PayrollRunPostedMeta = {
  periodName: 'October 2026',
  storeName: 'MBUMAH HARDWARE - Juja Main',
  runType: 'REGULAR',
  employeeCount: 4,
  totalGross: 345000,
  totalDeductions: 51650.5,
  totalNet: 293349.5,
  postedByLabel: 'Njeri Kamau',
  postedAtIso: '2026-10-17T09:28:00.000Z',
  payslipCount: 4,
  firstPayslipNumber: 'PS-2026-00042',
  lastPayslipNumber: 'PS-2026-00045',
};

const ROWS: PayrollRunDigestEmployeeRow[] = [
  { employeeName: 'David Otieno', employeeCode: 'MBM-JUJ-E001', gross: 100000, deductions: 15000, net: 85000 },
  { employeeName: 'Grace Achieng', employeeCode: 'MBM-JUJ-E002', gross: 90000, deductions: 13500, net: 76500 },
];

describe('payrollRunPostedCopy', () => {
  it('carries the same closing numbers in every channel', () => {
    const copy = payrollRunPostedCopy(POSTED_META);
    expect(copy.title).toBe('Payroll posted — October 2026');
    expect(copy.message).toContain('4 payslips issued');
    expect(copy.message).toContain('Net Ksh 293,349.50');
    expect(copy.message).toContain('Njeri Kamau');
    expect(copy.message).toContain('ready to disburse');
    expect(copy.emailSubject).toContain('October 2026');
    expect(copy.emailSubject).toContain('MBUMAH HARDWARE - Juja Main');
    expect(copy.emailSubject).toContain('4 payslips');
    expect(copy.emailSubject).toContain('Ksh 293,349.50 net');
    expect(copy.emailText).toContain('Gross: Ksh 345,000.00');
    expect(copy.emailText).toContain('Net: Ksh 293,349.50');
    expect(copy.emailText).toContain('Payslips issued: 4 payslips (PS-2026-00042 – PS-2026-00045)');
    expect(copy.emailHtml).toContain('Payroll posted — October 2026');
    expect(copy.emailHtml).toContain('PS-2026-00042 – PS-2026-00045');
  });

  it('uses the sky surface family so a posting never looks like an approval', () => {
    const posted = payrollRunPostedCopy(POSTED_META);
    const approved = payrollRunPostedCopy; // reference guard below uses the approval copy indirectly
    void approved;
    expect(posted.emailHtml).toContain('#0c4a6e');
    // The emerald approval header must not leak into the posting surface.
    expect(posted.emailHtml).not.toContain('#065f46');
  });

  it('renders a single payslip without a dash range', () => {
    const copy = payrollRunPostedCopy({ ...POSTED_META, payslipCount: 1, firstPayslipNumber: 'PS-2026-00007', lastPayslipNumber: 'PS-2026-00007' });
    expect(copy.emailText).toContain('Payslips issued: 1 payslip (PS-2026-00007)');
    expect(copy.emailHtml).toContain('(PS-2026-00007)');
  });

  it('says "no payslips" and drops the range when none were issued', () => {
    const copy = payrollRunPostedCopy({ ...POSTED_META, payslipCount: 0, firstPayslipNumber: null, lastPayslipNumber: null });
    expect(copy.message).toContain('no payslips issued');
    expect(copy.emailText).toContain('Payslips issued: no payslips');
    expect(copy.emailText).not.toContain('Payslips issued: no payslips (');
    expect(copy.emailHtml).not.toContain('PS-');
  });

  it('names the next step (disburse, then lock) in text and HTML', () => {
    const copy = payrollRunPostedCopy(POSTED_META);
    expect(copy.emailText).toContain('disburse salaries');
    expect(copy.emailText).toContain('lock the run');
    expect(copy.emailHtml).toContain('disburse salaries');
  });

  it('states the privacy contract (no national IDs, bank details or line items)', () => {
    const copy = payrollRunPostedCopy(POSTED_META);
    expect(copy.emailText).toContain('never contains national IDs');
    expect(copy.emailHtml).toContain('never contains national IDs');
  });

  it('escapes hostile meta values in the HTML surface', () => {
    const copy = payrollRunPostedCopy({
      ...POSTED_META,
      storeName: 'Store <script>alert("x")</script>',
      postedByLabel: "Bob & <b>Co</b>",
    });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
    expect(copy.emailHtml).toContain('Bob &amp; &lt;b&gt;Co&lt;/b&gt;');
  });

  it('stays INFO/NORMAL (quiet bell rows; failures escalate in the feed mapper)', () => {
    const copy = payrollRunPostedCopy(POSTED_META);
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });
});

describe('payrollRunDigestToCsv posted variant', () => {
  const at = new Date('2026-10-17T09:28:00.000Z');

  it('flips the header block to posting labels and adds the payslip row', () => {
    const csv = need(
      payrollRunDigestToCsv(
        ROWS,
        {
          periodName: POSTED_META.periodName,
          storeName: POSTED_META.storeName,
          runType: POSTED_META.runType,
          employeeCount: POSTED_META.employeeCount,
          totalGross: POSTED_META.totalGross,
          totalDeductions: POSTED_META.totalDeductions,
          totalNet: POSTED_META.totalNet,
          approvedByLabel: POSTED_META.postedByLabel,
          approvedAtIso: POSTED_META.postedAtIso,
          postedByLabel: POSTED_META.postedByLabel,
          postedAtIso: POSTED_META.postedAtIso,
          payslipCount: POSTED_META.payslipCount,
          firstPayslipNumber: POSTED_META.firstPayslipNumber,
          lastPayslipNumber: POSTED_META.lastPayslipNumber,
        },
        at,
        'posted',
      ),
    );
    const text = Buffer.from(need(csv).content, 'base64').toString('utf8');
    expect(text).toContain('Report,Payroll posting summary');
    expect(text).toContain('Posted by,Njeri Kamau');
    expect(text).toContain('Posted-UTC,2026-10-17T09:28:00.000Z');
    expect(text).toContain('Payslips issued,4 (PS-2026-00042 - PS-2026-00045)');
    expect(text).not.toContain('Approved by');
    expect(text).not.toContain('Approved-UTC');
    // Summary + per-employee table survive unchanged.
    expect(text).toContain('Net (KES),293349.50');
    expect(text).toContain('David Otieno,MBM-JUJ-E001,100000.00,15000.00,85000.00');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('suffixes the filename with -posted so the two CSVs never collide in one inbox', () => {
    const csv = need(
      payrollRunDigestToCsv(
        ROWS,
        {
          ...POSTED_META,
          approvedByLabel: POSTED_META.postedByLabel,
          approvedAtIso: POSTED_META.postedAtIso,
        },
        at,
        'posted',
      ),
    );
    expect(csv.filename).toBe('mbumah-payroll-october-2026-regular-posted.csv');
  });

  it('inherits the OWASP formula-injection guard on the posted variant', () => {
    const hostile: PayrollRunDigestEmployeeRow[] = [
      { employeeName: '=HYPERLINK("http://evil","pay")', employeeCode: '+SUM(A1)', gross: 1, deductions: 0, net: 1 },
    ];
    const csv = need(
      payrollRunDigestToCsv(
        hostile,
        { ...POSTED_META, approvedByLabel: POSTED_META.postedByLabel, approvedAtIso: POSTED_META.postedAtIso },
        at,
        'posted',
      ),
    );
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).toContain(`'+SUM(A1)`);
  });

  it('returns null for a posted empty run (never ships an empty spreadsheet)', () => {
    expect(
      payrollRunDigestToCsv(
        [],
        {
          ...POSTED_META,
          employeeCount: 0,
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          approvedByLabel: POSTED_META.postedByLabel,
          approvedAtIso: POSTED_META.postedAtIso,
        },
        at,
        'posted',
      ),
    ).toBeNull();
  });

  it('leaves the default (approval) variant byte-compatible — regression guard', () => {
    const csv = need(
      payrollRunDigestToCsv(ROWS, {
        periodName: 'October 2026',
        storeName: 'MBUMAH HARDWARE - Juja Main',
        runType: 'REGULAR',
        employeeCount: 4,
        totalGross: 345000,
        totalDeductions: 51650.5,
        totalNet: 293349.5,
        approvedByLabel: 'Grace Wanjiku',
        approvedAtIso: '2026-10-17T08:52:00.000Z',
      }, at),
    );
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain('Report,Payroll approval summary');
    expect(text).toContain('Approved by,Grace Wanjiku');
    expect(text).not.toContain('Posted');
    expect(csv.filename).toBe('mbumah-payroll-october-2026-regular.csv');
  });
});

describe('notifyPayrollRunPosted (service seams)', () => {
  const RUN = {
    id: 'run-1',
    payrollPeriodId: 'period-1',
    runType: 'REGULAR',
    postedAt: new Date('2026-10-17T09:28:00.000Z'),
    postedByUserId: 'poster-1',
    preparedByUserId: 'maker-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.payrollRun.findUnique.mockResolvedValue({
      employeeCount: 2,
      totalGross: 190000,
      totalDeductions: 28500,
      totalNet: 161500,
      postedAt: RUN.postedAt,
      preparedByUserId: 'maker-1',
    });
    db.store.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE - Juja Main' });
    db.payrollPeriod.findUnique.mockResolvedValue({ name: 'October 2026' });
    db.payrollDetail.findMany.mockResolvedValue([
      {
        grossPay: 100000,
        totalDeductions: 15000,
        netPay: 85000,
        payslipNumber: 'PS-2026-00042',
        employee: { firstName: 'David', lastName: 'Otieno', employeeCode: 'MBM-JUJ-E001' },
      },
      {
        grossPay: 90000,
        totalDeductions: 13500,
        netPay: 76500,
        payslipNumber: 'PS-2026-00043',
        employee: { firstName: 'Grace', lastName: 'Achieng', employeeCode: 'MBM-JUJ-E002' },
      },
    ]);
    db.user.findUnique.mockResolvedValue({ id: 'poster-1', name: 'Njeri Kamau', email: 'poster@x.y' });
    db.user.findMany.mockResolvedValue([
      { id: 'poster-1', email: 'poster@x.y' },
      { id: 'maker-1', email: 'maker@x.y' },
      { id: 'owner-1', email: 'owner@x.y' },
    ]);
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('excludes the actor and keeps the maker in the audience', async () => {
    const result = await notifyPayrollRunPosted({ run: RUN, storeId: 'store-1', actorId: 'poster-1' });
    // poster-1 (actor) is removed; maker + owner remain.
    expect(result.notifiedUsers).toBe(2);
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{ userId: string }>;
    expect(created.map((r) => r.userId).sort()).toEqual(['maker-1', 'owner-1']);
    expect(result.emailRecipients).toBe(2);
  });

  it('sends ONE envelope with the posted CSV attached and the metadata stamp', async () => {
    const result = await notifyPayrollRunPosted({ run: RUN, storeId: 'store-1', actorId: 'poster-1' });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const params = sendEmailMock.mock.calls[0][0];
    expect(params.to).toEqual(['maker@x.y', 'owner@x.y']);
    expect(params.type).toBe('PAYROLL_POSTED');
    expect(params.subject).toContain('Payroll posted');
    expect(params.subject).toContain('October 2026');
    expect(params.attachments).toHaveLength(1);
    expect(params.attachments[0].filename).toBe('mbumah-payroll-october-2026-regular-posted.csv');
    const csvText = Buffer.from(params.attachments[0].content, 'base64').toString('utf8');
    expect(csvText).toContain('Payslips issued,2 (PS-2026-00042 - PS-2026-00043)');
    expect(params.metadata.runId).toBe('run-1');
    expect(params.metadata.postedBy).toBe('Njeri Kamau');
    expect(params.metadata.payslipCount).toBe(2);
    expect(params.metadata.csvFilename).toBe('mbumah-payroll-october-2026-regular-posted.csv');
    expect(params.metadata.csvBytes).toBe(result.csvByteSize);
    expect(result.emailStatus).toBe('SENT');
  });

  it('writes in-app rows with the payroll_posted kind marker', async () => {
    await notifyPayrollRunPosted({ run: RUN, storeId: 'store-1', actorId: 'poster-1' });
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{ metadata: string; category: string; title: string }>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.category).toBe('HR');
      expect(row.title).toBe('Payroll posted — October 2026');
      const meta = JSON.parse(row.metadata);
      expect(meta.kind).toBe(PAYROLL_POSTED_METADATA_MARKER);
      expect(meta.runId).toBe('run-1');
      expect(meta.emailStatus).toBe('SENT');
    }
  });

  it('skips the email when recipients have no addresses but still rings bells', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'a1', email: null },
      { id: 'a2', email: '' },
    ]);
    const result = await notifyPayrollRunPosted({ run: RUN, storeId: 'store-1', actorId: 'poster-1' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.emailStatus).toBe('SKIPPED');
    expect(result.notifiedUsers).toBe(2);
  });

  it('reports FAILED without throwing when the email send fails', async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured - email send skipped.' });
    const result = await notifyPayrollRunPosted({ run: RUN, storeId: 'store-1', actorId: 'poster-1' });
    expect(result.emailStatus).toBe('FAILED');
    expect(result.emailError).toContain('RESEND_API_KEY');
    // In-app rows still go out with the honest FAILED stamp.
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{ metadata: string }>;
    expect(JSON.parse(rows[0].metadata).emailStatus).toBe('FAILED');
  });

  it('skips quietly when the run row has already disappeared', async () => {
    db.payrollRun.findUnique.mockResolvedValue(null);
    const result = await notifyPayrollRunPosted({ run: RUN, storeId: 'store-1', actorId: 'poster-1' });
    expect(result).toEqual({ notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
