// ─────────────────────────────────────────────────────────────────────────────
// financialMath — FINANCIAL MATHEMATICS AUDIT spec tests
// ─────────────────────────────────────────────────────────────────────────────
// Verifies the uniform formula chain mandated by the audit:
//   • Line items: base subtotal → line discount → net → VAT (inclusive /
//     exclusive) — HALF_UP 2dp at the line level, zero float drift.
//   • Document aggregation: Σ(lineNet) === docGross EXACTLY (no
//     off-by-one-cent drift).
//   • Payment balances: balanceDue / changeDue clamped at zero.
//   • Inventory valuation: weighted average cost (MAC).
//   • Formatting: canonical en-KE KES + quantity renderers.
// Pure unit tests — no database, no network.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  toDec,
  toNum,
  round2,
  calculateLineItem,
  aggregateDocument,
  balanceDue,
  changeDue,
  weightedAverageCost,
  stockValuation,
  formatKES,
  formatQty,
  formatQtyWithUnit,
  unitLabel,
} from '@/lib/utils/financialMath';

describe('toDec / toNum — the Prisma Decimal bridge', () => {
  it('never concatenates: number + Decimal is FORBIDDEN, toDec().plus() is exact', () => {
    // Regression guard for the audit's Critical finding:
    // `0 + PrismaDecimal` yields "0123.45" (string concat) — toDec never does.
    const prismaLike = new Decimal('123.45');
    expect(toDec(prismaLike).plus(50).toNumber()).toBe(173.45);
    expect(toDec('1,234.50').toNumber()).toBe(1234.5);
    expect(toDec('KES 99.99').toNumber()).toBe(99.99);
  });

  it('normalizes garbage to 0 (NaN, Infinity, null, undefined, junk strings)', () => {
    expect(toDec(NaN).toNumber()).toBe(0);
    expect(toDec(Infinity).toNumber()).toBe(0);
    expect(toDec(null).toNumber()).toBe(0);
    expect(toDec(undefined).toNumber()).toBe(0);
    expect(toDec('').toNumber()).toBe(0);
    expect(toDec('abc').toNumber()).toBe(0);
    expect(toNum('12.5')).toBe(12.5);
  });
});

describe('round2 — strict HALF_UP policy at 2dp', () => {
  it('rounds exact halves UP (0.005 → 0.01, 1.005 → 1.01)', () => {
    expect(round2(0.005)).toBe(0.01);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(new Decimal('2.675'))).toBe(2.68); // float 2.675 is 2.67499… — string input is exact
  });

  it('never produces float dust', () => {
    // The classic IEEE-754 failure the audit bans.
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(toDec(0.1).plus(0.2))).toBe(0.3);
  });
});

describe('calculateLineItem — VAT-INCLUSIVE (POS retail default)', () => {
  it('extracts VAT from the shelf price: 116 gross → 100 net + 16 VAT', () => {
    const line = calculateLineItem(1, 116, 0, true, 16);
    expect(line.subtotal).toBe(116);
    expect(line.netTotal).toBe(116);
    expect(line.netExclVat).toBe(100);
    expect(line.vatAmount).toBe(16);
    expect(line.lineGrossTotal).toBe(116); // customer pays the shelf price
  });

  it('fractional quantity (2.5 m timber) with no float drift', () => {
    const line = calculateLineItem(2.5, 460, 0, true, 16);
    expect(line.subtotal).toBe(1150);
    // 1150 / 1.16 = 991.37931… → 991.38 net, VAT 158.62
    expect(line.netExclVat).toBe(991.38);
    expect(line.vatAmount).toBe(158.62);
    expect(line.netExclVat + line.vatAmount).toBe(1150); // exact recomposition
  });

  it('line discount applies before VAT extraction (5% on 1,160 → 1,102 → 950 + 152)', () => {
    const line = calculateLineItem(1, 1160, 5, true, 16);
    expect(line.discountAmount).toBe(58);
    expect(line.netTotal).toBe(1102);
    expect(line.netExclVat).toBe(950);
    expect(line.vatAmount).toBe(152);
  });

  it('exempt lines (taxRate 0) carry zero VAT and gross == net', () => {
    const line = calculateLineItem(3, 200, 0, true, 0);
    expect(line.vatAmount).toBe(0);
    expect(line.netExclVat).toBe(600);
    expect(line.lineGrossTotal).toBe(600);
  });
});

describe('calculateLineItem — VAT-EXCLUSIVE (B2B / wholesale POs)', () => {
  it('adds VAT on top: 1000 net → 160 VAT → 1160 gross', () => {
    const line = calculateLineItem(1, 1000, 0, false, 16);
    expect(line.subtotal).toBe(1000);
    expect(line.netExclVat).toBe(1000);
    expect(line.vatAmount).toBe(160);
    expect(line.lineGrossTotal).toBe(1160);
  });

  it('PO-style: 12.5 units × 80.00 net + 16% = 1160 gross', () => {
    const line = calculateLineItem(12.5, 80, 0, false, 16);
    expect(line.subtotal).toBe(1000);
    expect(line.vatAmount).toBe(160);
    expect(line.lineGrossTotal).toBe(1160);
  });
});

describe('aggregateDocument — Σ lines === docGross EXACTLY (audit assertion)', () => {
  it('mixed basket aggregates to the cent with fullyConsistent=true', () => {
    const lines = [
      calculateLineItem(3, 150.5, 0, true, 16),   // 451.50 gross
      calculateLineItem(2.5, 460, 5, true, 16),   // 1092.50 gross after 5%
      calculateLineItem(1, 200, 0, true, 0),      // exempt 200
      calculateLineItem(10, 33.333, 10, false, 16), // B2B line
    ];
    const doc = aggregateDocument(lines, 50);
    expect(doc.fullyConsistent).toBe(true);
    // Σ netTotal − docDiscount must equal finalTotalPayable exactly.
    const manual = lines.reduce((a, l) => a + l.netTotal, 0);
    expect(doc.grossSubtotal).toBe(manual); // no drift, ever
    expect(doc.finalTotalPayable).toBe(round2(doc.grossSubtotal - 50));
    // VAT = Σ vatAmount; subtotalExclVat = Σ netExclVat.
    expect(doc.totalVat).toBe(lines.reduce((a, l) => a + l.vatAmount, 0));
    expect(doc.subtotalExclVat).toBe(lines.reduce((a, l) => a + l.netExclVat, 0));
  });

  it('document discount can never push the payable negative', () => {
    const doc = aggregateDocument([calculateLineItem(1, 100)], 999);
    expect(doc.finalTotalPayable).toBe(0);
  });
});

describe('balanceDue / changeDue — payment balances (spec §4)', () => {
  it('Balance Due = max(0, finalTotal − Σ paid)', () => {
    expect(balanceDue(1000, 400, 300, 300)).toBe(0);
    expect(balanceDue(1000, 400)).toBe(600);
    expect(balanceDue(1000, 1200)).toBe(0); // never negative
  });

  it('Change Due = max(0, cash rendered − final total)', () => {
    expect(changeDue(5000, 3725)).toBe(1275);
    expect(changeDue(1000, 1000)).toBe(0);
    expect(changeDue(500, 1000)).toBe(0); // never negative
  });
});

describe('weightedAverageCost — MAC on GRN (spec §5)', () => {
  it('blends existing + received stock: (10×100 + 10×140)/20 = 120', () => {
    const r = weightedAverageCost(10, 100, 10, 140);
    expect(r.newQty).toBe(20);
    expect(r.newAvgCost).toBe(120);
  });

  it('fractional quantities blend exactly (0.5 kg + 2.5 kg @ different costs)', () => {
    const r = weightedAverageCost(0.5, 400, 2.5, 480);
    expect(r.newQty).toBe(3);
    expect(r.newAvgCost).toBe(466.6667); // (200 + 1200) / 3, 4dp HALF_UP
  });

  it('zero existing stock adopts the incoming cost; zero incoming keeps WAC', () => {
    expect(weightedAverageCost(0, 0, 25, 88).newAvgCost).toBe(88);
    expect(weightedAverageCost(40, 55, 0, 999).newAvgCost).toBe(55);
  });

  it('stockValuation = Σ qty × cost (Decimal-exact)', () => {
    expect(stockValuation([
      { quantity: 2.5, costPrice: '460.00' },
      { quantity: new Decimal('10'), costPrice: 99.99 },
    ])).toBe(2149.90);
  });
});

describe('formatKES / formatQty — the ONE canonical renderer', () => {
  it('KES: en-KE style, exactly 2 decimals, ICU NBSP normalized', () => {
    expect(formatKES(1234567.5)).toBe('Ksh 1,234,567.50');
    expect(formatKES(0)).toBe('Ksh 0.00');
    expect(formatKES('1234.56')).toBe('Ksh 1,234.56');
    expect(formatKES(null as unknown as string)).toBe('Ksh 0.00');
    // no narrow/no-break spaces survive (copy-safe in WhatsApp/terminals)
    expect(formatKES(5)).not.toMatch(/[\u00A0\u202F]/);
  });

  it('quantities: integers bare, fractional ≤3dp, no float dust', () => {
    expect(formatQty(12)).toBe('12');
    expect(formatQty(2.5)).toBe('2.50');
    expect(formatQty(0.25)).toBe('0.25');
    expect(formatQty(3.14159)).toBe('3.142'); // 3dp cap
  });

  it('unit labels: smart suppression + no "boxs"/"pcss" pluralization bugs', () => {
    expect(formatQtyWithUnit(2.5, 'M')).toBe('2.50 m');
    expect(formatQtyWithUnit(500, 'PCS')).toBe('500 pcs');
    expect(formatQtyWithUnit(3, 'EA')).toBe('3'); // generic unit suppressed
    expect(unitLabel('BOX')).toBe('box');
    expect(unitLabel('KG')).toBe('kg');
  });
});
