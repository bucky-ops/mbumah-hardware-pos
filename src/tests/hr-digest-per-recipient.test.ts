// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  summariseRecipientSends,
  sendDigestEnvelopes,
  runDueHrReportSchedules,
  sendScheduleNow,
  listScheduleDeliveries,
  type RecipientSendResult,
} from '@/lib/hr/report-schedule-service';

/**
 * v2.54.0: per-recipient digest envelopes — "every recipient stands alone".
 *
 * Contracts under test:
 *   • summariseRecipientSends (pure): all delivered → SENT, none → FAILED
 *     with the aggregated copy, mixed → PARTIAL with the honest
 *     "Delivered to N of M" line that points at the delivery history.
 *   • sendDigestEnvelopes (service seam): ONE envelope PER RECIPIENT —
 *     each sendEmail call carries to:[one address] with metadata stamped
 *     recipientAddress / recipientIndex / recipientCount; the digest body
 *     and CSV attachment are IDENTICAL on every envelope (built once
 *     upstream); a rejected send counts as that recipient's failure.
 *   • Sweep wiring: mixed delivery stamps lastStatus PARTIAL + lastError,
 *     the creator gets ONE aggregate in-app copy (never N), the sweep
 *     result row carries the delivered count.
 *   • Send-now wiring: outcome PARTIAL passes through; email aggregate
 *     is honest (success only when every recipient got the digest).
 *   • Deliveries: per-recipient rows expose recipientAddress; legacy
 *     shared-envelope rows keep recipientAddress null.
 *
 * Privacy contract: no recipient's address is ever on another recipient's
 * To: line (each envelope is to:[one]) — asserted on the call args.
 */

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  });
  return {
    hrReportSchedule: model(),
    organization: model(),
    store: model(),
    notification: model(),
    notificationLog: model(),
  };
});

const sendEmailMock = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' }));

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/email-service', () => ({ sendEmail: sendEmailMock }));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/audit-trail', () => ({ auditTrail: { log: vi.fn().mockResolvedValue('audit-id') } }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { REPORT_SCHEDULE: 'HrReportSchedule', DATA_EXPORT: 'DataExport' },
}));

vi.mock('@/lib/hr/reports', () => ({
  headcountReport: vi.fn().mockResolvedValue({
    scope: 'ORG',
    active: 5,
    onLeave: 0,
    suspended: 0,
    hiresInPeriod: 0,
    exitsInPeriod: 1,
    avgTenureYears: 3.7,
    byEmploymentType: [{ employmentType: 'permanent', count: 3 }],
    byStore: [],
  }),
  employmentCostReport: vi.fn(),
  absenceReport: vi.fn(),
  turnoverReport: vi.fn(),
  timeToHideReport: vi.fn(),
  timeToHireReport: vi.fn(),
  statutoryLiabilityReport: vi.fn(),
  leaveUtilisationReport: vi.fn(),
}));

function need<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('unexpected null in test');
  return value;
}

const NOW = new Date('2026-10-17T03:00:00.000Z');

const DIGEST_SCHEDULE = {
  id: 'sched-1',
  organizationId: 'org-1',
  storeId: null,
  reportKey: 'headcount',
  frequency: 'DAILY',
  recipients: JSON.stringify(['owner@mbumah.co.ke', 'hr@mbumah.co.ke', 'audit@mbumah.co.ke']),
  weekday: null,
  dayOfMonth: null,
  hourUtc: 3,
  active: true,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  createdByUserId: 'user-creator-1',
  deletedAt: null,
};

describe('summariseRecipientSends (pure aggregate)', () => {
  it('every address delivered → SENT with no error', () => {
    const sends: RecipientSendResult[] = [
      { to: 'a@x.co.ke', success: true },
      { to: 'b@x.co.ke', success: true },
    ];
    expect(summariseRecipientSends(sends)).toEqual({ delivered: 2, total: 2, outcome: 'SENT', aggregateError: null });
  });

  it('no address delivered → FAILED with the aggregated copy', () => {
    const sends: RecipientSendResult[] = [
      { to: 'a@x.co.ke', success: false, error: 'invalid mailbox' },
      { to: 'b@x.co.ke', success: false, error: 'quota exceeded' },
    ];
    const s = summariseRecipientSends(sends);
    expect(s.outcome).toBe('FAILED');
    expect(s.delivered).toBe(0);
    expect(s.aggregateError).toContain('2 recipient(s) not delivered');
    expect(s.aggregateError).toContain('invalid mailbox');
  });

  it('mixed delivery → PARTIAL with the honest "Delivered to N of M" line', () => {
    const sends: RecipientSendResult[] = [
      { to: 'a@x.co.ke', success: true },
      { to: 'b@x.co.ke', success: false, error: 'mailbox unavailable' },
      { to: 'c@x.co.ke', success: true },
    ];
    const s = summariseRecipientSends(sends);
    expect(s.outcome).toBe('PARTIAL');
    expect(s.delivered).toBe(2);
    expect(s.total).toBe(3);
    expect(s.aggregateError).toContain('Delivered to 2 of 3 recipient(s)');
    expect(s.aggregateError).toContain('mailbox unavailable');
    expect(s.aggregateError).toContain('delivery history');
  });

  it('single-recipient failure keeps the plain error (no aggregate wrapper)', () => {
    const s = summariseRecipientSends([{ to: 'a@x.co.ke', success: false, error: 'RESEND_API_KEY not configured' }]);
    expect(s.outcome).toBe('FAILED');
    expect(s.aggregateError).toBe('RESEND_API_KEY not configured');
  });

  it('an empty plan refuses to claim success', () => {
    expect(summariseRecipientSends([]).outcome).toBe('FAILED');
  });
});

describe('sendDigestEnvelopes (service seam)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  const DIGEST = {
    reportLabel: 'Headcount',
    organizationName: 'MBUMAH Hardware',
    periodLabel: '2026-10-01 → 2026-10-17',
    scopeLabel: 'All branches',
    headline: [{ label: 'Active employees', value: '5' }],
    disclaimer: 'Aggregates only.',
    generatedAtIso: NOW.toISOString(),
    sections: [],
  } as unknown as Parameters<typeof sendDigestEnvelopes>[0]['digest'];

  it('sends ONE envelope PER RECIPIENT — no address ever shares a To: line', async () => {
    await sendDigestEnvelopes({
      recipients: ['a@x.co.ke', 'b@x.co.ke', 'c@x.co.ke'],
      digest: DIGEST,
      csv: null,
      metadata: { scheduleId: 'sched-1', reportKey: 'headcount' },
    });
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
    const tos = sendEmailMock.mock.calls.map((c) => (c[0] as { to: string[] }).to);
    expect(tos).toEqual([['a@x.co.ke'], ['b@x.co.ke'], ['c@x.co.ke']]);
  });

  it('every envelope carries the recipient-stamped metadata (address, index, count)', async () => {
    await sendDigestEnvelopes({
      recipients: ['a@x.co.ke', 'b@x.co.ke'],
      digest: DIGEST,
      csv: null,
      metadata: { scheduleId: 'sched-1', reportKey: 'headcount', frequency: 'DAILY' },
    });
    const metas = sendEmailMock.mock.calls.map((c) => (c[0] as { metadata: Record<string, unknown> }).metadata);
    expect(metas[0]).toMatchObject({ scheduleId: 'sched-1', recipientAddress: 'a@x.co.ke', recipientIndex: 1, recipientCount: 2 });
    expect(metas[1]).toMatchObject({ recipientAddress: 'b@x.co.ke', recipientIndex: 2, recipientCount: 2 });
  });

  it('the CSV attachment is identical on every envelope (built once upstream)', async () => {
    const csv = { filename: 'mbumah-headcount.csv', content: 'Yg==', byteSize: 12 };
    await sendDigestEnvelopes({
      recipients: ['a@x.co.ke', 'b@x.co.ke', 'c@x.co.ke'],
      digest: DIGEST,
      csv,
      metadata: { scheduleId: 'sched-1', reportKey: 'headcount' },
    });
    for (const call of sendEmailMock.mock.calls) {
      const att = (call[0] as { attachments?: Array<typeof csv> }).attachments;
      expect(need(att)[0].filename).toBe('mbumah-headcount.csv');
    }
    const metas = sendEmailMock.mock.calls.map((c) => (c[0] as { metadata: Record<string, unknown> }).metadata);
    for (const m of metas) expect(m).toMatchObject({ csvFilename: 'mbumah-headcount.csv', csvBytes: 12 });
  });

  it('a per-recipient failure is isolated: mixed sends summarise to PARTIAL', async () => {
    sendEmailMock
      .mockResolvedValueOnce({ success: true, messageId: 'm-1' })
      .mockResolvedValueOnce({ success: false, error: 'mailbox unavailable' })
      .mockResolvedValueOnce({ success: true, messageId: 'm-3' });
    const { summary } = await sendDigestEnvelopes({
      recipients: ['a@x.co.ke', 'b@x.co.ke', 'c@x.co.ke'],
      digest: DIGEST,
      csv: null,
      metadata: { scheduleId: 'sched-1', reportKey: 'headcount' },
    });
    expect(summary.outcome).toBe('PARTIAL');
    expect(summary.delivered).toBe(2);
  });

  it('a rejected sendEmail promise counts as that recipient\u2019s failure, never blows up the batch', async () => {
    sendEmailMock
      .mockRejectedValueOnce(new Error('network reset'))
      .mockResolvedValueOnce({ success: true, messageId: 'm-2' });
    const { sends, summary } = await sendDigestEnvelopes({
      recipients: ['a@x.co.ke', 'b@x.co.ke'],
      digest: DIGEST,
      csv: null,
      metadata: { scheduleId: 'sched-1', reportKey: 'headcount' },
    });
    expect(sends[0]).toMatchObject({ to: 'a@x.co.ke', success: false, error: 'network reset' });
    expect(summary.outcome).toBe('PARTIAL');
  });
});

describe('sweep wiring: runDueHrReportSchedules with per-recipient envelopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.hrReportSchedule.findMany.mockResolvedValue([]);
    db.notification.create.mockResolvedValue({ id: 'notif-1' });
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('mixed delivery stamps lastStatus PARTIAL with the honest lastError', async () => {
    db.hrReportSchedule.findMany.mockResolvedValue([DIGEST_SCHEDULE]);
    sendEmailMock
      .mockResolvedValueOnce({ success: true, messageId: 'm-1' })
      .mockResolvedValueOnce({ success: false, error: 'mailbox unavailable' })
      .mockResolvedValueOnce({ success: true, messageId: 'm-3' });
    const result = await runDueHrReportSchedules(NOW);
    expect(result.results[0]).toMatchObject({ status: 'PARTIAL', recipients: 3, delivered: 2 });
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sched-1' },
        data: expect.objectContaining({ lastStatus: 'PARTIAL', lastError: expect.stringContaining('Delivered to 2 of 3') }),
      }),
    );
  });

  it('the creator still gets ONE aggregate in-app copy, never one per recipient', async () => {
    db.hrReportSchedule.findMany.mockResolvedValue([DIGEST_SCHEDULE]);
    await runDueHrReportSchedules(NOW);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
  });

  it('all delivered → SENT with the delivered count on the result row', async () => {
    db.hrReportSchedule.findMany.mockResolvedValue([DIGEST_SCHEDULE]);
    const result = await runDueHrReportSchedules(NOW);
    expect(result.sent).toBe(1);
    expect(result.results[0]).toMatchObject({ status: 'SENT', recipients: 3, delivered: 3 });
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
  });

  it('every recipient failed → FAILED and the count is not incremented as sent', async () => {
    db.hrReportSchedule.findMany.mockResolvedValue([DIGEST_SCHEDULE]);
    sendEmailMock.mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured' });
    const result = await runDueHrReportSchedules(NOW);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({ status: 'FAILED', delivered: 0 });
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: 'FAILED' }) }),
    );
  });
});

describe('send-now wiring with per-recipient envelopes', () => {
  const ACTOR = { id: 'user-owner-1', role: 'STORE_OWNER', storeId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    db.hrReportSchedule.findFirst.mockResolvedValue(DIGEST_SCHEDULE);
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    db.notification.create.mockResolvedValue({ id: 'notif-1' });
    sendEmailMock.mockResolvedValue({ success: true, messageId: 'm-1' });
  });

  it('mixed delivery → outcome PARTIAL and an honest aggregate email', async () => {
    sendEmailMock
      .mockResolvedValueOnce({ success: true, messageId: 'm-1' })
      .mockResolvedValueOnce({ success: false, error: 'mailbox unavailable' })
      .mockResolvedValueOnce({ success: true, messageId: 'm-3' });
    const result = await sendScheduleNow('org-1', ACTOR, 'sched-1', NOW);
    expect(result.outcome).toBe('PARTIAL');
    expect(result.email.success).toBe(false);
    expect(result.email.error).toContain('Delivered to 2 of 3 recipient(s)');
    expect(result.schedule.lastStatus).toBe('PARTIAL');
  });

  it('all delivered → outcome SENT and email.success true', async () => {
    const result = await sendScheduleNow('org-1', ACTOR, 'sched-1', NOW);
    expect(result.outcome).toBe('SENT');
    expect(result.email.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(3);
  });
});

describe('deliveries: per-recipient rows surface the address', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.hrReportSchedule.findFirst.mockResolvedValue({ ...DIGEST_SCHEDULE, storeId: null });
  });

  it('a per-recipient envelope row exposes recipientAddress from metadata', async () => {
    db.notificationLog.findMany.mockResolvedValue([
      {
        id: 'nl-1',
        status: 'FAILED',
        recipient: 'hr@mbumah.co.ke',
        subject: 'Headcount digest',
        error: 'mailbox unavailable',
        sentAt: null,
        createdAt: new Date('2026-10-17T03:00:05.000Z'),
        metadata: JSON.stringify({ scheduleId: 'sched-1', recipientAddress: 'hr@mbumah.co.ke', recipientIndex: 2, recipientCount: 3 }),
      },
    ]);
    const rows = await listScheduleDeliveries('org-1', { id: 'u1', role: 'STORE_OWNER', storeId: null }, 'sched-1');
    expect(rows[0]).toMatchObject({ id: 'nl-1', status: 'FAILED', recipientAddress: 'hr@mbumah.co.ke', recipientList: ['hr@mbumah.co.ke'] });
  });

  it('legacy shared-envelope rows keep recipientAddress null (chips still work)', async () => {
    db.notificationLog.findMany.mockResolvedValue([
      {
        id: 'nl-2',
        status: 'SENT',
        recipient: 'owner@mbumah.co.ke, hr@mbumah.co.ke',
        subject: 'Headcount digest',
        error: null,
        sentAt: new Date('2026-10-12T02:00:05.000Z'),
        createdAt: new Date('2026-10-12T02:00:05.000Z'),
        metadata: JSON.stringify({ scheduleId: 'sched-1', recipientCount: 2 }),
      },
    ]);
    const rows = await listScheduleDeliveries('org-1', { id: 'u1', role: 'STORE_OWNER', storeId: null }, 'sched-1');
    expect(rows[0].recipientAddress).toBeNull();
    expect(rows[0].recipientList).toEqual(['owner@mbumah.co.ke', 'hr@mbumah.co.ke']);
  });
});
