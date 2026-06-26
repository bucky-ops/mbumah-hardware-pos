// ─────────────────────────────────────────────────────────────────────────────
// Money class unit tests
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests verify the financial-correctness guarantees of the Money class:
//   • No floating-point drift on add / subtract / multiply
//   • Banker's rounding (HALF_EVEN) — GAAP / IFRS standard
//   • Exact allocation (no lost or created pennies)
//   • Safe parsing of user input (no throws on bad input)
//   • Currency enforcement (cannot add KES + USD)
//
// These are PURE unit tests — no database, no network. They run in < 100ms.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { Money, KES, toKES, toPrisma, currencyDecimals } from '@/lib/money';
import Decimal from 'decimal.js';

describe('Money — construction', () => {
  it('KES() factory creates a Money with KES currency', () => {
    const m = KES(500);
    expect(m.currency).toBe('KES');
    expect(m.toNumber()).toBe(500);
  });

  it('Money.zero() creates a zero-value Money', () => {
    const z = Money.zero();
    expect(z.isZero()).toBe(true);
    expect(z.currency).toBe('KES');
  });

  it('Money.fromNumber throws on NaN / Infinity', () => {
    expect(() => Money.fromNumber(NaN)).toThrow(RangeError);
    expect(() => Money.fromNumber(Infinity)).toThrow(RangeError);
    expect(() => Money.fromNumber(-Infinity)).toThrow(RangeError);
  });

  it('Money.fromString parses plain, comma-grouped, and KES-prefixed strings', () => {
    expect(Money.fromString('1234.56').toNumber()).toBe(1234.56);
    expect(Money.fromString('1,234.56').toNumber()).toBe(1234.56);
    expect(Money.fromString('Ksh 1,234.56').toNumber()).toBe(1234.56);
    expect(Money.fromString('KES 1234').toNumber()).toBe(1234);
  });

  it('Money.fromString throws on unparseable input', () => {
    expect(() => Money.fromString('not a number')).toThrow();
    expect(() => Money.fromString('')).toThrow();
  });

  it('Money.fromPrisma returns zero for null/undefined', () => {
    expect(Money.fromPrisma(null).isZero()).toBe(true);
    expect(Money.fromPrisma(undefined).isZero()).toBe(true);
  });

  it('Money.fromPrisma accepts Decimal, string, and number', () => {
    expect(Money.fromPrisma(new Decimal('99.99')).toNumber()).toBe(99.99);
    expect(Money.fromPrisma('99.99').toNumber()).toBe(99.99);
    expect(Money.fromPrisma(99.99).toNumber()).toBe(99.99);
  });

  it('Money.tryParse returns null on bad input (never throws)', () => {
    expect(Money.tryParse('not a number')).toBeNull();
    expect(Money.tryParse('')).toBeNull();
    expect(Money.tryParse(null)).toBeNull();
    expect(Money.tryParse(undefined)).toBeNull();
  });

  it('Money.tryParse succeeds on valid input', () => {
    const m = Money.tryParse('1,234.50');
    expect(m).not.toBeNull();
    expect(m!.toNumber()).toBe(1234.5);
  });
});

describe('Money — arithmetic (no floating-point drift)', () => {
  it('0.1 + 0.2 === 0.3 (NOT 0.30000000000000004)', () => {
    // This is the classic IEEE-754 bug that the Money class exists to fix.
    const result = KES(0.1).add(KES(0.2));
    expect(result.toNumber()).toBe(0.3);
    expect(result.eq(KES(0.3))).toBe(true);
  });

  it('0.1 * 3 === 0.3 (NOT 0.30000000000000004)', () => {
    const result = KES(0.1).multiply(3);
    expect(result.toNumber()).toBe(0.3);
  });

  it('add accumulates without drift over 1000 operations', () => {
    let sum = Money.zero();
    for (let i = 0; i < 1000; i++) {
      sum = sum.add(KES(0.1));
    }
    expect(sum.toNumber()).toBe(100);
  });

  it('subtract works correctly', () => {
    expect(KES(1000).subtract(KES(250)).toNumber()).toBe(750);
    expect(KES(100).subtract(KES(100)).isZero()).toBe(true);
    expect(KES(50).subtract(KES(100)).isNegative()).toBe(true);
  });

  it('multiply by a scalar (quantity)', () => {
    expect(KES(500).multiply(3).toNumber()).toBe(1500);
    expect(KES(100).multiply(0).toNumber()).toBe(0);
  });

  it('divide by a scalar', () => {
    expect(KES(1000).divide(4).toNumber()).toBe(250);
    expect(() => KES(100).divide(0)).toThrow(RangeError);
  });

  it('negate and abs', () => {
    expect(KES(100).negate().toNumber()).toBe(-100);
    expect(KES(-50).abs().toNumber()).toBe(50);
    expect(KES(50).abs().toNumber()).toBe(50);
  });
});

describe('Money — rounding (banker\'s rounding / HALF_EVEN)', () => {
  it('rounds 0.005 to 0.00 (HALF_EVEN, not HALF_UP)', () => {
    // Banker's rounding rounds to the nearest EVEN number.
    // 0.005 → 0.00 (0 is even), 0.015 → 0.02 (2 is even).
    expect(KES(0.005).round().toNumber()).toBe(0);
  });

  it('rounds 0.015 to 0.02 (HALF_EVEN)', () => {
    expect(KES(0.015).round().toNumber()).toBe(0.02);
  });

  it('rounds 0.025 to 0.02 (HALF_EVEN, NOT 0.03)', () => {
    // This is the key difference from "round half up": 0.025 → 0.02 (even),
    // not 0.03. This prevents the systematic upward bias of HALF_UP.
    expect(KES(0.025).round().toNumber()).toBe(0.02);
  });

  it('rounds 0.035 to 0.04 (HALF_EVEN)', () => {
    expect(KES(0.035).round().toNumber()).toBe(0.04);
  });

  it('applyDiscount uses banker\'s rounding', () => {
    // 1000 - 10% = 900. No rounding needed.
    expect(KES(1000).applyDiscount(10).toNumber()).toBe(900);
    // 999 - 10% = 899.1 → rounds to 899.10
    expect(KES(999).applyDiscount(10).toNumber()).toBeCloseTo(899.1, 2);
  });

  it('applyTax uses banker\'s rounding', () => {
    // 1000 + 16% VAT = 1160
    expect(KES(1000).applyTax(16).toNumber()).toBe(1160);
    // 0% tax is a no-op
    expect(KES(1000).applyTax(0).toNumber()).toBe(1000);
  });

  it('taxComponent extracts the tax from a tax-inclusive amount', () => {
    // 1160 gross at 16% → 160 tax
    expect(KES(1160).taxComponent(16).toNumber()).toBe(160);
  });
});

describe('Money — allocation (exact penny distribution)', () => {
  it('allocate [1,1,1] of 1.00 → [0.34, 0.33, 0.33] (no lost penny)', () => {
    const result = KES(1).allocate([1, 1, 1]);
    expect(result).toHaveLength(3);
    const sum = result.reduce((s, m) => s + m.toNumber(), 0);
    expect(sum).toBeCloseTo(1, 2); // Total is exactly 1.00
    // The first share gets the extra penny (largest remainder).
    expect(result[0].toNumber()).toBeGreaterThan(result[1].toNumber());
  });

  it('allocate preserves the total exactly (no created or lost pennies)', () => {
    const amounts = [100, 333.33, 99.99, 1000];
    for (const amt of amounts) {
      const result = KES(amt).allocate([1, 1, 1, 1, 1]);
      const sum = result.reduce((s, m) => s.add(m), Money.zero());
      expect(sum.eq(KES(amt))).toBe(true);
    }
  });

  it('allocate with uneven ratios', () => {
    // 60/40 split of 100 → 60, 40
    const result = KES(100).allocate([60, 40]);
    expect(result[0].toNumber()).toBe(60);
    expect(result[1].toNumber()).toBe(40);
  });

  it('allocate handles zero ratios gracefully', () => {
    const result = KES(100).allocate([0, 0, 0]);
    expect(result).toHaveLength(3);
    result.forEach((m) => expect(m.isZero()).toBe(true));
  });

  it('allocate of zero amount returns all zeros', () => {
    const result = KES(0).allocate([1, 2, 3]);
    expect(result).toHaveLength(3);
    result.forEach((m) => expect(m.isZero()).toBe(true));
  });
});

describe('Money — comparison', () => {
  it('eq checks value AND currency', () => {
    expect(KES(100).eq(KES(100))).toBe(true);
    expect(KES(100).eq(KES(200))).toBe(false);
  });

  it('gt, gte, lt, lte work correctly', () => {
    expect(KES(200).gt(KES(100))).toBe(true);
    expect(KES(100).gt(KES(200))).toBe(false);
    expect(KES(100).gte(KES(100))).toBe(true);
    expect(KES(100).lt(KES(200))).toBe(true);
    expect(KES(100).lte(KES(100))).toBe(true);
  });

  it('isZero, isPositive, isNegative', () => {
    expect(KES(0).isZero()).toBe(true);
    expect(KES(100).isPositive()).toBe(true);
    expect(KES(-50).isNegative()).toBe(true);
  });

  it('static max and min', () => {
    expect(Money.max(KES(100), KES(200)).toNumber()).toBe(200);
    expect(Money.min(KES(100), KES(200)).toNumber()).toBe(100);
  });

  it('static sum', () => {
    const total = Money.sum([KES(100), KES(200), KES(300)]);
    expect(total.toNumber()).toBe(600);
    expect(Money.sum([]).isZero()).toBe(true);
  });
});

describe('Money — currency handling', () => {
  it('currencyDecimals returns correct precision per currency', () => {
    expect(currencyDecimals('KES')).toBe(2);
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('TZS')).toBe(0); // Tanzanian shilling has no minor unit
    expect(currencyDecimals('UGX')).toBe(0); // Ugandan shilling has no minor unit
  });

  it('adding different currencies should be prevented (coerce throws)', () => {
    const usd = new Money(100, 'USD');
    // The coerce method is called internally by add; cross-currency add
    // throws because it asserts same currency.
    expect(() => KES(100).add(usd)).toThrow();
  });
});

describe('Money — serialization', () => {
  it('toNumber returns a JS number', () => {
    expect(typeof KES(100).toNumber()).toBe('number');
    expect(KES(100).toNumber()).toBe(100);
  });

  it('toDecimal returns a Decimal instance', () => {
    const d = KES(100).toDecimal();
    expect(d).toBeInstanceOf(Decimal);
  });

  it('formatKES produces a human-readable string', () => {
    expect(KES(1000).formatKES()).toMatch(/1,?000/);
    expect(KES(0).formatKES()).toMatch(/0/);
  });

  it('toPrisma converts back to a Decimal for DB writes', () => {
    const d = toPrisma(KES(123.45));
    expect(d).toBeInstanceOf(Decimal);
    expect(d.toNumber()).toBe(123.45);
  });

  it('toKES converts a Prisma Decimal field to a Money', () => {
    const m = toKES(new Decimal('999.99'));
    expect(m.toNumber()).toBe(999.99);
    expect(m.currency).toBe('KES');
  });

  it('round-trip: Money → Prisma → Money preserves value', () => {
    const original = KES(1234.56);
    const prisma = toPrisma(original);
    const restored = toKES(prisma);
    expect(restored.eq(original)).toBe(true);
  });
});

describe('Money — immutability', () => {
  it('add returns a NEW Money (does not mutate)', () => {
    const a = KES(100);
    const b = a.add(KES(50));
    expect(a.toNumber()).toBe(100); // unchanged
    expect(b.toNumber()).toBe(150);
    expect(a).not.toBe(b);
  });

  it('round returns a NEW Money (does not mutate)', () => {
    const a = KES(0.005);
    const b = a.round();
    expect(a.toNumber()).toBe(0.005); // unchanged
    expect(b.toNumber()).toBe(0);
  });

  it('multiply returns a NEW Money (does not mutate)', () => {
    const a = KES(100);
    const b = a.multiply(3);
    expect(a.toNumber()).toBe(100);
    expect(b.toNumber()).toBe(300);
  });
});
