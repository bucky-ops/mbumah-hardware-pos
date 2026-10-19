// MBUMAH HARDWARE POS - the pre-flight run gate (v2.133.0, spec Phase 4.6)
//
// "The gate speaks first." The run's guardrails (consent, timesheets) have
// always enforced themselves inside the run's prepare step — but their verdict
// only surfaced AFTER a failed prepare attempt, as an amber card of issues.
// This read asks the SAME gates the SAME question BEFORE anyone tries:
// who would the gate block, and why, right now?
//
// HONESTY CONTRACT: this file mirrors prepare's gates line for line — the
// same employee where and order (ACTIVE, store-scoped, employeeCode asc),
// the same consent where (withdrawnAt: null), the same timesheet helper, the
// same block order (consent first, then timesheets — prepare's loop order).
// It never writes: no run is created, no payslip computed, no state moves.
// If prepare's gates ever change, the parity pins in run-gate-v2133.test.ts
// fail and the desk must be re-mirrored — the gate can never drift from the
// run it protects.

import { db } from '@/lib/db';
import { hasUnapprovedTimesheet } from '../attendance-service';
import type { RunActorContext } from './run-service';

/** The codes prepare itself pushes, in prepare's own loop order. */
export type RunGateCode = 'MISSING_CONSENT' | 'TIMESHEET_NOT_APPROVED';

export interface RunGateRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  /** The consent gate's own verdict, independent of the timesheet's. */
  consentOk: boolean;
  /** The timesheet gate's own verdict, independent of the consent's. */
  timesheetOk: boolean;
  /** Codes that would block prepare, in prepare's loop order. */
  blocks: RunGateCode[];
  /** The FIRST block — exactly what prepare would report for this employee. */
  gateState: 'CLEAR' | RunGateCode;
}

export interface RunGateReport {
  period: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    /** A voided period closes runs — the desk says so instead of a verdict. */
    status: string;
  };
  rows: RunGateRow[];
  summary: { clear: number; missingConsent: number; timesheetNotApproved: number };
  checkedAt: string;
}

/**
 * Derive one employee's gate verdict. Pure so the desk, the tests, and the
 * E2E exercise the same math the service runs.
 *
 * Both gates are ALWAYS evaluated (the full picture per person), but the
 * state speaks prepare's language: the first block in prepare's loop order
 * is the one prepare would report. An employee failing both wears the
 * consent block as their state and carries the timesheet block right behind
 * it — nothing hidden, only ordered.
 */
export function deriveGateState(consentOk: boolean, timesheetOk: boolean): {
  blocks: RunGateCode[];
  gateState: RunGateRow['gateState'];
} {
  const blocks: RunGateCode[] = [];
  if (!consentOk) blocks.push('MISSING_CONSENT');
  if (!timesheetOk) blocks.push('TIMESHEET_NOT_APPROVED');
  return { blocks, gateState: blocks[0] ?? 'CLEAR' };
}

/**
 * The pre-flight read: every active employee's gate verdict for ONE period,
 * read-only by construction. A cross-branch or unknown period is an honest
 * 404 — it does not leak, and a voided period is reported as voided (runs
 * are closed there; the desk says so instead of pretending to check).
 */
export async function readRunGate(
  ctx: RunActorContext,
  periodId: string,
): Promise<RunGateReport> {
  const period = await db.payrollPeriod.findFirst({
    where: { id: String(periodId ?? ''), storeId: ctx.storeId },
    select: { id: true, name: true, startDate: true, endDate: true, status: true },
  });
  if (!period) {
    throw new PayrollGateError('PERIOD_NOT_FOUND', 'Payroll period not found.', 404);
  }

  // THE SAME where and order as the prepare loop above it (parity-pinned).
  const employees = await db.employee.findMany({
    where: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' },
    orderBy: { employeeCode: 'asc' },
    select: { id: true, employeeCode: true, firstName: true, lastName: true },
  });

  const rows: RunGateRow[] = [];
  for (const employee of employees) {
    // THE SAME consent gate as prepare (withdrawnAt: null).
    const consent = await db.consentRecord.findFirst({
      where: { employeeId: employee.id, withdrawnAt: null },
      select: { id: true },
    });
    // THE SAME timesheet gate as prepare (spec acceptance #11).
    const timesheetOk = await hasUnapprovedTimesheet(
      employee.id,
      ctx.storeId,
      period.startDate,
      period.endDate,
    ).then((unapproved) => !unapproved);

    const consentOk = consent !== null;
    const { blocks, gateState } = deriveGateState(consentOk, timesheetOk);
    rows.push({
      employeeId: employee.id,
      employeeCode: employee.employeeCode ?? '—',
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      consentOk,
      timesheetOk,
      blocks,
      gateState,
    });
  }

  return {
    period: {
      id: period.id,
      name: period.name,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
      status: period.status,
    },
    rows,
    summary: {
      clear: rows.filter((r) => r.gateState === 'CLEAR').length,
      missingConsent: rows.filter((r) => r.gateState === 'MISSING_CONSENT').length,
      timesheetNotApproved: rows.filter((r) => r.gateState === 'TIMESHEET_NOT_APPROVED').length,
    },
    checkedAt: new Date().toISOString(),
  };
}

/** The gate read's own error vocabulary (mirrors PayrollLifecycleError's shape). */
export class PayrollGateError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
