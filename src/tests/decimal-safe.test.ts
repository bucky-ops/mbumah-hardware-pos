import { describe, expect, it } from 'vitest';

import { toNum } from '@/lib/decimal-safe';

// Reproduces the Prisma Decimal runtime shape: a decimal.js Decimal is an
// object whose valueOf() returns the numeric STRING - exactly the trap that
// corrupted leave balances before v2.30.0 ("0" + 2 → "02").
class DecimalStub {
  constructor(private readonly s: string) {}
  valueOf(): string {
    return this.s;
  }
}

describe('toNum (decimal-safe reads)', () => {
  it('converts a Decimal object (valueOf → string) to a finite number', () => {
    expect(toNum(new DecimalStub('21.5'))).toBe(21.5);
    expect(toNum(new DecimalStub('0'))).toBe(0);
  });

  it('does NOT string-concatenate when the caller adds the result', () => {
    // The core regression: usedDays (Decimal) + days must be numeric math.
    const used = toNum(new DecimalStub('2'));
    expect(used + 2).toBe(4);
    expect(`${used + 2}`).toBe('4');
  });

  it('passes plain numbers through, including 0 and negatives', () => {
    expect(toNum(0)).toBe(0);
    expect(toNum(-3.25)).toBe(-3.25);
    expect(toNum(1e9)).toBe(1e9);
  });

  it('converts numeric strings', () => {
    expect(toNum('12.75')).toBe(12.75);
    expect(toNum('  8 ')).toBe(8);
  });

  it('falls back for null, undefined and empty string', () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum('')).toBe(0);
    expect(toNum(null, 8)).toBe(8);
    expect(toNum(undefined, 21)).toBe(21);
  });

  it('falls back for non-finite and non-numeric values', () => {
    expect(toNum('not-a-number')).toBe(0);
    expect(toNum(NaN)).toBe(0);
    expect(toNum(Infinity, 8)).toBe(8);
    expect(toNum({})).toBe(0);
  });

  it('preserves the legacy `record.x || 0` / `record.x || 8` semantics at call sites', () => {
    // Legacy: `record.expectedHours || 8` - Decimal(0) is a TRUTHY OBJECT so
    // 0 stayed 0; only null/undefined fell back to 8. Call sites wrap the
    // legacy expression so behavior is runtime-exact.
    expect(toNum(new DecimalStub('0') as unknown || 8)).toBe(0);
    // Nullish through an opaque array so TS cannot statically prove the
    // falsiness (the legacy expression is a runtime property, not a type one).
    for (const v of [null, undefined] as unknown[]) {
      expect(toNum(v || 8)).toBe(8);
    }
    expect(toNum(new DecimalStub('7.5') as unknown)).toBe(7.5);
  });
});
