// Unit tests for the v2.14.0 receipt-rendering formatting helpers.
//
// Spec contracts under test:
//   1. MONEY NEVER WRAPS  - splitKES() splits the ONE canonical KES formatter
//      output into a currency prefix + numeric value so templates can render
//      right-aligned, tabular-numeral money cells and drop the per-line
//      "Ksh" prefix below 480px (currency is stated in the column headers).
//   2. UNITS - abbreviateUnit() gives the lowercase abbreviated on-screen
//      unit ("1 pc", "1 bag", "1 kg"); fullUnitLabel() gives the full word
//      used by print/PDF ("1 piece", "1 bag", "1 kilogram").
//   3. PDF FILENAME - buildReceiptFileName() returns the bare receipt number
//      ("MBM-20261007-9D042"), sanitized for every filesystem.
//   4. Quantities stay exact (2.5 -> "2.5", 3 -> "3", never float dust).
//
// All helpers are DOM-free and side-effect-free - pure vitest, no DB.
import { describe, it, expect } from 'vitest';
import {
  abbreviateUnit,
  buildReceiptFileName,
  formatReceiptQuantity,
  fullUnitLabel,
  RECEIPT_TABLE_COL_WIDTHS,
  splitKES,
} from '@/lib/receipt-format';
import { formatKES } from '@/lib/utils/financialMath';

describe('receipt money formatting (splitKES)', () => {
  it('splits the canonical formatter output into currency + value', () => {
    expect(splitKES(93820)).toEqual({ currency: 'Ksh', value: '93,820.00' });
  });

  it('keeps the canonical 2dp HALF_UP rounding of the shared formatter', () => {
    // The VAT component of the Ksh 93,820 demo cart (16% incl.).
    const vat = (93820 * 16) / 116; // 12940.689655...
    expect(splitKES(vat).value).toBe('12,940.69');
    expect(formatKES(vat)).toBe('Ksh 12,940.69');
  });

  it('formats zero as Ksh 0.00', () => {
    expect(splitKES(0)).toEqual({ currency: 'Ksh', value: '0.00' });
    expect(splitKES(null)).toEqual({ currency: 'Ksh', value: '0.00' });
    expect(splitKES(undefined)).toEqual({ currency: 'Ksh', value: '0.00' });
  });

  it('groups thousands so money strings align in tabular columns', () => {
    expect(splitKES(1234567.5).value).toBe('1,234,567.50');
  });

  it('never emits a value containing whitespace (money cells never wrap)', () => {
    for (const amount of [0, 1.5, 114, 93820, 12940.69, 1234567.89]) {
      expect(splitKES(amount).value).not.toMatch(/\s/);
    }
  });
});

describe('receipt unit abbreviation (on screen)', () => {
  it('renders the spec examples abbreviated and lowercase', () => {
    expect(abbreviateUnit('PIECE')).toBe('pc');
    expect(abbreviateUnit('PCS')).toBe('pc');
    expect(abbreviateUnit('BAG')).toBe('bag');
    expect(abbreviateUnit('BAGS')).toBe('bag');
    expect(abbreviateUnit('KG')).toBe('kg');
  });

  it('treats unitless counts (EA/UNIT/empty) as a bare quantity', () => {
    expect(abbreviateUnit('EA')).toBe('');
    expect(abbreviateUnit('UNIT')).toBe('');
    expect(abbreviateUnit('')).toBe('');
    expect(abbreviateUnit(null)).toBe('');
    expect(abbreviateUnit(undefined)).toBe('');
  });

  it('shortens common hardware units', () => {
    expect(abbreviateUnit('M')).toBe('m');
    expect(abbreviateUnit('METRES')).toBe('m');
    expect(abbreviateUnit('LITRE')).toBe('l');
    expect(abbreviateUnit('ROLL')).toBe('roll');
    expect(abbreviateUnit('KILOGRAMS')).toBe('kg');
  });

  it('falls back to a lowercase token for unknown units', () => {
    expect(abbreviateUnit('Gauge')).toBe('gauge');
  });
});

describe('receipt full unit words (print/PDF)', () => {
  it('expands abbreviations to full words', () => {
    expect(fullUnitLabel('PCS')).toBe('piece');
    expect(fullUnitLabel('BAG')).toBe('bag');
    expect(fullUnitLabel('KG')).toBe('kilogram');
    expect(fullUnitLabel('M')).toBe('metre');
    expect(fullUnitLabel('LITRE')).toBe('litre');
  });

  it('uses "each" for unitless counts on paper', () => {
    expect(fullUnitLabel('EA')).toBe('each');
    expect(fullUnitLabel('UNIT')).toBe('each');
  });

  it('stays empty when the item carries no unit at all', () => {
    expect(fullUnitLabel('')).toBe('');
    expect(fullUnitLabel(null)).toBe('');
  });
});

describe('receipt quantity formatting', () => {
  it('keeps integers bare', () => {
    expect(formatReceiptQuantity(3)).toBe('3');
    expect(formatReceiptQuantity(180)).toBe('180');
  });

  it('keeps fractional hardware quantities exact', () => {
    expect(formatReceiptQuantity(2.5)).toBe('2.5');
    expect(formatReceiptQuantity(0.5)).toBe('0.5');
    expect(formatReceiptQuantity(1.125)).toBe('1.125');
  });

  it('never emits float dust', () => {
    expect(formatReceiptQuantity(0.1 + 0.2)).toBe('0.3');
  });
});

describe('receipt PDF filename (v2.14.0: bare receipt number)', () => {
  it('uses the receipt number as the filename', () => {
    expect(buildReceiptFileName('MBM-20261007-9D042')).toBe('MBM-20261007-9D042');
  });

  it('falls back to the transaction id, then "transaction"', () => {
    expect(buildReceiptFileName(null, 'txn_abc123')).toBe('txn_abc123');
    expect(buildReceiptFileName(undefined, undefined)).toBe('transaction');
  });

  it('sanitizes filesystem-unsafe characters', () => {
    expect(buildReceiptFileName('MBM/001: X')).toBe('MBM-001-X');
  });

  it('survives empty-ish inputs', () => {
    expect(buildReceiptFileName('///')).toBe('transaction');
  });
});

describe('receipt table geometry (fixed layout)', () => {
  it('declares the spec column widths 38/18/22/22 percent', () => {
    expect(RECEIPT_TABLE_COL_WIDTHS).toEqual({ item: 38, qty: 18, price: 22, total: 22 });
    expect(
      RECEIPT_TABLE_COL_WIDTHS.item +
        RECEIPT_TABLE_COL_WIDTHS.qty +
        RECEIPT_TABLE_COL_WIDTHS.price +
        RECEIPT_TABLE_COL_WIDTHS.total,
    ).toBe(100);
  });
});
