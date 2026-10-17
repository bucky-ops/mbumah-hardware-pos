// SCHEDULE RE-SEND TESTS - v2.55.0
//
// "The failed get another chance" — when a digest delivery comes up short
// (PARTIAL or FAILED), the schedule card names exactly who missed it and
// offers one-tap re-send to ONLY those addresses.
//
// Contracts under test:
//   • latestBatchFailedRecipients (PURE): the batch = rows within
//     RESEND_BATCH_WINDOW_MS of the newest row; per-recipient envelope rows
//     speak for their own address; legacy shared-envelope rows speak for
//     their whole list; delivered-wins (an address both delivered and failed
//     in the same window is NEVER re-emailed); honest batch verdict
//     (SENT/PARTIAL/FAILED/PENDING); older batches never widen today's retry.
//   • getScheduleResendInfo: 404 unknown schedule; 403 BRANCH manager out of
//     branch; failed list = batch-failed ∩ CURRENT recipients (a removal is
//     honoured, not undone); read-only (no stamps, no audit).
//   • resendFailedDigest: 409 NOTHING_TO_RESEND when the latest batch
//     delivered everything; sends EXACTLY to the missed addresses (server-
//     derived, metadata.resend stamped); recomputes the digest fresh; cadence
//     untouched (lastRunAt never written); SKIPPED when the report has no
//     data; audit logs carry the real actor + resend flag.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
  });
  return {
    hrReportSchedule: model(),
    organization: model(),
    store: model(),
    notification: model(),
    notificationLog: model(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
});

vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' }) }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { REPORT_SCHEDULE: 'HrReportSchedule' },
}));
vi.mock('@/lib/hr/reports', () => ({
  headcountReport: vi.fn().mockResolvedValue({
    active: 5,
    onLeave: 0,
    suspended: 0,
    hiresInPeriod: 0,
    exitsInPeriod: 0,
    avgTenureYears: 2.1,
    byEmploymentType: [{ employmentType: 'PERMANENT', count: 5 }],
  }),
  employmentCostReport: vi.fn(),
  absenceReport: vi.fn(),
  turnoverReport: vi.fn(),
  timeToHireReport: vi.fn(),
  statutoryLiabilityReport: vi.fn(),
}));

import {
  RESEND_BATCH_WINDOW_MS,
  getScheduleResendInfo,
  latestBatchFailedRecipients,
  resendFailedDigest,
} from '@/lib/hr/report-schedule-service';
import type { HrScheduleError } from '@/lib/hr/report-schedule-service';
import { hrAudit } from '@/lib/hr/audit';
import { sendEmail } from '@/lib/email-service';

const ORG = 'org_mbumah';
const SCHEDULE_ID = 'sched-1';
const OWNER = 'owner@mbumahhardware.co.ke';
const HR = 'hr@mbumahhardware.co.ke';
const T = '2026-10-17T02:00:00Z'; // batch instant
const T_MS = Date.parse(T);

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    organizationId: ORG,
    storeId: null,
    reportKey: 'headcount',
    frequency: 'WEEKLY',
    recipients: JSON.stringify([OWNER, HR]),
    weekday: 1,
    dayOfMonth: null,
    hourUtc: 2,
    active: true,
    lastRunAt: new Date(T),
    lastStatus: 'FAILED',
    lastError: '2 recipient(s) not delivered: RESEND_API_KEY not configured - email send skipped.',
    createdByUserId: 'user_hr',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

/** A v2.54+ per-recipient envelope row (one address, own status). */
function perRecipientRow(address: string, status: string, atMs: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `nl-${address}-${status}-${atMs}`,
    type: 'HR_REPORT_DIGEST',
    status,
    recipient: address,
    subject: 'Headcount digest — MBUMAH HARDWARE',
    error: status === 'SENT' ? null : 'RESEND_API_KEY not configured - email send skipped.',
    sentAt: status === 'SENT' ? new Date(atMs) : null,
    createdAt: new Date(atMs),
    metadata: JSON.stringify({
      scheduleId: SCHEDULE_ID,
      reportKey: 'headcount',
      recipientAddress: address,
      recipientIndex: 1,
      recipientCount: 2,
      manual: true,
    }),
    ...overrides,
  };
}

const ORG_ACTOR = { id: 'user_admin', role: 'HR_MANAGER', storeId: null };
const BM_ACTOR = { id: 'user_bm', role: 'BRANCH_MANAGER', storeId: 'store_juja_main' };

beforeEach(() => {
  vi.clearAllMocks();
  db.hrReportSchedule.findMany.mockResolvedValue([]);
  db.notificationLog.findMany.mockResolvedValue([]);
  db.hrReportSchedule.update.mockResolvedValue(scheduleRow());
  db.notification.create.mockResolvedValue({ id: 'notif-1' });
  db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE' });
});

// ── latestBatchFailedRecipients (PURE) ──────────────────────────────────────

describe('latestBatchFailedRecipients', () => {
  it('no rows → nothing to do (batchAt null, no failures)', () => {
    const v = latestBatchFailedRecipients([]);
    expect(v).toEqual({ batchAt: null, lastStatus: null, delivered: 0, total: 0, failed: [] });
  });

  it('per-recipient batch: mixed SENT/FAILED names only the failed addresses', () => {
    const v = latestBatchFailedRecipients([
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: OWNER, recipientList: [OWNER] },
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: HR, recipientList: [HR] },
    ]);
    expect(v.failed).toEqual([HR, OWNER].sort());
    expect(v.delivered).toBe(0);
    expect(v.total).toBe(2);
    expect(v.lastStatus).toBe('FAILED');
    expect(v.batchAt).toBe(new Date(T).toISOString());
  });

  it('per-recipient batch: one SENT one FAILED is a PARTIAL verdict', () => {
    const v = latestBatchFailedRecipients([
      { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: OWNER, recipientList: [OWNER] },
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: HR, recipientList: [HR] },
    ]);
    expect(v.lastStatus).toBe('PARTIAL');
    expect(v.delivered).toBe(1);
    expect(v.failed).toEqual([HR]);
  });

  it('per-recipient batch: all SENT → nothing failed, verdict SENT', () => {
    const v = latestBatchFailedRecipients([
      { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: OWNER, recipientList: [OWNER] },
      { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: HR, recipientList: [HR] },
    ]);
    expect(v.lastStatus).toBe('SENT');
    expect(v.failed).toEqual([]);
    expect(v.total).toBe(2);
  });

  it('legacy shared-envelope row: FAILED puts its whole list up for retry', () => {
    const v = latestBatchFailedRecipients([
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: null, recipientList: [OWNER, HR] },
    ]);
    expect(v.lastStatus).toBe('FAILED');
    expect(v.failed).toEqual([OWNER, HR].sort());
  });

  it('legacy shared-envelope row: SENT delivers its whole list (nothing failed)', () => {
    const v = latestBatchFailedRecipients([
      { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: null, recipientList: [OWNER, HR] },
    ]);
    expect(v.lastStatus).toBe('SENT');
    expect(v.failed).toEqual([]);
  });

  it('delivered wins: an address both delivered and failed in the window is NEVER re-emailed', () => {
    const v = latestBatchFailedRecipients([
      { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: OWNER, recipientList: [OWNER] },
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: null, recipientList: [OWNER, HR] },
    ]);
    expect(v.failed).toEqual([HR]);
    expect(v.delivered).toBe(1);
  });

  it(`rows older than the ${RESEND_BATCH_WINDOW_MS}ms window are history, not the batch`, () => {
    const v = latestBatchFailedRecipients([
      // The batch: only HR failed now.
      { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: OWNER, recipientList: [OWNER] },
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: HR, recipientList: [HR] },
      // Yesterday's failure must NOT widen today's re-send.
      { status: 'FAILED', createdAt: new Date(T_MS - 24 * 3600 * 1000), recipientAddress: 'ghost@past.co.ke', recipientList: ['ghost@past.co.ke'] },
      // Just inside the window still counts (15s − 1ms).
      { status: 'FAILED', createdAt: new Date(T_MS - RESEND_BATCH_WINDOW_MS + 1), recipientAddress: 'edge@in.co.ke', recipientList: ['edge@in.co.ke'] },
    ]);
    expect(v.failed).toEqual(['edge@in.co.ke', HR].sort());
    // Just outside the window is excluded when re-derived with a tighter window.
    const tight = latestBatchFailedRecipients(
      [
        { status: 'SENT', createdAt: new Date(T_MS), recipientAddress: OWNER, recipientList: [OWNER] },
        { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: HR, recipientList: [HR] },
        { status: 'FAILED', createdAt: new Date(T_MS - RESEND_BATCH_WINDOW_MS - 1), recipientAddress: 'edge@out.co.ke', recipientList: ['edge@out.co.ke'] },
      ],
      RESEND_BATCH_WINDOW_MS,
    );
    expect(tight.failed).toEqual([HR]);
  });

  it('addresses without an @ are ignored (defensive against junk rows)', () => {
    const v = latestBatchFailedRecipients([
      { status: 'FAILED', createdAt: new Date(T_MS), recipientAddress: null, recipientList: [OWNER, 'broken-fragment'] },
    ]);
    expect(v.failed).toEqual([OWNER]);
  });
});

// ── getScheduleResendInfo ───────────────────────────────────────────────────

describe('getScheduleResendInfo', () => {
  it('404 when the schedule does not exist in the organization', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(null);
    await expect(getScheduleResendInfo(ORG, ORG_ACTOR, 'missing')).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
      status: 404,
    } as Partial<HrScheduleError>);
  });

  it('403 when a BRANCH manager reads an org-wide schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(getScheduleResendInfo(ORG, BM_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    } as Partial<HrScheduleError>);
  });

  it('names the failed addresses and stays read-only (no stamps, no audit)', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      perRecipientRow(OWNER, 'FAILED', T_MS),
      perRecipientRow(HR, 'FAILED', T_MS),
    ]);

    const info = await getScheduleResendInfo(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(info.available).toBe(true);
    expect(info.lastStatus).toBe('FAILED');
    expect(info.failedRecipients).toEqual([OWNER, HR].sort());
    expect(info.total).toBe(2);

    // Read-only: no writes of any kind.
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(hrAudit).not.toHaveBeenCalled();
  });

  it('honours a removal: a failed address since struck from the recipients is not offered', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(
      scheduleRow({ recipients: JSON.stringify([OWNER]) }),
    );
    db.notificationLog.findMany.mockResolvedValue([
      perRecipientRow(OWNER, 'FAILED', T_MS),
      perRecipientRow(HR, 'FAILED', T_MS),
      perRecipientRow('ghost@removed.co.ke', 'FAILED', T_MS),
    ]);

    const info = await getScheduleResendInfo(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(info.failedRecipients).toEqual([OWNER]);
    expect(info.available).toBe(true);
    // Historical facts still describe the batch as it happened.
    expect(info.total).toBe(3);
  });

  it('available=false when the latest batch delivered everything', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      perRecipientRow(OWNER, 'SENT', T_MS),
      perRecipientRow(HR, 'SENT', T_MS),
    ]);
    const info = await getScheduleResendInfo(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(info.available).toBe(false);
    expect(info.failedRecipients).toEqual([]);
  });
});

// ── resendFailedDigest ──────────────────────────────────────────────────────

describe('resendFailedDigest', () => {
  it('404 / 403 scope mirrors every other schedule action', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(null);
    await expect(resendFailedDigest(ORG, ORG_ACTOR, 'missing')).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
      status: 404,
    } as Partial<HrScheduleError>);

    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(resendFailedDigest(ORG, BM_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    } as Partial<HrScheduleError>);
  });

  it('409 NOTHING_TO_RESEND when the latest batch delivered everything', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      perRecipientRow(OWNER, 'SENT', T_MS),
      perRecipientRow(HR, 'SENT', T_MS),
    ]);
    await expect(resendFailedDigest(ORG, ORG_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      code: 'NOTHING_TO_RESEND',
      status: 409,
    } as Partial<HrScheduleError>);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('re-sends EXACTLY to the missed addresses with the re-send stamp, fresh digest, cadence untouched', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      perRecipientRow(OWNER, 'FAILED', T_MS),
      perRecipientRow(HR, 'FAILED', T_MS),
    ]);

    const now = new Date(Date.UTC(2026, 9, 17, 9, 0));
    const result = await resendFailedDigest(ORG, ORG_ACTOR, SCHEDULE_ID, now);

    // The mocked provider succeeds → SENT, and reSentTo names who got it.
    expect(result.outcome).toBe('SENT');
    expect(result.reSentTo).toEqual([OWNER, HR].sort());
    expect(result.digestSummary?.reportLabel).toBe('Headcount');
    expect(result.csv).not.toBeNull();

    // One envelope per missed address — nobody else is emailed.
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const tos = (sendEmail as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { to: string[] }).to,
    );
    expect(tos.map((t) => t[0]).sort()).toEqual([OWNER, HR].sort());

    // Every envelope is stamped as a re-send answering the failed batch.
    for (const call of (sendEmail as ReturnType<typeof vi.fn>).mock.calls) {
      const meta = (call[0] as { metadata: Record<string, unknown> }).metadata;
      expect(meta.resend).toBe(true);
      expect(meta.resendOfBatchAt).toBe(new Date(T).toISOString());
      expect(meta.manual).toBe(true);
      expect(meta.actorId).toBe('user_admin');
    }

    // The row stamp mirrors the outcome but NEVER touches the cadence.
    const update = db.hrReportSchedule.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(update.where.id).toBe(SCHEDULE_ID);
    expect(update.data.lastStatus).toBe('SENT');
    expect(update.data.lastError).toBeNull();
    expect(update.data).not.toHaveProperty('lastRunAt');

    // Audit carries the REAL actor + the resend flag.
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user_admin',
        actorRole: 'HR_MANAGER',
        action: 'EXECUTE',
        resourceId: SCHEDULE_ID,
        metadata: expect.objectContaining({ resend: true, recipientCount: 2, outcome: 'SENT' }),
      }),
    );
  });

  it('a PARTIAL re-send stamps PARTIAL with the honest aggregate error', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      perRecipientRow(OWNER, 'FAILED', T_MS),
      perRecipientRow(HR, 'FAILED', T_MS),
    ]);
    (sendEmail as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: true, messageId: 'm-1' })
      .mockResolvedValueOnce({ success: false, error: 'Mailbox unavailable' });

    const result = await resendFailedDigest(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(result.outcome).toBe('PARTIAL');
    expect(result.email.success).toBe(false);
    expect(result.email.error).toContain('Delivered to 1 of 2');

    const update = db.hrReportSchedule.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(update.data.lastStatus).toBe('PARTIAL');
  });

  it('SKIPPED with an honest note when the report returns no data (nothing emailed)', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ reportKey: 'employment-cost' }));
    db.notificationLog.findMany.mockResolvedValue([perRecipientRow(OWNER, 'FAILED', T_MS)]);

    const result = await resendFailedDigest(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(result.outcome).toBe('SKIPPED');
    expect(result.reSentTo).toEqual([]);
    expect(result.email.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();

    const update = db.hrReportSchedule.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(update.data.lastStatus).toBe('SKIPPED');
  });

  it('a BRANCH manager may re-send their OWN branch schedule; audit keeps the real role', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: 'store_juja_main' }));
    db.notificationLog.findMany.mockResolvedValue([perRecipientRow(OWNER, 'FAILED', T_MS)]);

    const result = await resendFailedDigest(ORG, BM_ACTOR, SCHEDULE_ID);
    expect(result.outcome).toBe('SENT');
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user_bm', actorRole: 'BRANCH_MANAGER' }),
    );
  });
});
