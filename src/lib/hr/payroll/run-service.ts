// MBUMAH HARDWARE POS - EMS payroll run lifecycle service (v2.18.9)
//
// Phase 4.6 contract (EMS spec):
//   • State machine: DRAFT → PENDING_APPROVAL → APPROVED → POSTED → LOCKED,
//     with REJECTED (approver sends back), VOIDED (pre-post cancel), FAILED.
//   • Maker-checker: the user who prepares a run can NEVER approve it
//     (spec rule 21) — enforced here regardless of role.
//   • Posting is IDEMPOTENT: the combined journal is created through the
//     existing accounting helper createJournalEntry with
//     idempotencyKey = `payroll-run:{runId}`; a replay returns the same
//     entry and never double-posts (spec acceptance #3, #4).
//   • Payslips are issued (PS-YYYYMMDD-NNNN) at POST time and are append-
//     only afterwards; corrections go through PayrollCorrection which
//     REVERSES (balanced adjusting entry) and REPLACES (supplementary run).
//   • Every mutation is audit-logged via hrAudit; no direct Prisma writes
//     from route handlers (spec rule 15).
//
// Money inside this service is integer cents (engine contract). Persistence
// to PayrollDetail converts to KES Decimal (cents / 100) because those
// columns pre-date the engine; the exact integer-cent truth travels in
// computationTrace JSON so corrections and the P10 extract can reproduce
// every figure without float drift.

import { db, withImmutabilityBypass } from '@/lib/db';
import { createJournalEntry } from '@/lib/accounting-helpers';
import { nextSequence, formatSequence } from '@/lib/sequence';
import { sendEmail } from '@/lib/email-service';
import { hrAudit, HrEntityType } from '../audit';
import { hasUnapprovedTimesheet } from '../attendance-service';
import {
  PAYROLL_APPROVED_METADATA_MARKER,
  PAYROLL_POSTED_METADATA_MARKER,
  PAYSLIP_ISSUED_METADATA_MARKER,
  PAYROLL_DISBURSED_METADATA_MARKER,
  payrollRunApprovalCopy,
  payrollRunPostedCopy,
  payslipIssuedCopy,
  payrollRunDisbursedCopy,
  payrollRunDigestToCsv,
  payrollDisbursementToCsv,
  type PayrollRunDigestEmployeeRow,
  type PayrollRunDigestMeta,
  type PayrollRunPostedMeta,
  type PayrollRunDisbursedMeta,
  type PayrollDisbursementRow,
  type PayrollDisbursementMode,
} from './run-digest';
import {
  buildPayrollJournal,
  computePayslip,
  resolveRates,
} from './engine';
import {
  PAYROLL_ACCOUNTS,
  PayrollGuardrailError,
  type PayslipResult,
  type ResolvedRateTable,
  type RateTableRowData,
} from './types';

// ── Public vocabulary ────────────────────────────────────────────────────────

export const RUN_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'LOCKED',
  'REJECTED',
  'VOIDED',
  'FAILED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CORRECTION_TYPES = ['UNDERPAYMENT', 'OVERPAYMENT', 'REVERSAL'] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

/** Legal status transitions of the run state machine. */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'VOIDED'],
  REJECTED: ['PENDING_APPROVAL', 'VOIDED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'VOIDED'],
  APPROVED: ['POSTED', 'VOIDED'],
  POSTED: ['LOCKED'],
  LOCKED: [],
  VOIDED: [],
  FAILED: ['DRAFT'],
};

export class PayrollLifecycleError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: PayrollIssue[];
  constructor(code: string, message: string, status = 409, issues?: PayrollIssue[]) {
    super(`${code}: ${message}`);
    this.code = code;
    this.status = status;
    this.issues = issues;
    this.name = 'PayrollLifecycleError';
  }
}

export interface PayrollIssue {
  employeeId?: string;
  employeeName?: string;
  code: string;
  message: string;
}

// v2.21.0: exported so the B2C disbursement service (disbursement-service.ts)
// can share the exact actor-context shape without redefining it.
export interface RunActorContext {
  storeId: string;
  organizationId: string;
  actorId: string;
}

const KES = (cents: number): number => Math.round(cents) / 100;

/** Resolve the branch-scoped actor context from an authenticated session. */
export function payrollActorContext(session: {
  userId: string;
  role: string;
  storeId: string | null;
  organizationId: string;
}): RunActorContext {
  if (!session.storeId) {
    throw new PayrollLifecycleError(
      'NO_STORE_CONTEXT',
      'Your session has no branch context; payroll runs are branch-scoped.',
      403,
    );
  }
  return {
    storeId: session.storeId,
    organizationId: session.organizationId,
    actorId: session.userId,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getRunOrThrow(runId: string, storeId: string) {
  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId },
    include: { payrollPeriod: true },
  });
  if (!run) {
    throw new PayrollLifecycleError('RUN_NOT_FOUND', 'Payroll run not found.', 404);
  }
  return run;
}

function assertTransition(from: string, to: string) {
  const allowed = RUN_TRANSITIONS[from as RunStatus];
  if (!allowed || !allowed.includes(to as RunStatus)) {
    throw new PayrollLifecycleError(
      'INVALID_TRANSITION',
      `Cannot move a ${from} payroll run to ${to}.`,
    );
  }
}

/** Rebuild the exact engine result from the stored integer-cent trace. */
function deserialisePayslipResult(raw: string | null): PayslipResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PayslipResult;
    if (
      typeof parsed.grossCents !== 'number' ||
      typeof parsed.netCents !== 'number' ||
      !Array.isArray(parsed.earnings)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface LoadedRateTable {
  id: string;
  type: string;
  code: string;
  label: string;
  basis: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  rows: RateTableRowData[];
}

function toResolved(table: LoadedRateTable): ResolvedRateTable {
  return {
    id: table.id,
    type: table.type,
    code: table.code,
    label: table.label,
    basis: table.basis,
    effectiveFrom: table.effectiveFrom.toISOString(),
    effectiveTo: table.effectiveTo ? table.effectiveTo.toISOString() : null,
    rows: [...table.rows].sort((a, b) => a.order - b.order),
  };
}

/** Weekday count (Mon–Fri) in [from, to] inclusive, UTC day semantics. */
function countWorkingDays(from: Date, to: Date): number {
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Overlapping weekdays between a leave request and the payroll period. */
function overlapWorkingDays(
  leaveStart: Date,
  leaveEnd: Date,
  periodStart: Date,
  periodEnd: Date,
): number {
  const start = leaveStart > periodStart ? leaveStart : periodStart;
  const end = leaveEnd < periodEnd ? leaveEnd : periodEnd;
  if (start > end) return 0;
  return countWorkingDays(start, end);
}

// ── 1. Create run ────────────────────────────────────────────────────────────

export async function createPayrollRun(
  ctx: RunActorContext,
  input: { payrollPeriodId: string; runType?: string; idempotencyKey?: string },
) {
  if (input.idempotencyKey) {
    const replay = await db.payrollRun.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (replay) return { run: replay, replay: true };
  }

  const period = await db.payrollPeriod.findFirst({
    where: { id: input.payrollPeriodId, storeId: ctx.storeId },
  });
  if (!period) {
    throw new PayrollLifecycleError('PERIOD_NOT_FOUND', 'Payroll period not found.', 404);
  }
  if (period.status === 'VOIDED') {
    throw new PayrollLifecycleError('PERIOD_VOIDED', 'Cannot run payroll against a voided period.');
  }

  const runType = input.runType ?? 'REGULAR';
  const duplicate = await db.payrollRun.findFirst({
    where: { payrollPeriodId: period.id, runType, status: { notIn: ['VOIDED'] } },
    select: { id: true },
  });
  if (duplicate) {
    throw new PayrollLifecycleError(
      'RUN_ALREADY_EXISTS',
      `A ${runType} run already exists for period "${period.name}". Void it first or use a different run type.`,
    );
  }

  const run = await db.payrollRun.create({
    data: {
      payrollPeriodId: period.id,
      storeId: ctx.storeId,
      runType,
      status: 'DRAFT',
      initiatedBy: ctx.actorId,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'CREATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { runType, periodId: period.id },
    });
    return { run, replay: false };
}

// ── 2. Prepare (compute + validate + persist payslips) ──────────────────────

export async function preparePayrollRun(ctx: RunActorContext, runId: string) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  if (run.status !== 'DRAFT' && run.status !== 'REJECTED') {
    throw new PayrollLifecycleError(
      'INVALID_TRANSITION',
      `Payroll can only be prepared from DRAFT or REJECTED (current: ${run.status}).`,
    );
  }

  const period = run.payrollPeriod;
  const issues: PayrollIssue[] = [];

  // 2a. Statutory rate tables (org-scoped, effective at period end).
  const tables = (await db.rateTable.findMany({
    where: { organizationId: ctx.organizationId },
    include: { rows: true },
  })) as unknown as LoadedRateTable[];
  const requiredTypes = ['PAYE', 'PERSONAL_RELIEF', 'NSSF_TIER1', 'NSSF_TIER2', 'SHIF', 'HOUSING_LEVY'];
  const resolved = new Map<string, ResolvedRateTable>();
  try {
    for (const [key, value] of resolveRates(
      tables.map(toResolved),
      period.endDate,
      requiredTypes,
    )) {
      resolved.set(key, value);
    }
  } catch (error) {
    if (error instanceof PayrollGuardrailError) {
      throw new PayrollLifecycleError(error.code, error.message, 422);
    }
    throw error;
  }

  // 2b. Employees in scope.
  const employees = await db.employee.findMany({
    where: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' },
    orderBy: { employeeCode: 'asc' },
  });

  const standardWorkingDays = Math.max(1, countWorkingDays(period.startDate, period.endDate));
  const overtimeBps =
    resolved.get('OVERTIME')?.rows[0]?.rateBps ?? 15_000;

  type Computed = {
    employeeId: string;
    result: PayslipResult;
    daysPresent: number;
    daysAbsent: number;
    daysOnLeave: number;
    overtimeHours: number;
  };
  const computed: Computed[] = [];

  for (const employee of employees) {
    const label = `${employee.firstName} ${employee.lastName}`.trim();

    // Consent gate (engine guardrail MISSING_CONSENT).
    const consent = await db.consentRecord.findFirst({
      where: { employeeId: employee.id, withdrawnAt: null },
      select: { id: true },
    });
    if (!consent) {
      issues.push({
        employeeId: employee.id,
        employeeName: label,
        code: 'MISSING_CONSENT',
        message: 'No active data-processing consent on file; payroll blocked.',
      });
      continue;
    }

    // Timesheet gate (spec acceptance #11).
    const unapproved = await hasUnapprovedTimesheet(
      employee.id,
      ctx.storeId,
      period.startDate,
      period.endDate,
    );
    if (unapproved) {
      issues.push({
        employeeId: employee.id,
        employeeName: label,
        code: 'TIMESHEET_NOT_APPROVED',
        message: 'Attendance for this period has unapproved timesheet days.',
      });
      continue;
    }

    // Salary basis: employee basic + fixed/percent earnings components from
    // the salary structure effective at period end.
    const basicCents = Math.round(Number(employee.basicSalary) * 100);
    const structure = await db.salaryStructure.findFirst({
      where: { employeeId: employee.id, deletedAt: null, effectiveFrom: { lte: period.endDate } },
      orderBy: { effectiveFrom: 'desc' },
      include: { components: { include: { salaryComponent: true } } },
    });
    let houseCents = 0;
    let transportCents = 0;
    let medicalCents = 0;
    let otherAllowCents = 0;
    let otherDedCents = 0;
    if (structure) {
      for (const assignment of structure.components) {
        const comp = assignment.salaryComponent;
        if (!comp.isActive) continue;
        const fixed = comp.amountCents ?? Math.round((Number(employee.basicSalary) * (comp.percentBps ?? 0)) / 10_000) * 100;
        if (comp.type === 'EARNING') {
          if (comp.code === 'HOUSE') houseCents += fixed;
          else if (comp.code === 'TRANSPORT') transportCents += fixed;
          else if (comp.code === 'MEDICAL') medicalCents += fixed;
          else otherAllowCents += fixed;
        } else if (comp.type === 'DEDUCTION') {
          otherDedCents += fixed;
        }
      }
    }

    // Attendance aggregates (approved days only).
    const attendance = await db.attendanceRecord.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: period.startDate, lte: period.endDate },
        timesheetApprovedAt: { not: null },
      },
      select: { status: true, overtimeHours: true },
    });
    const daysPresent = attendance.filter((a) => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'REMOTE').length;
    const daysAbsent = attendance.filter((a) => a.status === 'ABSENT').length;
    const overtimeHours = attendance.reduce((sum, a) => sum + Number(a.overtimeHours ?? 0), 0);

    // Unpaid leave days (approved requests overlapping the period).
    const unpaidLeave = await db.leaveRequest.findMany({
      where: {
        employeeId: employee.id,
        status: 'APPROVED',
        leaveType: { isPaid: false },
        startDate: { lte: period.endDate },
        endDate: { gte: period.startDate },
      },
      select: { startDate: true, endDate: true },
    });
    const unpaidLeaveDays = unpaidLeave.reduce(
      (sum, l) => sum + overlapWorkingDays(l.startDate, l.endDate, period.startDate, period.endDate),
      0,
    );
    const daysOnLeave = unpaidLeave.length > 0 ? unpaidLeaveDays : 0;

    const overtime =
      overtimeHours > 0
        ? [{ kind: 'WEEKDAY' as const, hours: overtimeHours, multiplierBps: overtimeBps }]
        : [];

    try {
      const result = computePayslip({
        employee: {
          employeeId: employee.id,
          employeeCode: employee.employeeCode ?? employee.id,
          fullName: label,
          basicSalaryCents: basicCents,
          houseAllowanceCents: houseCents,
          transportAllowanceCents: transportCents,
          medicalAllowanceCents: medicalCents,
          otherAllowancesCents: otherAllowCents,
          hourlyRateCents: employee.hourlyRate ? Math.round(Number(employee.hourlyRate) * 100) : null,
          payeExempt: false,
          nssfExempt: false,
          nhifExempt: false,
          housingExempt: false,
        },
        period: {
          periodYear: period.startDate.getUTCFullYear(),
          periodMonth: period.startDate.getUTCMonth() + 1,
          workedDays: daysPresent,
          standardWorkingDays,
          overtime,
          casualDays: 0,
          casualDayRateCents: 0,
          commissionCents: 0,
          otherDeductionsCents: otherDedCents,
          unpaidLeaveDays,
          nightAllowanceCents: 0,
        },
        rates: resolved,
        consentGranted: true,
      });
      computed.push({ employeeId: employee.id, result, daysPresent, daysAbsent, daysOnLeave, overtimeHours });
    } catch (error) {
      if (error instanceof PayrollGuardrailError) {
        issues.push({
          employeeId: employee.id,
          employeeName: label,
          code: error.code,
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  if (issues.length > 0) {
    await db.payrollRun.update({
      where: { id: run.id },
      data: { errorMessage: JSON.stringify(issues) },
    });
    throw new PayrollLifecycleError(
      'PAYROLL_GATES_FAILED',
      `${issues.length} employee(s) blocked payroll preparation; resolve the listed issues and re-prepare.`,
      422,
      issues,
    );
  }
  if (computed.length === 0) {
    throw new PayrollLifecycleError(
      'NO_PAYROLL_SCOPE',
      'No active employees with payable salaries were found for this period.',
      422,
    );
  }

  // 2c. Persist payslip rows (replace any previous draft computation) + totals.
  const totalGrossCents = computed.reduce((s, c) => s + c.result.grossCents, 0);
  const totalDeductionsCents = computed.reduce((s, c) => s + c.result.totalDeductionsCents, 0);
  const totalNetCents = computed.reduce((s, c) => s + c.result.netCents, 0);

  const line = (result: PayslipResult, code: string) =>
    result.earnings.find((l) => l.code === code)?.amountCents ?? 0;
  const ded = (result: PayslipResult, code: string) =>
    result.deductions.find((l) => l.code === code)?.amountCents ?? 0;

  // PayrollDetail is a db-level IMMUTABLE model; re-preparing a DRAFT run is
  // the sanctioned pre-issuance replace flow (nothing is issued yet).
  await withImmutabilityBypass(async () => {
    await db.$transaction(async (tx) => {
    await tx.payrollDetail.deleteMany({ where: { payrollRunId: run.id } });
    for (const c of computed) {
      const r = c.result;
      const extraAllowances = line(r, 'CASUAL') + line(r, 'NIGHT_ALLOW') + line(r, 'COMMISSION');
      await tx.payrollDetail.create({
        data: {
          payrollRunId: run.id,
          employeeId: c.employeeId,
          storeId: ctx.storeId,
          basicSalary: KES(line(r, 'BASIC')),
          houseAllowance: KES(line(r, 'HOUSE')),
          transportAllowance: KES(line(r, 'TRANSPORT')),
          medicalAllowance: KES(line(r, 'MEDICAL')),
          otherAllowances: KES(line(r, 'OTHER_ALLOW') + extraAllowances),
          overtimePay: KES(line(r, 'OVERTIME')),
          grossPay: KES(r.grossCents),
          paye: KES(ded(r, 'PAYE')),
          nssf: KES(ded(r, 'NSSF_T1') + ded(r, 'NSSF_T2')),
          nhif: KES(ded(r, 'SHIF')),
          housingLevy: KES(ded(r, 'AHL')),
          payeArrears: 0,
          loanDeduction: 0,
          otherDeductions: KES(ded(r, 'OTHER_DED')),
          totalDeductions: KES(r.totalDeductionsCents),
          netPay: KES(r.netCents),
          daysWorked: c.daysPresent,
          daysPresent: c.daysPresent,
          daysAbsent: c.daysAbsent,
          daysOnLeave: c.daysOnLeave,
          overtimeHours: c.overtimeHours,
          deductionsBreakdown: JSON.stringify({
            earnings: r.earnings,
            deductions: r.deductions,
            employerContributions: r.employerContributions,
          }),
          rateTableIds: JSON.stringify(r.rateTableIds),
          roundingAdjustmentCents: r.roundingAdjustmentCents,
          computationTrace: JSON.stringify(r),
        },
      });
    }
      await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          totalGross: KES(totalGrossCents),
          totalDeductions: KES(totalDeductionsCents),
          totalNet: KES(totalNetCents),
          employeeCount: computed.length,
          errorMessage: null,
        },
      });
    });
  }, 'payroll_draft_reprepare');

  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { prepared: computed.length, totalNetCents },
    },
  );

  return {
    prepared: computed.length,
    totalGrossCents,
    totalDeductionsCents,
    totalNetCents,
  };
}

// ── 3. Submit / reject / approve (maker-checker) ────────────────────────────

export async function submitPayrollRun(ctx: RunActorContext, runId: string) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  assertTransition(run.status, 'PENDING_APPROVAL');
  if (run.employeeCount === 0) {
    throw new PayrollLifecycleError(
      'NOT_PREPARED',
      'Prepare the run (compute payslips) before submitting it for approval.',
    );
  }
  const updated = await db.payrollRun.update({
    where: { id: run.id },
    data: {
      status: 'PENDING_APPROVAL',
      preparedByUserId: ctx.actorId,
      preparedAt: new Date(),
      rejectionReason: null,
    },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { submittedForApproval: true },
    },
  );
  return updated;
}

export async function rejectPayrollRun(
  ctx: RunActorContext,
  runId: string,
  reason: string,
) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  assertTransition(run.status, 'REJECTED');
  if (!reason || reason.trim().length < 10) {
    throw new PayrollLifecycleError(
      'MISSING_REJECTION_REASON',
      'A rejection reason of at least 10 characters is required.',
      400,
    );
  }
  const updated = await db.payrollRun.update({
    where: { id: run.id },
    data: {
      status: 'REJECTED',
      rejectedByUserId: ctx.actorId,
      rejectionReason: reason.trim(),
    },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { rejected: true },
    },
  );
  return updated;
}

export async function approvePayrollRun(ctx: RunActorContext, runId: string) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  assertTransition(run.status, 'APPROVED');
  // MAKER-CHECKER (spec rule 21): the preparer can never approve, whatever
  // their role. There is no role combination that bypasses this check.
  if (run.preparedByUserId && run.preparedByUserId === ctx.actorId) {
    throw new PayrollLifecycleError(
      'MAKER_CHECKER_VIOLATION',
      'The user who prepared this payroll run cannot approve it.',
      403,
    );
  }
  const updated = await db.payrollRun.update({
    where: { id: run.id },
    data: {
      status: 'APPROVED',
      approvedByUserId: ctx.actorId,
      approvedAt: new Date(),
    },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { approved: true },
    },
  );
  // v2.47.0: the approval digest rides the v2.46.0 attachment machinery —
  // bell rows to the maker + the store's payroll group, one email with the
  // per-employee CSV attached. BEST-EFFORT by contract: a notification or
  // email failure must never fail the approval decision itself (the run is
  // already APPROVED above); the digest result is surfaced fail-soft.
  const digest = await notifyPayrollRunApproved({
    run: updated,
    storeId: ctx.storeId,
    actorId: ctx.actorId,
  }).catch((err) => {
    console.warn('[payroll] approval digest failed (best-effort):', err);
    return null;
  });
  return { run: updated, digest };
}

/** Fail-soft result surfaced by POST /api/payroll/runs/[id]/approve. */
export interface PayrollApprovalDigestResult {
  /** Distinct users that received the in-app bell row. */
  notifiedUsers: number;
  /** Distinct email recipients (may be less when addresses are missing). */
  emailRecipients: number;
  emailStatus: 'SENT' | 'FAILED' | 'SKIPPED';
  emailError?: string;
  csvFilename?: string;
  csvByteSize?: number;
}

/**
 * v2.47.0: fan out the approval digest for a JUST-APPROVED run.
 *
 * Audience (mirrors the leave approver fan-out):
 *   - the store's decision-capable payroll group (SUPER_ADMIN,
 *     STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT — active, store-scoped or
 *     super), MINUS the approver who just acted;
 *   - PLUS the run's maker (preparedByUserId) always — the maker-checker
 *     contract means the maker was waiting on this decision.
 *
 * Delivery: one email per send (all addresses on one envelope) with the
 * per-employee CSV attached, in-app bell rows per user with the
 * payroll_approved metadata marker (the feed route owns the surface).
 * Every failure mode is caught: the approval decision is already durable.
 */
export async function notifyPayrollRunApproved(params: {
  run: { id: string; payrollPeriodId: string; runType: string; approvedAt: Date | null; approvedByUserId: string | null; preparedByUserId: string | null };
  storeId: string;
  actorId: string;
}): Promise<PayrollApprovalDigestResult> {
  const [run, store, period] = await Promise.all([
    db.payrollRun.findUnique({
      where: { id: params.run.id },
      select: {
        employeeCount: true,
        totalGross: true,
        totalDeductions: true,
        totalNet: true,
        approvedAt: true,
        preparedByUserId: true,
      },
    }),
    db.store.findUnique({ where: { id: params.storeId }, select: { name: true } }),
    db.payrollPeriod.findUnique({ where: { id: params.run.payrollPeriodId }, select: { name: true } }),
  ]);
  if (!run) return { notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' };

  // Per-employee aggregates for the CSV (names + codes only, from the
  // PayrollDetail rows the run was posted with).
  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: params.run.id },
    select: {
      grossPay: true,
      totalDeductions: true,
      netPay: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: { employeeId: 'asc' },
  });
  const rows: PayrollRunDigestEmployeeRow[] = details.map((d) => ({
    employeeName: `${d.employee?.firstName ?? ''} ${d.employee?.lastName ?? ''}`.trim() || 'Unnamed employee',
    employeeCode: d.employee?.employeeCode ?? null,
    gross: Number(d.grossPay),
    deductions: Number(d.totalDeductions),
    net: Number(d.netPay),
  }));

  // Approver label: same fallback ladder as leave-notify (name → email).
  const approverLabel =
    (await db.user
      .findUnique({ where: { id: params.actorId }, select: { name: true, email: true } })
      .then((u) => u?.name?.trim() || u?.email || null)
      .catch(() => null)) || 'Approver';

  const meta: PayrollRunDigestMeta = {
    periodName: period?.name ?? 'Payroll run',
    storeName: store?.name ?? 'MBUMAH HARDWARE',
    runType: params.run.runType,
    employeeCount: run.employeeCount,
    totalGross: Number(run.totalGross),
    totalDeductions: Number(run.totalDeductions),
    totalNet: Number(run.totalNet),
    approvedByLabel: approverLabel,
    approvedAtIso: (run.approvedAt ?? new Date()).toISOString(),
  };

  const copy = payrollRunApprovalCopy(meta);
  const csv = payrollRunDigestToCsv(rows, meta);

  // Recipients: decision-capable group minus the actor, plus the maker.
  const group = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      OR: [{ storeId: params.storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  const byId = new Map(group.map((u) => [u.id, u]));
  if (params.run.preparedByUserId && !byId.has(params.run.preparedByUserId)) {
    const maker = await db.user.findUnique({
      where: { id: params.run.preparedByUserId },
      select: { id: true, email: true, isActive: true },
    });
    if (maker?.isActive) byId.set(maker.id, maker);
  }
  byId.delete(params.actorId);
  const recipients = [...byId.values()];
  if (recipients.length === 0) return { notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' };

  const emailAddresses = recipients
    .map((u) => u.email)
    .filter((e): e is string => typeof e === 'string' && e.includes('@'));

  let emailStatus: PayrollApprovalDigestResult['emailStatus'] = 'SKIPPED';
  let emailError: string | undefined;
  if (emailAddresses.length > 0) {
    const email = await sendEmail({
      to: emailAddresses,
      subject: copy.emailSubject,
      html: copy.emailHtml,
      text: copy.emailText,
      ...(csv ? { attachments: [csv] } : {}),
      type: 'PAYROLL_APPROVED',
      metadata: {
        runId: params.run.id,
        periodName: meta.periodName,
        storeName: meta.storeName,
        employeeCount: meta.employeeCount,
        totalNet: meta.totalNet,
        approvedBy: approverLabel,
        ...(csv ? { csvFilename: csv.filename, csvBytes: csv.byteSize } : {}),
      },
    });
    emailStatus = email.success ? 'SENT' : 'FAILED';
    if (!email.success) emailError = email.error ?? 'Email send failed';
  }

  // In-app bell rows (kind marker drives the feed surface + filters).
  await db.notification.createMany({
    data: recipients.map((u) => ({
      storeId: params.storeId,
      userId: u.id,
      title: copy.title,
      message: copy.message,
      type: copy.notifType,
      category: 'HR',
      priority: copy.priority,
      metadata: JSON.stringify({
        kind: PAYROLL_APPROVED_METADATA_MARKER,
        runId: params.run.id,
        periodName: meta.periodName,
        emailStatus,
      }),
    })),
  });

  return {
    notifiedUsers: recipients.length,
    emailRecipients: emailAddresses.length,
    emailStatus,
    ...(emailError ? { emailError } : {}),
    ...(csv ? { csvFilename: csv.filename, csvByteSize: csv.byteSize } : {}),
  };
}

/** Fail-soft result surfaced by POST /api/payroll/runs/[id]/post (v2.48.0). */
export type PayrollPostedDigestResult = PayrollApprovalDigestResult;

/**
 * v2.48.0: fan out the posting digest for a JUST-POSTED run — the ledger
 * closed (journal entry + payslips issued), the point of no return for pay.
 *
 * Audience mirrors the approval fan-out: the store's decision-capable
 * payroll group (SUPER_ADMIN/STORE_OWNER/BRANCH_MANAGER/ACCOUNTANT —
 * active, store-scoped or super) MINUS the poster who just acted, PLUS the
 * run's maker (preparedByUserId) always — the maker's work just became
 * official payslips.
 *
 * Delivery: one email per send (all addresses on one envelope) with the
 * per-employee CSV attached (posted variant: "Payroll posting summary"
 * header + payslip range + -posted filename suffix), in-app bell rows per
 * user with the payroll_posted metadata marker. Every failure mode is
 * caught: the posting decision is already durable.
 */
export async function notifyPayrollRunPosted(params: {
  run: { id: string; payrollPeriodId: string; runType: string; postedAt: Date | null; postedByUserId: string | null; preparedByUserId: string | null };
  storeId: string;
  actorId: string;
}): Promise<PayrollPostedDigestResult> {
  const [run, store, period] = await Promise.all([
    db.payrollRun.findUnique({
      where: { id: params.run.id },
      select: {
        employeeCount: true,
        totalGross: true,
        totalDeductions: true,
        totalNet: true,
        postedAt: true,
        preparedByUserId: true,
      },
    }),
    db.store.findUnique({ where: { id: params.storeId }, select: { name: true } }),
    db.payrollPeriod.findUnique({ where: { id: params.run.payrollPeriodId }, select: { name: true } }),
  ]);
  if (!run) return { notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' };

  // Per-employee aggregates + the issued payslip numbers (stamped on post —
  // this query is the sanctioned read of the issuance write above).
  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: params.run.id },
    select: {
      grossPay: true,
      totalDeductions: true,
      netPay: true,
      payslipNumber: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: { employeeId: 'asc' },
  });
  const rows: PayrollRunDigestEmployeeRow[] = details.map((d) => ({
    employeeName: `${d.employee?.firstName ?? ''} ${d.employee?.lastName ?? ''}`.trim() || 'Unnamed employee',
    employeeCode: d.employee?.employeeCode ?? null,
    gross: Number(d.grossPay),
    deductions: Number(d.totalDeductions),
    net: Number(d.netPay),
  }));
  const payslipNumbers = details
    .map((d) => d.payslipNumber)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .sort();
  const firstPayslipNumber = payslipNumbers[0] ?? null;
  const lastPayslipNumber = payslipNumbers[payslipNumbers.length - 1] ?? null;

  // Poster label: same fallback ladder as the approval digest (name → email).
  const posterLabel =
    (await db.user
      .findUnique({ where: { id: params.actorId }, select: { name: true, email: true } })
      .then((u) => u?.name?.trim() || u?.email || null)
      .catch(() => null)) || 'Poster';

  const meta: PayrollRunPostedMeta = {
    periodName: period?.name ?? 'Payroll run',
    storeName: store?.name ?? 'MBUMAH HARDWARE',
    runType: params.run.runType,
    employeeCount: run.employeeCount,
    totalGross: Number(run.totalGross),
    totalDeductions: Number(run.totalDeductions),
    totalNet: Number(run.totalNet),
    postedByLabel: posterLabel,
    postedAtIso: (run.postedAt ?? new Date()).toISOString(),
    payslipCount: payslipNumbers.length,
    firstPayslipNumber,
    lastPayslipNumber,
  };

  const copy = payrollRunPostedCopy(meta);
  // The posted CSV needs the approval-meta shape plus the posted extras;
  // variant 'posted' flips every label it reads.
  const csv = payrollRunDigestToCsv(
    rows,
    {
      periodName: meta.periodName,
      storeName: meta.storeName,
      runType: meta.runType,
      employeeCount: meta.employeeCount,
      totalGross: meta.totalGross,
      totalDeductions: meta.totalDeductions,
      totalNet: meta.totalNet,
      approvedByLabel: meta.postedByLabel,
      approvedAtIso: meta.postedAtIso,
      postedByLabel: meta.postedByLabel,
      postedAtIso: meta.postedAtIso,
      payslipCount: meta.payslipCount,
      firstPayslipNumber: meta.firstPayslipNumber,
      lastPayslipNumber: meta.lastPayslipNumber,
    },
    new Date(),
    'posted',
  );

  // Recipients: decision-capable group minus the actor, plus the maker.
  const group = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      OR: [{ storeId: params.storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  const byId = new Map(group.map((u) => [u.id, u]));
  if (params.run.preparedByUserId && !byId.has(params.run.preparedByUserId)) {
    const maker = await db.user.findUnique({
      where: { id: params.run.preparedByUserId },
      select: { id: true, email: true, isActive: true },
    });
    if (maker?.isActive) byId.set(maker.id, maker);
  }
  byId.delete(params.actorId);
  const recipients = [...byId.values()];
  if (recipients.length === 0) return { notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' };

  const emailAddresses = recipients
    .map((u) => u.email)
    .filter((e): e is string => typeof e === 'string' && e.includes('@'));

  let emailStatus: PayrollPostedDigestResult['emailStatus'] = 'SKIPPED';
  let emailError: string | undefined;
  if (emailAddresses.length > 0) {
    const email = await sendEmail({
      to: emailAddresses,
      subject: copy.emailSubject,
      html: copy.emailHtml,
      text: copy.emailText,
      ...(csv ? { attachments: [csv] } : {}),
      type: 'PAYROLL_POSTED',
      metadata: {
        runId: params.run.id,
        periodName: meta.periodName,
        storeName: meta.storeName,
        employeeCount: meta.employeeCount,
        payslipCount: meta.payslipCount,
        totalNet: meta.totalNet,
        postedBy: posterLabel,
        ...(csv ? { csvFilename: csv.filename, csvBytes: csv.byteSize } : {}),
      },
    });
    emailStatus = email.success ? 'SENT' : 'FAILED';
    if (!email.success) emailError = email.error ?? 'Email send failed';
  }

  // In-app bell rows (kind marker drives the feed surface + filters).
  await db.notification.createMany({
    data: recipients.map((u) => ({
      storeId: params.storeId,
      userId: u.id,
      title: copy.title,
      message: copy.message,
      type: copy.notifType,
      category: 'HR',
      priority: copy.priority,
      metadata: JSON.stringify({
        kind: PAYROLL_POSTED_METADATA_MARKER,
        runId: params.run.id,
        periodName: meta.periodName,
        emailStatus,
      }),
    })),
  });

  return {
    notifiedUsers: recipients.length,
    emailRecipients: emailAddresses.length,
    emailStatus,
    ...(emailError ? { emailError } : {}),
    ...(csv ? { csvFilename: csv.filename, csvByteSize: csv.byteSize } : {}),
  };
}

// ── 3.c v2.49.0: employee-facing "your payslip is issued" notices ───────────

/** Fail-soft result surfaced inside POST .../post body.digest.employeeNotices. */
export interface PayslipIssuedFanoutResult {
  /** Run employees with a linked portal account (the bell-row audience). */
  portalLinked: number;
  /** In-app rows actually written (≤ portalLinked; equals it on success). */
  notifiedUsers: number;
  /** Per-employee emails attempted (portal-linked employees with an address). */
  emailsAttempted: number;
  emailsSent: number;
  emailsFailed: number;
}

/**
 * v2.49.0: fan out the "your payslip is issued" notices to the run's
 * EMPLOYEES — the last silent hop of the payroll lifecycle. Posting just
 * made their pay official; the maker and the payroll group already heard
 * about it (v2.48.0), but the person whose payslip now exists had to
 * discover it by stumbling into the portal.
 *
 * PRIVACY DESIGN (deliberately unlike the group digests): every employee
 * gets a PERSONAL row carrying only THEIR OWN payslip facts — payslip
 * number, net, payment status — and, when they have an address, a
 * personalized email with the same facts. There is no group CSV here, no
 * other employees' numbers, ever. Only portal-linked employees (Employee
 * rows with a userId) receive anything: an unlinked employee has no bell
 * to ring and no portal page to open, and paper payslips remain the
 * offline channel for them.
 *
 * Delivery: createMany for the in-app rows (one round-trip), then
 * per-employee emails in batches of 5 (personalized content cannot share
 * one envelope) — every send is individually caught, so one bad address
 * never stalls the batch. Best-effort by contract: a failure here must
 * never fail the posting itself.
 */
export async function notifyEmployeesPayslipsIssued(params: {
  runId: string;
  payrollPeriodId: string;
  storeId: string;
  postedAt: Date | null;
}): Promise<PayslipIssuedFanoutResult> {
  const [store, period] = await Promise.all([
    db.store.findUnique({ where: { id: params.storeId }, select: { name: true } }),
    db.payrollPeriod.findUnique({ where: { id: params.payrollPeriodId }, select: { name: true } }),
  ]);

  // The run's payslips joined to the portal link + personal email.
  const details = await db.payrollDetail.findMany({
    where: { payrollRunId: params.runId },
    select: {
      netPay: true,
      paymentStatus: true,
      payslipNumber: true,
      employee: {
        select: {
          firstName: true,
          lastName: true,
          userId: true,
          email: true,
        },
      },
    },
    orderBy: { employeeId: 'asc' },
  });

  const postedAtIso = (params.postedAt ?? new Date()).toISOString();
  const periodName = period?.name ?? 'Payroll run';
  const storeName = store?.name ?? 'MBUMAH HARDWARE';

  // Only portal-linked employees can receive anything at all (the schema
  // guarantees the employee relation on every detail row; userId is the
  // optional portal link).
  const audience = details.filter(
    (d) => typeof d.employee?.userId === 'string' && d.employee.userId.length > 0,
  );

  if (audience.length === 0) {
    return { portalLinked: 0, notifiedUsers: 0, emailsAttempted: 0, emailsSent: 0, emailsFailed: 0 };
  }

  // In-app bell rows (one per portal-linked employee, personalized copy).
  // Deep link straight to the portal Payslips page so the row IS the route.
  const notices = audience.map((d) => {
    const meta = {
      periodName,
      storeName,
      employeeName: `${d.employee.firstName ?? ''} ${d.employee.lastName ?? ''}`.trim(),
      payslipNumber: d.payslipNumber,
      netPay: Number(d.netPay),
      paymentStatus: d.paymentStatus,
      postedAtIso,
    };
    const copy = payslipIssuedCopy(meta);
    return { userId: d.employee.userId as string, copy };
  });

  await db.notification.createMany({
    data: notices.map(({ userId, copy }) => ({
      storeId: params.storeId,
      userId,
      title: copy.title,
      message: copy.message,
      type: copy.notifType,
      category: 'HR',
      priority: copy.priority,
      // v2.49.0: the row deep-links the portal Payslips page — the in-shell
      // feed (and the portal home strip) route the employee straight there.
      actionUrl: '/employees/me/payslips',
      actionLabel: 'View payslip',
      metadata: JSON.stringify({
        kind: PAYSLIP_ISSUED_METADATA_MARKER,
        runId: params.runId,
        periodName,
      }),
    })),
  });

  // Per-employee emails in batches of 5 — personalized content cannot share
  // one envelope. Every send is individually caught; RESEND failures (and
  // the dev no-API-key skip) surface honestly in the counts and the log.
  const emailable = audience
    .map((d, i) => ({ d, notice: notices[i] }))
    .filter(
      (x): x is { d: (typeof audience)[number]; notice: (typeof notices)[number] } =>
        typeof x.d.employee.email === 'string' && x.d.employee.email.includes('@'),
    );

  let emailsSent = 0;
  let emailsFailed = 0;
  const BATCH = 5;
  for (let i = 0; i < emailable.length; i += BATCH) {
    const batch = emailable.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(({ d, notice }) =>
        sendEmail({
          to: d.employee.email as string,
          subject: notice.copy.emailSubject,
          html: notice.copy.emailHtml,
          text: notice.copy.emailText,
          // Attribute the log row to the employee's user account when the
          // portal link exists (it always does inside this audience).
          userId: d.employee.userId ?? undefined,
          type: 'PAYSLIP_ISSUED',
          metadata: {
            runId: params.runId,
            periodName,
            payslipNumber: d.payslipNumber,
          },
        }).then((res) => {
          if (res.success) emailsSent += 1;
          else emailsFailed += 1;
        }),
      ),
    );
    // A rejected promise (bug in the send path itself) counts as FAILED —
    // allSettled means it cannot stall the rest of the batch.
    for (const s of settled) {
      if (s.status === 'rejected') {
        emailsFailed += 1;
        console.warn('[payroll] payslip-issued email rejected (best-effort):', s.reason);
      }
    }
  }

  return {
    portalLinked: audience.length,
    notifiedUsers: audience.length,
    emailsAttempted: emailable.length,
    emailsSent,
    emailsFailed,
  };
}

// ── 5.b v2.50.0: disbursement digest (money leaves the door) ─────────────

/** Fail-soft result surfaced by POST .../disburse + POST .../disburse-mpesa. */
export interface PayrollDisbursementDigestResult {
  notifiedUsers: number;
  emailRecipients: number;
  emailStatus: 'SENT' | 'FAILED' | 'SKIPPED';
  emailError?: string;
  csvFilename?: string;
  csvByteSize?: number;
}

/**
 * v2.50.0: fan out the DISBURSEMENT digest for a just-settled payment batch —
 * the lifecycle's last step finally has a voice. Money actually left the
 * door (M-Pesa B2C live or simulated, or a manual bank-run confirmation),
 * and everyone who co-owns the payroll decision now gets the per-batch
 * payment record: counts by outcome, the net total, and a ready-to-file
 * per-payslip payment CSV for the M-Pesa/bank reconciliation.
 *
 * Audience mirrors the posting digest: the store's decision-capable payroll
 * group (SUPER_ADMIN/STORE_OWNER/BRANCH_MANAGER/ACCOUNTANT — active,
 * store-scoped or super) MINUS the disbursing actor who just acted (their
 * own dialog shows them the banner). Delivery: ONE email envelope with the
 * per-payslip payment CSV attached, in-app bell rows per user with the
 * payroll_disbursed metadata marker. Every failure mode is caught by the
 * callers — the disbursement itself is already durable.
 */
export async function notifyPayrollRunDisbursed(params: {
  runId: string;
  storeId: string;
  actorId: string;
  mode: PayrollDisbursementMode;
  eligible: number;
  initiated: number;
  alreadyInitiated: number;
  paidNow: number;
  failed: number;
  skipped: number;
  backoffSkipped?: number;
  maxAttemptSkipped?: number;
  paymentRef?: string | null;
  disbursedAtIso: string;
  rows: PayrollDisbursementRow[];
}): Promise<PayrollDisbursementDigestResult> {
  const [run, store, period] = await Promise.all([
    db.payrollRun.findUnique({
      where: { id: params.runId },
      select: { runType: true, totalNet: true },
    }),
    db.store.findUnique({ where: { id: params.storeId }, select: { name: true } }),
    // The period name rides the run → period relation.
    db.payrollRun
      .findUnique({
        where: { id: params.runId },
        select: { payrollPeriod: { select: { name: true } } },
      })
      .then((r) => r?.payrollPeriod?.name ?? null),
  ]);

  // Actor label: same fallback ladder as the approval/posting digests.
  const actorLabel =
    (await db.user
      .findUnique({ where: { id: params.actorId }, select: { name: true, email: true } })
      .then((u) => u?.name?.trim() || u?.email || null)
      .catch(() => null)) || 'Disbursing user';

  const meta: PayrollRunDisbursedMeta = {
    periodName: period ?? 'Payroll run',
    storeName: store?.name ?? 'MBUMAH HARDWARE',
    runType: run?.runType ?? 'RUN',
    mode: params.mode,
    eligible: params.eligible,
    initiated: params.initiated,
    alreadyInitiated: params.alreadyInitiated,
    paidNow: params.paidNow,
    failed: params.failed,
    skipped: params.skipped,
    ...(params.backoffSkipped !== undefined ? { backoffSkipped: params.backoffSkipped } : {}),
    ...(params.maxAttemptSkipped !== undefined
      ? { maxAttemptSkipped: params.maxAttemptSkipped }
      : {}),
    totalNet: Number(run?.totalNet ?? 0),
    disbursedByLabel: actorLabel,
    disbursedAtIso: params.disbursedAtIso,
    ...(params.paymentRef ? { paymentRef: params.paymentRef } : {}),
  };

  const copy = payrollRunDisbursedCopy(meta);
  const csv = payrollDisbursementToCsv(params.rows, meta);

  // Recipients: decision-capable group minus the actor. The actor keeps
  // their own honest banner; the group gets the durable record.
  const group = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      OR: [{ storeId: params.storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  const recipients = group.filter((u) => u.id !== params.actorId);
  if (recipients.length === 0) {
    return { notifiedUsers: 0, emailRecipients: 0, emailStatus: 'SKIPPED' };
  }

  const emailAddresses = recipients
    .map((u) => u.email)
    .filter((e): e is string => typeof e === 'string' && e.includes('@'));

  let emailStatus: PayrollDisbursementDigestResult['emailStatus'] = 'SKIPPED';
  let emailError: string | undefined;
  if (emailAddresses.length > 0) {
    const email = await sendEmail({
      to: emailAddresses,
      subject: copy.emailSubject,
      html: copy.emailHtml,
      text: copy.emailText,
      ...(csv ? { attachments: [csv] } : {}),
      type: 'PAYROLL_DISBURSED',
      metadata: {
        runId: params.runId,
        periodName: meta.periodName,
        storeName: meta.storeName,
        mode: meta.mode,
        initiated: meta.initiated,
        paidNow: meta.paidNow,
        failed: meta.failed,
        skipped: meta.skipped,
        totalNet: meta.totalNet,
        disbursedBy: actorLabel,
        ...(csv ? { csvFilename: csv.filename, csvBytes: csv.byteSize } : {}),
      },
    });
    emailStatus = email.success ? 'SENT' : 'FAILED';
    if (!email.success) emailError = email.error ?? 'Email send failed';
  }

  // In-app bell rows (kind marker drives the feed surface + filters).
  await db.notification.createMany({
    data: recipients.map((u) => ({
      storeId: params.storeId,
      userId: u.id,
      title: copy.title,
      message: copy.message,
      type: copy.notifType,
      category: 'HR',
      priority: copy.priority,
      metadata: JSON.stringify({
        kind: PAYROLL_DISBURSED_METADATA_MARKER,
        runId: params.runId,
        periodName: meta.periodName,
        emailStatus,
      }),
    })),
  });

  return {
    notifiedUsers: recipients.length,
    emailRecipients: emailAddresses.length,
    emailStatus,
    ...(emailError ? { emailError } : {}),
    ...(csv ? { csvFilename: csv.filename, csvByteSize: csv.byteSize } : {}),
  };
}

// ── 4. Post (idempotent journal + payslip issuance) ─────────────────────────

export async function postPayrollRun(ctx: RunActorContext, runId: string) {
  const run = await getRunOrThrow(runId, ctx.storeId);

  // Idempotent replay: already posted → return the same journal linkage.
  // (Checked BEFORE the state machine so a retried POST on a POSTED run is
  // an acknowledged no-op instead of an INVALID_TRANSITION error.)
  if (run.journalEntryId) {
    return { run, journalEntryId: run.journalEntryId, replay: true };
  }

  assertTransition(run.status, 'POSTED');

  const details = await db.payrollDetail.findMany({ where: { payrollRunId: run.id } });
  if (details.length === 0) {
    throw new PayrollLifecycleError('NOT_PREPARED', 'No payslips to post; prepare the run first.');
  }

  // Aggregate the stored integer-cent lines across all payslips per account.
  const debit = new Map<string, number>();
  const credit = new Map<string, number>();
  const add = (map: Map<string, number>, code: string, amount: number) => {
    if (amount <= 0) return;
    map.set(code, (map.get(code) ?? 0) + amount);
  };

  for (const detail of details) {
    const result = deserialisePayslipResult(detail.computationTrace);
    if (!result) {
      throw new PayrollLifecycleError(
        'CORRUPT_TRACE',
        `Stored computation trace for payslip ${detail.id} is unreadable; re-prepare the run.`,
        422,
      );
    }
    // Debits: expenses (engine journal semantics, aggregated across payslips).
    add(debit, PAYROLL_ACCOUNTS.SALARIES_EXPENSE, result.grossCents);
    add(
      debit,
      PAYROLL_ACCOUNTS.EMPLOYER_NSSF_EXPENSE,
      result.employerContributions.filter((l) => l.code.startsWith('NSSF')).reduce((s, l) => s + l.amountCents, 0),
    );
    add(
      debit,
      PAYROLL_ACCOUNTS.EMPLOYER_HOUSING_EXPENSE,
      result.employerContributions.filter((l) => l.code === 'AHL_ER').reduce((s, l) => s + l.amountCents, 0),
    );
    // Credits: payables.
    const stat = (code: string) => result.deductions.find((l) => l.code === code)?.amountCents ?? 0;
    add(credit, PAYROLL_ACCOUNTS.PAYE_PAYABLE, stat('PAYE'));
    add(
      credit,
      PAYROLL_ACCOUNTS.NSSF_PAYABLE,
      stat('NSSF_T1') + stat('NSSF_T2') + result.employerContributions.filter((l) => l.code.startsWith('NSSF')).reduce((s, l) => s + l.amountCents, 0),
    );
    add(credit, PAYROLL_ACCOUNTS.SHIF_PAYABLE, stat('SHIF'));
    add(
      credit,
      PAYROLL_ACCOUNTS.HOUSING_PAYABLE,
      stat('AHL') + result.employerContributions.filter((l) => l.code === 'AHL_ER').reduce((s, l) => s + l.amountCents, 0),
    );
    add(credit, PAYROLL_ACCOUNTS.OTHER_DEDUCTIONS_PAYABLE, stat('OTHER_DED'));
    add(credit, PAYROLL_ACCOUNTS.NET_PAY_PAYABLE, result.netCents);
  }

  const totalDebitCents = [...debit.values()].reduce((s, v) => s + v, 0);
  const totalCreditCents = [...credit.values()].reduce((s, v) => s + v, 0);
  if (totalDebitCents !== totalCreditCents || totalDebitCents === 0) {
    throw new PayrollLifecycleError(
      'JOURNAL_IMBALANCE',
      `Aggregate journal does not balance (debits ${totalDebitCents} vs credits ${totalCreditCents}); run blocked before activation.`,
      422,
    );
  }

  // Chart-of-accounts readiness.
  const codes = [...new Set([...debit.keys(), ...credit.keys()])];
  const accounts = await db.account.findMany({
    where: { organizationId: ctx.organizationId, code: { in: codes }, isActive: true },
    select: { id: true, code: true },
  });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new PayrollLifecycleError(
      'MISSING_CHART_ACCOUNT',
      `Payroll liability/expense accounts missing from the chart of accounts: ${missing.join(', ')}. Run scripts/seed-payroll-accounts.mjs.`,
      422,
    );
  }

  // Post through the EXISTING accounting helper (idempotencyKey = run id).
  const periodName = run.payrollPeriod.name;
  const journal = await createJournalEntry({
    storeId: ctx.storeId,
    organizationId: ctx.organizationId,
    userId: ctx.actorId,
    description: `Payroll ${periodName} (${run.runType.toLowerCase()}) - ${details.length} payslip(s)`,
    lines: [
      ...[...debit.entries()].map(([code, amount]) => ({
        accountId: requireAccountId(byCode, code),
        debit: KES(amount),
        credit: 0,
      })),
      ...[...credit.entries()].map(([code, amount]) => ({
        accountId: requireAccountId(byCode, code),
        debit: 0,
        credit: KES(amount),
      })),
    ],
    referenceType: 'PAYROLL_RUN',
    referenceId: run.id,
    idempotencyKey: `payroll-run:${run.id}`,
    postImmediately: true,
  });

  // Issue payslip numbers + stamp posted state. The rows become immutable
  // payslips the moment they are issued - this is THE sanctioned issuance
  // write (receipt-numbering class), hence the audited bypass.
  const now = new Date();
  let seq = await nextSequence(db, ctx.storeId, 'PS', now);
  await withImmutabilityBypass(async () => {
    for (const detail of details) {
      await db.payrollDetail.update({
        where: { id: detail.id },
        data: {
          payslipNumber: formatSequence('PS', now, seq),
          payslipIssuedAt: now,
        },
      });
      seq += 1;
    }
  }, 'payroll_post_payslip_issuance');

  const updated = await db.payrollRun.update({
    where: { id: run.id },
    data: {
      status: 'POSTED',
      postedAt: now,
      postedByUserId: ctx.actorId,
      journalEntryId: journal.id,
      processedAt: now,
    },
  });

  // Corrections that awaited this replacement run are now APPLIED.
  await db.payrollCorrection.updateMany({
    where: { replacementRunId: run.id, status: 'APPROVED' },
    data: { status: 'APPLIED', appliedAt: now },
  });

  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { posted: true, journalEntryId: journal.id, payslips: details.length },
    },
  );

  // v2.48.0: the posting digest rides the same attachment machinery as the
  // approval digest — bell rows to the maker + the store's payroll group,
  // one email with the per-employee CSV (posted variant) attached.
  // BEST-EFFORT by contract: a notification or email failure must never
  // fail the posting itself (the run is already POSTED above and the
  // journal is durable); the digest result is surfaced fail-soft. The
  // idempotent replay path above returns NO digest — a retried post must
  // not re-notify anyone.
  const digest = await notifyPayrollRunPosted({
    run: updated,
    storeId: ctx.storeId,
    actorId: ctx.actorId,
  }).catch((err) => {
    console.warn('[payroll] posting digest failed (best-effort):', err);
    return null;
  });

  // v2.49.0: the EMPLOYEE-facing half of the story — every portal-linked
  // employee in the run gets a personal "your payslip is issued" bell row
  // (deep link to their Payslips page) and a personalized email with ONLY
  // their own numbers. Also best-effort by the same contract: it can never
  // block or undo the posting, and the replay path returns NO notices.
  const employeeNotices = await notifyEmployeesPayslipsIssued({
    runId: run.id,
    payrollPeriodId: run.payrollPeriodId,
    storeId: ctx.storeId,
    postedAt: updated.postedAt,
  }).catch((err) => {
    console.warn('[payroll] payslip-issued fan-out failed (best-effort):', err);
    return null;
  });

  return { run: updated, journalEntryId: journal.id, replay: false, digest, employeeNotices };
}

// ── 5. Lock / void / disburse ────────────────────────────────────────────────

export async function lockPayrollRun(ctx: RunActorContext, runId: string) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  assertTransition(run.status, 'LOCKED');
  const updated = await db.payrollRun.update({
    where: { id: run.id },
    data: { status: 'LOCKED', lockedAt: new Date(), lockedByUserId: ctx.actorId },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { locked: true },
    },
  );
  return updated;
}

export async function voidPayrollRun(
  ctx: RunActorContext,
  runId: string,
  context?: { reason?: string },
) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  assertTransition(run.status, 'VOIDED');
  const updated = await db.payrollRun.update({
    where: { id: run.id },
    data: { status: 'VOIDED' },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { voided: true, reason: context?.reason ?? null },
    },
  );
  return updated;
}

export async function disbursePayrollRun(
  ctx: RunActorContext,
  runId: string,
  paymentRef?: string,
) {
  const run = await getRunOrThrow(runId, ctx.storeId);
  if (run.status !== 'POSTED' && run.status !== 'LOCKED') {
    throw new PayrollLifecycleError(
      'INVALID_TRANSITION',
      'Only posted or locked runs can be disbursed.',
    );
  }
  // v2.50.0: snapshot the batch BEFORE the updateMany so the digest CSV can
  // carry the per-payslip payment rows (employee, staff number, net).
  const batch = await db.payrollDetail.findMany({
    where: { payrollRunId: run.id, paymentStatus: 'PENDING', netPay: { gt: 0 } },
    select: {
      netPay: true,
      employee: { select: { firstName: true, lastName: true, employeeCode: true } },
    },
    orderBy: { employeeId: 'asc' },
  });
  const now = new Date();
  const result = await withImmutabilityBypass(
    async () =>
      db.payrollDetail.updateMany({
        where: { payrollRunId: run.id, paymentStatus: 'PENDING' },
        data: { paymentStatus: 'PAID', paymentDate: now, paymentRef: paymentRef ?? null },
      }),
    'payroll_disbursement_mark_paid',
  );
  await db.payrollRun.update({ where: { id: run.id }, data: { paidAt: now } });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_RUN,
      resourceId: run.id,
      storeId: ctx.storeId,
      metadata: { disbursed: result.count, paymentRef: paymentRef ?? null },
    },
  );

  // v2.50.0: the disbursement digest — a manual bank-run confirmation is
  // exactly the moment the payroll group wants the record. BEST-EFFORT by
  // contract: the marks above are already durable; the digest result rides
  // fail-soft and can never undo or block them.
  const rows: PayrollDisbursementRow[] = batch.map((d) => ({
    employeeName: `${d.employee?.firstName ?? ''} ${d.employee?.lastName ?? ''}`.trim() || 'Unnamed employee',
    employeeCode: d.employee?.employeeCode ?? null,
    net: Number(d.netPay),
    status: 'PAID',
    receipt: paymentRef ?? null,
  }));
  const digest = await notifyPayrollRunDisbursed({
    runId: run.id,
    storeId: ctx.storeId,
    actorId: ctx.actorId,
    mode: 'manual',
    eligible: batch.length,
    initiated: 0,
    alreadyInitiated: 0,
    paidNow: result.count,
    failed: 0,
    skipped: 0,
    paymentRef: paymentRef ?? null,
    disbursedAtIso: now.toISOString(),
    rows,
  }).catch((err) => {
    console.warn('[payroll] manual disbursement digest failed (best-effort):', err);
    return null;
  });

  return { disbursed: result.count, digest };
}

// ── 6. Corrections (reverse and replace) ─────────────────────────────────────

export async function requestPayrollCorrection(
  ctx: RunActorContext,
  input: {
    originalDetailId: string;
    correctionType: CorrectionType;
    amountCents: number;
    reason: string;
  },
) {
  const detail = await db.payrollDetail.findFirst({
    where: { id: input.originalDetailId, storeId: ctx.storeId },
    include: { payrollRun: { select: { id: true, status: true } } },
  });
  if (!detail) {
    throw new PayrollLifecycleError('PAYSLIP_NOT_FOUND', 'Payslip not found.', 404);
  }
  if (detail.payrollRun.status !== 'POSTED' && detail.payrollRun.status !== 'LOCKED') {
    throw new PayrollLifecycleError(
      'CORRECTION_TARGET_IMMUTABLE',
      'Corrections apply to posted or locked payslips only; re-prepare the draft run instead.',
    );
  }
  if (!input.reason || input.reason.trim().length < 10) {
    throw new PayrollLifecycleError(
      'MISSING_CORRECTION_REASON',
      'A correction reason of at least 10 characters is required.',
      400,
    );
  }
  if (input.correctionType !== 'REVERSAL' && input.amountCents === 0) {
    throw new PayrollLifecycleError(
      'MISSING_CORRECTION_AMOUNT',
      'An amount (positive = company owes employee, negative = employee owes company) is required.',
      400,
    );
  }
  const pending = await db.payrollCorrection.findFirst({
    where: { originalDetailId: detail.id, status: 'PENDING' },
    select: { id: true },
  });
  if (pending) {
    throw new PayrollLifecycleError(
      'CORRECTION_PENDING',
      'A pending correction already exists for this payslip.',
    );
  }
  const correction = await db.payrollCorrection.create({
    data: {
      storeId: ctx.storeId,
      payrollRunId: detail.payrollRunId,
      employeeId: detail.employeeId,
      originalDetailId: detail.id,
      correctionType: input.correctionType,
      amountCents: Math.trunc(input.amountCents),
      reason: input.reason.trim(),
      requestedByUserId: ctx.actorId,
    },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'CREATE',
      resourceType: HrEntityType.PAYROLL_CORRECTION,
      resourceId: correction.id,
      storeId: ctx.storeId,
      metadata: { correctionType: input.correctionType, amountCents: Math.trunc(input.amountCents) },
    },
  );
  return correction;
}

export async function decidePayrollCorrection(
  ctx: RunActorContext,
  correctionId: string,
  decision: 'APPROVED' | 'REJECTED',
  rejectionReason?: string,
) {
  const correction = await db.payrollCorrection.findFirst({
    where: { id: correctionId, storeId: ctx.storeId },
    include: {
      originalDetail: true,
      run: { include: { payrollPeriod: true } },
    },
  });
  if (!correction) {
    throw new PayrollLifecycleError('CORRECTION_NOT_FOUND', 'Correction not found.', 404);
  }
  if (correction.status !== 'PENDING') {
    throw new PayrollLifecycleError(
      'INVALID_TRANSITION',
      `Correction is already ${correction.status}.`,
    );
  }
  // Maker-checker for corrections as well.
  if (correction.requestedByUserId === ctx.actorId) {
    throw new PayrollLifecycleError(
      'MAKER_CHECKER_VIOLATION',
      'The user who requested this correction cannot approve or reject it.',
      403,
    );
  }

  if (decision === 'REJECTED') {
    if (!rejectionReason || rejectionReason.trim().length < 10) {
      throw new PayrollLifecycleError(
        'MISSING_REJECTION_REASON',
        'A rejection reason of at least 10 characters is required.',
        400,
      );
    }
    const updated = await db.payrollCorrection.update({
      where: { id: correction.id },
      data: {
        status: 'REJECTED',
        rejectedByUserId: ctx.actorId,
        rejectionReason: rejectionReason.trim(),
      },
    });
    await hrAudit(
      {
        actorId: ctx.actorId,
        actorRole: 'SYSTEM',
        action: 'UPDATE',
        resourceType: HrEntityType.PAYROLL_CORRECTION,
        resourceId: correction.id,
        storeId: ctx.storeId,
        metadata: { rejected: true },
      },
    );
    return updated;
  }

  // APPROVED → reverse (balanced adjusting entry) and/or replace (new run).
  const now = new Date();
  const original = deserialisePayslipResult(correction.originalDetail.computationTrace);
  if (!original) {
    throw new PayrollLifecycleError(
      'CORRUPT_TRACE',
      'Original payslip trace is unreadable; the correction cannot be applied safely.',
      422,
    );
  }

  let journalEntryId: string | null = null;
  let replacementRunId: string | null = null;

  if (correction.correctionType === 'REVERSAL') {
    // Full reversal: the engine-built journal for the original payslip, with
    // debits and credits swapped, posted through the accounting helper.
    const originalJournal = buildPayrollJournal(
      original,
      'REVERSAL',
      `payroll-correction:${correction.id}`,
    );
    const codes = [...new Set(originalJournal.lines.map((l) => l.accountCode))];
    const accounts = await db.account.findMany({
      where: { organizationId: ctx.organizationId, code: { in: codes }, isActive: true },
      select: { id: true, code: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    const missingReversalAccounts = codes.filter((c) => !byCode.has(c));
    if (missingReversalAccounts.length > 0) {
      throw new PayrollLifecycleError(
        'MISSING_CHART_ACCOUNT',
        `Reversal blocked: missing accounts ${missingReversalAccounts.join(', ')}.`,
        422,
      );
    }
    const journal = await createJournalEntry({
      storeId: ctx.storeId,
      organizationId: ctx.organizationId,
      userId: ctx.actorId,
      description: `Reversal of payslip ${correction.originalDetail.payslipNumber ?? correction.originalDetail.id} (${correction.reason.slice(0, 80)})`,
      lines: originalJournal.lines.map((l) => ({
        accountId: requireAccountId(byCode, l.accountCode),
        debit: KES(l.creditCents),
        credit: KES(l.debitCents),
      })),
      referenceType: 'PAYROLL_CORRECTION',
      referenceId: correction.id,
      idempotencyKey: `payroll-correction:${correction.id}`,
      postImmediately: true,
    });
    journalEntryId = journal.id;
  } else {
    // UNDER/OVERPAYMENT: post the signed delta now, and open a replacement
    // supplementary run so HR re-issues the corrected payslip through the
    // normal (maker-checked) lifecycle.
    const amount = correction.amountCents;
    const journal = await createJournalEntry({
      storeId: ctx.storeId,
      organizationId: ctx.organizationId,
      userId: ctx.actorId,
      description: `Payroll ${correction.correctionType.toLowerCase()} correction (${correction.reason.slice(0, 80)})`,
      lines:
        amount > 0
          ? [
              { accountId: await byCodeOrThrow(ctx, PAYROLL_ACCOUNTS.SALARIES_EXPENSE), debit: KES(amount), credit: 0 },
              { accountId: await byCodeOrThrow(ctx, PAYROLL_ACCOUNTS.NET_PAY_PAYABLE), debit: 0, credit: KES(amount) },
            ]
          : [
              { accountId: await byCodeOrThrow(ctx, PAYROLL_ACCOUNTS.NET_PAY_PAYABLE), debit: KES(-amount), credit: 0 },
              { accountId: await byCodeOrThrow(ctx, PAYROLL_ACCOUNTS.SALARIES_EXPENSE), debit: 0, credit: KES(-amount) },
            ],
      referenceType: 'PAYROLL_CORRECTION',
      referenceId: correction.id,
      idempotencyKey: `payroll-correction:${correction.id}`,
      postImmediately: true,
    });
    journalEntryId = journal.id;

    const { run: replacement } = await createPayrollRun(ctx, {
      payrollPeriodId: correction.run.payrollPeriodId,
      runType: 'SUPPLEMENTARY',
      idempotencyKey: `payroll-correction-replacement:${correction.id}`,
    });
    replacementRunId = replacement.id;
  }

  const updated = await db.payrollCorrection.update({
    where: { id: correction.id },
    data: {
      status: replacementRunId ? 'APPROVED' : 'APPLIED',
      approvedByUserId: ctx.actorId,
      approvedAt: now,
      appliedAt: replacementRunId ? null : now,
      journalEntryId,
      replacementRunId,
    },
  });
  await hrAudit(
    {
      actorId: ctx.actorId,
      actorRole: 'SYSTEM',
      action: 'UPDATE',
      resourceType: HrEntityType.PAYROLL_CORRECTION,
      resourceId: correction.id,
      storeId: ctx.storeId,
      metadata: { approved: true, journalEntryId, replacementRunId },
    },
  );
  return updated;
}

/** Chart-account lookup that cannot return undefined (missing codes are rejected upstream). */
function requireAccountId(byCode: Map<string, string>, code: string): string {
  const id = byCode.get(code);
  if (!id) {
    throw new PayrollLifecycleError(
      'MISSING_CHART_ACCOUNT',
      `Account ${code} is missing from the chart of accounts.`,
      422,
    );
  }
  return id;
}

async function byCodeOrThrow(ctx: RunActorContext, code: string): Promise<string> {
  const account = await db.account.findFirst({
    where: { organizationId: ctx.organizationId, code, isActive: true },
    select: { id: true },
  });
  if (!account) {
    throw new PayrollLifecycleError(
      'MISSING_CHART_ACCOUNT',
      `Account ${code} is missing from the chart of accounts.`,
      422,
    );
  }
  return account.id;
}
