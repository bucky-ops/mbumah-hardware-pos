/**
 * Debt Payment Plan utilities — pure functions for schedule calculation,
 * status derivation, and totals recalculation.
 *
 * All math is Decimal-safe: callers pass Prisma `Decimal`-shaped values and
 * receive plain `number`s back (suitable for JSON responses and UI display).
 */

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

/** Round to 2 decimal places (banker's-style safety without surprises). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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
 * Interest model: simple annual interest split evenly across installments.
 * `totalWithInterest = totalAmount * (1 + (interestRate / 100) * (durationYears))`
 * where `durationYears` is derived from the frequency × count.
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
  const safeTotal = Math.max(0, Number.isFinite(totalAmount) ? totalAmount : 0);
  const safeRate = Math.max(0, Number.isFinite(interestRate) ? interestRate : 0);

  // Duration in years (rough — used only for simple-interest allocation).
  const unitsPerYear =
    frequency === 'WEEKLY' ? 52 : frequency === 'BI_WEEKLY' ? 26 : 12;
  const durationYears = safeCount / unitsPerYear;

  const totalWithInterest = safeTotal * (1 + (safeRate / 100) * durationYears);
  const perInstallment = round2(totalWithInterest / safeCount);

  // Distribute rounding error onto the final installment so totals reconcile.
  const sumOfFirst = round2(perInstallment * (safeCount - 1));
  const lastInstallment = round2(totalWithInterest - sumOfFirst);

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

/** Compute the per-installment amount without building the full schedule. */
export function calculateInstallmentAmount(
  totalAmount: number,
  installmentCount: number,
  interestRate: number = 0,
): number {
  const safeCount = Math.max(1, Math.floor(installmentCount));
  const safeTotal = Math.max(0, Number.isFinite(totalAmount) ? totalAmount : 0);
  const safeRate = Math.max(0, Number.isFinite(interestRate) ? interestRate : 0);
  const totalWithInterest = safeTotal * (1 + (safeRate / 100));
  return round2(totalWithInterest / safeCount);
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
  const totalAmount = toNumber(plan.totalAmount);
  const amountPaid = installments.reduce(
    (sum, inst) => sum + toNumber(inst.amountPaid),
    0,
  );
  const installmentsPaid = installments.filter(
    (inst) => inst.status === 'PAID',
  ).length;
  const installmentsOverdue = installments.filter(
    (inst) => inst.status === 'OVERDUE',
  ).length;
  const balance = Math.max(0, round2(totalAmount - amountPaid));
  return {
    amountPaid: round2(amountPaid),
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
