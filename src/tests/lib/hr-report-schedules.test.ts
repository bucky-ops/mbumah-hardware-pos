// SCHEDULED HR REPORT DIGEST TESTS - v2.22.0
//
// Contracts under test (scheduled /hr/reports digests):
//   • validateScheduleInput: report/frequency/recipient/hour validation,
//     dedup + lowercase recipients, WEEKLY needs weekday 0-6, MONTHLY needs
//     day 1-28.
//   • isScheduleDue: DAILY fires once per UTC day after the send hour;
//     WEEKLY only on the configured weekday; MONTHLY on the configured day
//     (day>28 impossible by construction); never before the send hour; not
//     re-fires within the same slot (lastRunAt guard).
//   • runDueHrReportSchedules: sends when due (mocked email success stamps
//     SENT), records FAILED + lastError on send failure, SKIPPED when the
//     report returns no data, and force=true treats every active schedule as
//     due regardless of the clock.
//   • Digest payloads aggregate only: no employee names / national IDs /
//     raw ids reach the email builder (asserted via the generated HTML).

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
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
});

vi.mock('@/lib/db', () => ({ db, runWithoutTenant: async <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/email-service', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'm-1' }) }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { REPORT_SCHEDULE: 'HrReportSchedule' },
}));

// The reports service hits Prisma models per report; for the sweep contract
// tests we only exercise headcount (mocked) — other report keys return null
// (SKIPPED) which is itself a covered branch.
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
  timeToHireReport: vi.fn(),
  statutoryLiabilityReport: vi.fn(),
}));

import { sendEmail } from '@/lib/email-service';
import { hrAudit } from '@/lib/hr/audit';
import {
  validateScheduleInput,
  isScheduleDue,
  runDueHrReportSchedules,
  buildDigestData,
  sendScheduleNow,
  HrScheduleError,
} from '@/lib/hr/report-schedule-service';

// Wednesday 2026-10-14 03:30 UTC.
const NOW = new Date('2026-10-14T03:30:00Z');

describe('validateScheduleInput', () => {
  const base = {
    reportKey: 'headcount',
    frequency: 'WEEKLY',
    recipients: ['Owner@Mbumah.co.ke', 'hr@mbumah.co.ke', 'owner@mbumah.co.ke'],
    weekday: 1,
    hourUtc: 2,
  };

  it('dedupes + lowercases recipients', () => {
    const v = validateScheduleInput(base);
    expect(v.recipients).toEqual(['owner@mbumah.co.ke', 'hr@mbumah.co.ke']);
  });

  it('rejects unknown reports and frequencies', () => {
    expect(() => validateScheduleInput({ ...base, reportKey: 'salaries' })).toThrow(HrScheduleError);
    expect(() => validateScheduleInput({ ...base, frequency: 'HOURLY' })).toThrow(HrScheduleError);
  });

  it('rejects bad emails and empty lists', () => {
    expect(() => validateScheduleInput({ ...base, recipients: ['not-an-email'] })).toThrow(/valid email/);
    expect(() => validateScheduleInput({ ...base, recipients: [] })).toThrow(/At least one recipient/);
  });

  it('WEEKLY needs weekday 0-6; MONTHLY needs day 1-28; hour 0-23', () => {
    expect(() => validateScheduleInput({ ...base, weekday: 7 })).toThrow(/weekday/);
    expect(() => validateScheduleInput({ ...base, frequency: 'MONTHLY', weekday: null, dayOfMonth: 0 })).toThrow(/day of month/);
    expect(() => validateScheduleInput({ ...base, dayOfMonth: null, weekday: null, hourUtc: 24 })).toThrow(/hour/);
    expect(validateScheduleInput({ ...base, frequency: 'MONTHLY', weekday: null, dayOfMonth: 28 })).toMatchObject({ dayOfMonth: 28, weekday: null });
  });
});

describe('isScheduleDue', () => {
  const mk = (over: Record<string, unknown> = {}) => ({
    frequency: 'DAILY',
    weekday: null,
    dayOfMonth: null,
    hourUtc: 3,
    lastRunAt: null as Date | null,
    ...over,
  });

  it('fires once per UTC day and catches up on the most recent past slot', () => {
    expect(isScheduleDue(mk(), NOW)).toBe(true);
    // Catch-up: at 03:30 a 04:00 schedule is due for YESTERDAY's slot (the
    // nightly sweep is the only trigger, so a missed hour still fires).
    expect(isScheduleDue(mk({ hourUtc: 4 }), NOW)).toBe(true);
    // ...unless yesterday's slot was already claimed.
    expect(
      isScheduleDue(mk({ hourUtc: 4, lastRunAt: new Date('2026-10-13T04:00:00Z') }), NOW),
    ).toBe(false);
  });

  it('does not refire within the same slot', () => {
    const ranToday = mk({ lastRunAt: new Date('2026-10-14T03:00:01Z') });
    expect(isScheduleDue(ranToday, NOW)).toBe(false);
  });

  it('fires on a missed slot from before yesterday; today\u2019s passed slot is due once', () => {
    const missedYesterday = mk({ lastRunAt: new Date('2026-10-12T03:00:00Z') });
    expect(isScheduleDue(missedYesterday, NOW)).toBe(true);
    // lastRun yesterday 03:00 claimed YESTERDAY\u2019s slot; TODAY\u2019s 03:00 slot
    // has already passed and is still unclaimed -> due.
    const ranYesterday = mk({ lastRunAt: new Date('2026-10-13T03:00:00Z') });
    expect(isScheduleDue(ranYesterday, NOW)).toBe(true);
    // ...and after claiming today\u2019s slot it goes quiet.
    expect(isScheduleDue(mk({ lastRunAt: new Date('2026-10-14T03:00:00Z') }), NOW)).toBe(false);
  });

  it('WEEKLY fires only on the configured weekday', () => {
    const wednesday = mk({ frequency: 'WEEKLY', weekday: 3 });
    const tuesday = mk({ frequency: 'WEEKLY', weekday: 2 });
    expect(isScheduleDue(wednesday, NOW)).toBe(true); // 2026-10-14 is a Wednesday
    expect(isScheduleDue(tuesday, NOW)).toBe(false);
  });

  it('MONTHLY fires only on the configured day', () => {
    const on14th = mk({ frequency: 'MONTHLY', dayOfMonth: 14 });
    const on15th = mk({ frequency: 'MONTHLY', dayOfMonth: 15 });
    expect(isScheduleDue(on14th, NOW)).toBe(true);
    expect(isScheduleDue(on15th, NOW)).toBe(false);
  });
});

describe('runDueHrReportSchedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.hrReportSchedule.findMany.mockResolvedValue([]);
  });

  it('sends a due schedule and stamps SENT', async () => {
    db.hrReportSchedule.findMany.mockResolvedValue([
      {
        id: 'sched-1',
        organizationId: 'org-1',
        storeId: null,
        reportKey: 'headcount',
        frequency: 'DAILY',
        recipients: JSON.stringify(['owner@mbumah.co.ke']),
        weekday: null,
        dayOfMonth: null,
        hourUtc: 3,
        active: true,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      },
    ]);
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    const result = await runDueHrReportSchedules(NOW);
    expect(result.sent).toBe(1);
    expect(result.results[0]).toMatchObject({ status: 'SENT', recipients: 1 });
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sched-1' }, data: expect.objectContaining({ lastStatus: 'SENT' }) }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(hrAudit).toHaveBeenCalled();
  });

  it('records FAILED with the error on send failure', async () => {
    (sendEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, error: 'RESEND_API_KEY not configured' });
    db.hrReportSchedule.findMany.mockResolvedValue([
      {
        id: 'sched-2',
        organizationId: 'org-1',
        storeId: null,
        reportKey: 'headcount',
        frequency: 'DAILY',
        recipients: JSON.stringify(['owner@mbumah.co.ke']),
        weekday: null,
        dayOfMonth: null,
        hourUtc: 3,
        active: true,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      },
    ]);
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    const result = await runDueHrReportSchedules(NOW);
    expect(result.failed).toBe(1);
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: 'FAILED', lastError: 'RESEND_API_KEY not configured' }) }),
    );
  });

  it('respects the due calculation unless force=true', async () => {
    const inactiveSlot = {
      id: 'sched-3',
      organizationId: 'org-1',
      storeId: null,
      reportKey: 'headcount',
      frequency: 'DAILY',
      recipients: JSON.stringify(['owner@mbumah.co.ke']),
      weekday: null,
      dayOfMonth: null,
      hourUtc: 12,
      // Most recent slot = yesterday 12:00 (today's is in the future at
      // 03:30) - already claimed, so the schedule is NOT due.
      lastRunAt: new Date('2026-10-13T12:00:00Z'),
      lastStatus: 'SENT',
      lastError: null,
    };
    db.hrReportSchedule.findMany.mockResolvedValue([inactiveSlot]);
    const notDue = await runDueHrReportSchedules(NOW);
    expect(notDue.due).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();

    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    const forced = await runDueHrReportSchedules(NOW, true);
    expect(forced.due).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('digest HTML carries aggregates only (no names / national IDs / raw ids)', async () => {
    db.hrReportSchedule.findMany.mockResolvedValue([
      {
        id: 'sched-4',
        organizationId: 'org-1',
        storeId: null,
        reportKey: 'headcount',
        frequency: 'DAILY',
        recipients: JSON.stringify(['owner@mbumah.co.ke']),
        weekday: null,
        dayOfMonth: null,
        hourUtc: 3,
        active: true,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
      },
    ]);
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    await runDueHrReportSchedules(NOW);
    const call = (sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][0] as { html: string; text: string };
    expect(call.html).toContain('Headcount');
    expect(call.html).toContain('Active employees');
    // "national" appears in the digest disclaimer itself - assert no PII
    // VALUES (names, ids) leak instead of matching the English word.
    const forbidden = /Mary|Wanjiku|nationalId|emp-1|detail-1|sched-4/i;
    expect(forbidden.test(call.html)).toBe(false);
    expect(forbidden.test(call.text)).toBe(false);
  });
});

describe('buildDigestData scope session', () => {
  it('uses a BRANCH-scoped synthetic session for store schedules', async () => {
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    db.store.findUnique.mockResolvedValue({ name: 'Juja Main' });
    const digest = await buildDigestData(
      { organizationId: 'org-1', storeId: 'store-9', reportKey: 'headcount', frequency: 'WEEKLY' },
      NOW,
    );
    expect(digest?.scopeLabel).toBe('Juja Main');
    expect(digest?.reportLabel).toBe('Headcount');
  });
});

// ── v2.24.0: manual sendScheduleNow ─────────────────────────────────────────

describe('sendScheduleNow', () => {
  const rowBase = {
    id: 'sched-9',
    organizationId: 'org-1',
    storeId: null as string | null,
    reportKey: 'headcount',
    frequency: 'DAILY',
    recipients: JSON.stringify(['owner@mbumah.co.ke']),
    weekday: null as number | null,
    dayOfMonth: null as number | null,
    hourUtc: 3,
    active: true,
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
  const orgActor = { id: 'user-owner', role: 'STORE_OWNER', storeId: null };
  const bmActor = { id: 'user-bm', role: 'BRANCH_MANAGER', storeId: 'store-9' };

  beforeEach(() => {
    vi.clearAllMocks();
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH Hardware' });
    db.notification.create.mockResolvedValue({ id: 'notif-1' });
  });

  it('404s for an unknown / cross-org schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(null);
    await expect(sendScheduleNow('org-1', orgActor, 'sched-9', NOW)).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
      status: 404,
    });
  });

  it('forbids a BRANCH manager sending an out-of-scope schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue({ ...rowBase, storeId: 'store-other' });
    await expect(sendScheduleNow('org-1', bmActor, 'sched-9', NOW)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    });
  });

  it('allows a BRANCH manager to send their OWN branch schedule and stamps SENT without touching lastRunAt', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue({ ...rowBase, storeId: 'store-9', lastRunAt: new Date('2026-10-14T03:00:00Z') });
    const result = await sendScheduleNow('org-1', bmActor, 'sched-9', NOW);
    expect(result.outcome).toBe('SENT');
    expect(result.email.success).toBe(true);
    // The stored row's lastRunAt is echoed untouched in the view (ISO string).
    expect(result.schedule.lastRunAt).toBe('2026-10-14T03:00:00.000Z');
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sched-9' }, data: expect.objectContaining({ lastStatus: 'SENT' }) }),
    );
    const updateData = (db.hrReportSchedule.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(updateData.lastRunAt).toBeUndefined();
    // In-app copy addressed to the ACTOR, category HR, quiet priority.
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: 'HR', userId: 'user-bm', priority: 'NORMAL', storeId: 'store-9' }),
      }),
    );
    // Audit carries the REAL actor + manualSend marker.
    expect(hrAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'user-bm', actorRole: 'BRANCH_MANAGER', metadata: expect.objectContaining({ manualSend: true, outcome: 'SENT' }) }));
  });

  it('stamps FAILED + HIGH-priority notification when the email send fails', async () => {
    (sendEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false, error: 'RESEND_API_KEY not configured' });
    db.hrReportSchedule.findFirst.mockResolvedValue({ ...rowBase, lastRunAt: null });
    const result = await sendScheduleNow('org-1', orgActor, 'sched-9', NOW);
    expect(result.outcome).toBe('FAILED');
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: 'FAILED' }) }),
    );
    const updateData = (db.hrReportSchedule.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(updateData.lastRunAt).toBeUndefined();
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: 'HR', priority: 'HIGH' }) }),
    );
  });

  it('SKIPPED when the report returns no data (still writes the in-app copy)', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue({ ...rowBase, reportKey: 'employment-cost' });
    const result = await sendScheduleNow('org-1', orgActor, 'sched-9', NOW);
    expect(result.outcome).toBe('SKIPPED');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: 'HR', userId: 'user-owner' }) }),
    );
  });
});
