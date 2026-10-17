// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYROLL_DISBURSED_METADATA_MARKER,
  payrollRunDisbursedCopy,
  payrollDisbursementToCsv,
  type PayrollRunDisbursedMeta,
  type PayrollDisbursementRow,
} from '@/lib/hr/payroll/run-digest';
import { notifyPayrollRunDisbursed } from '@/lib/hr/payroll/run-service';

/**
 * v2.50.0: the DISBURSEMENT digest — money leaves the door and the payroll
 * group hears it with the per-batch payment record. Companion to
 * payroll-posted-digest.test.ts (the group machinery it mirrors) and
 * payslip-issued-notice.test.ts (the personal half of the story).
 *
 * Two layers:
 *   1. PURE module: disbursed copy (amber surface family, mode-specific
 *      prose for mpesa / mpesa-mock / manual, failed/skipped honesty,
 *      gate counters, privacy contract) + the per-payslip payment CSV
 *      (header labels, status/receipt rows, -disbursement filename,
 *      inherited injection guard, empty-batch null).
 *   2. Service seams: audience resolution (actor excluded, group kept),
 *      one email envelope with the payment CSV + metadata stamp, in-app
 *      rows with the payroll_disbursed marker, honest SKIPPED/FAILED.
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

const META: PayrollRunDisbursedMeta = {
  periodName: 'October 2026',
  storeName: 'MBUMAH HARDWARE - Juja Main',
  runType: 'REGULAR',
  mode: 'mpesa-mock',
  eligible: 4,
  initiated: 4,
  alreadyInitiated: 0,
  paidNow: 4,
  failed: 0,
  skipped: 0,
  totalNet: 293349.5,
  disbursedByLabel: 'Njeri Kamau',
  disbursedAtIso: '2026-10-17T10:42:00.000Z',
};

const ROWS: PayrollDisbursementRow[] = [
  { employeeName: 'David Otieno', employeeCode: 'MBH-1-005', net: 24620, status: 'PAID', receipt: 'MPESA-QJK7XL9M2P' },
  { employeeName: 'Grace Achieng', employeeCode: 'MBH-1-004', net: 37280.65, status: 'PAID', receipt: 'MPESA-QJK7XL9M2Q' },
  { employeeName: 'John Mwangi', employeeCode: 'MBH-1-003', net: 30000, status: 'SKIPPED' },
];

describe('payrollRunDisbursedCopy', () => {
  it('carries the same money-left-the-door facts in every channel', () => {
    const copy = payrollRunDisbursedCopy(META);
    expect(copy.title).toBe('Payroll disbursed — October 2026');
    expect(copy.message).toContain('4 payments sent via simulated M-Pesa B2C');
    expect(copy.message).toContain('Net Ksh 293,349.50');
    expect(copy.message).toContain('settled immediately with a mock receipt');
    expect(copy.emailSubject).toContain('October 2026');
    expect(copy.emailSubject).toContain('4 payments sent');
    expect(copy.emailSubject).toContain('Ksh 293,349.50 net');
    expect(copy.emailText).toContain('Channel: simulated M-Pesa B2C');
    expect(copy.emailText).toContain('Settled this batch: 4');
    expect(copy.emailText).toContain('Net settled: Ksh 293,349.50');
    expect(copy.emailHtml).toContain('Payroll disbursed — October 2026');
    expect(copy.emailHtml).toContain('Njeri Kamau');
  });

  it('uses the amber surface family so a disbursement never looks like the other digests', () => {
    const copy = payrollRunDisbursedCopy(META);
    expect(copy.emailHtml).toContain('#92400e');
    // None of the sibling digest headers may leak into this surface.
    expect(copy.emailHtml).not.toContain('#065f46');
    expect(copy.emailHtml).not.toContain('#0c4a6e');
    expect(copy.emailHtml).not.toContain('#0f766e');
  });

  it('speaks manual-confirmation prose for the bank-run path', () => {
    const copy = payrollRunDisbursedCopy({ ...META, mode: 'manual', initiated: 0, paidNow: 4, paymentRef: 'MANUAL-1730000000000' });
    expect(copy.message).toContain('4 payments marked paid via manual confirmation');
    expect(copy.message).toContain('bookkeeping confirmation, not an M-Pesa send');
    expect(copy.emailText).toContain('Payment ref: MANUAL-1730000000000');
    expect(copy.emailHtml).toContain('MANUAL-1730000000000');
  });

  it('reports failed and skipped batches honestly and reroutes the next step', () => {
    const copy = payrollRunDisbursedCopy({ ...META, initiated: 2, paidNow: 2, failed: 1, skipped: 1 });
    expect(copy.message).toContain('2 payments sent');
    expect(copy.message).toContain('1 failed, 1 skipped');
    expect(copy.emailText).toContain('Failed: 1');
    expect(copy.emailText).toContain('Skipped: 1');
    expect(copy.emailText).toContain('Next step: Retry the failed payments from the run dialog, then lock.');
    expect(copy.emailHtml).toContain('color:#b91c1c;');
    const healthy = payrollRunDisbursedCopy(META);
    expect(healthy.emailText).toContain('Next step: Lock the run to freeze the period.');
  });

  it('surfaces the v2.33 gate counters when the retry gate blocked candidates', () => {
    const copy = payrollRunDisbursedCopy({ ...META, backoffSkipped: 2, maxAttemptSkipped: 1 });
    expect(copy.emailText).toContain('Backoff-blocked retries: 2');
    expect(copy.emailText).toContain('At attempt ceiling: 1');
    expect(copy.emailHtml).toContain('Backoff-blocked retries');
    expect(copy.emailHtml).toContain('At attempt ceiling');
  });

  it('states the privacy contract (no national IDs, bank details or line items)', () => {
    const copy = payrollRunDisbursedCopy(META);
    expect(copy.emailText).toContain('never contains national IDs');
    expect(copy.emailHtml).toContain('never contains national IDs');
  });

  it('escapes hostile meta values in the HTML surface', () => {
    const copy = payrollRunDisbursedCopy({
      ...META,
      storeName: 'Store <script>alert("x")</script>',
      disbursedByLabel: "Bob & <b>Co</b>",
    });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
    expect(copy.emailHtml).toContain('Bob &amp; &lt;b&gt;Co&lt;/b&gt;');
  });

  it('stays INFO/NORMAL (quiet bell rows; failures escalate in the feed mapper)', () => {
    const copy = payrollRunDisbursedCopy(META);
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });
});

describe('payrollDisbursementToCsv', () => {
  it('writes the disbursement header block and per-payslip payment rows', () => {
    const csv = need(payrollDisbursementToCsv(ROWS, META));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain('Report,Payroll disbursement summary');
    expect(text).toContain('Organization,MBUMAH HARDWARE - Juja Main');
    expect(text).toContain('Period,October 2026');
    expect(text).toContain('Channel,simulated M-Pesa B2C');
    expect(text).toContain('Disbursed by,Njeri Kamau');
    expect(text).toContain('Disbursed-UTC,2026-10-17T10:42:00.000Z');
    expect(text).toContain('Employee,Staff number,Net (KES),Status,Receipt');
    expect(text).toContain('David Otieno,MBH-1-005,24620.00,PAID,MPESA-QJK7XL9M2P');
    expect(text).toContain('John Mwangi,MBH-1-003,30000.00,SKIPPED,');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('names the file -disbursement so the three CSVs never collide in one inbox', () => {
    const csv = need(payrollDisbursementToCsv(ROWS, META));
    expect(csv.filename).toBe('mbumah-payroll-october-2026-disbursement.csv');
  });

  it('carries the manual payment ref in the header when provided', () => {
    const csv = need(payrollDisbursementToCsv(ROWS, { ...META, mode: 'manual', paymentRef: 'MANUAL-1730000000000' }));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain('Channel,manual confirmation');
    expect(text).toContain('Payment ref,MANUAL-1730000000000');
  });

  it('inherits the OWASP formula-injection guard on payment rows', () => {
    const hostile: PayrollDisbursementRow[] = [
      { employeeName: '=HYPERLINK("http://evil","pay")', employeeCode: '+SUM(A1)', net: 1, status: 'PAID', receipt: '-CMD("calc")' },
    ];
    const csv = need(payrollDisbursementToCsv(hostile, META));
    const text = Buffer.from(csv.content, 'base64').toString('utf8');
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).toContain(`'+SUM(A1)`);
    // The receipt starts with '-' (guard fires) AND contains quotes
    // (RFC-4180 doubles them): the guarded form is "'-CMD(""calc"")".
    expect(text).toContain(`'-CMD(`);
  });

  it('returns null for an empty batch (never ships an empty spreadsheet)', () => {
    expect(payrollDisbursementToCsv([], META)).toBeNull();
  });
});

describe('notifyPayrollRunDisbursed (service seams)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payrollRun.findUnique
      .mockResolvedValueOnce({ runType: 'REGULAR', totalNet: 293349.5 })
      .mockResolvedValueOnce({ payrollPeriod: { name: 'October 2026' } });
    db.store.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE - Juja Main' });
    db.user.findUnique.mockResolvedValue({ id: 'disburser-1', name: 'Njeri Kamau', email: 'disburser@x.y' });
    db.user.findMany.mockResolvedValue([
      { id: 'disburser-1', email: 'disburser@x.y' },
      { id: 'owner-1', email: 'owner@x.y' },
      { id: 'accountant-1', email: 'accountant@x.y' },
    ]);
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('excludes the disbursing actor and notifies the rest of the group', async () => {
    const result = await notifyPayrollRunDisbursed({
      runId: 'run-1',
      storeId: 'store-1',
      actorId: 'disburser-1',
      mode: 'mpesa-mock',
      eligible: 3,
      initiated: 3,
      alreadyInitiated: 0,
      paidNow: 3,
      failed: 0,
      skipped: 0,
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
      rows: ROWS,
    });
    expect(result.notifiedUsers).toBe(2);
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{ userId: string }>;
    expect(created.map((r) => r.userId).sort()).toEqual(['accountant-1', 'owner-1']);
    expect(result.emailRecipients).toBe(2);
    expect(result.emailStatus).toBe('SENT');
  });

  it('sends ONE envelope with the disbursement CSV attached and the metadata stamp', async () => {
    const result = await notifyPayrollRunDisbursed({
      runId: 'run-1',
      storeId: 'store-1',
      actorId: 'disburser-1',
      mode: 'mpesa-mock',
      eligible: 3,
      initiated: 3,
      alreadyInitiated: 0,
      paidNow: 3,
      failed: 0,
      skipped: 0,
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
      rows: ROWS,
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const params = sendEmailMock.mock.calls[0][0];
    expect(params.to).toEqual(['owner@x.y', 'accountant@x.y']);
    expect(params.type).toBe('PAYROLL_DISBURSED');
    expect(params.subject).toContain('Payroll disbursed');
    expect(params.subject).toContain('October 2026');
    expect(params.attachments).toHaveLength(1);
    expect(params.attachments[0].filename).toBe('mbumah-payroll-october-2026-disbursement.csv');
    const csvText = Buffer.from(params.attachments[0].content, 'base64').toString('utf8');
    expect(csvText).toContain('David Otieno,MBH-1-005,24620.00,PAID,MPESA-QJK7XL9M2P');
    expect(params.metadata.runId).toBe('run-1');
    expect(params.metadata.mode).toBe('mpesa-mock');
    expect(params.metadata.disbursedBy).toBe('Njeri Kamau');
    expect(params.metadata.csvFilename).toBe('mbumah-payroll-october-2026-disbursement.csv');
    expect(params.metadata.csvBytes).toBe(result.csvByteSize);
  });

  it('writes in-app rows with the payroll_disbursed kind marker', async () => {
    await notifyPayrollRunDisbursed({
      runId: 'run-1',
      storeId: 'store-1',
      actorId: 'disburser-1',
      mode: 'manual',
      eligible: 3,
      initiated: 0,
      alreadyInitiated: 0,
      paidNow: 3,
      failed: 0,
      skipped: 0,
      paymentRef: 'MANUAL-1',
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
      rows: ROWS,
    });
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{ metadata: string; category: string; title: string }>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.category).toBe('HR');
      expect(row.title).toBe('Payroll disbursed — October 2026');
      const meta = JSON.parse(row.metadata);
      expect(meta.kind).toBe(PAYROLL_DISBURSED_METADATA_MARKER);
      expect(meta.runId).toBe('run-1');
      expect(meta.emailStatus).toBe('SENT');
    }
  });

  it('skips the email when recipients have no addresses but still rings bells', async () => {
    db.user.findMany.mockResolvedValue([
      { id: 'a1', email: null },
      { id: 'a2', email: '' },
    ]);
    const result = await notifyPayrollRunDisbursed({
      runId: 'run-1',
      storeId: 'store-1',
      actorId: 'disburser-1',
      mode: 'mpesa-mock',
      eligible: 3,
      initiated: 3,
      alreadyInitiated: 0,
      paidNow: 3,
      failed: 0,
      skipped: 0,
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
      rows: ROWS,
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(result.emailStatus).toBe('SKIPPED');
    expect(result.notifiedUsers).toBe(2);
  });

  it('reports FAILED without throwing when the email send fails', async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured - email send skipped.' });
    const result = await notifyPayrollRunDisbursed({
      runId: 'run-1',
      storeId: 'store-1',
      actorId: 'disburser-1',
      mode: 'mpesa-mock',
      eligible: 3,
      initiated: 3,
      alreadyInitiated: 0,
      paidNow: 3,
      failed: 0,
      skipped: 0,
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
      rows: ROWS,
    });
    expect(result.emailStatus).toBe('FAILED');
    expect(result.emailError).toContain('RESEND_API_KEY');
    // In-app rows still go out with the honest FAILED stamp.
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{ metadata: string }>;
    expect(JSON.parse(rows[0].metadata).emailStatus).toBe('FAILED');
  });

  it('returns an all-zero SKIPPED result when nobody is left to notify', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'disburser-1', email: 'disburser@x.y' }]);
    const result = await notifyPayrollRunDisbursed({
      runId: 'run-1',
      storeId: 'store-1',
      actorId: 'disburser-1',
      mode: 'mpesa-mock',
      eligible: 3,
      initiated: 3,
      alreadyInitiated: 0,
      paidNow: 3,
      failed: 0,
      skipped: 0,
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
      rows: ROWS,
    });
    expect(result).toEqual({ notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' });
    expect(db.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
