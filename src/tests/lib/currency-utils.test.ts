// ─────────────────────────────────────────────────────────────────────────────
// Currency utilities tests
// ─────────────────────────────────────────────────────────────────────────────
//
// Pure-logic tests for:
//   • formatCurrency — display formatting for KES, USD, UGX, TZS
//   • convertCurrency — cross-currency conversion (static rates)
//   • parseCurrencyInput — user-input parsing
//   • getCurrencyByCountry — country → currency code lookup
//   • SUPPORTED_CURRENCIES / CURRENCY_BY_CODE metadata
//   • Money class — formatting (formatKES, formatCompact) with different currencies
//
// No database required — all tests are pure arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  formatCurrency,
  convertCurrency,
  parseCurrencyInput,
  getCurrencyByCountry,
  SUPPORTED_CURRENCIES,
  CURRENCY_BY_CODE,
  CURRENCY_CODES,
} from '@/lib/currency-utils';
import { Money, KES, currencyDecimals, type CurrencyCode } from '@/lib/money';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Currency metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('Currency metadata', () => {
  it('SUPPORTED_CURRENCIES has 4 entries', () => {
    expect(SUPPORTED_CURRENCIES).toHaveLength(4);
  });

  it('includes KES, USD, UGX, TZS', () => {
    const codes = SUPPORTED_CURRENCIES.map((c) => c.code);
    expect(codes).toContain('KES');
    expect(codes).toContain('USD');
    expect(codes).toContain('UGX');
    expect(codes).toContain('TZS');
  });

  it('CURRENCY_BY_CODE has all 4 currencies', () => {
    expect(CURRENCY_BY_CODE.KES).toBeDefined();
    expect(CURRENCY_BY_CODE.USD).toBeDefined();
    expect(CURRENCY_BY_CODE.UGX).toBeDefined();
    expect(CURRENCY_BY_CODE.TZS).toBeDefined();
  });

  it('CURRENCY_CODES lists codes only', () => {
    expect(CURRENCY_CODES).toEqual(['KES', 'USD', 'UGX', 'TZS']);
  });

  it('KES has exchangeRateToKES = 1 (base currency)', () => {
    expect(CURRENCY_BY_CODE.KES.exchangeRateToKES).toBe(1);
  });

  it('KES and USD have 2 decimal places', () => {
    expect(CURRENCY_BY_CODE.KES.decimals).toBe(2);
    expect(CURRENCY_BY_CODE.USD.decimals).toBe(2);
  });

  it('UGX and TZS have 0 decimal places', () => {
    expect(CURRENCY_BY_CODE.UGX.decimals).toBe(0);
    expect(CURRENCY_BY_CODE.TZS.decimals).toBe(0);
  });

  it('each currency has non-empty symbol, name, and flag', () => {
    for (const c of SUPPORTED_CURRENCIES) {
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.flag.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. formatCurrency — KES
// ─────────────────────────────────────────────────────────────────────────────

describe('formatCurrency — KES', () => {
  it('formats a simple amount with Ksh prefix and 2 decimals', () => {
    expect(formatCurrency(1234, 'KES')).toBe('Ksh 1,234.00');
  });

  it('formats zero', () => {
    expect(formatCurrency(0, 'KES')).toBe('Ksh 0.00');
  });

  it('formats amounts > 1,000,000 with commas', () => {
    expect(formatCurrency(1234567, 'KES')).toBe('Ksh 1,234,567.00');
  });

  it('formats amounts with cents', () => {
    expect(formatCurrency(99.99, 'KES')).toBe('Ksh 99.99');
    expect(formatCurrency(0.50, 'KES')).toBe('Ksh 0.50');
  });

  it('accepts string input', () => {
    expect(formatCurrency('1234.56', 'KES')).toBe('Ksh 1,234.56');
  });

  it('accepts Decimal input', () => {
    expect(formatCurrency(new Decimal('1234.56'), 'KES')).toBe('Ksh 1,234.56');
  });

  it('formats null as zero', () => {
    expect(formatCurrency(null, 'KES')).toBe('Ksh 0.00');
  });

  it('formats undefined as zero', () => {
    expect(formatCurrency(undefined, 'KES')).toBe('Ksh 0.00');
  });

  it('defaults to KES when no currency specified', () => {
    expect(formatCurrency(500)).toBe('Ksh 500.00');
  });

  it('strips currency prefix from string input', () => {
    expect(formatCurrency('KES 1,234.50', 'KES')).toBe('Ksh 1,234.50');
    expect(formatCurrency('Ksh 999', 'KES')).toBe('Ksh 999.00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. formatCurrency — USD
// ─────────────────────────────────────────────────────────────────────────────

describe('formatCurrency — USD', () => {
  it('formats USD with $ prefix and 2 decimals', () => {
    expect(formatCurrency(100, 'USD')).toBe('$ 100.00');
  });

  it('formats large USD amounts with commas', () => {
    expect(formatCurrency(50000, 'USD')).toBe('$ 50,000.00');
  });

  it('formats zero USD', () => {
    expect(formatCurrency(0, 'USD')).toBe('$ 0.00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. formatCurrency — UGX and TZS (0 decimals)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatCurrency — UGX (0 decimals)', () => {
  it('formats UGX with no decimal places', () => {
    expect(formatCurrency(50000, 'UGX')).toBe('USh 50,000');
  });

  it('rounds UGX with banker\'s rounding (HALF_EVEN)', () => {
    // 50000.50 → 50000 (0 is even, so 0.5 rounds down to even)
    expect(formatCurrency(50000.50, 'UGX')).toBe('USh 50,000');
    expect(formatCurrency(50000.49, 'UGX')).toBe('USh 50,000');
    // 50001.50 → 50002 (2 is even)
    expect(formatCurrency(50001.50, 'UGX')).toBe('USh 50,002');
  });

  it('formats zero UGX', () => {
    expect(formatCurrency(0, 'UGX')).toBe('USh 0');
  });
});

describe('formatCurrency — TZS (0 decimals)', () => {
  it('formats TZS with no decimal places', () => {
    expect(formatCurrency(15000, 'TZS')).toBe('TSh 15,000');
  });

  it('formats zero TZS', () => {
    expect(formatCurrency(0, 'TZS')).toBe('TSh 0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. formatCurrency — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('formatCurrency — edge cases', () => {
  it('handles NaN by formatting as zero', () => {
    expect(formatCurrency(NaN, 'KES')).toBe('Ksh 0.00');
  });

  it('handles Infinity by formatting as zero', () => {
    expect(formatCurrency(Infinity, 'KES')).toBe('Ksh 0.00');
  });

  it('handles negative amounts', () => {
    expect(formatCurrency(-100, 'KES')).toBe('Ksh -100.00');
  });

  it('handles very small amounts', () => {
    expect(formatCurrency(0.01, 'KES')).toBe('Ksh 0.01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. convertCurrency
// ─────────────────────────────────────────────────────────────────────────────

describe('convertCurrency', () => {
  it('same currency returns same amount', () => {
    expect(convertCurrency(100, 'KES', 'KES')).toBe(100);
    expect(convertCurrency(100, 'USD', 'USD')).toBe(100);
  });

  it('converts USD to KES (1 USD ≈ 152 KES)', () => {
    const result = convertCurrency(100, 'USD', 'KES');
    expect(result).toBe(15200);
  });

  it('converts KES to USD', () => {
    const result = convertCurrency(15200, 'KES', 'USD');
    expect(result).toBe(100);
  });

  it('converts KES to UGX', () => {
    // 1 KES = 1/0.024 UGX ≈ 41.67
    const result = convertCurrency(1000, 'KES', 'UGX');
    // 1000 / 0.024 ≈ 41666.67 → rounded to 0 decimals = 41667
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(40000);
    expect(result).toBeLessThan(50000);
  });

  it('converts KES to TZS', () => {
    // 1 KES = 1/0.065 TZS ≈ 15.38
    const result = convertCurrency(1000, 'KES', 'TZS');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(10000);
    expect(result).toBeLessThan(20000);
  });

  it('returns 0 for unknown currency codes', () => {
    // @ts-expect-error — testing invalid input
    expect(convertCurrency(100, 'KES', 'XYZ')).toBe(0);
    // @ts-expect-error — testing invalid input
    expect(convertCurrency(100, 'XYZ', 'KES')).toBe(0);
  });

  it('handles null amount as zero', () => {
    expect(convertCurrency(null, 'KES', 'USD')).toBe(0);
  });

  it('handles undefined amount as zero', () => {
    expect(convertCurrency(undefined, 'KES', 'USD')).toBe(0);
  });

  it('accepts string amounts', () => {
    expect(convertCurrency('100', 'USD', 'KES')).toBe(15200);
  });

  it('accepts Decimal amounts', () => {
    const result = convertCurrency(new Decimal('100'), 'USD', 'KES');
    expect(result).toBe(15200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. parseCurrencyInput
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCurrencyInput', () => {
  it('parses a plain number string', () => {
    expect(parseCurrencyInput('1234')).toBe(1234);
    expect(parseCurrencyInput('1234.56')).toBe(1234.56);
  });

  it('parses comma-grouped strings', () => {
    expect(parseCurrencyInput('1,234.56')).toBe(1234.56);
    expect(parseCurrencyInput('1,234,567')).toBe(1234567);
  });

  it('parses currency-prefixed strings', () => {
    expect(parseCurrencyInput('Ksh 1,234.50')).toBe(1234.5);
    expect(parseCurrencyInput('$50')).toBe(50);
    expect(parseCurrencyInput('USD 100')).toBe(100);
  });

  it('returns null for unparseable strings', () => {
    expect(parseCurrencyInput('abc')).toBeNull();
    expect(parseCurrencyInput('')).toBeNull();
    expect(parseCurrencyInput('$')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseCurrencyInput(null)).toBeNull();
    expect(parseCurrencyInput(undefined)).toBeNull();
  });

  it('passes through finite numbers', () => {
    expect(parseCurrencyInput(99.99)).toBe(99.99);
    expect(parseCurrencyInput(0)).toBe(0);
  });

  it('returns null for non-finite numbers', () => {
    expect(parseCurrencyInput(NaN)).toBeNull();
    expect(parseCurrencyInput(Infinity)).toBeNull();
  });

  it('rejects strings with non-numeric characters', () => {
    expect(parseCurrencyInput('12abc')).toBeNull();
    expect(parseCurrencyInput('12.34.56')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. getCurrencyByCountry
// ─────────────────────────────────────────────────────────────────────────────

describe('getCurrencyByCountry', () => {
  it('maps KE → KES', () => {
    expect(getCurrencyByCountry('KE')).toBe('KES');
    expect(getCurrencyByCountry('ke')).toBe('KES');
  });

  it('maps UG → UGX', () => {
    expect(getCurrencyByCountry('UG')).toBe('UGX');
  });

  it('maps TZ → TZS', () => {
    expect(getCurrencyByCountry('TZ')).toBe('TZS');
  });

  it('maps US → USD', () => {
    expect(getCurrencyByCountry('US')).toBe('USD');
  });

  it('defaults to KES for unknown countries', () => {
    expect(getCurrencyByCountry('XX')).toBe('KES');
    expect(getCurrencyByCountry('')).toBe('KES');
  });

  it('handles null/undefined gracefully', () => {
    expect(getCurrencyByCountry(null as unknown as string)).toBe('KES');
    expect(getCurrencyByCountry(undefined as unknown as string)).toBe('KES');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Money class — formatKES with different currencies
// ─────────────────────────────────────────────────────────────────────────────

describe('Money.formatKES — multi-currency', () => {
  it('KES format includes Ksh prefix', () => {
    expect(KES(1234567.5).formatKES()).toBe('Ksh 1,234,567.50');
  });

  it('USD format includes USD prefix', () => {
    const usd = new Money(1234.56, 'USD');
    expect(usd.formatKES()).toContain('USD ');
    expect(usd.formatKES()).toContain('1,234.56');
  });

  it('UGX format has no decimals', () => {
    const ugx = new Money(50000.7, 'UGX');
    const formatted = ugx.formatKES();
    expect(formatted).not.toContain('.');
    expect(formatted).toContain('50,001');
  });

  it('TZS format has no decimals', () => {
    const tzs = new Money(15000.3, 'TZS');
    const formatted = tzs.formatKES();
    expect(formatted).not.toContain('.');
  });

  it('currencyDecimals matches currency-utils metadata', () => {
    for (const code of CURRENCY_CODES as CurrencyCode[]) {
      expect(currencyDecimals(code)).toBe(CURRENCY_BY_CODE[code].decimals);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Rounding behavior — banker's rounding with Decimal
// ─────────────────────────────────────────────────────────────────────────────

describe('Rounding behavior', () => {
  it('formatCurrency rounds 0.5 to nearest even (banker\'s rounding)', () => {
    // 0.005 → 0.00 (0 is even)
    expect(formatCurrency(0.005, 'KES')).toBe('Ksh 0.00');
    // 0.015 → 0.02 (2 is even)
    expect(formatCurrency(0.015, 'KES')).toBe('Ksh 0.02');
    // 0.025 → 0.02 (2 is even)
    expect(formatCurrency(0.025, 'KES')).toBe('Ksh 0.02');
    // 0.035 → 0.04 (4 is even)
    expect(formatCurrency(0.035, 'KES')).toBe('Ksh 0.04');
  });

  it('convertCurrency rounds to target currency\'s precision', () => {
    // UGX has 0 decimals — result should be an integer
    const ugx = convertCurrency(1, 'KES', 'UGX');
    expect(Number.isInteger(ugx)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Money.formatCompact
// ─────────────────────────────────────────────────────────────────────────────

describe('Money.formatCompact', () => {
  it('formats millions with M suffix', () => {
    expect(KES(1500000).formatCompact()).toContain('1.5M');
  });

  it('formats thousands with K suffix', () => {
    expect(KES(50000).formatCompact()).toContain('50.0K');
  });

  it('formats small amounts without suffix', () => {
    expect(KES(500).formatCompact()).toContain('500');
  });

  it('formats zero', () => {
    expect(KES(0).formatCompact()).toContain('0');
  });

  it('handles negative amounts', () => {
    const formatted = KES(-1500000).formatCompact();
    expect(formatted).toContain('-');
    expect(formatted).toContain('1.5M');
  });
});
