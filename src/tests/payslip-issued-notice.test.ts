// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYSLIP_ISSUED_METADATA_MARKER,
  payslipIssuedCopy,
  type PayslipIssuedMeta,
} from '@/lib/hr/payroll/run-digest';
import { notifyEmployeesPayslipsIssued } from '@/lib/hr/payroll/run-service';

/**
 * v2.49.0: employee-facing "your payslip is issued" notices — the last
 * silent hop of the payroll lifecycle closed. Companion to
 * payroll-posted-digest.test.ts (the group side): the maker and payroll
 * group already hear about a posting; THIS fan-out tells the EMPLOYEES.
 *
 * Two layers:
 *   1. PURE module: the personalized copy (teal surface family, own
 *      payslip number + net only, "being finalised" fallback, hostile-name
 *      escaping, personal privacy footer).
 *   2. Service seams: portal-link gating (unlinked employees get nothing),
 *      personal bell rows with the portal deep link, per-employee emails
 *      (one envelope each — personalized content cannot share one), honest
 *      sent/failed counts, zero-audience short-circuit, never throws.
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

const META: PayslipIssuedMeta = {
  periodName: 'October 2026',
  storeName: 'MBUMAH HARDWARE - Juja Main',
  employeeName: 'David Otieno',
  payslipNumber: 'PS-20261017-0006',
  netPay: 51240,
  paymentStatus: 'PENDING',
  postedAtIso: '2026-10-17T09:28:00.000Z',
};

describe('payslipIssuedCopy', () => {
  it('carries the employee\'s OWN payslip facts in every channel', () => {
    const copy = payslipIssuedCopy(META);
    expect(copy.title).toBe('Payslip issued — October 2026');
    expect(copy.message).toContain('Your October 2026 payslip PS-20261017-0006 is ready');
    expect(copy.message).toContain('Net Ksh 51,240.00');
    expect(copy.message).toContain('My Workspace → Payslips');
    expect(copy.emailSubject).toContain('PS-20261017-0006');
    expect(copy.emailSubject).toContain('Ksh 51,240.00 net');
    expect(copy.emailText).toContain('Hello David,');
    expect(copy.emailText).toContain('Payslip number: PS-20261017-0006');
    expect(copy.emailText).toContain('Net pay: Ksh 51,240.00');
    expect(copy.emailText).toContain('Payment status: PENDING');
    expect(copy.emailHtml).toContain('PS-20261017-0006');
    expect(copy.emailHtml).toContain('Ksh 51,240.00');
  });

  it('uses the teal surface family so a personal notice never looks like the group digests', () => {
    const copy = payslipIssuedCopy(META);
    expect(copy.emailHtml).toContain('#0f766e');
    // Neither group-digest header may leak into the personal surface.
    expect(copy.emailHtml).not.toContain('#065f46');
    expect(copy.emailHtml).not.toContain('#0c4a6e');
  });

  it('says "being finalised" gracefully when no payslip number exists yet', () => {
    const copy = payslipIssuedCopy({ ...META, payslipNumber: null });
    expect(copy.message).not.toContain('PS-');
    expect(copy.message).toContain('Your October 2026 payslip is ready');
    expect(copy.emailText).toContain('Payslip number: (being finalised)');
    expect(copy.emailHtml).toContain('being finalised');
    expect(copy.emailSubject).not.toContain('PS-');
  });

  it('celebrates PAID status without lying about pending runs', () => {
    const paid = payslipIssuedCopy({ ...META, paymentStatus: 'PAID' });
    expect(paid.message).toContain('marked PAID');
    expect(paid.emailHtml).toContain('PAID');
    const pending = payslipIssuedCopy(META);
    expect(pending.message).not.toContain('marked PAID');
    expect(pending.emailText).toContain('Payment status: PENDING');
  });

  it('states the personal privacy contract (only you, only your own summary)', () => {
    const copy = payslipIssuedCopy(META);
    expect(copy.emailText).toContain('This notice is personal');
    expect(copy.emailText).toContain('sent only to you');
    expect(copy.emailHtml).toContain('only your own payslip summary');
    expect(copy.emailHtml).toContain('never contains other employees');
  });

  it('escapes hostile meta values in the HTML surface', () => {
    const copy = payslipIssuedCopy({
      ...META,
      storeName: 'Store <script>alert("x")</script>',
      employeeName: "Eve & <b>Co</b> <img src=x onerror=y>",
    });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
    // The greeting uses the first name only — the space-splitter naturally
    // truncates the payload, so no tag or attribute ever reaches the HTML.
    expect(copy.emailHtml).toContain('Hello <strong>Eve</strong>');
    expect(copy.emailHtml).not.toContain('<img src=x');
    expect(copy.emailHtml).not.toContain('onerror');
  });

  it('stays INFO/NORMAL (personal pay news, never an alarm)', () => {
    const copy = payslipIssuedCopy(META);
    expect(copy.notifType).toBe('INFO');
    expect(copy.priority).toBe('NORMAL');
  });
});

describe('notifyEmployeesPayslipsIssued (service seams)', () => {
  const DETAILS = [
    {
      netPay: 51240,
      paymentStatus: 'PENDING',
      payslipNumber: 'PS-20261017-0006',
      employee: { firstName: 'David', lastName: 'Otieno', userId: 'emp-user-1', email: 'david@x.y' },
    },
    {
      netPay: 47800,
      paymentStatus: 'PENDING',
      payslipNumber: 'PS-20261017-0007',
      employee: { firstName: 'Grace', lastName: 'Achieng', userId: 'emp-user-2', email: 'grace@x.y' },
    },
    // NOT portal-linked: no bell to ring, no portal to open — gets nothing.
    {
      netPay: 30000,
      paymentStatus: 'PENDING',
      payslipNumber: 'PS-20261017-0008',
      employee: { firstName: 'Paper', lastName: 'Only', userId: null, email: 'paper@x.y' },
    },
    // Portal-linked but no email address: bell row yes, email no.
    {
      netPay: 25000,
      paymentStatus: 'PENDING',
      payslipNumber: 'PS-20261017-0009',
      employee: { firstName: 'No', lastName: 'Mail', userId: 'emp-user-3', email: null },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    db.store.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE - Juja Main' });
    db.payrollPeriod.findUnique.mockResolvedValue({ name: 'October 2026' });
    db.payrollDetail.findMany.mockResolvedValue(DETAILS);
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('notifies ONLY portal-linked employees (unlinked staff get nothing)', async () => {
    const result = await notifyEmployeesPayslipsIssued({
      runId: 'run-1',
      payrollPeriodId: 'period-1',
      storeId: 'store-1',
      postedAt: new Date('2026-10-17T09:28:00.000Z'),
    });
    expect(result.portalLinked).toBe(3);
    expect(result.notifiedUsers).toBe(3);
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{ userId: string }>;
    expect(created.map((r) => r.userId).sort()).toEqual(['emp-user-1', 'emp-user-2', 'emp-user-3']);
    // Paper Only (unlinked) never receives an email either; No Mail
    // (portal-linked, no address) gets a bell row but no envelope.
    expect(sendEmailMock.mock.calls.length).toBe(2);
    const tos = sendEmailMock.mock.calls.map((c) => c[0].to);
    expect(tos).not.toContain('paper@x.y');
    expect(result.emailsAttempted).toBe(2);
    expect(result.emailsSent).toBe(2);
    expect(result.emailsFailed).toBe(0);
  });

  it('writes personal rows with the payslip_issued marker and the portal deep link', async () => {
    await notifyEmployeesPayslipsIssued({
      runId: 'run-1',
      payrollPeriodId: 'period-1',
      storeId: 'store-1',
      postedAt: null,
    });
    const rows = db.notification.createMany.mock.calls[0][0].data as Array<{
      userId: string;
      title: string;
      message: string;
      category: string;
      actionUrl: string;
      actionLabel: string;
      metadata: string;
    }>;
    const david = rows.find((r) => r.userId === 'emp-user-1');
    const grace = rows.find((r) => r.userId === 'emp-user-2');
    expect(need(david).title).toBe('Payslip issued — October 2026');
    // PERSONAL: David's row names HIS payslip, never Grace's.
    expect(need(david).message).toContain('PS-20261017-0006');
    expect(need(david).message).not.toContain('PS-20261017-0007');
    expect(need(grace).message).toContain('PS-20261017-0007');
    expect(need(grace).message).not.toContain('PS-20261017-0006');
    for (const row of rows) {
      expect(row.category).toBe('HR');
      expect(row.actionUrl).toBe('/employees/me/payslips');
      expect(row.actionLabel).toBe('View payslip');
      const meta = JSON.parse(row.metadata);
      expect(meta.kind).toBe(PAYSLIP_ISSUED_METADATA_MARKER);
      expect(meta.runId).toBe('run-1');
      expect(meta.periodName).toBe('October 2026');
    }
  });

  it('emails each employee their OWN numbers (personalized envelopes, type + attribution)', async () => {
    await notifyEmployeesPayslipsIssued({
      runId: 'run-1',
      payrollPeriodId: 'period-1',
      storeId: 'store-1',
      postedAt: new Date('2026-10-17T09:28:00.000Z'),
    });
    const david = sendEmailMock.mock.calls.find((c) => c[0].to === 'david@x.y');
    const grace = sendEmailMock.mock.calls.find((c) => c[0].to === 'grace@x.y');
    expect(need(david)[0].subject).toContain('PS-20261017-0006');
    expect(need(david)[0].subject).toContain('Ksh 51,240.00');
    expect(need(david)[0].html).not.toContain('PS-20261017-0007');
    expect(need(david)[0].type).toBe('PAYSLIP_ISSUED');
    expect(need(david)[0].userId).toBe('emp-user-1');
    expect(need(david)[0].metadata.runId).toBe('run-1');
    expect(need(david)[0].metadata.payslipNumber).toBe('PS-20261017-0006');
    expect(need(grace)[0].subject).toContain('PS-20261017-0007');
    expect(need(grace)[0].html).not.toContain('PS-20261017-0006');
  });

  it('counts FAILED sends honestly without throwing', async () => {
    sendEmailMock.mockImplementation(async (params: { to: string }) =>
      params.to === 'david@x.y'
        ? { success: false, error: 'RESEND_API_KEY not configured - email send skipped.' }
        : { success: true, messageId: 'm-2' },
    );
    const result = await notifyEmployeesPayslipsIssued({
      runId: 'run-1',
      payrollPeriodId: 'period-1',
      storeId: 'store-1',
      postedAt: null,
    });
    // Only David + Grace are emailable (No Mail has no address): one fails,
    // one leaves — and nothing throws.
    expect(result.emailsSent).toBe(1);
    expect(result.emailsFailed).toBe(1);
    // The in-app rows are unaffected by email outcomes.
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
  });

  it('short-circuits to zeros when no run employee is portal-linked', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      {
        netPay: 30000,
        paymentStatus: 'PENDING',
        payslipNumber: 'PS-20261017-0008',
        employee: { firstName: 'Paper', lastName: 'Only', userId: null, email: 'paper@x.y' },
      },
    ]);
    const result = await notifyEmployeesPayslipsIssued({
      runId: 'run-1',
      payrollPeriodId: 'period-1',
      storeId: 'store-1',
      postedAt: null,
    });
    expect(result).toEqual({ portalLinked: 0, notifiedUsers: 0, emailsAttempted: 0, emailsSent: 0, emailsFailed: 0 });
    expect(db.notification.createMany).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('tolerates a rejected send (allSettled) and still counts it FAILED', async () => {
    sendEmailMock.mockImplementation(async (params: { to: string }) => {
      if (params.to === 'david@x.y') throw new Error('transport exploded');
      return { success: true, messageId: 'm-3' };
    });
    const result = await notifyEmployeesPayslipsIssued({
      runId: 'run-1',
      payrollPeriodId: 'period-1',
      storeId: 'store-1',
      postedAt: null,
    });
    expect(result.emailsFailed).toBe(1);
    expect(result.emailsSent).toBe(1);
  });
});
