import Decimal from "decimal.js";
import { D, round2 } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// Credit & debt math core — PURE functions (no DB access, fully unit-testable).
//
// MONEY RULE: every arithmetic step on KES goes through Decimal.js (D/round2)
// exactly like src/lib/format.ts — never native float math (0.1 + 0.2 !== 0.3).
// Rounding policy: ROUND_HALF_UP to 2dp, with the rounding remainder absorbed
// by the LAST installment so a schedule always sums to the financed balance
// with zero drift (the accounting identity: Σ installments === financed+interest).
// ─────────────────────────────────────────────────────────────────────────────

export type InstallmentFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY";

export interface ScheduleInput {
  totalAmount: number; // full invoice amount being put on credit
  downPayment: number; // paid up-front on the spot (NOT financed)
  installmentCount: number; // n ≥ 1
  frequency: InstallmentFrequency;
  interestRate: number; // % one-off service charge on the financed balance
  startDate: Date; // plan start — installment #1 lands one cadence step later
}

export interface ScheduleInstallment {
  seq: number; // 1-based due order
  dueDate: Date;
  amountDue: number;
}

/** UTC-safe cadence add: WEEKLY +7d, BIWEEKLY +14d, MONTHLY +1 calendar month.
 *  Week-type cadences use fixed millisecond math (immune to TZ); MONTHLY shifts
 *  the UTC calendar month and lets Date normalise overflow (Jan 31 → Mar 2/3).
 *  Nairobi has no DST, so UTC field arithmetic never shifts wall-clock times. */
function addCadence(from: Date, periods: number, frequency: InstallmentFrequency): Date {
  const DAY_MS = 86_400_000;
  if (frequency === "WEEKLY") return new Date(from.getTime() + periods * 7 * DAY_MS);
  if (frequency === "BIWEEKLY") return new Date(from.getTime() + periods * 14 * DAY_MS);
  const m = new Date(from.getTime());
  m.setUTCMonth(m.getUTCMonth() + periods);
  return m;
}

/**
 * Build the full amortization schedule for a debt plan.
 *
 * Math (all Decimal):
 *   financed            = totalAmount − downPayment
 *   interest            = financed × interestRate / 100
 *                         (one-off flat charge — computed once on the principal,
 *                          NOT compounding per installment — then folded into
 *                          the financed balance for equal-splitting)
 *   financedWithInterest = financed + interest
 *   base                = round2(financedWithInterest / n)  for installments 1..n−1
 *   LAST installment    = financedWithInterest − base × (n−1)
 *                         → the schedule sums EXACTLY to financedWithInterest
 *                           (no cumulative rounding drift).
 */
export function buildAmortizationSchedule(input: ScheduleInput): ScheduleInstallment[] {
  const financed = D(input.totalAmount).sub(D(input.downPayment));
  // One-off interest charge on the financed principal (not per-period compounding).
  const interest = financed.mul(D(input.interestRate)).div(100);
  const financedWithInterest = financed.add(interest);

  const n = Math.max(1, Math.floor(input.installmentCount));
  // Base equal split, rounded half-up to cents.
  const base = financedWithInterest.div(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  // Remainder absorption: last installment = total − Σ(base × (n−1)) → exact sum.
  const last = financedWithInterest.sub(base.mul(n - 1));

  const out: ScheduleInstallment[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      seq: i,
      dueDate: addCadence(input.startDate, i, input.frequency),
      amountDue: i === n ? round2(last) : round2(base),
    });
  }
  return out;
}

export type AllocationKind = "PENALTY" | "OVERDUE" | "PENDING";

export interface WaterfallInstallment {
  id: string;
  seq: number;
  dueDate: Date | string;
  amountDue: number | string | Decimal;
  amountPaid: number | string | Decimal;
  status: string; // PENDING | PARTIAL | PAID | OVERDUE
}

export interface Allocation {
  installmentId: string;
  seq: number;
  amount: number;
  kind: AllocationKind;
}

/**
 * Repayment waterfall — distributes a payment across the oldest obligations
 * first, never over-allocating any single line:
 *
 *   1) oldest accrued PENALTY charges           (kind "PENALTY")
 *   2) oldest OVERDUE installments, capped at
 *      (amountDue − amountPaid)                 (kind "OVERDUE")
 *   3) PENDING future installments in due
 *      order, capped at (amountDue − amountPaid) (kind "PENDING")
 *
 * `penalties` maps installmentId → outstanding accrued fee (KES). An
 * installment that is already PAID contributes nothing. Ordering is by
 * dueDate then seq (the same order the ledger would present them).
 */
export function allocateWaterfall(
  payAmount: number,
  installments: WaterfallInstallment[],
  penalties: Record<string, number>
): Allocation[] {
  const plan: Allocation[] = [];
  let remaining = D(payAmount);
  if (remaining.lte(0)) return plan;

  const byId = new Map(installments.map((i) => [i.id, i]));
  const dueOrder = (id: string): number => {
    const inst = byId.get(id);
    return inst ? new Date(inst.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  };
  const installmentOrder = (a: WaterfallInstallment, b: WaterfallInstallment): number =>
    new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() || a.seq - b.seq;

  // ── Step 1: oldest PENALTY charges first (fees clear before principal). ──
  const penaltyEntries = Object.entries(penalties)
    .filter(([id, amount]) => byId.has(id) && D(amount).gt(0))
    .sort((a, b) => dueOrder(a[0]) - dueOrder(b[0]));
  for (const [installmentId, fee] of penaltyEntries) {
    if (remaining.lte(0)) break;
    const inst = byId.get(installmentId);
    if (!inst) continue;
    // Take the smaller of: what's left of the payment, the outstanding fee.
    const take = Decimal.min(remaining, D(fee));
    if (take.gt(0)) {
      plan.push({ installmentId, seq: inst.seq, amount: round2(take), kind: "PENALTY" });
      remaining = remaining.sub(take);
    }
  }

  // ── Step 2: oldest OVERDUE installments — principal arrears only. ──
  const overdue = installments
    .filter((i) => i.status === "OVERDUE")
    .sort(installmentOrder);
  for (const inst of overdue) {
    if (remaining.lte(0)) break;
    const arrears = D(inst.amountDue).sub(D(inst.amountPaid)); // never beyond amountDue
    if (arrears.lte(0)) continue;
    const take = Decimal.min(remaining, arrears);
    plan.push({ installmentId: inst.id, seq: inst.seq, amount: round2(take), kind: "OVERDUE" });
    remaining = remaining.sub(take);
  }

  // ── Step 3: PENDING (and future PARTIAL) installments in due order. ──
  const pending = installments
    .filter((i) => i.status === "PENDING" || i.status === "PARTIAL")
    .sort(installmentOrder);
  for (const inst of pending) {
    if (remaining.lte(0)) break;
    const owed = D(inst.amountDue).sub(D(inst.amountPaid)); // cap: never beyond amountDue
    if (owed.lte(0)) continue;
    const take = Decimal.min(remaining, owed);
    plan.push({ installmentId: inst.id, seq: inst.seq, amount: round2(take), kind: "PENDING" });
    remaining = remaining.sub(take);
  }

  return plan;
}

export interface CreditScoreInput {
  onTimePayments: number; // installments settled on/before due (status PAID)
  latePayments: number; // installments that went OVERDUE
  defaultedPlans: number; // plans that hit DEFAULTED status
  creditLimit: number;
  currentBalance: number; // outstanding debt right now
}

/**
 * Credit score 0..100 — HIGHER is a BETTER payer. Factor ladder:
 *   • base 50                        → neutral start for a new borrower
 *   • +15 when latePayments === 0    → spotless repayment history bonus
 *   • −8 per defaultedPlan (floor 0) → severe historical breach, compounding
 *   • utilization = currentBalance / creditLimit (divide-by-zero guarded → 0):
 *       < 0.3 → +15 (comfortable headroom)
 *       < 0.6 → +8  (moderate leverage)
 *       < 0.9 → −5  (stretched)
 *       else  → −20 (at/over limit — danger zone)
 *   • timeliness ratio = onTime / (onTime + late || 1) → ×20 bonus
 *     (the `|| 1` guard makes an empty history score 0 bonus, not NaN)
 *   • final clamp 0..100, integer (riskScore column is Int).
 */
export function computeCreditScore(input: CreditScoreInput): number {
  let score = 50; // base 50 — neutral starting trust

  // Perfect-timeliness bonus: never a single late installment.
  if (input.latePayments === 0) score += 15;

  // Defaulted plans are severe breaches: −8 each, floored at 0 before other factors.
  score -= 8 * Math.max(0, Math.floor(input.defaultedPlans));
  score = Math.max(0, score);

  // Utilization factor — guard divide-by-zero: no/zero limit counts as 0 utilization.
  const limit = D(input.creditLimit);
  const utilization = limit.gt(0)
    ? D(input.currentBalance).div(limit).toNumber()
    : 0;
  if (utilization < 0.3) score += 15;
  else if (utilization < 0.6) score += 8;
  else if (utilization < 0.9) score -= 5;
  else score -= 20;

  // Timeliness ratio bonus: share of installments paid on time, worth up to 20.
  const observed = Math.max(0, input.onTimePayments) + Math.max(0, input.latePayments);
  const ratio = observed > 0 ? Math.max(0, input.onTimePayments) / observed : 0;
  score += ratio * 20;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Decimal-safe projected balance: currentBalance + newCharge (rounded to cents). */
export function projectBalance(currentBalance: number | string | Decimal, newCharge: number | string | Decimal): number {
  return round2(D(currentBalance).add(D(newCharge)));
}
