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
import { digestToCsv, formatCsvSize, type DigestCsvAttachment } from '@/lib/hr/digest-csv';
import {
  hrReportDigestTemplate,
  hrReportDigestText,
  type HrReportDigestData,
} from '@/lib/email-templates';
import {
  absenceReport,
  employmentCostReport,
  headcountReport,
  leaveUtilisationReport,
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
  'leave-utilisation',
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
  'leave-utilisation': 'Leave balances',
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

/**
 * v2.23.0: scope-aware storeId enforcement. BRANCH-scope schedule owners are
 * PINNED to their own store (a manager must never schedule a digest for a
 * branch they cannot see); ORG-scope owners may target any store of their
 * organization (validated) or leave it org-wide.
 */
export async function resolveScheduleStore(
  actor: { role: string; storeId: string | null; organizationId: string },
  storeId: string | null | undefined,
): Promise<string | null> {
  if (actor.role === 'BRANCH_MANAGER') {
    if (storeId && storeId !== actor.storeId) {
      throw new HrScheduleError('STORE_SCOPE_FORBIDDEN', 'Branch managers can only schedule digests for their own branch.', 403);
    }
    return actor.storeId;
  }
  if (!storeId) return null;
  const store = await db.store.findFirst({
    where: { id: storeId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!store) {
    throw new HrScheduleError('STORE_NOT_FOUND', 'Branch not found in this organization.', 404);
  }
  return store.id;
}

export async function createSchedule(
  organizationId: string,
  actorId: string,
  input: ScheduleInput,
  actor?: { role: string; storeId: string | null; organizationId: string },
) {
  const v = validateScheduleInput(input);
  const storeId = actor ? await resolveScheduleStore(actor, v.storeId) : (v.storeId ?? null);
  const row = await db.hrReportSchedule.create({
    data: {
      organizationId,
      storeId,
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
    storeId: row.storeId ?? undefined,
    metadata: { reportKey: v.reportKey, frequency: v.frequency, recipientCount: v.recipients.length, hourUtc: v.hourUtc, storeScoped: Boolean(row.storeId) },
  });
  return row;
}

export async function updateSchedule(
  organizationId: string,
  actor: { id: string; role: string; storeId: string | null },
  id: string,
  patch: Partial<ScheduleInput> & { active?: boolean },
) {
  const existing = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!existing) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  assertScheduleScope(existing, actor);
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
    actorId: actor.id,
    actorRole: actor.role,
    action: 'UPDATE',
    resourceType: HrEntityType.REPORT_SCHEDULE,
    resourceId: row.id,
    storeId: row.storeId ?? undefined,
    metadata: {
      active: row.active,
      reportKey: row.reportKey,
      frequency: row.frequency,
      hourUtc: row.hourUtc,
    },
  });
  return row;
}

export async function deleteSchedule(
  organizationId: string,
  actor: { id: string; role: string; storeId: string | null },
  id: string,
) {
  const existing = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!existing) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  assertScheduleScope(existing, actor);
  await db.hrReportSchedule.update({
    where: { id: existing.id },
    data: { deletedAt: new Date(), active: false },
  });
  await hrAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'DELETE',
    resourceType: HrEntityType.REPORT_SCHEDULE,
    resourceId: existing.id,
    storeId: existing.storeId ?? undefined,
    metadata: { reportKey: existing.reportKey, softDeleted: true },
  });
}

/**
 * v2.26.0: fail-closed row scope for schedule writes (PATCH/DELETE), closing
 * the gap that let a BRANCH_MANAGER edit or delete org-wide and other-branch
 * schedules — e.g. adding their own address to an ORG-scope digest and
 * receiving aggregates of branches they must never see. Mirrors the scope
 * rules of sendScheduleNow / previewScheduleDigest / listScheduleDeliveries:
 * org roles may touch any schedule of their organization; a BRANCH manager
 * may only touch their own branch's schedule (org-wide = out of scope).
 */
function assertScheduleScope(
  row: { id: string; storeId: string | null },
  actor: { id: string; role: string; storeId: string | null },
): void {
  if (actor.role === 'BRANCH_MANAGER' && row.storeId !== actor.storeId) {
    throw new HrScheduleError(
      'STORE_SCOPE_FORBIDDEN',
      'Branch managers can only manage schedules for their own branch.',
      403,
    );
  }
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

/**
 * Shared header-block facts of every digest (email body AND CSV header rows).
 * v2.52.0: extracted so the ad-hoc CSV export route and the scheduled email
 * resolve organization / scope labels through ONE code path — the labels on
 * a downloaded CSV can never drift from the labels in the email.
 */
export interface DigestMeta {
  organizationName: string;
  scopeLabel: string;
  periodLabel: string;
  frequencyLabel: string;
}

/** Resolve the digest's organization + scope labels for a caller's scope. */
export async function digestOrgAndScope(
  organizationId: string,
  storeId: string | null,
): Promise<{ organizationName: string; scopeLabel: string }> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  const scopeLabel = storeId
    ? (await db.store.findUnique({ where: { id: storeId }, select: { name: true } }))?.name ?? 'Branch'
    : 'All branches';
  return { organizationName: org?.name ?? 'MBUMAH Hardware', scopeLabel };
}

/**
 * Build ONE report's digest payload from an explicit session + period + meta
 * block. v2.52.0: extracted from buildDigestData so the ad-hoc CSV export
 * route (GET /api/hr/reports/export) and the scheduled email share a single
 * builder — a downloaded CSV always carries the same aggregates, labels and
 * table shape the digest email would. `opts.storeId` narrows the report to a
 * branch (org-scope caller drill-down, fail-closed inside the report fns).
 */
export async function buildDigestPayload(
  session: AuthSession,
  reportKey: string,
  period: { from: Date; to: Date },
  meta: DigestMeta,
  now: Date = new Date(),
  opts?: { storeId?: string | null; year?: number },
): Promise<HrReportDigestData | null> {
  const base = {
    organizationName: meta.organizationName,
    periodLabel: meta.periodLabel,
    scopeLabel: meta.scopeLabel,
    frequencyLabel: meta.frequencyLabel,
  };

  switch (reportKey) {
    case 'headcount': {
      const r = await headcountReport(session, period, opts);
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
      const r = await employmentCostReport(session, period, opts);
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
      const r = await absenceReport(session, period, opts);
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
      const r = await turnoverReport(session, period, opts);
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
      const r = await timeToHireReport(session, period, opts);
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
      const r = await statutoryLiabilityReport(session, period, opts);
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
    case 'leave-utilisation': {
      // v2.37.0: the only YEAR-KEYED schedule — balances are calendar-year
      // scoped, NOT period-keyed, so the digest re-computes for the current
      // UTC leave year on every fire and says so in the period label.
      // v2.52.0: the ad-hoc export passes the page's selected leave year so
      // the CSV always matches what the screen shows.
      const year = opts?.year ?? now.getUTCFullYear();
      const r = await leaveUtilisationReport(session, year, { storeId: opts?.storeId ?? session.storeId ?? null });
      if (!r) return null;
      const pct = (v: number) => `${Math.round(v * 10) / 10}%`;
      return {
        ...base,
        reportLabel: REPORT_LABELS['leave-utilisation'],
        periodLabel: `Leave year ${year}`,
        headline: [
          { label: 'Tracked rows', value: String(r.totals.tracked) },
          { label: 'Liability days', value: String(r.totals.available) },
          { label: 'Committed', value: pct(r.totals.committedPct) },
          { label: 'Over-drawn', value: String(r.totals.overdrawn) },
          { label: 'Pending days', value: String(r.totals.pending) },
          { label: 'Exhausted / low', value: `${r.totals.exhausted} / ${r.totals.low}` },
        ],
        table: {
          caption: `Entitlement by leave type (${r.year})`,
          columns: ['Type', 'Allocated', 'Carried', 'Used', 'Pending', 'Available', 'Committed %'],
          rows: r.byType.map((t) => [t.type, String(t.allocated), String(t.carried), String(t.used), String(t.pending), String(t.available), pct(t.committedPct)]),
        },
      };
    }
    default:
      return null;
  }
}

/** Build the digest payload for one schedule (or null when the report is empty). */
export async function buildDigestData(
  schedule: { organizationId: string; storeId: string | null; reportKey: string; frequency: string },
  now: Date = new Date(),
): Promise<HrReportDigestData | null> {
  const session = sweepSession(schedule);
  const period = schedule.frequency === 'MONTHLY' ? monthPeriod(now) : quarterPeriod(now);
  const periodLabel = `${period.from.toISOString().slice(0, 10)} → ${period.to.toISOString().slice(0, 10)}`;
  const { organizationName, scopeLabel } = await digestOrgAndScope(schedule.organizationId, schedule.storeId);
  return buildDigestPayload(
    session,
    schedule.reportKey,
    period,
    { organizationName, scopeLabel, periodLabel, frequencyLabel: schedule.frequency },
    now,
    { storeId: schedule.storeId },
  );
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
  /** v2.54.0: `delivered` counts the per-recipient envelopes that actually went out; `status` gains PARTIAL (mixed delivery). */
  results: Array<{ id: string; reportKey: string; status: 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED'; error?: string; recipients: number; delivered?: number }>;
}

// v2.24.0: schedule report keys -> /hr/reports deep-link tab ids (the UI
// shortens 'employment-cost' to 'cost' and 'time-to-hire' to 'tth').
export const REPORT_KEY_TO_TAB: Record<HrScheduleReportKey, string> = {
  headcount: 'headcount',
  'employment-cost': 'cost',
  absence: 'absence',
  turnover: 'turnover',
  'time-to-hire': 'tth',
  'statutory-liability': 'statutory',
  'leave-utilisation': 'leave',
};

function digestHeadlines(digest: HrReportDigestData): string {
  return (digest.headline ?? [])
    .slice(0, 3)
    .map((h) => `${h.label}: ${h.value}`)
    .join(' · ');
}

/**
 * v2.24.0: mirror a digest outcome into the IN-APP notification center.
 *
 * Scheduled sends notify the schedule's creator; manual send-now notifies
 * the actor. Success rows are quiet (category HR, priority NORMAL - they
 * surface in the bell feed only); failures get priority HIGH so the alert
 * popup host surfaces them to the person who owns the schedule. The digest
 * itself is aggregate-only (same contract as the email), and the copy never
 * blocks the digest flow: any notification failure is swallowed.
 */
async function writeDigestNotification(params: {
  scheduleId: string;
  reportKey: string;
  storeId: string | null;
  recipientUserId: string;
  digest: HrReportDigestData | null;
  email: { success: boolean; error?: string | null };
  manual: boolean;
  /** v2.46.0: set when the email carried the ready-to-file CSV. */
  attachmentLabel?: string | null;
}): Promise<string | null> {
  try {
    const tab = REPORT_KEY_TO_TAB[params.reportKey as HrScheduleReportKey];
    const actionUrl = tab
      ? `/hr/reports?tab=${tab}${params.storeId ? `&storeId=${params.storeId}` : ''}`
      : '/hr/reports';
    const label =
      params.digest?.reportLabel ??
      REPORT_LABELS[params.reportKey as HrScheduleReportKey] ??
      params.reportKey;
    const headlineText = params.digest ? digestHeadlines(params.digest) : 'No data for this period.';
    const delivery = params.email.success
      ? 'Email delivered.'
      : `Email not delivered${params.email.error ? `: ${params.email.error}` : '.'}`;
    // v2.46.0: the attachment is only claimed when the email actually went
    // out — a failed send must not promise a CSV the recipient never got.
    const attachment = params.email.success && params.attachmentLabel ? ` ${params.attachmentLabel} attached.` : '';
    const row = await db.notification.create({
      data: {
        storeId: params.storeId,
        userId: params.recipientUserId,
        title: `${label} digest — ${params.digest?.scopeLabel ?? 'All branches'}`.trim(),
        message: `${params.digest?.periodLabel ?? ''} · ${headlineText} · ${delivery}${attachment}${params.manual ? ' (manual send)' : ''}`,
        type: 'SYSTEM',
        category: 'HR',
        priority: params.email.success ? 'NORMAL' : 'HIGH',
        actionUrl,
        actionLabel: 'Open report',
        metadata: JSON.stringify({
          scheduleId: params.scheduleId,
          reportKey: params.reportKey,
          manual: params.manual,
          emailStatus: params.email.success ? 'SENT' : 'FAILED',
        }),
      },
    });
    return row.id;
  } catch {
    // The in-app copy is best-effort by design - the email + row stamping
    // above are the source of truth.
    return null;
  }
}

// ── v2.54.0: per-recipient digest envelopes ──────────────────────────────────

/** Per-address send attempt outcome (one envelope = one address). */
export interface RecipientSendResult {
  to: string;
  success: boolean;
  error?: string;
}

export interface RecipientSendSummary {
  delivered: number;
  total: number;
  /** SENT = every address delivered · PARTIAL = mixed · FAILED = none. */
  outcome: 'SENT' | 'PARTIAL' | 'FAILED';
  /** Honest aggregate error for the schedule row / creator copy (null when all delivered). */
  aggregateError: string | null;
}

/**
 * Pure aggregate over per-recipient send attempts (unit-tested). The
 * vocabulary is honest: a mixed delivery is PARTIAL — neither the emerald
 * SENT nor the rose FAILED would tell the truth about "delivered to 2 of 3".
 */
export function summariseRecipientSends(sends: RecipientSendResult[]): RecipientSendSummary {
  const total = sends.length;
  const delivered = sends.filter((s) => s.success).length;
  if (total > 0 && delivered === total) {
    return { delivered, total, outcome: 'SENT', aggregateError: null };
  }
  const failed = sends.filter((s) => !s.success);
  const firstError = failed[0]?.error ?? 'Email send failed';
  if (delivered === 0) {
    return { delivered: 0, total, outcome: 'FAILED', aggregateError: total > 1 ? `${total} recipient(s) not delivered: ${firstError}` : firstError };
  }
  return {
    delivered,
    total,
    outcome: 'PARTIAL',
    aggregateError: `Delivered to ${delivered} of ${total} recipient(s) — ${firstError}. Per-recipient rows are in the delivery history.`,
  };
}

/**
 * v2.54.0: send ONE envelope PER RECIPIENT — the digest privacy upgrade.
 *
 * Why: a single shared envelope puts every recipient's address on every
 * other recipient's To: line, and the provider-level SENT/FAILED applies to
 * the whole batch, so "which recipient actually broke" was a guess. One
 * envelope per address fixes both: no address is ever exposed to the group,
 * and every address earns its own NotificationLog row (own status + own
 * error text) stamped with recipientAddress/recipientIndex/recipientCount.
 *
 * The digest content and CSV attachment are IDENTICAL on every envelope —
 * built once upstream, never recomputed per recipient.
 */
export async function sendDigestEnvelopes(params: {
  recipients: string[];
  digest: HrReportDigestData;
  csv: DigestCsvAttachment | null;
  metadata: { scheduleId: string; reportKey: string; frequency?: string; manual?: boolean; actorId?: string };
}): Promise<{ sends: RecipientSendResult[]; summary: RecipientSendSummary }> {
  const subject = `${params.digest.reportLabel} digest — ${params.digest.organizationName} (${params.digest.periodLabel})`;
  const attempts = params.recipients.map(async (to, index): Promise<RecipientSendResult> => {
    try {
      const email = await sendEmail({
        to: [to],
        subject,
        html: hrReportDigestTemplate(params.digest),
        text: hrReportDigestText(params.digest),
        ...(params.csv ? { attachments: [params.csv] } : {}),
        type: 'HR_REPORT_DIGEST',
        metadata: {
          ...params.metadata,
          recipientAddress: to,
          recipientIndex: index + 1,
          recipientCount: params.recipients.length,
          ...(params.csv ? { csvFilename: params.csv.filename, csvBytes: params.csv.byteSize } : {}),
        },
      });
      return { to, success: email.success, ...(email.success ? {} : { error: email.error ?? 'Email send failed' }) };
    } catch (error) {
      // sendEmail never throws by contract, but a rejected promise here must
      // count as that recipient's failure, never blow up the whole send.
      return { to, success: false, error: error instanceof Error ? error.message : 'Email send failed' };
    }
  });
  const sends = await Promise.all(attempts);
  return { sends, summary: summariseRecipientSends(sends) };
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
      // v2.46.0: every digest travels with a ready-to-file CSV built from
      // the SAME aggregate-only payload — no new data leaves the service.
      const csv = digestToCsv(digest, now);
      // v2.54.0: one envelope PER RECIPIENT — no address is exposed to the
      // other recipients on a shared To: line, and every address earns its
      // own NotificationLog row (its own SENT/FAILED + its own error), so
      // "which recipient actually broke" is a lookup, not a guess.
      const { summary } = await sendDigestEnvelopes({
        recipients,
        digest,
        csv,
        metadata: {
          scheduleId: schedule.id,
          reportKey: schedule.reportKey,
          frequency: schedule.frequency,
        },
      });
      const attachmentLabel = csv ? `CSV (${formatCsvSize(csv.byteSize)})` : null;
      if (summary.outcome === 'SENT') {
        await db.hrReportSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastStatus: 'SENT', lastError: null },
        });
        result.sent += 1;
        result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'SENT', recipients: recipients.length, delivered: summary.delivered });
        // v2.24.0: in-app copy for the schedule's creator (quiet, info-level).
        await writeDigestNotification({
          scheduleId: schedule.id,
          reportKey: schedule.reportKey,
          storeId: schedule.storeId,
          recipientUserId: schedule.createdByUserId,
          digest,
          email: { success: true },
          manual: false,
          attachmentLabel,
        });
      } else if (summary.outcome === 'PARTIAL') {
        // v2.54.0: mixed delivery is its own honest state — neither the
        // emerald SENT nor the rose FAILED would tell the truth.
        await db.hrReportSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastStatus: 'PARTIAL', lastError: (summary.aggregateError ?? 'Some recipients were not delivered').slice(0, 250) },
        });
        result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'PARTIAL', recipients: recipients.length, delivered: summary.delivered, error: summary.aggregateError ?? undefined });
        await writeDigestNotification({
          scheduleId: schedule.id,
          reportKey: schedule.reportKey,
          storeId: schedule.storeId,
          recipientUserId: schedule.createdByUserId,
          digest,
          email: { success: false, error: summary.aggregateError ?? 'Some recipients were not delivered' },
          manual: false,
          attachmentLabel,
        });
      } else {
        await db.hrReportSchedule.update({
          where: { id: schedule.id },
          data: { lastRunAt: now, lastStatus: 'FAILED', lastError: (summary.aggregateError ?? 'Email send failed').slice(0, 250) },
        });
        result.failed += 1;
        result.results.push({ id: schedule.id, reportKey: schedule.reportKey, status: 'FAILED', error: summary.aggregateError ?? undefined, recipients: recipients.length, delivered: 0 });
        // v2.24.0: failures surface at HIGH priority so the creator's alert
        // popups catch a silently broken digest cadence.
        await writeDigestNotification({
          scheduleId: schedule.id,
          reportKey: schedule.reportKey,
          storeId: schedule.storeId,
          recipientUserId: schedule.createdByUserId,
          digest,
          email: { success: false, error: summary.aggregateError ?? 'Email send failed' },
          manual: false,
          attachmentLabel,
        });
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

// ── v2.24.0: manual "send now" ──────────────────────────────────────────────

export type SendNowOutcome = 'SENT' | 'PARTIAL' | 'FAILED' | 'SKIPPED';

export interface SendScheduleNowResult {
  outcome: SendNowOutcome;
  schedule: ScheduleView;
  /** Aggregate-only digest summary (identical contract to the email). */
  digestSummary: { reportLabel: string; periodLabel: string; scopeLabel: string; headlines: string[] } | null;
  email: { success: boolean; error?: string };
  notificationId: string | null;
  /** v2.46.0: set when the send carried the ready-to-file CSV attachment. */
  csv: { filename: string; byteSize: number } | null;
}

/**
 * Send one schedule's digest IMMEDIATELY, on demand.
 *
 * - Scope: the ROW's store must sit inside the actor's visibility - a
 *   BRANCH manager may only send their own branch's schedule (an org-wide
 *   schedule is out of their scope); org roles may send any schedule of
 *   their organization.
 * - Cadence: lastRunAt is NOT touched (a manual send is not a schedule
 *   fire); lastStatus/lastError reflect the last attempt of any kind.
 * - Audit: hrAudit EXECUTE with manualSend=true and the REAL actor.
 * - In-app: the actor always gets a notification-center copy with the
 *   digest headline + delivery status (so the flow is usable in dev/CI
 *   where RESEND_API_KEY is not configured - the email failure is reported,
 *   not hidden).
 */
export async function sendScheduleNow(
  organizationId: string,
  actor: { id: string; role: string; storeId: string | null },
  id: string,
  now: Date = new Date(),
): Promise<SendScheduleNowResult> {
  const row = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!row) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  if (actor.role === 'BRANCH_MANAGER' && row.storeId !== actor.storeId) {
    throw new HrScheduleError(
      'STORE_SCOPE_FORBIDDEN',
      'Branch managers can only send digests for their own branch.',
      403,
    );
  }

  const recipients = safeParseRecipients(row.recipients);
  let digest: HrReportDigestData | null = null;
  let computeError: string | null = null;
  try {
    digest = await buildDigestData(row, now);
  } catch (error) {
    computeError = error instanceof Error ? error.message : 'Digest computation failed';
  }

  let outcome: SendNowOutcome;
  let email: { success: boolean; error?: string } = { success: false };
  let notificationId: string | null = null;
  let csv: SendScheduleNowResult['csv'] = null;

  if (!digest) {
    outcome = 'SKIPPED';
    const reason = computeError ?? 'Report returned no data for scope.';
    await db.hrReportSchedule.update({
      where: { id: row.id },
      data: { lastStatus: 'SKIPPED', lastError: reason.slice(0, 250) },
    });
    email = { success: false, error: reason };
    notificationId = await writeDigestNotification({
      scheduleId: row.id,
      reportKey: row.reportKey,
      storeId: row.storeId,
      recipientUserId: actor.id,
      digest: null,
      email: { success: false, error: reason },
      manual: true,
    });
  } else {
    const attachment = digestToCsv(digest, now);
    // v2.54.0: one envelope PER RECIPIENT (same contract as the sweep) —
    // the actor's manual send is audited with the aggregate outcome, and
    // every address earns its own NotificationLog delivery row.
    const { summary } = await sendDigestEnvelopes({
      recipients,
      digest,
      csv: attachment,
      metadata: {
        scheduleId: row.id,
        reportKey: row.reportKey,
        manual: true,
        actorId: actor.id,
      },
    });
    email = {
      success: summary.outcome === 'SENT',
      ...(summary.aggregateError ? { error: summary.aggregateError } : {}),
    };
    if (attachment) csv = { filename: attachment.filename, byteSize: attachment.byteSize };
    if (summary.outcome !== 'FAILED') {
      outcome = summary.outcome === 'SENT' ? 'SENT' : 'PARTIAL';
      await db.hrReportSchedule.update({
        where: { id: row.id },
        data: { lastStatus: outcome, lastError: summary.aggregateError ?? null },
      });
    } else {
      outcome = 'FAILED';
      await db.hrReportSchedule.update({
        where: { id: row.id },
        data: { lastStatus: 'FAILED', lastError: (summary.aggregateError ?? 'Email send failed').slice(0, 250) },
      });
    }
    notificationId = await writeDigestNotification({
      scheduleId: row.id,
      reportKey: row.reportKey,
      storeId: row.storeId,
      recipientUserId: actor.id,
      digest,
      email,
      manual: true,
      attachmentLabel: csv ? `CSV (${formatCsvSize(csv.byteSize)})` : null,
    });
  }

  await hrAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'EXECUTE',
    resourceType: HrEntityType.REPORT_SCHEDULE,
    resourceId: row.id,
    storeId: row.storeId ?? undefined,
    metadata: {
      manualSend: true,
      reportKey: row.reportKey,
      outcome,
      recipientCount: recipients.length,
      notificationId,
    },
  }).catch(() => {});

  return {
    outcome,
    schedule: toScheduleView({ ...row, lastStatus: outcome, lastError: email.error ?? null }),
    digestSummary: digest
      ? {
          reportLabel: digest.reportLabel,
          periodLabel: digest.periodLabel,
          scopeLabel: digest.scopeLabel,
          headlines: (digest.headline ?? []).map((h) => `${h.label}: ${h.value}`),
        }
      : null,
    email,
    notificationId,
    csv,
  };
}

// ── v2.25.0: delivery observability ─────────────────────────────────────────

/**
 * Next UTC instant at which a schedule is due, computed from its frequency
 * slot AFTER the last run (a manual send never moves the cadence, so the
 * next slot must clear both `from` and `lastRunAt`). Pure — used by the
 * Schedules-tab dry-run preview; mirrors isScheduleDue's slot semantics:
 *   • DAILY  → tomorrow's (or today's) send hour
 *   • WEEKLY → the next occurrence of the configured weekday at the send hour
 *   • MONTHLY→ the configured day (1-28) of this or the next month
 */
export function nextScheduleRunAt(
  schedule: { frequency: string; weekday: number | null; dayOfMonth: number | null; hourUtc: number; lastRunAt: Date | null },
  from: Date = new Date(),
): Date {
  const floor = Math.max(from.getTime(), schedule.lastRunAt?.getTime() ?? 0);

  // Candidate slot instants at the schedule's send hour, day by day.
  const slotFor = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), schedule.hourUtc, 0, 0));

  if (schedule.frequency === 'DAILY') {
    let candidate = slotFor(from);
    if (candidate.getTime() <= floor) candidate = slotFor(new Date(from.getTime() + 24 * 3600 * 1000));
    return candidate;
  }

  if (schedule.frequency === 'WEEKLY') {
    const weekday = Math.min(Math.max(schedule.weekday ?? 0, 0), 6);
    for (let i = 0; i < 8; i += 1) {
      const day = new Date(from.getTime() + i * 24 * 3600 * 1000);
      const candidate = slotFor(day);
      if (candidate.getUTCDay() === weekday && candidate.getTime() > floor) return candidate;
    }
    // Unreachable (a week always contains the weekday) — defensive fallback.
    return new Date(floor + 7 * 24 * 3600 * 1000);
  }

  // MONTHLY: first slot on/after `from` whose UTC date matches the config.
  const dayOfMonth = Math.min(Math.max(schedule.dayOfMonth ?? 1, 1), 28);
  for (let monthShift = 0; monthShift <= 2; monthShift += 1) {
    const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + monthShift, dayOfMonth, schedule.hourUtc, 0, 0));
    if (candidate.getTime() > floor) return candidate;
  }
  return new Date(floor + 30 * 24 * 3600 * 1000);
}

export interface ScheduleDeliveryRow {
  id: string;
  status: string; // SENT | FAILED | PENDING
  recipient: string;
  subject: string;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  recipients: number; // parsed from metadata for convenience
  // v2.27.0: the individual addresses this attempt was addressed to (parsed
  // from the comma-joined recipient column) so the UI can expand one row
  // into per-recipient chips.
  recipientList: string[];
  // v2.54.0: per-recipient envelope sends stamp metadata.recipientAddress —
  // when present, the row IS that recipient's own delivery record (its own
  // SENT/FAILED + its own error). Null for legacy shared-envelope rows.
  recipientAddress: string | null;
  manual: boolean; // manual "send now" vs scheduled sweep
  // v2.46.0: the ready-to-file CSV that travelled with the email (name +
  // decoded byte size from the send metadata; null for pre-2.46.0 rows).
  csvFilename: string | null;
  csvBytes: number | null;
}

/**
 * Delivery history for one schedule: the last HR_REPORT_DIGEST
 * NotificationLog rows correlated via metadata.scheduleId (stamped by the
 * digest sender on every send since the digest feature shipped).
 *
 * Scope: fail-closed, identical to sendScheduleNow — the schedule must sit
 * inside the actor's visibility (a BRANCH manager may only read their own
 * branch's schedule; an org-wide schedule is out of their scope).
 * Read-only: no stamps, no audit, no side effects.
 */
export async function listScheduleDeliveries(
  organizationId: string,
  actor: { id: string; role: string; storeId: string | null },
  id: string,
  limit: number = 10,
): Promise<ScheduleDeliveryRow[]> {
  const row = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!row) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  if (actor.role === 'BRANCH_MANAGER' && row.storeId !== actor.storeId) {
    throw new HrScheduleError(
      'STORE_SCOPE_FORBIDDEN',
      'Branch managers can only view delivery history for their own branch.',
      403,
    );
  }

  const capped = Math.min(Math.max(Math.trunc(limit) || 10, 1), 50);
  const logs = await db.notificationLog.findMany({
    where: {
      type: 'HR_REPORT_DIGEST',
      metadata: { contains: `"scheduleId":"${row.id}"` },
    },
    orderBy: { createdAt: 'desc' },
    take: capped,
  });

  return logs.map((log) => {
    let meta: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(log.metadata ?? '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
    } catch {
      meta = {};
    }
    // v2.27.0: parse the address list once — the fallback count and the UI's
    // per-recipient expansion now share the same derivation, so the row
    // header ("N recipient(s)") and the expanded chips can never disagree.
    const recipientList = log.recipient
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0 && r.includes('@'));
    return {
      id: log.id,
      status: log.status,
      recipient: log.recipient,
      subject: log.subject,
      error: log.error,
      sentAt: log.sentAt ? log.sentAt.toISOString() : null,
      createdAt: log.createdAt.toISOString(),
      recipients: typeof meta.recipientCount === 'number' ? meta.recipientCount : recipientList.length,
      recipientList,
      recipientAddress: typeof meta.recipientAddress === 'string' && meta.recipientAddress.includes('@') ? meta.recipientAddress : null,
      manual: meta.manual === true,
      // v2.46.0: the ready-to-file CSV travels with the digest email — the
      // delivery row surfaces it as a chip so recipients know what to expect.
      csvFilename: typeof meta.csvFilename === 'string' ? meta.csvFilename : null,
      csvBytes: typeof meta.csvBytes === 'number' ? meta.csvBytes : null,
    };
  });
}

export interface SchedulePreview {
  schedule: ScheduleView;
  reportLabel: string;
  /** Null when the digest cannot be produced (no data / compute error). */
  periodLabel: string | null;
  scopeLabel: string | null;
  headlines: Array<{ label: string; value: string }>;
  table: { caption: string; columns: string[]; rows: string[][] } | null;
  recipients: string[];
  nextRunAt: string;
  /** Non-null when the digest cannot be produced (no data / compute error). */
  unavailableReason: string | null;
}

/**
 * v2.25.0: dry-run digest preview. Computes EXACTLY what the next email
 * would contain — through the same governed report functions and scope as a
 * real send — without sending anything, writing any log/notification, or
 * touching lastRunAt/lastStatus. Read-only by construction.
 */
export async function previewScheduleDigest(
  organizationId: string,
  actor: { id: string; role: string; storeId: string | null },
  id: string,
  now: Date = new Date(),
): Promise<SchedulePreview> {
  const row = await db.hrReportSchedule.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!row) {
    throw new HrScheduleError('SCHEDULE_NOT_FOUND', 'Schedule not found.', 404);
  }
  if (actor.role === 'BRANCH_MANAGER' && row.storeId !== actor.storeId) {
    throw new HrScheduleError(
      'STORE_SCOPE_FORBIDDEN',
      'Branch managers can only preview digests for their own branch.',
      403,
    );
  }

  const recipients = safeParseRecipients(row.recipients);
  let digest: HrReportDigestData | null = null;
  let unavailableReason: string | null = null;
  try {
    digest = await buildDigestData(row, now);
    if (!digest) unavailableReason = 'Report returned no data for this scope and period.';
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : 'Digest computation failed.';
  }

  return {
    schedule: toScheduleView(row),
    reportLabel: REPORT_LABELS[row.reportKey as HrScheduleReportKey] ?? row.reportKey,
    periodLabel: digest?.periodLabel ?? null,
    scopeLabel: digest?.scopeLabel ?? null,
    headlines: digest?.headline ?? [],
    table: digest?.table ?? null,
    recipients,
    nextRunAt: nextScheduleRunAt(row, now).toISOString(),
    unavailableReason,
  } as SchedulePreview;
}
