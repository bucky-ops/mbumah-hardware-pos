// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Money class (financial-integer primitive)
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS
// ───────────────
// JavaScript `number` is an IEEE-754 double-precision float. It CANNOT
// represent most decimal fractions exactly:
//
//     0.1 + 0.2 === 0.30000000000000004   // ← classic float bug
//     1.005.toFixed(2) === "1.00"          // ← wrong, should be "1.01"
//     0.1 * 3 === 0.30000000000000004
//
// For a POS / accounting system this is unacceptable. A Ksh 0.01 rounding
// error multiplied across 100,000 transactions is Ksh 1,000 — real money,
// real audit findings, real customer complaints. The fix is to use a
// arbitrary-precision decimal type (`decimal.js`) for ALL monetary math and
// to centralise every money operation behind this `Money` class so that:
//
//   1. No floating-point ever touches a money field in application code.
//   2. Rounding is explicit and uses banker's rounding (HALF_EVEN) — the
//      GAAP / IFRS standard — never "round half up" (which biases upward).
//   3. Currency is attached to every amount, preventing accidental KES/KES
//      cross-currency arithmetic.
//   4. Allocation (splitting an amount into ratios) is exact — no penny
//      left behind, no penny created. `allocate([1, 1, 1])` of Ksh 1.00
//      returns [0.34, 0.33, 0.33] — never [0.33, 0.33, 0.33] (which loses
//      Ksh 0.01) or [0.34, 0.34, 0.34] (which creates Ksh 0.02).
//
// USAGE
// ─────
//   import { Money, KES } from '@/lib/money';
//
//   const unit  = KES(500);                    // Ksh 500.00
//   const qty   = 3;
//   const gross = unit.multiply(qty);          // Ksh 1,500.00
//   const disc  = gross.applyDiscount(10);     // 10% off → Ksh 1,350.00
//   const tax   = disc.applyTax(16);           // 16% VAT  → Ksh 1,566.00
//   const str   = tax.formatKES();             // "Ksh 1,566.00"
//
//   // From a Prisma Decimal field (already exact):
//   const fromDb = Money.fromPrisma(record.totalAmount);
//
//   // Safe parsing of user input (returns null on bad input, never throws):
//   const parsed = Money.tryParse('1,234.50');  // Money(1234.50) | null
//
// RELATIONSHIP TO PRISMA
// ──────────────────────
// Prisma `@db.Decimal(12,2)` columns are returned as `Prisma.Decimal` (a
// re-export of `decimal.js`). `Money.fromPrisma()` accepts that type
// directly, so there is zero conversion friction at the DB boundary. When
// writing back, pass `money.toDecimal()` — Prisma accepts the `Decimal`
// instance natively.
//
// ─────────────────────────────────────────────────────────────────────────────

import Decimal from "decimal.js";

// ── Banker's rounding (HALF_EVEN) — GAAP / IFRS standard ──────────────────────
//
// Half-even rounding rounds 0.5 to the nearest EVEN digit, eliminating the
// upward bias of "half up" (which rounds every 0.5 up, skewing aggregates
// over many transactions). This is the rounding mode mandated by:
//   • IFRS for financial reporting
//   • Article 7 of the EU "Prices in Euro" Directive
//   • KRA (Kenya Revenue Authority) for VAT computation
//
// Decimal.js configuration: precision 28 significant digits (enough for
// Ksh 9,999,999,999.99 — well beyond any retail POS transaction), rounding
// HALF_EVEN.
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_EVEN,
});

// ── Currency codes we accept (extensible) ────────────────────────────────────
export type CurrencyCode = "KES" | "USD" | "EUR" | "GBP" | "TZS" | "UGX";

const CURRENCY_DECIMALS: Readonly<Record<CurrencyCode, number>> = {
  KES: 2, // Kenyan Shilling — 2 decimals (cents)
  USD: 2,
  EUR: 2,
  GBP: 2,
  TZS: 0, // Tanzanian Shilling — no minor unit
  UGX: 0, // Ugandan Shilling — no minor unit
};

/**
 * The number of decimal places a currency supports. KES, USD, EUR, GBP use 2
 * (cents); TZS and UGX use 0 (no minor unit). Used by `round()` and
 * `formatKES()` to produce currency-correct outputs.
 */
export function currencyDecimals(currency: CurrencyCode = "KES"): number {
  return CURRENCY_DECIMALS[currency] ?? 2;
}

/**
 * A monetary amount tagged with a currency. Immutable — every arithmetic
 * operation returns a NEW `Money` instance, so `a.add(b)` never mutates `a`.
 *
 * The internal value is a `Decimal` (arbitrary precision, base-10), so there
 * is no floating-point error. Construct via the factory methods
 * (`Money.fromNumber`, `Money.fromString`, `Money.fromPrisma`, `KES()`) rather
 * than `new Money()` directly, so that currency defaults and validation are
 * applied consistently.
 */
export class Money {
  /** The raw decimal value. Never mutated. */
  readonly amount: Decimal;
  /** ISO 4217 currency code. Defaults to KES. */
  readonly currency: CurrencyCode;

  /**
   * @internal Use a factory (`Money.fromNumber`, `KES`, etc.) instead.
   */
  constructor(amount: Decimal | number | string, currency: CurrencyCode = "KES") {
    // `Decimal` is immutable in decimal.js, but a caller could in theory pass
    // a subclass with mutators. Defensive copy via `new Decimal(...)` keeps
    // the contract airtight.
    this.amount = amount instanceof Decimal ? new Decimal(amount) : new Decimal(amount);
    this.currency = currency;
  }

  // ── Factory methods ────────────────────────────────────────────────────────

  /** Zero in the given currency. Common starting point for running totals. */
  static zero(currency: CurrencyCode = "KES"): Money {
    return new Money(new Decimal(0), currency);
  }

  /** Construct from a JS number. Throws if the number is NaN / Infinity. */
  static fromNumber(value: number, currency: CurrencyCode = "KES"): Money {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `Money.fromNumber: value must be a finite number, got ${value}.`,
      );
    }
    return new Money(new Decimal(value), currency);
  }

  /**
   * Construct from a string. Accepts plain numeric strings ("1234.56"),
   * comma-grouped strings ("1,234.56"), and KES-prefixed strings
   * ("Ksh 1,234.56", "KES 1234"). Throws if the string cannot be parsed.
   */
  static fromString(value: string, currency: CurrencyCode = "KES"): Money {
    const cleaned = Money.cleanNumericString(value);
    if (cleaned === null) {
      throw new Error(`Money.fromString: cannot parse "${value}" as a number.`);
    }
    return new Money(new Decimal(cleaned), currency);
  }

  /**
   * Construct from a Prisma `Decimal` field, a string, a number, or null/undefined.
   * This is the bridge between the database and the Money class — Prisma
   * `@db.Decimal(12,2)` columns arrive as `Prisma.Decimal`, which is a re-export
   * of `decimal.js`, so `new Decimal(prismaDecimal)` works natively.
   *
   * Returns `Money.zero()` for null / undefined, so callers can safely pass
   * optional fields without a null check.
   */
  static fromPrisma(
    value: Decimal | string | number | null | undefined,
    currency: CurrencyCode = "KES",
  ): Money {
    if (value === null || value === undefined) {
      return Money.zero(currency);
    }
    return new Money(new Decimal(value), currency);
  }

  /**
   * Safe parse — returns `null` on bad input instead of throwing. Use this for
   * user-supplied form input where a throw would force a try/catch at every
   * call site. Accepts the same formats as `fromString`.
   */
  static tryParse(
    value: string | number | null | undefined,
    currency: CurrencyCode = "KES",
  ): Money | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return new Money(new Decimal(value), currency);
    }
    const cleaned = Money.cleanNumericString(value);
    if (cleaned === null) return null;
    try {
      return new Money(new Decimal(cleaned), currency);
    } catch {
      return null;
    }
  }

  /**
   * Strip currency prefixes ("Ksh ", "KES ", "KShs "), thousands separators
   * (commas), and whitespace, returning a parseable numeric string. Returns
   * `null` if the input contains non-numeric characters after cleaning.
   *
   * @example
   *   Money.cleanNumericString("Ksh 1,234.50")  → "1234.50"
   *   Money.cleanNumericString("1,234")         → "1234"
   *   Money.cleanNumericString("abc")           → null
   */
  static cleanNumericString(value: string): string | null {
    if (typeof value !== "string") return null;
    // Strip leading currency tokens (case-insensitive): Ksh, KES, KShs, USD, etc.
    // Also strip surrounding whitespace.
    let s = value.trim().replace(/^(KES|KSH|KSHS|USD|EUR|GBP|TZS|UGX)\s*/i, "");
    // Remove all commas (thousands separators) and spaces between digits.
    s = s.replace(/[\s,]/g, "");
    // Now validate: optional sign, digits, optional single decimal point + digits.
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
    return s;
  }

  // ── Arithmetic (all immutable — return new Money) ──────────────────────────

  /** Add another Money (must be the same currency) or a plain number. */
  add(other: Money | number | Decimal): Money {
    const otherAmount = other instanceof Money ? this.coerce(other) : new Decimal(other);
    return new Money(this.amount.plus(otherAmount), this.currency);
  }

  /** Subtract another Money (must be the same currency) or a plain number. */
  subtract(other: Money | number | Decimal): Money {
    const otherAmount = other instanceof Money ? this.coerce(other) : new Decimal(other);
    return new Money(this.amount.minus(otherAmount), this.currency);
  }

  /**
   * Multiply by a scalar (quantity, tax rate as decimal, etc.). The argument
   * is a NUMBER or Decimal — NOT a Money — because multiplying two monetary
   * amounts is a category error (you don't multiply "Ksh 100" by "Ksh 50").
   *
   * @example
   *   KES(500).multiply(3)        // Ksh 1,500.00  (3 units at Ksh 500)
   *   KES(1000).multiply(0.16)    // Ksh 160.00    (16% VAT)
   */
  multiply(factor: number | Decimal): Money {
    return new Money(this.amount.mul(factor), this.currency);
  }

  /**
   * Divide by a scalar. Throws on division by zero — that is a genuine bug
   * (dividing money by zero has no meaningful result).
   */
  divide(divisor: number | Decimal): Money {
    if (new Decimal(divisor).isZero()) {
      throw new RangeError("Money.divide: divisor must not be zero.");
    }
    return new Money(this.amount.div(divisor), this.currency);
  }

  /** Unary negation. Useful for representing refunds / credits as negatives. */
  negate(): Money {
    return new Money(this.amount.neg(), this.currency);
  }

  /** Absolute value. */
  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  // ── Financial operations ───────────────────────────────────────────────────

  /**
   * Apply a percentage discount and return the DISCOUNTED amount.
   * Uses banker's rounding to the currency's decimal precision.
   *
   * @example KES(1000).applyDiscount(10)  // 10% off → Ksh 900.00
   * @example KES(1000).applyDiscount(0)   // no discount → Ksh 1,000.00
   */
  applyDiscount(discountPercent: number | Decimal): Money {
    if (new Decimal(discountPercent).isZero()) return this;
    const factor = new Decimal(1).minus(new Decimal(discountPercent).div(100));
    return this.round().multiply(factor);
  }

  /**
   * Apply a percentage tax and return the TAX-INCLUSIVE total.
   * Uses banker's rounding to the currency's decimal precision.
   *
   * @example KES(1000).applyTax(16)   // 16% VAT added → Ksh 1,160.00
   * @example KES(1000).applyTax(0)    // no tax → Ksh 1,000.00
   */
  applyTax(taxPercent: number | Decimal): Money {
    if (new Decimal(taxPercent).isZero()) return this;
    const factor = new Decimal(1).plus(new Decimal(taxPercent).div(100));
    return this.round().multiply(factor);
  }

  /**
   * Compute the tax COMPONENT for this amount at the given rate (i.e. the
   * portion of a tax-inclusive amount that is tax). Uses the standard
   * "tax-exclusive fraction" formula: tax = amount × rate / (1 + rate).
   *
   * @example KES(1160).taxComponent(16)  // → Ksh 160.00 (the VAT in 1,160 gross)
   */
  taxComponent(taxPercent: number | Decimal): Money {
    const rate = new Decimal(taxPercent).div(100);
    if (rate.isZero()) return Money.zero(this.currency);
    const tax = this.amount.mul(rate).div(new Decimal(1).plus(rate));
    return new Money(tax, this.currency).round();
  }

  /**
   * What percentage of `total` is this amount? Returns a plain Decimal
   * (not a Money — the result is a ratio, not an amount).
   *
   * @example KES(160).percentOf(KES(1160))  // 13.793103...
   */
  percentOf(total: Money): Decimal {
    const totalAmount = this.coerce(total);
    if (totalAmount.isZero()) return new Decimal(0);
    return this.amount.div(totalAmount).mul(100);
  }

  /**
   * Allocate this amount across `ratios` with EXACT penny distribution — no
   * rounding loss, no created pennies. The classic problem: splitting Ksh 1.00
   * three ways. Naive `1.00 / 3 = 0.33` loses Ksh 0.01. This algorithm
   * (largest-remainder) distributes the residual penny(s) to the ratios with
   * the largest fractional remainder, so [1,1,1] of 1.00 → [0.34, 0.33, 0.33].
   *
   * Used for: split payments, commission distribution, multi-tax allocation,
   * invoice line proration.
   *
   * @example KES(100).allocate([1, 1, 1])  // [Money(33.34), Money(33.33), Money(33.33)]
   */
  allocate(ratios: number[]): Money[] {
    if (ratios.length === 0) return [];
    const totalRatios = ratios.reduce((sum, r) => sum.plus(new Decimal(r)), new Decimal(0));
    if (totalRatios.isZero()) {
      return ratios.map(() => Money.zero(this.currency));
    }

    const decimals = currencyDecimals(this.currency);
    const unit = new Decimal(10).pow(decimals);
    // Work in integer minor units (cents) to guarantee exact distribution.
    const totalMinor = this.amount.mul(unit).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);

    // First pass: floor allocation.
    const floored = ratios.map((r) => {
      const share = totalMinor.mul(r).div(totalRatios).toDecimalPlaces(0, Decimal.ROUND_FLOOR);
      return share;
    });

    // Residual = total - sum(floored). Distribute one minor unit at a time to
    // the ratios with the largest fractional remainder.
    const allocated = floored.reduce((s, x) => s.plus(x), new Decimal(0));
    let residual = totalMinor.minus(allocated);

    // Compute fractional remainders (the part we truncated with FLOOR).
    const remainders = ratios.map((r, i) => {
      const exact = totalMinor.mul(r).div(totalRatios);
      return { index: i, frac: exact.minus(floored[i]) };
    });
    remainders.sort((a, b) => b.frac.comparedTo(a.frac));

    let idx = 0;
    while (residual.gt(0) && idx < remainders.length) {
      floored[remainders[idx].index] = floored[remainders[idx].index].plus(1);
      residual = residual.minus(1);
      idx++;
    }

    return floored.map((minor) => new Money(minor.div(unit), this.currency));
  }

  // ── Rounding ───────────────────────────────────────────────────────────────

  /**
   * Round to the currency's minor-unit precision using banker's rounding
   * (HALF_EVEN). KES rounds to 2 decimals (cents); TZS / UGX to 0 decimals.
   *
   * This does NOT mutate — returns a new Money.
   */
  round(): Money {
    const decimals = currencyDecimals(this.currency);
    return new Money(
      this.amount.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN),
      this.currency,
    );
  }

  // ── Comparison ─────────────────────────────────────────────────────────────

  /** Equal value AND same currency. */
  eq(other: Money): boolean {
    if (this.currency !== other.currency) return false;
    return this.amount.equals(other.amount);
  }

  /** Strictly greater than. Throws if currencies differ. */
  gt(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.gt(other.amount);
  }

  /** Greater than or equal. */
  gte(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.gte(other.amount);
  }

  /** Strictly less than. */
  lt(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lt(other.amount);
  }

  /** Less than or equal. */
  lte(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount.lte(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.gt(0);
  }

  isNegative(): boolean {
    return this.amount.lt(0);
  }

  /** Max of two Money values (same currency). */
  static max(a: Money, b: Money): Money {
    a.assertSameCurrency(b);
    return a.gte(b) ? a : b;
  }

  /** Min of two Money values (same currency). */
  static min(a: Money, b: Money): Money {
    a.assertSameCurrency(b);
    return a.lte(b) ? a : b;
  }

  /**
   * Sum a list of Money values. All must share the same currency. Returns
   * `Money.zero()` for an empty list.
   */
  static sum(values: Money[], currency: CurrencyCode = "KES"): Money {
    if (values.length === 0) return Money.zero(currency);
    return values.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  // ── Conversion ─────────────────────────────────────────────────────────────

  /** Convert to a JS `number`. Loses precision for very large amounts — use
   *  `toDecimal()` for financial math, `toNumber()` only for display / JSON
   *  serialization to legacy APIs that don't accept Decimal. */
  toNumber(): number {
    return this.amount.toNumber();
  }

  /** The underlying `Decimal` — pass this to Prisma when writing to a
   *  `@db.Decimal` column. Prisma accepts `Decimal` natively. */
  toDecimal(): Decimal {
    return new Decimal(this.amount); // defensive copy
  }

  /** Plain numeric string, no formatting. e.g. "1234.56". */
  toString(): string {
    return this.amount.toFixed(currencyDecimals(this.currency));
  }

  /** JSON serialisation — returns a string so the value survives JSON
   *  round-tripping without float corruption. */
  toJSON(): string {
    return this.toString();
  }

  // ── Formatting ─────────────────────────────────────────────────────────────

  /**
   * Format as a Kenyan-Shilling display string with thousands separators and
   * 2 decimal places. e.g. `KES(1234567.5).formatKES()` → "Ksh 1,234,567.50".
   *
   * For currencies with 0 minor units (TZS, UGX), no decimals are shown.
   */
  formatKES(): string {
    const decimals = currencyDecimals(this.currency);
    const symbol = this.currency === "KES" ? "Ksh " : `${this.currency} `;
    const fixed = this.amount.toFixed(decimals);
    // Add thousands separators: "1234567.50" → "1,234,567.50"
    const [intPart, decPart] = fixed.split(".");
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${symbol}${decPart ? `${withCommas}.${decPart}` : withCommas}`;
  }

  /**
   * Compact format for dashboards / charts: "Ksh 1.2M", "Ksh 340K", "Ksh 980".
   * Useful for KPI cards where full precision isn't needed.
   */
  formatCompact(): string {
    const n = this.amount.toNumber();
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    const prefix = this.currency === "KES" ? "Ksh " : `${this.currency} `;
    if (abs >= 1_000_000) return `${prefix}${sign}${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${prefix}${sign}${(abs / 1_000).toFixed(1)}K`;
    return `${prefix}${sign}${abs.toFixed(0)}`;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Coerce another Money to this Money's currency. Currently ONLY allows
   * same-currency arithmetic (cross-currency conversion is a separate concern
   * requiring an exchange-rate service). Throws on mismatch.
   */
  private coerce(other: Money): Decimal {
    this.assertSameCurrency(other);
    return other.amount;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} vs ${other.currency}. ` +
          "Cross-currency arithmetic requires an explicit conversion.",
      );
    }
  }
}

// ── Convenience constructor: KES(500) === Money.fromNumber(500, 'KES') ───────
/**
 * Shorthand for `Money.fromNumber(value, 'KES')`. The most common case in
 * this codebase (Mbumah Hardware operates in Kenyan Shillings).
 *
 * @example
 *   const price = KES(500);
 *   const total = price.multiply(3).applyTax(16);  // Ksh 1,740.00
 */
export function KES(value: number | string | Decimal | null | undefined): Money {
  if (value === null || value === undefined) return Money.zero("KES");
  if (value instanceof Decimal) return new Money(value, "KES");
  if (typeof value === "number") return Money.fromNumber(value, "KES");
  return Money.fromString(value, "KES");
}

// ── Helpers for bulk conversion of Prisma result rows ────────────────────────

/**
 * Map a Prisma Decimal field (or string / number / null) to a `Money` in a
 * destructuring / mapping context. Sugar for `Money.fromPrisma(x)`.
 *
 * @example
 *   const totals = rows.map(toKES);
 */
export function toKES(
  value: Decimal | string | number | null | undefined,
): Money {
  return Money.fromPrisma(value, "KES");
}

/**
 * Convert a `Money` back to a Prisma-writable `Decimal`. Use when assigning
 * to a `@db.Decimal` column:
 *
 * @example
 *   await db.salesTransaction.update({ data: { totalAmount: toPrisma(money) } });
 */
export function toPrisma(money: Money): Decimal {
  return money.toDecimal();
}
