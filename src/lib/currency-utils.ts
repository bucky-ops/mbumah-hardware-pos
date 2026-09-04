// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Multi-currency utilities (East African trade)
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS
// ───────────────
// Mbumah Hardware operates primarily in Kenyan Shillings (KES), but
// cross-border trade with Uganda (UGX) and Tanzania (TZS) — plus
// occasional USD invoicing for imported stock — requires the POS to
// display, convert, and accept amounts in multiple currencies.
//
// This module is the SINGLE SOURCE OF TRUTH for currency metadata and
// offline-safe static exchange rates. For live/admin-managed rates see
// the `/api/currency/rates` endpoint and the `CurrencyRate` Prisma model.
//
// DESIGN NOTES
// ────────────
// • All monetary MATH must go through `decimal.js` (see `src/lib/money.ts`).
//   This module handles only DISPLAY formatting and approximate
//   cross-currency conversion for display purposes.
// • Decimal places per currency follow ISO 4217:
//     KES  → 2 (cents)
//     USD  → 2 (cents)
//     UGX  → 0 (no minor unit — shilling is the smallest unit)
//     TZS  → 0 (no minor unit — shilling is the smallest unit)
// • Static exchange rates are expressed as "1 unit of currency X =
//   N units of KES" so conversion can be done by multiplying the
//   source amount by its rate-to-KES, then dividing by the target's
//   rate-to-KES.
// ─────────────────────────────────────────────────────────────────────────────

import Decimal from "decimal.js";
import type { CurrencyCode } from "@/lib/money";
// FINANCIAL MATH AUDIT: rounding policy + the canonical KES formatter are
// owned by financialMath.ts — this module must not set its own mode.
import { MONEY_ROUNDING, formatKES as formatKESCanonical } from "@/lib/utils/financialMath";

// Re-export CurrencyCode from money.ts so callers have a single import path.
export type { CurrencyCode } from "@/lib/money";

/**
 * Static metadata for every supported currency. `exchangeRateToKES` is the
 * number of KES equivalent to 1 unit of this currency — used for offline
 * display conversions when no live `CurrencyRate` row is available.
 *
 * Rates are approximate (Q1 2025) and for DISPLAY ONLY. Actual invoicing
 * settlements must use the live/admin-managed rates from the API.
 */
export interface CurrencyMeta {
  /** ISO 4217 currency code. */
  code: CurrencyCode;
  /** Human-readable name. */
  name: string;
  /** Display symbol or prefix (e.g. "Ksh", "$", "USh", "TSh"). */
  symbol: string;
  /** Flag emoji for UI affordances. */
  flag: string;
  /** Number of decimal places (ISO 4217 minor unit). */
  decimals: number;
  /** 1 unit of this currency = N KES (approximate, static). */
  exchangeRateToKES: number;
}

/**
 * The four currencies supported for cross-border East African trade.
 * Order is the canonical display order in the currency switcher.
 */
export const SUPPORTED_CURRENCIES: readonly CurrencyMeta[] = [
  {
    code: "KES",
    name: "Kenyan Shilling",
    symbol: "Ksh",
    flag: "🇰🇪",
    decimals: 2,
    exchangeRateToKES: 1,
  },
  {
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    flag: "🇺🇸",
    decimals: 2,
    exchangeRateToKES: 152, // 1 USD ≈ 152 KES
  },
  {
    code: "UGX",
    name: "Ugandan Shilling",
    symbol: "USh",
    flag: "🇺🇬",
    decimals: 0,
    exchangeRateToKES: 0.024, // 1 UGX ≈ 0.024 KES (≈ 42 UGX per KES)
  },
  {
    code: "TZS",
    name: "Tanzanian Shilling",
    symbol: "TSh",
    flag: "🇹🇿",
    decimals: 0,
    exchangeRateToKES: 0.065, // 1 TZS ≈ 0.065 KES (≈ 15.4 TZS per KES)
  },
] as const;

/**
 * Lookup table keyed by currency code for O(1) metadata access.
 */
export const CURRENCY_BY_CODE: Readonly<Record<CurrencyCode, CurrencyMeta>> =
  Object.fromEntries(
    SUPPORTED_CURRENCIES.map((c) => [c.code, c]),
  ) as Readonly<Record<CurrencyCode, CurrencyMeta>>;

/**
 * Map an ISO 3166-1 alpha-2 country code to the currency used by that
 * country among our supported set. Falls back to KES for unknown countries
 * (Mbumah Hardware's home currency).
 *
 * @example getCurrencyByCountry("UG")  → "UGX"
 * @example getCurrencyByCountry("TZ")  → "TZS"
 * @example getCurrencyByCountry("US")  → "USD"
 * @example getCurrencyByCountry("KE")  → "KES"
 */
export function getCurrencyByCountry(countryCode: string): CurrencyCode {
  const upper = (countryCode || "").toUpperCase();
  switch (upper) {
    case "KE":
      return "KES";
    case "UG":
      return "UGX";
    case "TZ":
      return "TZS";
    case "US":
      return "USD";
    default:
      return "KES";
  }
}

/**
 * Format a numeric amount as a currency display string with the proper
 * symbol, thousands separators, and decimal precision for the given currency.
 *
 * KES amounts delegate to the ONE canonical en-KE formatter
 * (`financialMath.formatKES`) so every surface in the ERP renders the
 * identical string for the same amount ("KES 1,234.56"). Other currencies
 * keep their ISO-code prefix and ISO-4217 decimals.
 *
 * Uses `decimal.js` internally to avoid IEEE-754 float artifacts in the
 * displayed string (e.g. `0.1 + 0.2` would otherwise render as
 * "KES 0.30000000000000004" — unacceptable for a POS).
 *
 * @example formatCurrency(1234.5, "KES")   → "KES 1,234.50"
 * @example formatCurrency(1234.5, "USD")   → "$ 1,234.50"
 * @example formatCurrency(50000, "UGX")    → "USh 50,000"
 * @example formatCurrency(15000, "TZS")    → "TSh 15,000"
 */
export function formatCurrency(
  amount: number | string | Decimal | null | undefined,
  currency: CurrencyCode = "KES",
): string {
  const meta = CURRENCY_BY_CODE[currency] ?? CURRENCY_BY_CODE.KES;

  // KES (the store's home currency) always renders through the ONE canonical
  // en-KE formatter — including the null/undefined → "KES 0.00" case.
  if (currency === "KES") {
    return formatKESCanonical((amount ?? 0) as number | string | Decimal);
  }

  if (amount === null || amount === undefined) {
    return `${meta.symbol} 0${meta.decimals > 0 ? "." + "0".repeat(meta.decimals) : ""}`;
  }

  let d: Decimal;
  try {
    if (amount instanceof Decimal) d = amount;
    else if (typeof amount === "number") {
      if (!Number.isFinite(amount)) d = new Decimal(0);
      else d = new Decimal(amount);
    } else {
      // Strip thousands separators (commas) and any leading currency token.
      const cleaned = String(amount)
        .trim()
        .replace(/^(KES|KSH|KSHS|USD|UGX|TZS|EUR|GBP)\s*/i, "")
        .replace(/,/g, "");
      d = new Decimal(cleaned || 0);
    }
  } catch {
    d = new Decimal(0);
  }

  const fixed = d.toDecimalPlaces(
    meta.decimals,
    MONEY_ROUNDING,
  ).toFixed(meta.decimals);

  // Group integer part with thousands separators.
  const [intPart, decPart] = fixed.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = decPart ? `${withCommas}.${decPart}` : withCommas;

  return `${meta.symbol} ${formatted}`;
}

/**
 * Convert an amount from one currency to another using the static
 * `exchangeRateToKES` rates. KES is the pivot currency — every amount is
 * first converted to KES, then from KES to the target currency.
 *
 * Returns a `number` for convenience in display contexts. For financial
 * MATH (ledger postings, tax computation) use the `Money` class instead,
 * which uses `Decimal` end-to-end.
 *
 * @example convertCurrency(100, "USD", "KES")  → 15200
 * @example convertCurrency(1000, "KES", "UGX") → 41666.67
 */
export function convertCurrency(
  amount: number | string | Decimal | null | undefined,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
): number {
  const from = CURRENCY_BY_CODE[fromCurrency];
  const to = CURRENCY_BY_CODE[toCurrency];
  if (!from || !to) return 0;
  if (from.code === to.code) {
    return typeof amount === "number"
      ? amount
      : amount instanceof Decimal
        ? amount.toNumber()
        : Number(amount) || 0;
  }

  let d: Decimal;
  try {
    if (amount instanceof Decimal) d = amount;
    else if (typeof amount === "number") d = new Decimal(amount || 0);
    else d = new Decimal((amount || "0").toString().replace(/,/g, ""));
  } catch {
    d = new Decimal(0);
  }

  // amount_in_KES = amount * from.exchangeRateToKES
  const inKES = d.mul(from.exchangeRateToKES);
  // amount_in_target = inKES / to.exchangeRateToKES
  if (to.exchangeRateToKES === 0) return 0;
  const converted = inKES.div(to.exchangeRateToKES);

  // Round to the target currency's decimal precision (audit HALF_UP policy).
  const rounded = converted.toDecimalPlaces(
    to.decimals,
    MONEY_ROUNDING,
  );
  return rounded.toNumber();
}

/**
 * Parse a user-supplied currency input string into a number. Accepts:
 *  • Plain numbers: "1234", "1234.56"
 *  • Comma-grouped: "1,234.56"
 *  • Currency-prefixed: "Ksh 1,234.50", "USD 100", "$ 50.00", "USh 5000"
 *
 * Returns `null` if the input cannot be parsed (instead of throwing),
 * so callers can fall back to a default without try/catch noise.
 *
 * @example parseCurrencyInput("Ksh 1,234.50")  → 1234.5
 * @example parseCurrencyInput("$50")           → 50
 * @example parseCurrencyInput("abc")           → null
 */
export function parseCurrencyInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? input : null;
  }
  if (typeof input !== "string") return null;

  // Strip leading currency tokens (text + optional symbol), spaces, commas.
  const cleaned = input
    .trim()
    .replace(/^(KES|KSH|KSHS|USD|UGX|TZS|EUR|GBP)\s*/i, "")
    .replace(/^[A-Z$£€]+\s*/i, "")
    .replace(/,/g, "")
    .trim();

  if (cleaned === "") return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * List only the currency codes — useful for dropdown option generation
 * without pulling the full metadata.
 */
export const CURRENCY_CODES: readonly CurrencyCode[] = SUPPORTED_CURRENCIES.map(
  (c) => c.code,
);
