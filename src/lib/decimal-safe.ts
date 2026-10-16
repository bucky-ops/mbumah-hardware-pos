// src/lib/decimal-safe.ts
//
// Decimal-safe numeric reads (pure module - no 'use client', no imports).
//
// WHY THIS EXISTS
// Prisma `@db.Decimal` columns deserialize as decimal.js `Decimal` objects
// whose `valueOf()` returns a STRING. That makes raw JS arithmetic on them a
// silent-corruption trap that TypeScript cannot save you from at runtime:
//
//   Decimal("0") + 2  →  "02"      (+ concatenates two strings)
//   Decimal("21") + 0 →  "210"     (the v2.30.0 leave-balance bug)
//   Decimal("9") - 2  →  7         (- * / coerce numerically - benign)
//   Decimal("9") < 10 →  true      (< > coerce numerically - benign)
//
// The `+` sites corrupt data; the `-`/`*`/comparison sites are runtime-benign
// today but are the same type-unsafe pattern - a future refactor that turns a
// `-` into a `+` (e.g. turning a delta into an accumulator) would silently
// start concatenating. The v2.31.0 hygiene round closes ALL remaining
// TS2365/TS2363 baseline sites (18 across 7 API routes) by reading every
// Decimal-ish value through `toNum()` so no Decimal object can ever leak
// back into arithmetic.
//
// USAGE
//   import { toNum } from '@/lib/decimal-safe';
//
//   const hours   = toNum(record.breakHours);            // Decimal → number
//   const ot      = Math.max(0, worked - toNum(expected, 8)); // null → fallback
//   if (toNum(card.currentBalance) < toNum(amount)) { ... }

/**
 * Coerce any Prisma Decimal / string / number / nullish value into a finite
 * number, falling back to `fallback` for null, undefined, empty strings and
 * non-finite results (NaN / ±Infinity).
 *
 * - Plain numbers pass through untouched (including 0 - use a `||` fallback
 *   at the CALL SITE if 0 should mean "use the default"; this function keeps
 *   the runtime-exact semantics of the legacy `record.x || 0` expressions).
 * - Decimal objects (and any object) go through `Number()`, which invokes
 *   `valueOf()` - decimal.js returns the numeric string, Number coerces it.
 * - Numeric strings ("21.5") convert; non-numeric strings fall back.
 */
export function toNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
