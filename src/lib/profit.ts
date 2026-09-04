// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Unified profit & revenue formulas (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS
// ───────────────
// Audit finding (worklog Tasks 2-a/2-b): three conflicting profit formulas
// existed across the API surface:
//
//   1. reports/sales-summary — grossProfit = (TAX-INCLUSIVE totalAmount) − COGS
//      → overstated profit by the VAT component and ignored discounts.
//   2. transactions/[id]     — grossProfit = pretax subtotal − cost
//      → correct basis (VAT-exclusive, net of discount) but defined locally.
//   3. financial/revenue-trend — "grossProfit" = revenue − ALL expense debits
//      → actually a net-profit-style figure wearing a gross label.
//
// This module defines the ONE canonical chain used everywhere:
//
//   grossRevenue(totalAmount, taxAmount) = totalAmount − taxAmount
//       · Revenue is ALWAYS VAT-exclusive. totalAmount is the tax-inclusive
//         tender total stored on SalesTransaction; the VAT component is
//         stripped before anything is called "revenue".
//   netRevenue(grossRevenue, discountAmount) = grossRevenue − discounts
//       · Discounts reduce revenue. NOTE (schema subtlety): in this codebase
//         SalesTransaction.totalAmount is ALREADY net of line discounts
//         (totalAmount = subtotal − discount + tax, see helpers.calculateLineTotal),
//         so grossRevenue(totalAmount, taxAmount) is already net-of-discount.
//         Callers MUST NOT pass a discount that is already embedded in
//         totalAmount — that double-subtracts. Pass a discount only when the
//         gross input is PRE-discount (e.g. the stored `subtotal` sum).
//   grossProfit(netRevenue, cogs) = netRevenue − COGS
//       · COGS = Σ(quantity × costPrice snapshot) from SaleItem.
//   netProfit(grossProfit, operatingExpenses) = grossProfit − operatingExpenses
//       · Operating expenses exclude COGS. When an expense figure already
//         bundles COGS (e.g. all EXPENSE-type journal debits incl. account
//         5000), pass grossProfit(netRevenue, 0) as the input so COGS is not
//         double-counted — the composite then equals netRevenue − allExpenses.
//
// Rounding discipline: every operand is rounded HALF_EVEN (banker's rounding,
// the IFRS/KRA-VAT standard) to the currency minor unit (2dp for KES) BEFORE
// the subtraction. Subtraction of two 2dp values is exact at 2dp, so results
// are cent-exact and free of IEEE-754 dust. All math goes through the `Money`
// primitive (src/lib/money.ts) — never raw float arithmetic.
//
// Purity: these functions are pure — no logging, no I/O, no console noise.
// Missing (null/undefined) operands are treated as 0. Non-finite numbers
// (NaN/±Infinity, e.g. from Number(undefined)) are treated as 0 so a single
// malformed row can never 500 an aggregation endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import Decimal from 'decimal.js';
import { KES } from '@/lib/money';

/**
 * Version marker for the formula definitions implemented below. Bump this
 * whenever the chain changes so persisted artifacts (reports, filings,
 * systemLog metadata) can record which formula generation produced them.
 */
export const PROFIT_FORMULA_VERSION = 'PROFIT-FORMULA-v2-VAT-EXCLUSIVE-HALF_EVEN-1';

/** Anything that can be coerced into a KES amount (Prisma Decimal included). */
export type MoneyLike = number | string | Decimal | null | undefined;

/**
 * Normalize an operand to a 2dp HALF_EVEN-rounded `Money`.
 *  - null / undefined  → KES 0.00 (missing fields are zero, per audit spec)
 *  - NaN / ±Infinity   → KES 0.00 (defensive; keeps aggregations crash-free)
 */
function toRoundedKES(value: MoneyLike): ReturnType<typeof KES> {
  if (typeof value === 'number' && !Number.isFinite(value)) return KES(0);
  return KES(value).round();
}

/**
 * grossRevenue — VAT-exclusive revenue.
 *
 *   grossRevenue = totalAmount − taxAmount
 *
 * `totalAmount` is the tax-inclusive tender total (SalesTransaction.totalAmount);
 * the VAT component is always stripped before calling anything "revenue".
 * In this schema the stored total is also net of line discounts, so the
 * result is revenue net of BOTH VAT and discounts (see module header).
 */
export function grossRevenue(totalAmount: MoneyLike, taxAmount: MoneyLike): number {
  return toRoundedKES(totalAmount).subtract(toRoundedKES(taxAmount)).toNumber();
}

/**
 * netRevenue — revenue after discounts.
 *
 *   netRevenue = grossRevenue − discountAmount
 *
 * Only pass discounts NOT already embedded in the gross figure
 * (e.g. grossRevenue computed from the PRE-discount `subtotal`, or 0 when
 * the gross came from totalAmount, which is already net-of-discount).
 */
export function netRevenue(grossRevenueValue: MoneyLike, discountAmount: MoneyLike): number {
  return toRoundedKES(grossRevenueValue).subtract(toRoundedKES(discountAmount)).toNumber();
}

/**
 * grossProfit — netRevenue minus cost of goods sold.
 *
 *   grossProfit = netRevenue − cogs
 */
export function grossProfit(netRevenueValue: MoneyLike, cogs: MoneyLike): number {
  return toRoundedKES(netRevenueValue).subtract(toRoundedKES(cogs)).toNumber();
}

/**
 * netProfit — grossProfit minus operating expenses (COGS excluded).
 *
 *   netProfit = grossProfit − operatingExpenses
 */
export function netProfit(grossProfitValue: MoneyLike, operatingExpenses: MoneyLike): number {
  return toRoundedKES(grossProfitValue).subtract(toRoundedKES(operatingExpenses)).toNumber();
}

/**
 * Recover the VAT-exclusive amount of a TAX-INCLUSIVE line when the stored
 * tax AMOUNT is absent but the tax RATE is known (SaleItem stores lineTotal
 * + taxRate but no per-line tax column — documented schema limitation).
 *
 *   vatExclusive = totalInclusive × 100 / (100 + taxRatePercent)
 *
 * Because checkout math (helpers.calculateLineTotal) builds
 * total = round(taxable) + round(tax), inverting the ratio reproduces the
 * original taxable amount to within ±0.01 per line (round-trip drift only;
 * exact when taxRate is 0). Used for per-product revenue breakdowns where
 * the transaction header's taxAmount cannot be attributed to single items.
 */
export function vatExclusiveFromTaxInclusive(
  totalInclusive: MoneyLike,
  taxRatePercent: MoneyLike,
): number {
  const total = toRoundedKES(totalInclusive).amount;
  const rate = toRoundedKES(taxRatePercent).amount;
  const divisor = rate.add(100);
  if (divisor.isZero()) return toRoundedKES(totalInclusive).toNumber();
  return KES(total.mul(100).div(divisor)).round().toNumber();
}
