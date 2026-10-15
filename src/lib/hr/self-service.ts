// MBUMAH HARDWARE POS - Employee self-service (v2.19.0, spec Phase 4.7)
//
// The self-service portal resolves the Employee row through the signed-in
// User (Employee.userId @unique). Every query is hard-scoped to that single
// employee id: client-supplied employeeId/employeeCode parameters are ignored
// by design, so cross-employee reads are structurally impossible (spec test
// matrix 19 "Self-service cross-employee denial").
//
// Guard composition per endpoint:
//   1. Session (cookie or Bearer - Layer 5 "header wins, cookie fallback").
//   2. HR module flag (hr.module.enabled) => 403 FEATURE_DISABLED.
//   3. hr.* permission (hr.payroll.read.own, hr.leave.read.own, ...) with
//      deny logging via recordPermissionDenied.
//   4. Employee link resolution => 403 NO_EMPLOYEE_PROFILE when absent.

import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import {
  getSessionFromRequest,
  recordPermissionDenied,
  type AuthSession,
} from '@/lib/auth';
import { hasHrPermission, type HrPermissionKey } from './permissions';
import { isHrModuleEnabled } from './feature-flag';
import { StageGError } from './stage-g-shared';
import { requestLeave } from './leave-service';
import { listMyGoals } from './goal-service';
import { listMyReviews } from './performance-service';

type Session = AuthSession;

export interface SelfEmployee {
  id: string;
  storeId: string;
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  jobTitle: string | null;
  role: string;
  employmentType: string;
  status: string;
  hireDate: Date;
  photoUrl: string | null;
}

/** Resolve the signed-in user's own Employee row (or null). */
export async function resolveSelfEmployee(session: Session): Promise<SelfEmployee | null> {
  const employee = await db.employee.findFirst({
    where: { userId: session.userId, deletedAt: null },
    select: {
      id: true,
      storeId: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      jobTitle: true,
      role: true,
      employmentType: true,
      status: true,
      hireDate: true,
      photoUrl: true,
    },
  });
  return employee ?? null;
}

type SelfHandler = (
  request: NextRequest,
  session: Session,
  employee: SelfEmployee,
  context?: { params: Promise<{ id: string }> },
) => Promise<Response>;

/** Guard factory for /api/self-service/me/* endpoints (see header). */
export function selfServiceGuard(permission: HrPermissionKey) {
  return (handler: SelfHandler) =>
    async (request: NextRequest, ...rest: unknown[]): Promise<Response> => {
      const session = await getSessionFromRequest(request);
      if (!session) {
        return Response.json(
          { success: false, error: 'Authentication required.', code: 'UNAUTHENTICATED' },
          { status: 401 },
        );
      }
      const enabled = await isHrModuleEnabled(session.organizationId);
      if (!enabled) {
        return Response.json(
          {
            success: false,
            error: 'The Employee Management System is disabled for this organization.',
            code: 'FEATURE_DISABLED',
          },
          { status: 403 },
        );
      }
      if (!hasHrPermission(session.role, permission)) {
        await recordPermissionDenied({
          session,
          permission,
          request,
          resource: new URL(request.url).pathname,
        });
        return Response.json(
          {
            success: false,
            error: 'You do not have permission to perform this action.',
            code: 'PERMISSION_DENIED',
          },
          { status: 403 },
        );
      }
      const employee = await resolveSelfEmployee(session);
      if (!employee) {
        return Response.json(
          {
            success: false,
            error: 'No employee profile is linked to your account. Ask HR to link one.',
            code: 'NO_EMPLOYEE_PROFILE',
          },
          { status: 403 },
        );
      }
      return handler(request, session, employee, rest[0] as { params: Promise<{ id: string }> } | undefined);
    };
}

/** Map StageGError and plain leave-service Errors to safe JSON responses. */
export function selfServiceErrorResponse(error: unknown): Response {
  if (error instanceof StageGError) {
    return Response.json(
      { success: false, error: error.message.replace(/^[A-Z_]+: /, ''), code: error.code },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : '';
  const match = /^([A-Z_]+):/.exec(message);
  if (match) {
    const status = match[1] === 'INSUFFICIENT_LEAVE_BALANCE' ? 409 : 400;
    return Response.json({ success: false, error: message, code: match[1] }, { status });
  }
  return Response.json(
    { success: false, error: 'The request could not be completed.', code: 'INTERNAL_ERROR' },
    { status: 500 },
  );
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function money(value: unknown): string {
  if (value === null || value === undefined) return '0.00';
  if (typeof value === 'object' && value !== null && 'toFixed' in (value as Record<string, unknown>)) {
    return (value as Prisma.Decimal).toFixed(2);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

// ── /api/self-service/me ────────────────────────────────────────────────────

export async function getMyDashboard(employee: SelfEmployee): Promise<{
  profile: Record<string, unknown>;
  payslips: Array<Record<string, unknown>>;
  leave: Record<string, unknown>;
  attendanceToday: Record<string, unknown> | null;
  goals: Array<Record<string, unknown>>;
}> {
  const year = new Date().getUTCFullYear();

  const [latestRuns, balances, pendingLeaveCount, todayRecord, goals] = await Promise.all([
    db.payrollDetail.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 3,
      include: {
        payrollRun: {
          select: {
            status: true,
            payrollPeriod: { select: { name: true, startDate: true, endDate: true } },
          },
        },
      },
    }),
    db.employeeLeaveBalance.findMany({
      where: { employeeId: employee.id, leaveYear: year },
      include: { leaveType: { select: { name: true, code: true } } },
    }),
    db.leaveRequest.count({ where: { employeeId: employee.id, status: 'PENDING' } }),
    db.attendanceRecord.findFirst({
      where: {
        employeeId: employee.id,
        date: {
          gte: new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'),
          lt: new Date(new Date().toISOString().slice(0, 10) + 'T23:59:59.999Z'),
        },
      },
      orderBy: { date: 'desc' },
    }),
    listMyGoals(employee.id),
  ]);

  const monthsOfService = Math.floor(
    (Date.now() - employee.hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
  );

  return {
    profile: {
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode,
      jobTitle: employee.jobTitle,
      employmentType: employee.employmentType,
      status: employee.status,
      hireDate: employee.hireDate.toISOString(),
      monthsOfService,
    },
    payslips: latestRuns.map((p) => ({
      id: p.id,
      periodLabel: p.payrollRun.payrollPeriod.name,
      periodStart: p.payrollRun.payrollPeriod.startDate.toISOString(),
      periodEnd: p.payrollRun.payrollPeriod.endDate.toISOString(),
      netPay: money(p.netPay),
      grossPay: money(p.grossPay),
      totalDeductions: money(p.totalDeductions),
      payslipNumber: p.payslipNumber ?? null,
      runStatus: p.payrollRun.status,
      issuedAt: toIso(p.payslipIssuedAt) ?? p.createdAt.toISOString(),
    })),
    leave: {
      balances: balances.map((b) => {
        const allocated = b.allocatedDays ?? new Prisma.Decimal(0);
        const carried = b.carryForwardDays ?? new Prisma.Decimal(0);
        const used = b.usedDays ?? new Prisma.Decimal(0);
        const pending = b.pendingDays ?? new Prisma.Decimal(0);
        const available = allocated.add(carried).sub(used).sub(pending);
        return {
          leaveTypeId: b.leaveTypeId,
          name: b.leaveType.name,
          code: b.leaveType.code,
          allocatedDays: money(allocated),
          usedDays: money(used),
          pendingDays: money(pending),
          carryForwardDays: money(carried),
          availableDays: money(available),
        };
      }),
      pendingLeaveCount,
    },
    attendanceToday: todayRecord
      ? {
          date: todayRecord.date.toISOString(),
          status: todayRecord.status,
          checkIn: toIso(todayRecord.checkIn),
          checkOut: toIso(todayRecord.checkOut),
          workingHours: money(todayRecord.workingHours),
          lateMinutes: todayRecord.lateMinutes,
        }
      : null,
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      metricSource: g.metricSource,
      status: g.status,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      progressPct: g.progressPct,
      dueDate: g.dueDate,
    })),
  };
}

// ── /api/self-service/me/payslips ───────────────────────────────────────────

export async function listMyPayslips(employee: SelfEmployee, year?: number): Promise<Array<Record<string, unknown>>> {
  const yearStart = year ? new Date(Date.UTC(year, 0, 1)) : null;
  const yearEnd = year ? new Date(Date.UTC(year + 1, 0, 1)) : null;
  const payslips = await db.payrollDetail.findMany({
    where: {
      employeeId: employee.id,
      ...(year
        ? {
            payrollRun: {
              payrollPeriod: {
                startDate: { gte: yearStart as Date, lt: yearEnd as Date },
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      payrollRun: {
        select: {
          status: true,
          runType: true,
          payrollPeriod: { select: { name: true, startDate: true, endDate: true } },
        },
      },
    },
  });
  return payslips.map((p) => ({
    id: p.id,
    payslipNumber: p.payslipNumber ?? null,
    periodName: p.payrollRun.payrollPeriod.name,
    periodStart: p.payrollRun.payrollPeriod.startDate.toISOString(),
    periodEnd: p.payrollRun.payrollPeriod.endDate.toISOString(),
    runType: p.payrollRun.runType,
    runStatus: p.payrollRun.status,
    grossPay: money(p.grossPay),
    totalDeductions: money(p.totalDeductions),
    netPay: money(p.netPay),
    daysWorked: p.daysWorked,
    overtimeHours: money(p.overtimeHours),
    issuedAt: toIso(p.payslipIssuedAt) ?? p.createdAt.toISOString(),
  }));
}

/** Full own-payslip view: breakdown + plain-language trace (spec rule 7). */
export async function getMyPayslip(
  employee: SelfEmployee,
  payslipId: string,
  canUnmask: boolean,
): Promise<Record<string, unknown> | null> {
  const p = await db.payrollDetail.findFirst({
    where: { id: payslipId, employeeId: employee.id },
    include: {
      payrollRun: {
        select: {
          status: true,
          runType: true,
          payrollPeriod: { select: { name: true, startDate: true, endDate: true } },
        },
      },
    },
  });
  if (!p) return null;

  const breakdown = (() => {
    try {
      return p.deductionsBreakdown ? (JSON.parse(p.deductionsBreakdown) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();

  return {
    id: p.id,
    payslipNumber: p.payslipNumber ?? null,
    periodName: p.payrollRun.payrollPeriod.name,
    periodStart: p.payrollRun.payrollPeriod.startDate.toISOString(),
    periodEnd: p.payrollRun.payrollPeriod.endDate.toISOString(),
    runType: p.payrollRun.runType,
    runStatus: p.payrollRun.status,
    employee: {
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode,
      jobTitle: employee.jobTitle,
    },
    earnings: {
      basicSalary: money(p.basicSalary),
      houseAllowance: money(p.houseAllowance),
      transportAllowance: money(p.transportAllowance),
      medicalAllowance: money(p.medicalAllowance),
      otherAllowances: money(p.otherAllowances),
      overtimePay: money(p.overtimePay),
      grossPay: money(p.grossPay),
    },
    deductions: {
      paye: money(p.paye),
      nssf: money(p.nssf),
      shif: money(p.nhif),
      housingLevy: money(p.housingLevy),
      payeArrears: money(p.payeArrears),
      loanDeduction: money(p.loanDeduction),
      otherDeductions: money(p.otherDeductions),
      totalDeductions: money(p.totalDeductions),
    },
    netPay: money(p.netPay),
    stats: {
      daysWorked: p.daysWorked,
      daysPresent: p.daysPresent,
      daysAbsent: p.daysAbsent,
      daysOnLeave: p.daysOnLeave,
      overtimeHours: money(p.overtimeHours),
    },
    statutoryIds: canUnmask
      ? null // unmasked values are only ever served by HR endpoints w/ audit
      : { nssa: '[REDACTED]', kraPin: '[REDACTED]', shif: '[REDACTED]' },
    breakdown,
    issuedAt: toIso(p.payslipIssuedAt) ?? p.createdAt.toISOString(),
  };
}

// ── /api/self-service/me/attendance ─────────────────────────────────────────

export async function listMyAttendance(
  employee: SelfEmployee,
  opts: { limit?: number; from?: string } = {},
): Promise<{ records: Array<Record<string, unknown>>; summary: Record<string, unknown> }> {
  const limit = Math.min(Math.max(Number(opts.limit ?? 30) || 30, 1), 90);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [records, monthAgg] = await Promise.all([
    db.attendanceRecord.findMany({
      where: {
        employeeId: employee.id,
        ...(opts.from ? { date: { gte: new Date(opts.from) } } : {}),
      },
      orderBy: { date: 'desc' },
      take: limit,
    }),
    db.attendanceRecord.groupBy({
      by: ['status'],
      where: { employeeId: employee.id, date: { gte: monthStart } },
      _count: { status: true },
      _sum: { workingHours: true, overtimeHours: true },
    }),
  ]);

  const summary: Record<string, number> = {};
  let monthHours = 0;
  let monthOvertime = 0;
  for (const row of monthAgg) {
    summary[row.status] = row._count.status;
    monthHours += Number(row._sum.workingHours ?? 0);
    monthOvertime += Number(row._sum.overtimeHours ?? 0);
  }

  return {
    records: records.map((r) => ({
      id: r.id,
      date: r.date.toISOString(),
      status: r.status,
      checkIn: toIso(r.checkIn),
      checkOut: toIso(r.checkOut),
      workingHours: money(r.workingHours),
      overtimeHours: money(r.overtimeHours),
      lateMinutes: r.lateMinutes,
    })),
    summary: { month: summary, monthHours: monthHours.toFixed(1), monthOvertime: monthOvertime.toFixed(1) },
  };
}

// ── /api/self-service/me/leave ──────────────────────────────────────────────

export async function listMyLeave(employee: SelfEmployee): Promise<{
  balances: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
}> {
  const year = new Date().getUTCFullYear();
  const [balances, requests] = await Promise.all([
    db.employeeLeaveBalance.findMany({
      where: { employeeId: employee.id, leaveYear: year },
      include: { leaveType: { select: { name: true, code: true } } },
      orderBy: { leaveTypeId: 'asc' },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { leaveType: { select: { name: true, code: true } } },
    }),
  ]);
  return {
    balances: balances.map((b) => {
      const allocated = b.allocatedDays ?? new Prisma.Decimal(0);
      const carried = b.carryForwardDays ?? new Prisma.Decimal(0);
      const used = b.usedDays ?? new Prisma.Decimal(0);
      const pending = b.pendingDays ?? new Prisma.Decimal(0);
      const available = allocated.add(carried).sub(used).sub(pending);
      return {
        leaveTypeId: b.leaveTypeId,
        name: b.leaveType.name,
        code: b.leaveType.code,
        allocatedDays: money(allocated),
        usedDays: money(used),
        pendingDays: money(pending),
        carryForwardDays: money(carried),
        availableDays: money(available),
      };
    }),
    requests: requests.map((r) => ({
      id: r.id,
      type: r.leaveType.name,
      code: r.leaveType.code,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate.toISOString(),
      workingDays: money(r.workingDays),
      halfDay: r.halfDay,
      status: r.status,
      reason: r.reason ?? null,
      rejectionReason: r.status === 'REJECTED' ? r.rejectionReason ?? null : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Leave request submitted by the employee themself (employeeId forced). */
export async function requestMyLeave(
  employee: SelfEmployee,
  session: Session,
  input: {
    leaveTypeId?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    halfDay?: unknown;
    reason?: unknown;
  },
): Promise<Record<string, unknown>> {
  const leaveTypeId = String(input.leaveTypeId ?? '').trim();
  if (!leaveTypeId) throw new StageGError('LEAVE_TYPE_REQUIRED', 'Choose a leave type.', 400);
  const startDate = new Date(String(input.startDate ?? ''));
  const endDate = new Date(String(input.endDate ?? ''));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new StageGError('INVALID_PERIOD', 'startDate and endDate must be valid ISO dates.', 400);
  }
  const request = await requestLeave({
    employeeId: employee.id, // forced self; client value ignored
    storeId: employee.storeId,
    actorId: session.userId,
    actorRole: session.role,
    leaveTypeId,
    startDate,
    endDate,
    halfDay: input.halfDay === true,
    reason: typeof input.reason === 'string' ? input.reason.trim() || undefined : undefined,
  }).catch((error: unknown) => {
    // leave-service throws plain Errors with CODE: prefixes; normalise.
    if (error instanceof StageGError) throw error;
    const message = error instanceof Error ? error.message : '';
    const match = /^([A-Z_]+):/.exec(message);
    if (match) {
      throw new StageGError(match[1], message, match[1] === 'INSUFFICIENT_LEAVE_BALANCE' ? 409 : 400);
    }
    throw error;
  });
  return {
    id: request.id,
    status: request.status,
    startDate: request.startDate.toISOString(),
    endDate: request.endDate.toISOString(),
    workingDays: money(request.workingDays),
  };
}

// ── /api/self-service/me/documents ──────────────────────────────────────────

export async function listMyDocuments(employee: SelfEmployee): Promise<Array<Record<string, unknown>>> {
  const docs = await db.employeeDocument.findMany({
    where: { employeeId: employee.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  // Notes may hold HR-only context - excluded from self-service payloads.
  return docs.map((d) => ({
    id: d.id,
    type: d.type,
    fileName: d.fileName,
    verificationStatus: d.verificationStatus,
    issueDate: toIso(d.issueDate),
    expiryDate: toIso(d.expiryDate),
    hasFile: Boolean(d.fileUrl),
  }));
}

// ── /api/self-service/me/goals + reviews ────────────────────────────────────

export async function listMyGoalProgress(employee: SelfEmployee): Promise<Array<Record<string, unknown>>> {
  const goals = await listMyGoals(employee.id);
  return goals.map((g) => ({
    id: g.id,
    title: g.title,
    metricSource: g.metricSource,
    status: g.status,
    targetValue: g.targetValue,
    currentValue: g.currentValue,
    progressPct: g.progressPct,
    dueDate: g.dueDate,
    isPosSourced: g.metricSource === 'SALES_TOTAL' || g.metricSource === 'SALES_COUNT',
  }));
}

export async function listMyPerformanceReviews(employee: SelfEmployee): Promise<Array<Record<string, unknown>>> {
  const reviews = await listMyReviews(employee.id);
  return reviews.map((r) => ({
    id: r.id,
    cycleName: r.cycleName,
    status: r.status,
    acknowledgedAt: r.acknowledgedAt,
    createdAt: r.createdAt,
  }));
}
