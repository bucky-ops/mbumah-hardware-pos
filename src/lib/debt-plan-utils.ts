/**
 * Debt Payment Plan utilities — pure functions for schedule calculation,
 * status derivation, and totals recalculation.
 *
 * All math is Decimal-safe: callers pass Prisma `Decimal`-shaped values and
 * receive plain `number`s back (suitable for JSON responses and UI display).
 *
 * Task 12-c: `round2` is now the CANONICAL implementation re-exported from
 * `@/lib/utils/financialMath` (decimal.js HALF_UP, 2dp — the global rounding
 * policy owner). The previous local implementation was a float
 * `Math.round((n + Number.EPSILON) * 100) / 100` hack; schedules produced
 * with the old helper remain numerically identical (the old hack agreed with
 * HALF_UP on every positive half-cent case; the only divergence is negative
 * half-cent inputs, which never occur in schedule math — balances are
 * clamped ≥ 0). Money arithmetic in this module now flows through `toDec`.
 *
 * Task 12-d (debt-plan audit): added `calculateTotalWithInterest` as the
 * single source of truth for the simple-interest model (pro-rated by plan
 * duration), fixed `calculateInstallmentAmount` to use it (was a flat rate
 * that diverged from the schedule), and added shared response serializers so
 * the six hand-rolled Decimal→number mapping blocks across the API routes
 * collapse into one implementation.
 */

import { toDec, round2, max0 } from '@/lib/utils/financialMath';
import type Decimal from 'decimal.js';

/** Numeric-ish shape accepted by toDec (Prisma Decimal is a decimal.js Decimal). */
type NumericLike = number | string | Decimal | null | undefined;

// Re-export so every existing `import { round2 } from '@/lib/debt-plan-utils'`
// call site (routes + tests) keeps working against the canonical helper.
export { round2 };

// ── Types ────────────────────────────────────────────────────────────────────

export type PlanFrequency = 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';

export type PlanStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'DEFAULTED'
  | 'CANCELLED'
  | 'PAUSED';

export type InstallmentStatus =
  | 'SCHEDULED'
  | 'PAID'
  | 'PARTIAL'
  | 'OVERDUE'
  | 'MISSED'
  | 'WAIVED';

export interface ScheduledInstallment {
  installmentNumber: number;
  dueDate: Date;
  amountDue: number;
}

/** Lightweight plan shape consumed by `getPlanStatus` / `recalculatePlanTotals`. */
export interface PlanLike {
  status: string;
  installmentCount: number;
  installmentsPaid: number;
  installmentsOverdue: number;
  amountPaid: unknown; // Prisma Decimal or number — coerced internally
  balance: unknown;
  totalAmount: unknown;
  endDate?: unknown;
}

export interface InstallmentLike {
  id: string;
  status: string;
  dueDate: Date | string;
  amountDue: unknown;
  amountPaid: unknown;
}

export interface PlanTotals {
  amountPaid: number;
  balance: number;
  installmentsPaid: number;
  installmentsOverdue: number;
}

// ── Decimal coercion helpers ─────────────────────────────────────────────────

/**
 * Convert a Prisma `Decimal`, a string, or a number into a plain JS number.
 * Returns `0` for `null`/`undefined`/non-finite inputs.
 */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  // Prisma Decimal exposes `toNumber()` on the JS side
  const maybeDecimal = value as { toNumber?: () => number };
  if (typeof maybeDecimal.toNumber === 'function') {
    const n = maybeDecimal.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : 0;
}

// `round2` (canonical HALF_UP 2dp) is re-exported from financialMath above.

// ── Schedule calculation ────────────────────────────────────────────────────

/**
 * Add `n` units of the given frequency to a starting date.
 */
function addInterval(date: Date, frequency: PlanFrequency, units: number): Date {
  const result = new Date(date.getTime());
  switch (frequency) {
    case 'WEEKLY':
      result.setDate(result.getDate() + 7 * units);
      break;
    case 'BI_WEEKLY':
      result.setDate(result.getDate() + 14 * units);
      break;
    case 'MONTHLY':
      result.setMonth(result.getMonth() + units);
      break;
    default:
      // Unknown frequency — fall back to monthly so the plan is still usable.
      result.setMonth(result.getMonth() + units);
  }
  return result;
}

/**
 * Compute the per-installment amount (including any simple interest allocation)
 * and the array of scheduled installments.
 *
 * Interest model: simple annual interest split evenly across installments,
 * PRO-RATED by the plan duration (see `calculateTotalWithInterest`).
 * With `interestRate = 0` (default), this is an interest-free plan.
 */
export function calculateInstallmentSchedule(
  totalAmount: number,
  installmentCount: number,
  frequency: PlanFrequency,
  startDate: Date,
  interestRate: number = 0,
): ScheduledInstallment[] {
  const safeCount = Math.max(1, Math.floor(installmentCount));
  // Task 12-c: money math in Decimal (toDec maps NaN/Infinity → 0, matching
  // the old Number.isFinite guards).
  // Task 12-d: interest model now shared with calculateInstallmentAmount via
  // calculateTotalWithInterest (pro-rated simple interest).
  const totalWithInterest = toDec(
    calculateTotalWithInterest(totalAmount, safeCount, frequency, interestRate),
  );
  const perInstallment = round2(totalWithInterest.div(safeCount));

  // Distribute rounding error onto the final installment so totals reconcile.
  const sumOfFirst = round2(toDec(perInstallment).mul(safeCount - 1));
  const lastInstallment = round2(totalWithInterest.minus(sumOfFirst));

  const schedule: ScheduledInstallment[] = [];
  for (let i = 0; i < safeCount; i++) {
    schedule.push({
      installmentNumber: i + 1,
      dueDate: addInterval(startDate, frequency, i),
      amountDue: i === safeCount - 1 ? lastInstallment : perInstallment,
    });
  }
  return schedule;
}

/** Compute the plan end date (due date of the final installment). */
export function calculateEndDate(
  startDate: Date,
  installmentCount: number,
  frequency: PlanFrequency,
): Date {
  const safeCount = Math.max(1, Math.floor(installmentCount));
  return addInterval(startDate, frequency, safeCount - 1);
}

/**
 * Total payable including simple interest, PRO-RATED by the plan duration.
 *
 * `totalWithInterest = total × (1 + (rate/100) × durationYears)` where
 * `durationYears = installmentCount / unitsPerYear(frequency)`.
 *
 * Task 12-d (audit fix): this is now the SINGLE source of truth for the
 * interest model. Previously `calculateInstallmentSchedule` pro-rated the
 * rate by duration while `calculateInstallmentAmount` applied the rate as a
 * flat one-off multiplier — so a plan's `installmentAmount` column (computed
 * via the latter) disagreed with the actual per-installment schedule amounts
 * (computed via the former) whenever `rate > 0` and the plan spanned less
 * than one year. Example: 12% on 6 monthly installments — the schedule
 * charged 1.06× total, the flat helper said 1.12×. Every caller now flows
 * through this function so previews, the schedule, and the stored column
 * agree.
 */
export function calculateTotalWithInterest(
  totalAmount: number,
  installmentCount: number,
  frequency: PlanFrequency,
  interestRate: number = 0,
): number {
  const safeCount = Math.max(1, Math.floor(installmentCount));
  const safeTotal = max0(toDec(totalAmount));
  const safeRate = max0(toDec(interestRate));

  const unitsPerYear =
    frequency === 'WEEKLY' ? 52 : frequency === 'BI_WEEKLY' ? 26 : 12;
  const durationYears = safeCount / unitsPerYear;

  const growthFactor = toDec(1).plus(safeRate.div(100).mul(durationYears));
  return safeTotal.mul(growthFactor);
}

/**
 * Compute the per-installment amount without building the full schedule.
 * Task 12-d (audit fix): now uses the same pro-rated simple-interest model
 * as `calculateInstallmentSchedule` (was a flat
 * `total × (1 + rate/100) / count`, which diverged from the schedule for
 * plans shorter than a year).
 */
export function calculateInstallmentAmount(
  totalAmount: number,
  installmentCount: number,
  frequency: PlanFrequency,
  interestRate: number = 0,
): number {
  const safeCount = Math.max(1, Math.floor(installmentCount));
  const totalWithInterest = toDec(
    calculateTotalWithInterest(totalAmount, safeCount, frequency, interestRate),
  );
  return round2(totalWithInterest.div(safeCount));
}

// ── Status helpers ──────────────────────────────────────────────────────────

/**
 * Derive the operational plan status from the current totals + installments.
 *
 * Terminal states (`COMPLETED`, `CANCELLED`, `PAUSED`, `PENDING_APPROVAL`)
 * are preserved as-is. Otherwise the function returns:
 *   - `COMPLETED` if balance ≤ 0 (everything paid)
 *   - `DEFAULTED` if more than 25% of installments are overdue
 *   - `ACTIVE` otherwise
 */
export function getPlanStatus(plan: PlanLike): PlanStatus {
  const current = plan.status as PlanStatus;
  // Terminal / non-derived statuses are preserved.
  if (
    current === 'PENDING_APPROVAL' ||
    current === 'CANCELLED' ||
    current === 'PAUSED'
  ) {
    return current;
  }

  const balance = toNumber(plan.balance);
  if (balance <= 0.001) {
    return 'COMPLETED';
  }

  const total = Math.max(1, plan.installmentCount);
  const overdue = plan.installmentsOverdue;
  // 25%+ overdue installments → DEFAULTED
  if (overdue > 0 && overdue / total >= 0.25) {
    return 'DEFAULTED';
  }

  return 'ACTIVE';
}

// ── Overdue marking ──────────────────────────────────────────────────────────

/**
 * Return a NEW array of installments with `status` set to `OVERDUE` for any
 * installment that is past its due date and not yet paid/waived.
 *
 * Pure function — does NOT mutate the input. The caller is responsible for
 * persisting the changes.
 */
export function markOverdueInstallments<T extends InstallmentLike>(
  installments: T[],
  now: Date = new Date(),
): T[] {
  return installments.map((inst) => {
    if (inst.status === 'PAID' || inst.status === 'WAIVED') {
      return inst;
    }
    const due = new Date(inst.dueDate);
    if (due.getTime() < now.getTime() && inst.status !== 'OVERDUE') {
      return { ...inst, status: 'OVERDUE' as InstallmentStatus } as T;
    }
    return inst;
  });
}

// ── Totals recalculation ────────────────────────────────────────────────────

/**
 * Recompute the denormalized plan totals from the underlying installments.
 * Used after every payment / waiver / overdue sweep to keep the plan row in
 * sync with the installment rows.
 *
 * Rules:
 *   - `installmentsPaid`     = count of installments with status `PAID`
 *   - `installmentsOverdue`  = count with status `OVERDUE` (not yet paid)
 *   - `amountPaid`           = sum of every installment's `amountPaid`
 *   - `balance`              = totalAmount - amountPaid (clamped ≥ 0)
 */
export function recalculatePlanTotals(
  plan: PlanLike,
  installments: InstallmentLike[],
): PlanTotals {
  // Task 12-c: Decimal accumulators (was a float `sum + toNumber(...)`
  // reduce — number+number, so no concat risk, but exact Decimal removes the
  // float dust before rounding).
  const totalAmountDec = toDec(plan.totalAmount as NumericLike);
  const amountPaidDec = installments.reduce(
    (acc, inst) => acc.plus(toDec(inst.amountPaid as NumericLike)),
    toDec(0),
  );
  const installmentsPaid = installments.filter(
    (inst) => inst.status === 'PAID',
  ).length;
  const installmentsOverdue = installments.filter(
    (inst) => inst.status === 'OVERDUE',
  ).length;
  const balance = round2(max0(totalAmountDec.minus(amountPaidDec)));
  return {
    amountPaid: round2(amountPaidDec),
    balance,
    installmentsPaid,
    installmentsOverdue,
  };
}

// ── Display helpers (shared with UI) ────────────────────────────────────────

export const FREQUENCY_LABELS: Record<PlanFrequency, string> = {
  WEEKLY: 'Weekly',
  BI_WEEKLY: 'Bi-Weekly',
  MONTHLY: 'Monthly',
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  PENDING_APPROVAL: 'Pending Approval',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  DEFAULTED: 'Defaulted',
  CANCELLED: 'Cancelled',
  PAUSED: 'Paused',
};

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  PAID: 'Paid',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
  MISSED: 'Missed',
  WAIVED: 'Waived',
};

// ── Response serialization (shared) ─────────────────────────────────────────

/**
 * Serialize a DebtPlanInstallment row for a JSON response.
 *
 * Task 12-d (audit fix): every route used to hand-roll the same Decimal→number
 * mapping (6 copies across the module, and the approve route returned raw
 * Prisma rows with unserialized Decimals). All routes now share this helper
 * so response shapes stay consistent.
 */
export function serializeInstallmentRow<
  I extends { amountDue: unknown; amountPaid: unknown; lateFeeApplied: unknown },
>(installment: I): I & { amountDue: number; amountPaid: number; lateFeeApplied: number } {
  return {
    ...installment,
    amountDue: toNumber(installment.amountDue),
    amountPaid: toNumber(installment.amountPaid),
    lateFeeApplied: toNumber(installment.lateFeeApplied),
  };
}

/**
 * Serialize a DebtPaymentPlan row (+ nested installments / debt ledger) for
 * a JSON response. Handles the slightly different ledger selects used by the
 * routes (some include amountPaid/dueDate, some don't) by serializing any
 * money field that is present.
 */
export function serializePlanRow<
  P extends {
    totalAmount: unknown;
    installmentAmount: unknown;
    amountPaid: unknown;
    balance: unknown;
    interestRate: unknown;
    lateFee: unknown;
    installments?: Array<Record<string, unknown>>;
    debtLedger?: Record<string, unknown> | null;
  },
>(plan: P): Record<string, unknown> {
  const debtLedger = plan.debtLedger
    ? (() => {
        const ledger = plan.debtLedger as Record<string, unknown>;
        const out: Record<string, unknown> = { ...ledger };
        if ('amountOwed' in ledger) out.amountOwed = toNumber(ledger.amountOwed);
        if ('amountPaid' in ledger) out.amountPaid = toNumber(ledger.amountPaid);
        if ('balance' in ledger) out.balance = toNumber(ledger.balance);
        return out;
      })()
    : null;

  return {
    ...plan,
    totalAmount: toNumber(plan.totalAmount),
    installmentAmount: toNumber(plan.installmentAmount),
    amountPaid: toNumber(plan.amountPaid),
    balance: toNumber(plan.balance),
    interestRate: toNumber(plan.interestRate),
    lateFee: toNumber(plan.lateFee),
    installments: plan.installments?.map((i) =>
      serializeInstallmentRow(i as Parameters<typeof serializeInstallmentRow>[0]),
    ),
    debtLedger,
  };
}
