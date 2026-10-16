// MBUMAH HARDWARE POS - HR reporting service (v2.20.0, spec Phase 4.8)
//
// Six governed reports + P10 statutory export. Rules from the EMS spec:
//   - Reports are aggregates; per-employee rows use employeeCode + job title,
//     never names, national IDs, or raw database ids ("no raw IDs by default").
//   - hr.report.branch scopes a manager to their own store; hr.report.all
//     (ACCOUNTANT, HR_MANAGER, STORE_OWNER) sees the organization.
//   - P10 REPRODUCES FROM STORED LINES: every figure reads the immutable
//     PayrollDetail columns (posted runs only) - nothing is recomputed.
//   - Exports are audit logged (DATA_EXPORT) with field-name-only metadata.

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { toCSV } from '@/lib/report-utils';
import type { AuthSession } from '@/lib/auth';

type Session = AuthSession;

export type ReportScope = 'BRANCH' | 'ORG';

/** Resolve report scope from the caller's role (fail-closed). */
export function resolveReportScope(session: Session): ReportScope | null {
  if (session.role === 'SUPER_ADMIN') return 'ORG';
  if (['ACCOUNTANT', 'HR_MANAGER', 'STORE_OWNER'].includes(session.role)) return 'ORG';
  if (session.role === 'BRANCH_MANAGER' && session.storeId) return 'BRANCH';
  return null;
}

function scopeWhere(
  session: Session,
  scope: ReportScope,
  storeId?: string | null,
): Prisma.EmployeeWhereInput {
  const base =
    scope === 'BRANCH'
      ? { storeId: session.storeId as string }
      : { store: { organizationId: session.organizationId } };
  // v2.23.0: an ORG-scope caller may narrow every report to one branch.
  // The storeId is validated against the caller's organization by
  // validateReportStore before it reaches here, and even a hostile value
  // cannot WIDEN access: the org-membership condition stays ANDed.
  if (scope === 'ORG' && storeId) {
    return { storeId, store: { organizationId: session.organizationId } };
  }
  return base;
}

/**
 * Run-level store filter (payroll tables filter through payrollRun.storeId)
 * with the same v2.23.0 narrowing semantics as scopeWhere.
 */
function runStoreFilter(
  session: Session,
  scope: ReportScope,
  storeId?: string | null,
): { storeId: string } | { store: { organizationId: string } } {
  if (scope === 'BRANCH') return { storeId: session.storeId as string };
  if (scope === 'ORG' && storeId) {
    return { storeId, store: { organizationId: session.organizationId } };
  }
  return { store: { organizationId: session.organizationId } };
}

/**
 * v2.23.0: validate an explicit per-branch drill-down for a report caller.
 * Only ORG-scope sessions may narrow (BRANCH scope is already the caller's
 * own store); the store must belong to the caller's organization or the
 * request is rejected fail-closed.
 */
export async function validateReportStore(
  session: Session,
  scope: ReportScope | null,
  storeId: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!storeId) return null;
  if (scope !== 'ORG') {
    throw new StoreNarrowingError('STORE_NARROWING_FORBIDDEN', 'Per-branch drill-down requires organization scope.', 403);
  }
  const store = await db.store.findFirst({
    where: { id: storeId, organizationId: session.organizationId },
    select: { id: true, name: true },
  });
  if (!store) {
    throw new StoreNarrowingError('STORE_NOT_FOUND', 'Branch not found in this organization.', 404);
  }
  return store;
}

export class StoreNarrowingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'StoreNarrowingError';
  }
}

function money(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'object' && value !== null && 'toNumber' in (value as Record<string, unknown>)
    ? (value as Prisma.Decimal).toNumber()
    : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStart(year: number, month0: number): Date {
  return new Date(Date.UTC(year, month0, 1));
}

export interface ReportPeriod {
  from: Date;
  to: Date;
}

export function parsePeriod(fromRaw?: string | null, toRaw?: string | null): ReportPeriod {
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  return { from, to };
}

// ── 1. Headcount ────────────────────────────────────────────────────────────

export async function headcountReport(
  session: Session,
  period: ReportPeriod,
  opts?: { storeId?: string | null },
) {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const where = { deletedAt: null, ...scopeWhere(session, scope, opts?.storeId) };

  const [all, hires, exits, byType, byStore] = await Promise.all([
    db.employee.findMany({ where, select: { status: true, hireDate: true, terminationDate: true } }),
    db.employee.count({ where: { ...where, hireDate: { gte: period.from, lte: period.to } } }),
    db.employee.count({ where: { ...where, terminationDate: { gte: period.from, lte: period.to } } }),
    db.employee.groupBy({ by: ['employmentType'], where, _count: { _all: true } }),
    db.employee.groupBy({ by: ['storeId'], where, _count: { _all: true } }),
  ]);

  const active = all.filter((e) => e.status === 'ACTIVE').length;
  const onLeave = all.filter((e) => e.status === 'ON_LEAVE').length;
  const suspended = all.filter((e) => e.status === 'SUSPENDED').length;
  const tenures = all
    .filter((e) => e.status === 'ACTIVE')
    .map((e) => (Date.now() - e.hireDate.getTime()) / (365.25 * 24 * 3600 * 1000));
  const avgTenureYears = tenures.length
    ? Math.round((tenures.reduce((a, b) => a + b, 0) / tenures.length) * 10) / 10
    : 0;

  const storeNames = await db.store.findMany({
    where: { id: { in: byStore.map((s) => s.storeId) } },
    select: { id: true, name: true },
  });

  return {
    scope,
    active,
    onLeave,
    suspended,
    hiresInPeriod: hires,
    exitsInPeriod: exits,
    avgTenureYears,
    byEmploymentType: byType.map((t) => ({ employmentType: t.employmentType, count: t._count._all })),
    byStore: byStore.map((s) => ({
      storeName: storeNames.find((n) => n.id === s.storeId)?.name ?? 'Unknown branch',
      count: s._count._all,
    })),
  };
}

// ── 2. Employment cost ──────────────────────────────────────────────────────

export async function employmentCostReport(
  session: Session,
  period: ReportPeriod,
  opts?: { storeId?: string | null },
) {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const storeFilter = runStoreFilter(session, scope, opts?.storeId);

  // Posted (or later) runs in the period. Gross + employer statutory parts
  // come straight from the stored PayrollDetail lines.
  const details = await db.payrollDetail.findMany({
    where: {
      payrollRun: {
        status: { in: ['POSTED', 'LOCKED'] },
        payrollPeriod: { startDate: { gte: period.from, lte: period.to } },
        ...storeFilter,
      },
    },
    select: {
      grossPay: true,
      netPay: true,
      totalDeductions: true,
      nssf: true,
      housingLevy: true,
      payrollRun: { select: { payrollPeriod: { select: { startDate: true, name: true } } } },
    },
  });

  // Employer matches: NSSF employer = employee NSSF (Tier I+II match), AHL
  // employer = employee housing levy (1.5% match) — mirrors the engine.
  let gross = 0;
  let net = 0;
  let employerStatutory = 0;
  const monthly = new Map<string, { label: string; gross: number; employer: number; net: number }>();
  for (const d of details) {
    const g = money(d.grossPay);
    const employerMatch = money(d.nssf) + money(d.housingLevy);
    gross += g;
    net += money(d.netPay);
    employerStatutory += employerMatch;
    const key = monthKey(d.payrollRun.payrollPeriod.startDate);
    const bucket = monthly.get(key) ?? { label: d.payrollRun.payrollPeriod.name, gross: 0, employer: 0, net: 0 };
    bucket.gross += g;
    bucket.employer += employerMatch;
    bucket.net += money(d.netPay);
    monthly.set(key, bucket);
  }

  const series = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      label: v.label,
      grossPay: Math.round(v.gross * 100) / 100,
      employerStatutory: Math.round(v.employer * 100) / 100,
      totalCost: Math.round((v.gross + v.employer) * 100) / 100,
      netPay: Math.round(v.net * 100) / 100,
    }));

  return {
    scope,
    totalGross: Math.round(gross * 100) / 100,
    totalEmployerStatutory: Math.round(employerStatutory * 100) / 100,
    totalCost: Math.round((gross + employerStatutory) * 100) / 100,
    totalNet: Math.round(net * 100) / 100,
    payslipCount: details.length,
    monthly: series,
  };
}

// ── 3. Absence ──────────────────────────────────────────────────────────────

export async function absenceReport(
  session: Session,
  period: ReportPeriod,
  opts?: { storeId?: string | null },
) {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const storeFilter = scope === 'BRANCH' ? { storeId: session.storeId as string } : { store: { organizationId: session.organizationId } };

  const [records, leaveRequests, activeEmployees] = await Promise.all([
    db.attendanceRecord.groupBy({
      by: ['status'],
      where: { date: { gte: period.from, lte: period.to }, employee: storeFilter },
      _count: { _all: true },
    }),
    db.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: period.to },
        endDate: { gte: period.from },
        employee: storeFilter,
      },
      select: { workingDays: true, employeeId: true },
    }),
    db.employee.count({ where: { status: 'ACTIVE', ...scopeWhere(session, scope, opts?.storeId) } }),
  ]);

  const byStatus = records.map((r) => ({ status: r.status, days: r._count._all }));
  const absentDays = byStatus.find((s) => s.status === 'ABSENT')?.days ?? 0;
  const leaveDays = byStatus.find((s) => s.status === 'LEAVE')?.days ?? 0;
  const totalRecorded = byStatus.reduce((a, s) => a + s.days, 0);
  const approvedLeaveDays = leaveRequests.reduce((a, r) => a + Number(r.workingDays), 0);
  // Absence rate = unscheduled absence (ABSENT) over all recorded days.
  const absenceRate = totalRecorded ? Math.round((absentDays / totalRecorded) * 1000) / 10 : 0;
  const leaveRate = totalRecorded ? Math.round((leaveDays / totalRecorded) * 1000) / 10 : 0;
  // Working-day denominator approximation for the period (5-day weeks).
  const workingDays = Math.max(
    1,
    Math.round((period.to.getTime() - period.from.getTime()) / (24 * 3600 * 1000) * (5 / 7)),
  );

  return {
    scope,
    activeEmployees,
    byStatus,
    absentDays,
    leaveDays,
    approvedLeaveRequestsDays: Math.round(approvedLeaveDays * 10) / 10,
    absenceRatePct: absenceRate,
    leaveRatePct: leaveRate,
    availableWorkingDays: workingDays,
  };
}

// ── 4. Turnover ─────────────────────────────────────────────────────────────

export async function turnoverReport(
  session: Session,
  period: ReportPeriod,
  opts?: { storeId?: string | null },
) {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const where = { deletedAt: null, ...scopeWhere(session, scope, opts?.storeId) };

  const [exits, activeNow, hiresInPeriod] = await Promise.all([
    db.employee.findMany({
      where: { ...where, terminationDate: { gte: period.from, lte: period.to } },
      select: { employeeCode: true, jobTitle: true, employmentType: true, hireDate: true, terminationDate: true, storeId: true },
    }),
    db.employee.count({ where: { status: 'ACTIVE', ...where } }),
    db.employee.count({ where: { ...where, hireDate: { gte: period.from, lte: period.to } } }),
  ]);

  const tenureYears = exits.map((e) =>
    Math.round(((e.terminationDate?.getTime() ?? Date.now()) - e.hireDate.getTime()) / (365.25 * 24 * 3600 * 1000) * 10) / 10,
  );
  const avgTenureAtExit = tenureYears.length
    ? Math.round((tenureYears.reduce((a, b) => a + b, 0) / tenureYears.length) * 10) / 10
    : 0;
  // Annualised turnover = exits / average headcount * (12 / months elapsed).
  const monthsElapsed = Math.max(
    1,
    Math.round((period.to.getTime() - period.from.getTime()) / (30.44 * 24 * 3600 * 1000)),
  );
  const avgHeadcount = activeNow + exits.length - hiresInPeriod > 0 ? activeNow : activeNow || 1;
  const annualisedRate = Math.round((exits.length / Math.max(1, avgHeadcount)) * (12 / monthsElapsed) * 1000) / 10;

  const storeNames = await db.store.findMany({
    where: { id: { in: [...new Set(exits.map((e) => e.storeId))] } },
    select: { id: true, name: true },
  });

  return {
    scope,
    exits: exits.length,
    hires: hiresInPeriod,
    activeNow,
    annualisedTurnoverPct: annualisedRate,
    avgTenureAtExitYears: avgTenureAtExit,
    perStoreExitCounts: storeNames.map((s) => ({
      storeName: s.name,
      exits: exits.filter((e) => e.storeId === s.id).length,
    })),
    // Exit rows carry employeeCode + title only (no names / raw ids).
    exitRows: exits.map((e, i) => ({
      employeeCode: e.employeeCode ?? `EXIT-${i + 1}`,
      jobTitle: e.jobTitle ?? '—',
      employmentType: e.employmentType,
      hireDate: e.hireDate.toISOString(),
      terminationDate: (e.terminationDate ?? period.to).toISOString(),
      tenureYears: tenureYears[i],
    })),
  };
}

// ── 5. Time to hire ─────────────────────────────────────────────────────────

export async function timeToHireReport(
  session: Session,
  period: ReportPeriod,
  opts?: { storeId?: string | null },
) {
  const scope = resolveReportScope(session);
  if (!scope) return null;

  // Converted applicants: application createdAt -> offer accepted (respondedAt)
  // is the pipeline measure; the converted employee's hireDate cross-checks it.
  // NOTE: Applicant has no `store` relation — scope by storeId (resolved to
  // the organization's stores for ORG scope, the session store for BRANCH,
  // or the validated drill-down branch for the v2.23.0 narrowing).
  const applicantStoreIds =
    scope === 'BRANCH'
      ? [session.storeId as string]
      : opts?.storeId
        ? [opts.storeId]
        : (
            await db.store.findMany({
              where: { organizationId: session.organizationId },
              select: { id: true },
            })
          ).map((s) => s.id);
  const converted = await db.applicant.findMany({
    where: {
      status: 'HIRED',
      createdAt: { gte: period.from, lte: period.to },
      convertedEmployeeId: { not: null },
      storeId: { in: applicantStoreIds },
    },
    select: {
      id: true,
      fullName: false,
      createdAt: true,
      convertedEmployeeId: true,
      offers: { where: { status: 'ACCEPTED' }, select: { respondedAt: true, createdAt: true }, take: 1 },
      job: { select: { title: true } },
    },
    take: 200,
  });

  const rows = converted.map((a) => {
    const offer = a.offers[0];
    const end = offer?.respondedAt ?? offer?.createdAt ?? null;
    const days = end ? Math.max(0, Math.round((end.getTime() - a.createdAt.getTime()) / (24 * 3600 * 1000))) : null;
    return {
      jobTitle: a.job.title,
      appliedOn: a.createdAt.toISOString(),
      acceptedOn: end ? end.toISOString() : null,
      daysToHire: days,
    };
  });
  const measured = rows.filter((r) => r.daysToHire !== null).map((r) => r.daysToHire as number);
  const sorted = [...measured].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const average = sorted.length ? Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10 : 0;

  return {
    scope,
    convertedCount: rows.length,
    medianDaysToHire: median,
    averageDaysToHire: average,
    rows,
  };
}

// ── 6. Statutory liability ──────────────────────────────────────────────────

export async function statutoryLiabilityReport(
  session: Session,
  period: ReportPeriod,
  opts?: { storeId?: string | null },
) {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const storeFilter = runStoreFilter(session, scope, opts?.storeId);

  const details = await db.payrollDetail.findMany({
    where: {
      payrollRun: {
        status: { in: ['POSTED', 'LOCKED'] },
        payrollPeriod: { startDate: { gte: period.from, lte: period.to } },
        ...storeFilter,
      },
    },
    select: {
      paye: true,
      nssf: true,
      nhif: true,
      housingLevy: true,
      payeArrears: true,
      payrollRun: { select: { payrollPeriod: { select: { startDate: true, name: true } } } },
    },
  });

  const monthly = new Map<string, { label: string; paye: number; nssf: number; shif: number; ahl: number; arrears: number }>();
  let paye = 0;
  let nssf = 0;
  let shif = 0;
  let ahl = 0;
  let arrears = 0;
  for (const d of details) {
    paye += money(d.paye);
    nssf += money(d.nssf);
    shif += money(d.nhif);
    ahl += money(d.housingLevy);
    arrears += money(d.payeArrears);
    const key = monthKey(d.payrollRun.payrollPeriod.startDate);
    const bucket =
      monthly.get(key) ?? { label: d.payrollRun.payrollPeriod.name, paye: 0, nssf: 0, shif: 0, ahl: 0, arrears: 0 };
    bucket.paye += money(d.paye);
    bucket.nssf += money(d.nssf);
    bucket.shif += money(d.nhif);
    bucket.ahl += money(d.housingLevy);
    bucket.arrears += money(d.payeArrears);
    monthly.set(key, bucket);
  }
  const total = paye + nssf + shif + ahl + arrears;

  return {
    scope,
    totals: {
      paye: Math.round(paye * 100) / 100,
      nssf: Math.round(nssf * 100) / 100,
      shif: Math.round(shif * 100) / 100,
      housingLevy: Math.round(ahl * 100) / 100,
      payeArrears: Math.round(arrears * 100) / 100,
      total: Math.round(total * 100) / 100,
    },
    monthly: [...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        label: v.label,
        paye: Math.round(v.paye * 100) / 100,
        nssf: Math.round(v.nssf * 100) / 100,
        shif: Math.round(v.shif * 100) / 100,
        housingLevy: Math.round(v.ahl * 100) / 100,
        payeArrears: Math.round(v.arrears * 100) / 100,
      })),
  };
}

// ── 7. Org-console HR summary (tiles) ───────────────────────────────────────

export async function hrSummaryForOrgConsole(session: Session, opts?: { storeId?: string | null }) {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const now = new Date();
  const monthStartD = monthStart(now.getUTCFullYear(), now.getUTCMonth());
  const ninetyDays = new Date(Date.now() + 90 * 24 * 3600 * 1000);
  // v2.23.0: storeId narrowing flows through the same validated path as the
  // interactive reports (see scopeWhere) so every tile can drill per branch.
  const storeFilter =
    scope === 'BRANCH'
      ? { storeId: session.storeId as string }
      : opts?.storeId
        ? { storeId: opts.storeId, store: { organizationId: session.organizationId } }
        : { store: { organizationId: session.organizationId } };

  const [activeEmployees, monthDetails, absenceThisMonth, expiringDocs, overdueAssets, latestRun] = await Promise.all([
    db.employee.count({ where: { status: 'ACTIVE', deletedAt: null, ...scopeWhere(session, scope, opts?.storeId) } }),
    db.payrollDetail.findMany({
      where: {
        payrollRun: { status: { in: ['POSTED', 'LOCKED'] }, payrollPeriod: { startDate: { gte: monthStartD } }, ...storeFilter },
      },
      select: { grossPay: true, nssf: true, housingLevy: true },
    }),
    db.attendanceRecord.groupBy({
      by: ['status'],
      where: { date: { gte: monthStartD }, employee: storeFilter },
      _count: { _all: true },
    }),
    db.employeeDocument.count({
      where: { expiryDate: { lte: ninetyDays, gte: now }, deletedAt: null, employee: scopeWhere(session, scope, opts?.storeId) },
    }),
    db.assetAssignment.count({
      where: { status: 'ASSIGNED', dueReturnOn: { lt: now }, deletedAt: null, employee: scopeWhere(session, scope, opts?.storeId) },
    }),
    db.payrollRun.findFirst({
      where: { ...storeFilter },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true, payrollPeriod: { select: { name: true } } },
    }),
  ]);

  const cost = monthDetails.reduce(
    (acc, d) => acc + money(d.grossPay) + money(d.nssf) + money(d.housingLevy),
    0,
  );
  const recorded = absenceThisMonth.reduce((a, s) => a + s._count._all, 0);
  const absent = absenceThisMonth.find((s) => s.status === 'ABSENT')?._count._all ?? 0;

  return {
    scope,
    headcountActive: activeEmployees,
    monthEmploymentCost: Math.round(cost * 100) / 100,
    monthAbsenceRatePct: recorded ? Math.round((absent / recorded) * 1000) / 10 : 0,
    latestPayroll: latestRun
      ? { periodName: latestRun.payrollPeriod.name, status: latestRun.status, createdAt: latestRun.createdAt.toISOString() }
      : null,
    expiryAlerts: { documentsExpiring90Days: expiringDocs, assetsOverdue: overdueAssets },
  };
}

/**
 * v2.23.0: per-branch breakdown for the org console "People & payroll"
 * drill-down. ORG-scope only (BRANCH callers already see their own store in
 * the main tiles — a per-store table would be a single row of the same
 * numbers). Aggregates only: rows carry store names, never employee PII.
 * Every metric mirrors the org-level tile definitions exactly.
 */
export async function hrPerStoreForOrgConsole(
  session: Session,
): Promise<Array<{
  storeId: string;
  storeName: string;
  headcountActive: number;
  monthEmploymentCost: number;
  monthAbsenceRatePct: number;
  latestPayroll: { periodName: string; status: string; createdAt: string } | null;
  expiryAlerts: { documentsExpiring90Days: number; assetsOverdue: number };
}> | null> {
  const scope = resolveReportScope(session);
  if (scope !== 'ORG') return null;
  const now = new Date();
  const monthStartD = monthStart(now.getUTCFullYear(), now.getUTCMonth());
  const ninetyDays = new Date(Date.now() + 90 * 24 * 3600 * 1000);

  const stores = await db.store.findMany({
    where: { organizationId: session.organizationId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const orgEmployeeWhere = { store: { organizationId: session.organizationId } };

  // One grouped query for headcount + one for month cost; the per-store
  // absence/expiry/latest-payroll metrics stay small per-store counts so the
  // exact tile definitions are reused verbatim (no duplicate formulas).
  const [headcountByStore, costRows] = await Promise.all([
    db.employee.groupBy({
      by: ['storeId'],
      where: { status: 'ACTIVE', deletedAt: null, store: { organizationId: session.organizationId } },
      _count: { _all: true },
    }),
    db.payrollDetail.groupBy({
      by: ['storeId'],
      where: {
        payrollRun: { status: { in: ['POSTED', 'LOCKED'] }, payrollPeriod: { startDate: { gte: monthStartD } }, store: { organizationId: session.organizationId } },
      },
      _sum: { grossPay: true, nssf: true, housingLevy: true },
    }),
  ]);

  const headcountMap = new Map(headcountByStore.map((r) => [r.storeId, r._count._all]));
  const costMap = new Map(
    costRows.map((r) => [
      r.storeId,
      Math.round((money(r._sum.grossPay) + money(r._sum.nssf) + money(r._sum.housingLevy)) * 100) / 100,
    ]),
  );

  return Promise.all(
    stores.map(async (store) => {
      const [recorded, absent, expiringDocs, overdueAssets, latestRun] = await Promise.all([
        db.attendanceRecord.count({ where: { date: { gte: monthStartD }, employee: { ...orgEmployeeWhere, storeId: store.id } } }),
        db.attendanceRecord.count({ where: { date: { gte: monthStartD }, status: 'ABSENT', employee: { ...orgEmployeeWhere, storeId: store.id } } }),
        db.employeeDocument.count({ where: { expiryDate: { lte: ninetyDays, gte: now }, deletedAt: null, employee: { ...orgEmployeeWhere, storeId: store.id } } }),
        db.assetAssignment.count({ where: { status: 'ASSIGNED', dueReturnOn: { lt: now }, deletedAt: null, employee: { ...orgEmployeeWhere, storeId: store.id } } }),
        db.payrollRun.findFirst({
          where: { storeId: store.id },
          orderBy: { createdAt: 'desc' },
          select: { status: true, createdAt: true, payrollPeriod: { select: { name: true } } },
        }),
      ]);
      return {
        storeId: store.id,
        storeName: store.name,
        headcountActive: headcountMap.get(store.id) ?? 0,
        monthEmploymentCost: costMap.get(store.id) ?? 0,
        monthAbsenceRatePct: recorded ? Math.round((absent / recorded) * 1000) / 10 : 0,
        latestPayroll: latestRun
          ? { periodName: latestRun.payrollPeriod.name, status: latestRun.status, createdAt: latestRun.createdAt.toISOString() }
          : null,
        expiryAlerts: { documentsExpiring90Days: expiringDocs, assetsOverdue: overdueAssets },
      };
    }),
  );
}

// ── 8. P10 export (from stored lines, never recomputed) ─────────────────────

export interface P10EmployeeRow {
  employeeCode: string;
  employmentType: string;
  months: number;
  grossPay: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  paye: number;
  payeArrears: number;
  netPay: number;
}

/**
 * Build the P10 register for a tax year from POSTED/LOCKED payroll lines.
 * Every figure is read from the stored PayrollDetail columns; the payload
 * groups by employee and carries the run ids that contributed (traceability
 * without raw ids in the printable rows).
 */
export async function buildP10(session: Session, year: number): Promise<{
  scope: ReportScope;
  year: number;
  rows: P10EmployeeRow[];
  totals: Omit<P10EmployeeRow, 'employeeCode' | 'employmentType' | 'months'>;
  sourceRuns: number;
} | null> {
  const scope = resolveReportScope(session);
  if (!scope) return null;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const storeFilter = scope === 'BRANCH' ? { storeId: session.storeId as string } : { store: { organizationId: session.organizationId } };

  const details = await db.payrollDetail.findMany({
    where: {
      payrollRun: {
        status: { in: ['POSTED', 'LOCKED'] },
        payrollPeriod: { startDate: { gte: yearStart, lt: yearEnd } },
        ...storeFilter,
      },
    },
    select: {
      grossPay: true,
      netPay: true,
      paye: true,
      nssf: true,
      nhif: true,
      housingLevy: true,
      payeArrears: true,
      payrollRunId: true,
      employee: { select: { employeeCode: true, employmentType: true } },
    },
  });

  const byEmployee = new Map<string, P10EmployeeRow & { runs: Set<string> }>();
  for (const d of details) {
    const code = d.employee.employeeCode ?? 'UNASSIGNED';
    const row =
      byEmployee.get(code) ??
      {
        employeeCode: code,
        employmentType: d.employee.employmentType,
        months: 0,
        grossPay: 0,
        nssf: 0,
        shif: 0,
        housingLevy: 0,
        paye: 0,
        payeArrears: 0,
        netPay: 0,
        runs: new Set<string>(),
      };
    row.months += 1;
    row.grossPay += money(d.grossPay);
    row.nssf += money(d.nssf);
    row.shif += money(d.nhif);
    row.housingLevy += money(d.housingLevy);
    row.paye += money(d.paye);
    row.payeArrears += money(d.payeArrears);
    row.netPay += money(d.netPay);
    row.runs.add(d.payrollRunId);
    byEmployee.set(code, row);
  }

  const rows = [...byEmployee.values()]
    .map(({ runs, ...r }) => {
      void runs;
      return {
        ...r,
        grossPay: Math.round(r.grossPay * 100) / 100,
        nssf: Math.round(r.nssf * 100) / 100,
        shif: Math.round(r.shif * 100) / 100,
        housingLevy: Math.round(r.housingLevy * 100) / 100,
        paye: Math.round(r.paye * 100) / 100,
        payeArrears: Math.round(r.payeArrears * 100) / 100,
        netPay: Math.round(r.netPay * 100) / 100,
      };
    })
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  const totals = rows.reduce(
    (acc, r) => ({
      months: 0,
      grossPay: Math.round((acc.grossPay + r.grossPay) * 100) / 100,
      nssf: Math.round((acc.nssf + r.nssf) * 100) / 100,
      shif: Math.round((acc.shif + r.shif) * 100) / 100,
      housingLevy: Math.round((acc.housingLevy + r.housingLevy) * 100) / 100,
      paye: Math.round((acc.paye + r.paye) * 100) / 100,
      payeArrears: Math.round((acc.payeArrears + r.payeArrears) * 100) / 100,
      netPay: Math.round((acc.netPay + r.netPay) * 100) / 100,
    }),
    { months: 0, grossPay: 0, nssf: 0, shif: 0, housingLevy: 0, paye: 0, payeArrears: 0, netPay: 0 },
  );

  return { scope, year, rows, totals, sourceRuns: new Set(details.map((d) => d.payrollRunId)).size };
}

/** CSV rendition following the repo's report export conventions. */
export function p10ToCSV(p10: NonNullable<Awaited<ReturnType<typeof buildP10>>>): string {
  const header = [
    'Employee Code',
    'Employment Type',
    'Months',
    'Gross Pay (KES)',
    'NSSF (KES)',
    'SHIF (KES)',
    'Housing Levy (KES)',
    'PAYE (KES)',
    'PAYE Arrears (KES)',
    'Net Pay (KES)',
  ];
  const rows = p10.rows.map((r) => [
    r.employeeCode,
    r.employmentType,
    r.months,
    r.grossPay.toFixed(2),
    r.nssf.toFixed(2),
    r.shif.toFixed(2),
    r.housingLevy.toFixed(2),
    r.paye.toFixed(2),
    r.payeArrears.toFixed(2),
    r.netPay.toFixed(2),
  ]);
  rows.push([
    'TOTAL',
    '',
    '',
    p10.totals.grossPay.toFixed(2),
    p10.totals.nssf.toFixed(2),
    p10.totals.shif.toFixed(2),
    p10.totals.housingLevy.toFixed(2),
    p10.totals.paye.toFixed(2),
    p10.totals.payeArrears.toFixed(2),
    p10.totals.netPay.toFixed(2),
  ]);
  return toCSV(header, rows);
}

/** Audit the export (spec: exports audit logged). Fire-and-tolerate. */
export async function auditP10Export(session: Session, year: number, format: string): Promise<void> {
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'P10_EXPORTED',
    resourceType: HrEntityType.DATA_EXPORT,
    resourceId: `p10-${year}`,
    storeId: session.storeId,
    metadata: { year, format, scope: resolveReportScope(session) },
  }).catch(() => undefined);
}
