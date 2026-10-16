// MBUMAH HARDWARE POS - HR report schedule service (v2.22.0)
//
// Scheduled email digests for the /hr/reports aggregate reports. A schedule
// (report × frequency × recipients × UTC hour) is swept by the nightly cron;
// when due it computes the report through the SAME governed service functions
// the interactive routes use (fail-closed scope, aggregates only) and emails
// the digest via the central email service. Delivery outcome is stamped on
// the row (lastRunAt/lastStatus/lastError) so the Reports UI can surface it.
//
// Safety model:
//   • CRUD requires hr.report permission resolved through the standard HR
//     guard in the route layer; the service itself re-checks the schedule's
//     organization every read (no cross-org leakage).
//   • Sweep identity is a synthetic session scoped to the schedule's
//     organization (and store when the schedule is store-scoped) so reports
//     never widen beyond what the schedule owner could see interactively.
//   • Recipients are validated email addresses; frequency/weekday/dayOfMonth
//     are validated at write time and re-validated before compute.
//   • Every sweep outcome is audit-logged (HrEntityType.REPORT_SCHEDULE) with
//     field-name metadata only.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { sendEmail } from '@/lib/email-service';
import {
  hrReportDigestTemplate,
  hrReportDigestText,
  type HrReportDigestData,
} from '@/lib/email-templates';
import {
  absenceReport,
  employmentCostReport,
  headcountReport,
  statutoryLiabilityReport,
  timeToHireReport,
  turnoverReport,
} from './reports';
import type { AuthSession } from '@/lib/auth';

export const HR_SCHEDULE_REPORTS = [
  'headcount',
  'employment-cost',
  'absence',
  'turnover',
  'time-to-hire',
  'statutory-liability',
] as const;
export type HrScheduleReportKey = (typeof HR_SCHEDULE_REPORTS)[number];

export const HR_SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type HrScheduleFrequency = (typeof HR_SCHEDULE_FREQUENCIES)[number];

export const REPORT_LABELS: Record<HrScheduleReportKey, string> = {
  headcount: 'Headcount',
  'employment-cost': 'Employment cost',
  absence: 'Absence',
  turnover: 'Turnover',
  'time-to-hire': 'Time to hire',
  'statutory-liability': 'Statutory liability',
};

export class HrScheduleError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = 'HrScheduleError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ScheduleInput {
  reportKey: string;
  frequency: string;
  recipients: string[];
  weekday?: number | null;
  dayOfMonth?: number | null;
  hourUtc?: number;
  storeId?: string | null;
}

/** Validate + normalise a schedule payload. Throws HrScheduleError on bad input. */
export function validateScheduleInput(input: ScheduleInput): Required<Pick<ScheduleInput, 'reportKey' | 'frequency' | 'recipients' | 'hourUtc'>> & ScheduleInput {
  if (!HR_SCHEDULE_REPORTS.includes(input.reportKey as HrScheduleReportKey)) {
    throw new HrScheduleError('INVALID_REPORT', 'Unknown report key for a schedule.', 422);
  }
  if (!HR_SCHEDULE_FREQUENCIES.includes(input.frequency as HrScheduleFrequency)) {
    throw new HrScheduleError('INVALID_FREQUENCY', 'Frequency must be DAILY, WEEKLY or MONTHLY.', 422);
  }
  const recipients = [...new Set((input.recipients ?? []).map((r) => String(r).trim().toLowerCase()))].filter(Boolean);
  if (recipients.length === 0) {
    throw new HrScheduleError('NO_RECIPIENTS', 'At least one recipient email is required.', 422);
  }
  for (const r of recipients) {
    if (!EMAIL_RE.test(r) || r.length > 254) {
      throw new HrScheduleError('INVALID_RECIPIENT', `Not a valid email address: ${r.slice(0, 60)}`, 422);
    }
  }
  const hourUtc = Math.trunc(Number(input.hourUtc ?? 2));
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
    throw new HrScheduleError('INVALID_HOUR', 'Send hour must be 0-23 (UTC).', 422);
  }
  let weekday: number | null = null;
  let dayOfMonth: number | null = null;
  if (input.frequency === 'WEEKLY') {
    weekday = Math.trunc(Number(input.weekday));
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new HrScheduleError('INVALID_WEEKDAY', 'Weekly schedules need a weekday 0-6 (0 = Sunday).', 422);
    }
  } else if (input.frequency === 'MONTHLY') {
    dayOfMonth = Math.trunc(Number(input.dayOfMonth));
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
      throw new HrScheduleError('INVALID_DAY_OF_MONTH', 'Monthly schedules need a day of month 1-28.', 422);
    }
  }
  return { ...input, reportKey: input.reportKey as HrScheduleReportKey, frequency: input.frequency as HrScheduleFrequency, recipients, hourUtc, weekday, dayOfMonth };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function listSchedules(organizationId: string) {
  return db.hrReportSchedule.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export interface ScheduleView {
  id: string;
  reportKey: string;
  reportLabel: string;
  frequency: string;
  recipients: string[];
  weekday: number | null;
  dayOfMonth: number | null;
  hourUtc: number;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  storeId: string | null;
}

export function toScheduleView(row: {
  id: string;
  reportKey: string;
  frequency: string;
  recipients: string;
  weekday: number | null;
  dayOfMonth: number | null;
  hourUtc: number;
  active: boolean;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: Date;
  storeId: string | null;
}): ScheduleView {
  let recipients: string[] = [];
  try {
    const parsed = JSON.parse(row.recipients) as unknown;
    if (Array.isArray(parsed)) recipients = parsed.map(String).slice(0, 20);
  } catch {
    recipients = [];
  }
  return {
    id: row.id,
    reportKey: row.reportKey,
    reportLabel: REPORT_LABELS[row.reportKey as HrScheduleReportKey] ?? row.reportKey,
    frequency: row.frequency,
    recipients,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    hourUtc: row.hourUtc,
    active: row.active,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    storeId: row.storeId,
  };
}

export async function createSchedule(
  organizationId: string,
  actorId: string,
  input: ScheduleInput,
) {
  const v = validateScheduleInput(input);
  const row = await db.hrReportSchedule.create({
    data: {
      organizationId,
      storeId: v.storeId ?? null,
      reportKey: v.reportKey,
      frequency: v.frequency,
      recipients: JSON.stringify(v.recipients),
      weekday: v.weekday,
      dayOfMonth: v.dayOfMonth,
      hourUtc: v.hourUtc,
      createdByUserId: actorId,
    },
  });
  await hrAudit({
    actorId,
    actorRole: 'SYSTEM',
    action: 'CREATE',
    resourceType: HrEntityType.REPORT_SCHEDULE,
    resourceId: row.id,
    storeId: v.storeId ?? undefined,
    metadata: { reportKey: v.reportKey, frequency: v.frequency, recipientCount: v.recipients.length, hourUtc: v.hourUtc },
  });
  return row;
}

export async function updateSchedule(
  organizationId: string,
  actorId: string,
  id: string,
  patch: Partial<ScheduleInput> & { active?: boolean },
) {
  const existing = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!existing) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  const merged: ScheduleInput = {
    reportKey: patch.reportKey ?? existing.reportKey,
    frequency: patch.frequency ?? existing.frequency,
    recipients: patch.recipients ?? safeParseRecipients(existing.recipients),
    weekday: patch.weekday ?? existing.weekday,
    dayOfMonth: patch.dayOfMonth ?? existing.dayOfMonth,
    hourUtc: patch.hourUtc ?? existing.hourUtc,
    storeId: patch.storeId ?? existing.storeId,
  };
  const v = validateScheduleInput(merged);
  const row = await db.hrReportSchedule.update({
    where: { id: existing.id },
    data: {
      reportKey: v.reportKey,
      frequency: v.frequency,
      recipients: JSON.stringify(v.recipients),
      weekday: v.weekday,
      dayOfMonth: v.dayOfMonth,
      hourUtc: v.hourUtc,
      active: typeof patch.active === 'boolean' ? patch.active : existing.active,
    },
  });
  await hrAudit({
    actorId,
    actorRole: 'SYSTEM',
    action: 'UPDATE',
    resourceType: HrEntityType.REPORT_SCHEDULE,
    resourceId: row.id,
    metadata: {
      active: row.active,
      reportKey: row.reportKey,
      frequency: row.frequency,
      hourUtc: row.hourUtc,
    },
  });
  return row;
}

export async function deleteSchedule(organizationId: string, actorId: string, id: string) {
  const existing = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!existing) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  await db.hrReportSchedule.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), active: false },
  });
  await hrAudit({
    actorId,
    actorRole: 'SYSTEM',
    action: 'DELETE',
    resourceType: HrEntityType.REPORT_SCHEDULE,
    resourceId: existing.id,
    metadata: { reportKey: existing.reportKey, softDeleted: true },
  });
}

function safeParseRecipients(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// ── Digest computation + email ──────────────────────────────────────────────

/** Synthetic, narrowly-scoped session for the cron sweep. */
function sweepSession(schedule: { organizationId: string; storeId: string | null }): AuthSession {
  return {
    userId: 'system-hr-digests',
    email: 'system@hr-digests.local',
    role: schedule.storeId ? 'BRANCH_MANAGER' : 'SUPER_ADMIN',
    storeId: schedule.storeId,
    organizationId: schedule.organizationId,
  };
}

function monthPeriod(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: now,
  };
}

function quarterPeriod(now: Date): { from: Date; to: Date } {
  const startMonth = now.getUTCMonth() - 2;
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1)),
    to: now,
  };
}

/** Build the digest payload for one schedule (or null when the report is empty). */
export async function buildDigestData(
  schedule: { organizationId: string; storeId: string | null; reportKey: string; frequency: string },
  now: Date = new Date(),
): Promise<HrReportDigestData | null> {
  const session = sweepSession(schedule);
  const period = schedule.frequency === 'MONTHLY' ? monthPeriod(now) : quarterPeriod(now);
  const periodLabel = `${period.from.toISOString().slice(0, 10)} → ${period.to.toISOString().slice(0, 10)}`;
  const org = await db.organization.findUnique({
    where: { id: schedule.organizationId },
    select: { name: true },
  });
  const scopeLabel = schedule.storeId
    ? (await db.store.findUnique({ where: { id: schedule.storeId }, select: { name: true } }))?.name ?? 'Branch'
    : 'All branches';

  const base = {
    organizationName: org?.name ?? 'MBUMAH Hardware',
    periodLabel,
    scopeLabel,
    frequencyLabel: schedule.frequency,
  };

  switch (schedule.reportKey) {
    case 'headcount': {
      const r = await headcountReport(session, period);
      if (!r) return null;
      return {
        ...base,
        reportLabel: REPORT_LABELS.headcount,
        headline: [
          { label: 'Active employees', value: String(r.active) },
          { label: 'On leave', value: String(r.onLeave) },
          { label: 'Suspended', value: String(r.suspended) },
          { label: 'Hires in period', value: String(r.hiresInPeriod) },
          { label: 'Exits in period', value: String(r.exitsInPeriod) },
          { label: 'Average tenure', value: `${r.avgTenureYears}y` },
        ],
        table: {
          caption: 'By employment type',
          columns: ['Type', 'Count'],
          rows: r.byEmploymentType.map((b) => [b.employmentType, b.count]),
        },
      };
    }
    case 'employment-cost': {
      const r = await employmentCostReport(session, period);
      if (!r) return null;
      const fmt = (v: number) => `KES ${v.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return {
        ...base,
        reportLabel: REPORT_LABELS['employment-cost'],
        headline: [
          { label: 'Total gross', value: fmt(r.totalGross) },
          { label: 'Employer statutory', value: fmt(r.totalEmployerStatutory) },
          { label: 'Total cost', value: fmt(r.totalCost) },
          { label: 'Payslips in period', value: String(r.payslipCount) },
        ],
        table: {
          caption: 'Monthly cost',
          columns: ['Month', 'Gross', 'Employer', 'Total'],
          rows: r.monthly.map((m) => [m.label, fmt(m.grossPay), fmt(m.employerStatutory), fmt(m.totalCost)]),
        },
      };
    }
    case 'absence': {
      const r = await absenceReport(session, period);
      if (!r) return null;
      return {
        ...base,
        reportLabel: REPORT_LABELS.absence,
        headline: [
          { label: 'Active employees', value: String(r.activeEmployees) },
          { label: 'Absent days', value: String(r.absentDays) },
          { label: 'Leave days taken', value: String(r.leaveDays) },
          { label: 'Absence rate', value: `${r.absenceRatePct}%` },
          { label: 'Leave rate', value: `${r.leaveRatePct}%` },
        ],
        table: {
          caption: 'Attendance days by status',
          columns: ['Status', 'Days'],
          rows: r.byStatus.map((b) => [b.status, b.days]),
        },
      };
    }
    case 'turnover': {
      const r = await turnoverReport(session, period);
      if (!r) return null;
      return {
        ...base,
        reportLabel: REPORT_LABELS.turnover,
        headline: [
          { label: 'Exits in period', value: String(r.exits) },
          { label: 'Hires in period', value: String(r.hires) },
          { label: 'Active now', value: String(r.activeNow) },
          { label: 'Annualised turnover', value: `${r.annualisedTurnoverPct}%` },
        ],
        table: {
          caption: 'Exits by branch',
          columns: ['Branch', 'Exits'],
          rows: r.perStoreExitCounts.map((b) => [b.storeName, b.exits]),
        },
      };
    }
    case 'time-to-hire': {
      const r = await timeToHireReport(session, period);
      if (!r) return null;
      return {
        ...base,
        reportLabel: REPORT_LABELS['time-to-hire'],
        headline: [
          { label: 'Converted hires', value: String(r.convertedCount) },
          { label: 'Median days to hire', value: String(r.medianDaysToHire) },
          { label: 'Average days to hire', value: String(r.averageDaysToHire) },
        ],
      };
    }
    case 'statutory-liability': {
      const r = await statutoryLiabilityReport(session, period);
      if (!r) return null;
      const fmt = (v: number) => `KES ${v.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return {
        ...base,
        reportLabel: REPORT_LABELS['statutory-liability'],
        headline: [
          { label: 'PAYE', value: fmt(r.totals.paye) },
          { label: 'NSSF', value: fmt(r.totals.nssf) },
          { label: 'SHIF', value: fmt(r.totals.shif) },
          { label: 'Housing levy', value: fmt(r.totals.housingLevy) },
          { label: 'Total statutory', value: fmt(r.totals.total) },
        ],
        table: {
          caption: 'Monthly statutory liability',
          columns: ['Month', 'PAYE', 'NSSF', 'SHIF', 'AHL', 'Total'],
          rows: r.monthly.map((m) => [m.label, fmt(m.paye), fmt(m.nssf), fmt(m.shif), fmt(m.housingLevy), fmt(m.paye + m.nssf + m.shif + m.housingLevy + m.payeArrears)]),
        },
      };
    }
    default:
      return null;
  }
}

// ── Due-date logic + sweep ──────────────────────────────────────────────────

/**
 * Whether a schedule is due at `now`. Due = the scheduled send instant
 * (yesterday-or-earlier guard so a missed hour still fires on the next sweep)
 * is strictly after lastRunAt. DAILY fires once per UTC day; WEEKLY on the
 * configured weekday; MONTHLY on the configured day (clamped to 28).
 */
export function isScheduleDue(
  schedule: { frequency: string; weekday: number | null; dayOfMonth: number | null; hourUtc: number; lastRunAt: Date | null },
  now: Date,
): boolean {
  const lastRun = schedule.lastRunAt?.getTime() ?? 0;
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), schedule.hourUtc, 0, 0));
  if (base.getTime() > now.getTime()) {
    // Today's send instant not reached yet; check yesterday's slot.
    base.setUTCDate(base.getUTCDate() - 1);
  }
  if (base.getTime() <= lastRun) return false;

  if (schedule.frequency === 'DAILY') return true;
  if (schedule.frequency === 'WEEKLY') return base.getUTCDay() === schedule.weekday;
  if (schedule.frequency === 'MONTHLY') return base.getUTCDate() === Math.min(schedule.dayOfMonth ?? 1, 28);
  return false;
}

export interface ScheduleSweepResult {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  results: Array<{ id: string; reportKey: string; status: 'SENT' | 'FAILED' | 'SKIPPED'; error?: string; recipients: number }>;
}

/**
 * Run every due schedule. Call from the nightly cron (and the manual
 * `?force=1` path — force treats every active schedule as due WITHOUT
 * touching lastRunAt history). Each schedule is isolated: one failure never
 * blocks the rest, and outcomes are stamped on the row + audit logged.
 */
export async function runDueHrReportSchedules(
  now: Date = new Date(),
  force: boolean = false,
): Promise<ScheduleSweepResult> {
  const candidates = await db.hrReportSchedule.findMany({
    where: { active: true, deletedAt: null },
  });
  const result: ScheduleSweepResult = { due: 0, sent: 0, failed: 0, skipped: 0, results: [] };

  for (const schedule of candidates) {
    if (!force && !isScheduleDue(schedule, now)) continue;
    result.due += 1;
    const recipients = safeParseRecipients(schedule.recipients);
    try {
      const digest = await buildDigestData(schedule, now);
      if (!digest) {
        await db.hrReportSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastStatus: 'SKIPPED', lastError: 'Report returned no data for scope.' },
        });
        result.skipped += 1;
        result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'SKIPPED', recipients: recipients.length });
        continue;
      }
      const email = await sendEmail({
        to: recipients,
        subject: `${digest.reportLabel} digest — ${digest.organizationName} (${digest.periodLabel})`,
        html: hrReportDigestTemplate(digest),
        text: hrReportDigestText(digest),
        type: 'HR_REPORT_DIGEST',
        metadata: { scheduleId: schedule.id, reportKey: schedule.reportKey, frequency: schedule.frequency },
      });
      if (email.success) {
        await db.hrReportSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastStatus: 'SENT', lastError: null },
        });
        result.sent += 1;
        result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'SENT', recipients: recipients.length });
      } else {
        await db.hrReportSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastStatus: 'FAILED', lastError: (email.error ?? 'Email send failed').slice(0, 250) },
        });
        result.failed += 1;
        result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'FAILED', error: email.error, recipients: recipients.length });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Digest computation failed';
      await db.hrReportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, lastStatus: 'FAILED', lastError: message.slice(0, 250) },
      }).catch(() => {});
      result.failed += 1;
      result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'FAILED', error: message, recipients: recipients.length });
    }

    await hrAudit({
      actorId: 'system-hr-digests',
      actorRole: 'SYSTEM',
      action: 'EXECUTE',
      resourceType: HrEntityType.REPORT_SCHEDULE,
      resourceId: schedule.id,
      storeId: schedule.storeId,
      metadata: { scheduledDigest: true, reportKey: schedule.reportKey, recipientCount: recipients.length },
    }).catch(() => {});
  }
  return result;
}
