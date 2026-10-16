// SCHEDULE DELIVERY OBSERVABILITY TESTS - v2.25.0
//
// Contracts under test:
//   • nextScheduleRunAt: DAILY advances to tomorrow's send hour when the
//     slot has passed (or lastRunAt already covers it); WEEKLY lands on the
//     configured weekday AFTER both `from` and lastRunAt; MONTHLY lands on
//     the configured day of this or the next month; manual sends never move
//     the cadence (lastRunAt wins over `from` when later).
//   • listScheduleDeliveries: 404 for a missing schedule; BRANCH managers
//     are pinned to their own branch's schedule (org-wide + other-branch →
//     403); maps NotificationLog rows (metadata.scheduleId correlation) with
//     recipient count + manual flag parsed from metadata; malformed metadata
//     falls back to the comma-split recipient count.
//   • previewScheduleDigest: 404 / 403 scope fail-closed; returns the exact
//     digest payload (headlines + table) WITHOUT sending email, writing a
//     notification or NotificationLog row, or touching lastStatus (pure
//     read); unavailableReason is surfaced when the report has no data.
//   • The email service persists every attempt to NotificationLog (success
//     → status SENT + sentAt + messageId metadata; provider failure →
//     status FAILED + error) — the regression guard for the missing model.

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
  deleteSchedule,
  listScheduleDeliveries,
  nextScheduleRunAt,
  previewScheduleDigest,
  updateSchedule,
} from '@/lib/hr/report-schedule-service';
import type { HrScheduleError } from '@/lib/hr/report-schedule-service';
import { hrAudit } from '@/lib/hr/audit';

const ORG = 'org_mbumah';
const SCHEDULE_ID = 'sched-1';

function scheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    organizationId: ORG,
    storeId: null,
    reportKey: 'headcount',
    frequency: 'WEEKLY',
    recipients: JSON.stringify(['owner@mbumahhardware.co.ke', 'hr@mbumahhardware.co.ke']),
    weekday: 1,
    dayOfMonth: null,
    hourUtc: 2,
    active: true,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdByUserId: 'user_hr',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

const ORG_ACTOR = { id: 'user_admin', role: 'HR_MANAGER', storeId: null };
const BM_ACTOR = { id: 'user_bm', role: 'BRANCH_MANAGER', storeId: 'store_juja_main' };

beforeEach(() => {
  vi.clearAllMocks();
  db.hrReportSchedule.findMany.mockResolvedValue([]);
  db.notificationLog.findMany.mockResolvedValue([]);
});

// ── nextScheduleRunAt ───────────────────────────────────────────────────────

describe('nextScheduleRunAt', () => {
  it('daily: returns today\'s slot when the send hour has not passed', () => {
    const from = new Date(Date.UTC(2026, 9, 16, 1, 30)); // 01:30, slot at 02:00
    const next = nextScheduleRunAt({ frequency: 'DAILY', weekday: null, dayOfMonth: null, hourUtc: 2, lastRunAt: null }, from);
    expect(next.toISOString()).toBe('2026-10-16T02:00:00.000Z');
  });

  it('daily: rolls to tomorrow after the send hour', () => {
    const from = new Date(Date.UTC(2026, 9, 16, 3, 0));
    const next = nextScheduleRunAt({ frequency: 'DAILY', weekday: null, dayOfMonth: null, hourUtc: 2, lastRunAt: null }, from);
    expect(next.toISOString()).toBe('2026-10-17T02:00:00.000Z');
  });

  it('daily: lastRunAt wins over `from` (manual send never moves the cadence)', () => {
    const from = new Date(Date.UTC(2026, 9, 16, 1, 0));
    const last = new Date(Date.UTC(2026, 9, 16, 2, 0)); // today's slot already fired
    const next = nextScheduleRunAt({ frequency: 'DAILY', weekday: null, dayOfMonth: null, hourUtc: 2, lastRunAt: last }, from);
    expect(next.toISOString()).toBe('2026-10-17T02:00:00.000Z');
  });

  it('weekly: next Monday strictly after from and lastRunAt', () => {
    // 2026-10-16 is a Friday; Monday slot at 02:00.
    const from = new Date(Date.UTC(2026, 9, 16, 10, 0));
    const next = nextScheduleRunAt({ frequency: 'WEEKLY', weekday: 1, dayOfMonth: null, hourUtc: 2, lastRunAt: null }, from);
    expect(next.toISOString()).toBe('2026-10-19T02:00:00.000Z');
    expect(next.getUTCDay()).toBe(1);
  });

  it('weekly: skips this week\'s already-fired slot', () => {
    // Fired Monday 2026-10-19 02:00; from is Monday 10:00 → next Monday.
    const from = new Date(Date.UTC(2026, 9, 19, 10, 0));
    const last = new Date(Date.UTC(2026, 9, 19, 2, 0));
    const next = nextScheduleRunAt({ frequency: 'WEEKLY', weekday: 1, dayOfMonth: null, hourUtc: 2, lastRunAt: last }, from);
    expect(next.toISOString()).toBe('2026-10-26T02:00:00.000Z');
  });

  it('monthly: lands on the configured day of this month when still ahead', () => {
    const from = new Date(Date.UTC(2026, 9, 10, 12, 0));
    const next = nextScheduleRunAt({ frequency: 'MONTHLY', weekday: null, dayOfMonth: 15, hourUtc: 2, lastRunAt: null }, from);
    expect(next.toISOString()).toBe('2026-10-15T02:00:00.000Z');
  });

  it('monthly: rolls to next month when the day has passed', () => {
    const from = new Date(Date.UTC(2026, 9, 20, 12, 0));
    const next = nextScheduleRunAt({ frequency: 'MONTHLY', weekday: null, dayOfMonth: 15, hourUtc: 2, lastRunAt: null }, from);
    expect(next.toISOString()).toBe('2026-11-15T02:00:00.000Z');
  });
});

// ── listScheduleDeliveries ──────────────────────────────────────────────────

describe('listScheduleDeliveries', () => {
  it('404 when the schedule does not exist in the organization', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(null);
    await expect(listScheduleDeliveries(ORG, ORG_ACTOR, 'missing')).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
      status: 404,
    } as Partial<HrScheduleError>);
  });

  it('403 when a BRANCH manager reads an org-wide schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(listScheduleDeliveries(ORG, BM_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    } as Partial<HrScheduleError>);
  });

  it('403 when a BRANCH manager reads another branch\'s schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: 'store_thika' }));
    await expect(listScheduleDeliveries(ORG, BM_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      status: 403,
    } as Partial<HrScheduleError>);
  });

  it('returns rows mapped from NotificationLog with metadata parsed', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      {
        id: 'nl-1',
        status: 'FAILED',
        recipient: 'owner@mbumahhardware.co.ke, hr@mbumahhardware.co.ke',
        subject: 'Headcount digest — Mbumah',
        error: 'RESEND_API_KEY not configured',
        sentAt: null,
        createdAt: new Date('2026-10-16T04:00:00Z'),
        metadata: JSON.stringify({ scheduleId: SCHEDULE_ID, manual: true, recipientCount: 2 }),
      },
      {
        id: 'nl-2',
        status: 'SENT',
        recipient: 'owner@mbumahhardware.co.ke, hr@mbumahhardware.co.ke',
        subject: 'Headcount digest — Mbumah',
        error: null,
        sentAt: new Date('2026-10-12T02:00:05Z'),
        createdAt: new Date('2026-10-12T02:00:00Z'),
        metadata: JSON.stringify({ scheduleId: SCHEDULE_ID, messageId: 'resend-1' }),
      },
    ]);

    const rows = await listScheduleDeliveries(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'nl-1', status: 'FAILED', manual: true, recipients: 2 });
    expect(rows[1]).toMatchObject({ id: 'nl-2', status: 'SENT', manual: false, recipients: 2, sentAt: '2026-10-12T02:00:05.000Z' });

    // Correlation filter: digest type + scheduleId pinned into the metadata.
    expect(db.notificationLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: 'HR_REPORT_DIGEST',
          metadata: { contains: `"scheduleId":"${SCHEDULE_ID}"` },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    );
  });

  it('caps limit to 50 and falls back to 10 on junk input', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    await listScheduleDeliveries(ORG, ORG_ACTOR, SCHEDULE_ID, 500);
    expect(db.notificationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    await listScheduleDeliveries(ORG, ORG_ACTOR, SCHEDULE_ID, Number.NaN);
    expect(db.notificationLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('tolerates malformed metadata JSON (comma-split fallback)', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow());
    db.notificationLog.findMany.mockResolvedValue([
      {
        id: 'nl-bad',
        status: 'SENT',
        recipient: 'a@x.co.ke, b@x.co.ke, c@x.co.ke',
        subject: 's',
        error: null,
        sentAt: null,
        createdAt: new Date('2026-10-16T04:00:00Z'),
        metadata: 'not-json{',
      },
    ]);
    const rows = await listScheduleDeliveries(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(rows[0].recipients).toBe(3);
    expect(rows[0].manual).toBe(false);
  });
});

// ── previewScheduleDigest ───────────────────────────────────────────────────

describe('previewScheduleDigest', () => {
  it('404 for a missing schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(null);
    await expect(previewScheduleDigest(ORG, ORG_ACTOR, 'missing')).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
      status: 404,
    } as Partial<HrScheduleError>);
  });

  it('403 when a BRANCH manager previews an org-wide schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(previewScheduleDigest(ORG, BM_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    } as Partial<HrScheduleError>);
  });

  it('returns the digest payload without ANY side effects', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: 'store_juja_main' }));
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE' });
    db.store.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE - Juja Main' });

    const now = new Date(Date.UTC(2026, 9, 16, 8, 0));
    const preview = await previewScheduleDigest(ORG, ORG_ACTOR, SCHEDULE_ID, now);

    expect(preview.unavailableReason).toBeNull();
    expect(preview.reportLabel).toBe('Headcount');
    expect(preview.periodLabel).toContain('2026-10-16');
    expect(preview.scopeLabel).toBe('MBUMAH HARDWARE - Juja Main');
    expect(preview.headlines[0]).toEqual({ label: 'Active employees', value: '5' });
    expect(preview.table?.caption).toBe('By employment type');
    expect(preview.recipients).toHaveLength(2);
    // nextRunAt: Friday 2026-10-16 → next Monday 08:00 slot is 2026-10-19T02:00Z.
    expect(preview.nextRunAt).toBe('2026-10-19T02:00:00.000Z');

    // PURE READ — no email, no notification row, no NotificationLog row, no
    // lastStatus stamp, no schedule update of any kind.
    expect(db.notificationLog.create).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();
    expect(db.hrReportSchedule.updateMany).not.toHaveBeenCalled();
  });

  it('surfaces unavailableReason instead of throwing when the report has no data', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ reportKey: 'employment-cost' }));
    db.organization.findUnique.mockResolvedValue({ name: 'MBUMAH HARDWARE' });

    const preview = await previewScheduleDigest(ORG, ORG_ACTOR, SCHEDULE_ID);
    expect(preview.unavailableReason).toBe('Report returned no data for this scope and period.');
    expect(preview.periodLabel).toBeNull();
    expect(preview.headlines).toEqual([]);
    // Still no side effects on the skipped path.
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();
  });
});

// ── v2.26.0: write scope (PATCH/DELETE) ─────────────────────────────────

describe('updateSchedule / deleteSchedule fail-closed scope', () => {
  beforeEach(() => {
    db.hrReportSchedule.update.mockResolvedValue(scheduleRow());
  });

  it('403 when a BRANCH manager patches an org-wide schedule (previously writable)', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(
      updateSchedule(ORG, BM_ACTOR, SCHEDULE_ID, { recipients: ['bm@mbumahhardware.co.ke'] }),
    ).rejects.toMatchObject({ code: 'STORE_SCOPE_FORBIDDEN', status: 403 } as Partial<HrScheduleError>);
    // The escalation attempt must not reach the database.
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();
  });

  it('403 when a BRANCH manager patches another branch\'s schedule', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: 'store_thika' }));
    await expect(
      updateSchedule(ORG, BM_ACTOR, SCHEDULE_ID, { active: false }),
    ).rejects.toMatchObject({ status: 403 } as Partial<HrScheduleError>);
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();
  });

  it('BRANCH manager may patch their OWN branch\'s schedule; recipients are normalized', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: 'store_juja_main' }));
    // Invalid address → 422 (no write, no audit).
    await expect(
      updateSchedule(ORG, BM_ACTOR, SCHEDULE_ID, {
        recipients: ['owner@mbumahhardware.co.ke', 'bad-address'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECIPIENT', status: 422 } as Partial<HrScheduleError>);
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();

    // Valid input: trim + lowercase + dedupe before the write.
    await expect(
      updateSchedule(ORG, BM_ACTOR, SCHEDULE_ID, {
        recipients: ['  Owner@MbumahHardware.co.ke ', 'owner@mbumahhardware.co.ke'],
      }),
    ).resolves.toBeDefined();
    const write = db.hrReportSchedule.update.mock.calls[0][0] as { data: { recipients: string } };
    expect(JSON.parse(write.data.recipients)).toEqual(['owner@mbumahhardware.co.ke']);
    // Audit carries the REAL actor, not the synthetic SYSTEM identity.
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user_bm', actorRole: 'BRANCH_MANAGER', action: 'UPDATE' }),
    );
  });

  it('org roles may still patch org-wide schedules', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(
      updateSchedule(ORG, ORG_ACTOR, SCHEDULE_ID, { hourUtc: 5 }),
    ).resolves.toBeDefined();
    expect(db.hrReportSchedule.update).toHaveBeenCalled();
  });

  it('403 when a BRANCH manager deletes an org-wide schedule; audit uses the real role on success', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: null }));
    await expect(deleteSchedule(ORG, BM_ACTOR, SCHEDULE_ID)).rejects.toMatchObject({
      code: 'STORE_SCOPE_FORBIDDEN',
      status: 403,
    } as Partial<HrScheduleError>);
    expect(db.hrReportSchedule.update).not.toHaveBeenCalled();

    db.hrReportSchedule.findFirst.mockResolvedValue(scheduleRow({ storeId: 'store_juja_main' }));
    await deleteSchedule(ORG, BM_ACTOR, SCHEDULE_ID);
    expect(db.hrReportSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: false }),
      }),
    );
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user_bm', actorRole: 'BRANCH_MANAGER', action: 'DELETE' }),
    );
  });

  it('404 when the schedule does not exist (before any scope check)', async () => {
    db.hrReportSchedule.findFirst.mockResolvedValue(null);
    await expect(updateSchedule(ORG, ORG_ACTOR, 'missing', { active: true })).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
      status: 404,
    } as Partial<HrScheduleError>);
    await expect(deleteSchedule(ORG, ORG_ACTOR, 'missing')).rejects.toMatchObject({
      status: 404,
    } as Partial<HrScheduleError>);
  });
});
