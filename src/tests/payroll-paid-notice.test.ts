// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PAYROLL_PAID_METADATA_MARKER,
  payrollRunPaidCopy,
  type PayrollRunPaidMeta,
} from '@/lib/hr/payroll/run-digest';
import { notifyEmployeesPaid } from '@/lib/hr/payroll/run-service';

/**
 * v2.51.0: the personal "you've been paid" notice — the completion of the
 * pay story. Companion to payslip-issued-notice.test.ts (teal, the payslip
 * exists) and payroll-disbursed-digest.test.ts (amber, the group's record).
 *
 * Two layers:
 *   1. PURE module: paid copy (emerald surface family, mode-honest prose
 *      for mpesa / mpesa-mock / manual, receipt-present vs receipt-less
 *      honesty, personal privacy contract).
 *   2. Service seams: exactly-this-batch audience (never re-derived from
 *      the run), per-employee rows + personalized emails, per-detail
 *      receipt matching, unlinked employees untouched, fail-soft zeros.
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

const META: PayrollRunPaidMeta = {
  periodName: 'October 2026',
  storeName: 'MBUMAH HARDWARE - Juja Main',
  employeeName: 'David Otieno',
  netPay: 45500,
  payslipNumber: 'PS-20261017-0006',
  receipt: 'MPESA-SIMQJK7XL9M2P',
  mode: 'mpesa-mock',
  disbursedAtIso: '2026-10-17T10:42:00.000Z',
};

describe('payrollRunPaidCopy', () => {
  it('carries the settled-money facts: net, receipt, channel, payslip pointer', () => {
    const copy = payrollRunPaidCopy(META);
    expect(copy.title).toBe("You've been paid — October 2026");
    expect(copy.message).toContain('Ksh 45,500.00');
    expect(copy.message).toContain('receipt MPESA-SIMQJK7XL9M2P');
    expect(copy.message).toContain('PS-20261017-0006');
    expect(copy.message).toContain('My Workspace → Payslips');
    expect(copy.emailSubject).toContain("You've been paid — October 2026");
    expect(copy.emailSubject).toContain('Ksh 45,500.00');
    expect(copy.emailSubject).toContain('MPESA-SIMQJK7XL9M2P');
    expect(copy.emailText).toContain('Net pay: Ksh 45,500.00');
    expect(copy.emailText).toContain('Receipt: MPESA-SIMQJK7XL9M2P');
    expect(copy.emailText).toContain('Settled at: 2026-10-17 10:42 UTC');
    expect(copy.emailHtml).toContain('David');
    expect(copy.emailHtml).toContain('MPESA-SIMQJK7XL9M2P');
  });

  it('speaks live-M-Pesa prose that points at the Safaricom message as the proof', () => {
    const copy = payrollRunPaidCopy({ ...META, mode: 'mpesa', receipt: 'MPESA-QJK7XL9M2P' });
    expect(copy.message).toContain('has been sent to your M-Pesa via M-Pesa B2C');
    expect(copy.message).not.toContain('simulated');
    expect(copy.emailText).toContain('your M-Pesa message from Safaricom is the payment proof');
  });

  it('never lets a simulated batch read like real money moved', () => {
    const copy = payrollRunPaidCopy(META);
    expect(copy.message).toContain('simulated M-Pesa B2C (test environment — no real money moved)');
    expect(copy.emailText).toContain('Simulation mode: this batch is a rehearsal, not a payment.');
  });

  it('speaks manual-confirmation prose and tells the employee where to escalate', () => {
    const copy = payrollRunPaidCopy({ ...META, mode: 'manual', receipt: 'MANUAL-1730000000000' });
    expect(copy.message).toContain('was marked paid via manual confirmation (bank run / cash)');
    expect(copy.message).toContain('receipt MANUAL-1730000000000');
    expect(copy.emailText).toContain('This is a bookkeeping record, not an M-Pesa send');
    expect(copy.emailText).toContain('if the money has not reached your account, talk to HR');
  });

  it('stays honest when the channel recorded no receipt (never invents a number)', () => {
    const copy = payrollRunPaidCopy({ ...META, mode: 'manual', receipt: null });
    expect(copy.message).not.toContain('receipt');
    expect(copy.emailText).toContain('Receipt: (none recorded — your payslip carries the payment record)');
    expect(copy.emailHtml).toContain('none recorded — your payslip carries the payment record');
  });

  it('falls back to generic payslip phrasing when the slip number is missing', () => {
    const copy = payrollRunPaidCopy({ ...META, payslipNumber: null });
    expect(copy.message).toContain('your payslip is in My Workspace → Payslips');
    expect(copy.message).not.toContain('payslip null');
    expect(copy.emailText).toContain('Payslip number: (see My Workspace → Payslips)');
  });

  it('uses the emerald surface family so a paid notice never looks like the sibling digests', () => {
    const copy = payrollRunPaidCopy(META);
    expect(copy.emailHtml).toContain('#047857');
    // None of the sibling digest headers may leak into this surface.
    expect(copy.emailHtml).not.toContain('#065f46');
    expect(copy.emailHtml).not.toContain('#0c4a6e');
    expect(copy.emailHtml).not.toContain('#0f766e');
    expect(copy.emailHtml).not.toContain('#92400e');
  });

  it('carries the personal privacy contract in the email footer', () => {
    const copy = payrollRunPaidCopy(META);
    expect(copy.emailText).toContain('This notice is personal — it carries only your own payment');
    expect(copy.emailText).toContain('and is sent only to you.');
    expect(copy.emailHtml).toContain('It never contains other employees&rsquo; data.');
  });

  it('escapes hostile receipt values in the email HTML', () => {
    const copy = payrollRunPaidCopy({ ...META, receipt: '<script>alert(1)</script>' });
    expect(copy.emailHtml).not.toContain('<script>');
    expect(copy.emailHtml).toContain('&lt;script&gt;');
  });
});

describe('notifyEmployeesPaid (service seams)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payrollRun.findUnique.mockResolvedValue({ id: 'run-1', payrollPeriod: { name: 'October 2026' } });
    db.store.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE - Juja Main' });
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('writes one personalized bell row per portal-linked employee with the paid marker', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      {
        id: 'd-1',
        netPay: 45500,
        payslipNumber: 'PS-20261017-0006',
        employee: { firstName: 'David', lastName: 'Otieno', userId: 'u-1', email: 'david@x.y' },
      },
      {
        id: 'd-2',
        netPay: 37280.65,
        payslipNumber: 'PS-20261017-0007',
        employee: { firstName: 'Grace', lastName: 'Achieng', userId: 'u-2', email: 'grace@x.y' },
      },
    ]);
    const result = await notifyEmployeesPaid({
      runId: 'run-1',
      storeId: 'store-1',
      mode: 'mpesa-mock',
      paidDetails: [
        { detailId: 'd-1', receipt: 'MPESA-SIMQJK7XL9M2P' },
        { detailId: 'd-2', receipt: 'MPESA-SIMQJK7XL9M2Q' },
      ],
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
    });
    expect(result.notifiedUsers).toBe(2);
    expect(result.emailsAttempted).toBe(2);
    expect(result.emailsSent).toBe(2);
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{
      userId: string;
      actionUrl: string;
      actionLabel: string;
      metadata: string;
    }>;
    expect(created).toHaveLength(2);
    for (const row of created) {
      expect(row.actionUrl).toBe('/employees/me/payslips');
      expect(row.actionLabel).toBe('View payslip');
      const meta = JSON.parse(row.metadata) as Record<string, unknown>;
      expect(meta.kind).toBe(PAYROLL_PAID_METADATA_MARKER);
      expect(meta.runId).toBe('run-1');
      expect(meta.periodName).toBe('October 2026');
    }
  });

  it('matches each employee’s own receipt (never swaps receipts between rows)', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      {
        id: 'd-1',
        netPay: 45500,
        payslipNumber: 'PS-20261017-0006',
        employee: { firstName: 'David', lastName: 'Otieno', userId: 'u-1', email: 'david@x.y' },
      },
      {
        id: 'd-2',
        netPay: 37280.65,
        payslipNumber: 'PS-20261017-0007',
        employee: { firstName: 'Grace', lastName: 'Achieng', userId: 'u-2', email: 'grace@x.y' },
      },
    ]);
    await notifyEmployeesPaid({
      runId: 'run-1',
      storeId: 'store-1',
      mode: 'mpesa-mock',
      paidDetails: [
        { detailId: 'd-1', receipt: 'MPESA-SIMQJK7XL9M2P' },
        { detailId: 'd-2', receipt: 'MPESA-SIMQJK7XL9M2Q' },
      ],
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
    });
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{
      title: string;
      message: string;
      metadata: string;
    }>;
    const byUser = new Map(created.map((r) => [(JSON.parse(r.metadata) as Record<string, unknown>).receipt as string, r]));
    expect(byUser.get('MPESA-SIMQJK7XL9M2P')?.message).toContain('Ksh 45,500.00');
    expect(byUser.get('MPESA-SIMQJK7XL9M2Q')?.message).toContain('Ksh 37,280.65');
    // Each email carries the matching receipt in its subject too.
    const subjects = sendEmailMock.mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjects.some((s) => s.includes('MPESA-SIMQJK7XL9M2P'))).toBe(true);
    expect(subjects.some((s) => s.includes('MPESA-SIMQJK7XL9M2Q'))).toBe(true);
  });

  it('skips unlinked employees entirely — no row, no email, nothing leaked', async () => {
    db.payrollDetail.findMany.mockResolvedValue([
      {
        id: 'd-1',
        netPay: 45500,
        payslipNumber: 'PS-20261017-0006',
        employee: { firstName: 'Paper', lastName: 'Only', userId: null, email: 'paper@x.y' },
      },
      {
        id: 'd-2',
        netPay: 37280.65,
        payslipNumber: 'PS-20261017-0007',
        employee: { firstName: 'Grace', lastName: 'Achieng', userId: 'u-2', email: 'grace@x.y' },
      },
    ]);
    const result = await notifyEmployeesPaid({
      runId: 'run-1',
      storeId: 'store-1',
      mode: 'manual',
      paidDetails: [
        { detailId: 'd-1', receipt: null },
        { detailId: 'd-2', receipt: 'MANUAL-1730000000000' },
      ],
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
    });
    expect(result.portalLinked).toBe(1);
    expect(result.notifiedUsers).toBe(1);
    const created = db.notification.createMany.mock.calls[0][0].data as Array<{ userId: string }>;
    expect(created.map((r) => r.userId)).toEqual(['u-2']);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('returns fail-soft zeros for an empty batch without touching the database', async () => {
    const result = await notifyEmployeesPaid({
      runId: 'run-1',
      storeId: 'store-1',
      mode: 'mpesa',
      paidDetails: [],
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
    });
    expect(result).toEqual({ portalLinked: 0, notifiedUsers: 0, emailsAttempted: 0, emailsSent: 0, emailsFailed: 0 });
    expect(db.payrollDetail.findMany).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('returns fail-soft zeros when the run does not exist (nothing honest to say)', async () => {
    db.payrollRun.findUnique.mockResolvedValue(null);
    const result = await notifyEmployeesPaid({
      runId: 'ghost-run',
      storeId: 'store-1',
      mode: 'mpesa',
      paidDetails: [{ detailId: 'd-1', receipt: 'MPESA-X' }],
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
    });
    expect(result.notifiedUsers).toBe(0);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('scopes the audience query to the run — a stray detailId from another run leaks nothing', async () => {
    db.payrollDetail.findMany.mockResolvedValue([]);
    await notifyEmployeesPaid({
      runId: 'run-1',
      storeId: 'store-1',
      mode: 'mpesa',
      paidDetails: [{ detailId: 'd-other-run', receipt: 'MPESA-X' }],
      disbursedAtIso: '2026-10-17T10:42:00.000Z',
    });
    const where = need(db.payrollDetail.findMany.mock.calls[0]?.[0]) as {
      where: { payrollRunId: string; id: { in: string[] } };
    };
    expect(where.where.payrollRunId).toBe('run-1');
    expect(where.where.id.in).toEqual(['d-other-run']);
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });
});
