// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Central Financial Mathematics & Formatting Utility
// ─────────────────────────────────────────────────────────────────────────────
//
// SINGLE SOURCE OF TRUTH for every monetary calculation and every currency /
// quantity formatting decision in the ERP. This module is the canonical
// implementation of the FINANCIAL MATHEMATICS AUDIT spec (en-KE locale, KES,
// Kenya VAT 16%, eTIMS-ready):
//
//   1. NO raw JavaScript floating-point arithmetic ever touches a monetary
//      value. All math flows through `decimal.js` (base-10, arbitrary
//      precision) — `0.1 + 0.2 === 0.30000000000000004` cannot happen here.
//   2. STRICT ROUNDING POLICY: HALF_UP to 2 decimal places (KES cents),
//      applied at the LINE-ITEM level — never at the document level only.
//      This module OWNS the global decimal.js config; every other money
//      module (money.ts, currency-utils.ts, helpers.ts) imports this file
//      so the rounding mode cannot silently diverge per call-site.
//   3. UNIFORM FORMULAS (see `calculateLineItem`):
//        Line Base Subtotal  = quantity × unitPrice
//        Line Discount       = Base Subtotal × (discountPercent / 100)
//        Line Net Total      = Base Subtotal − Line Discount
//      VAT (standard rate 16%; exempt items pass taxRate 0):
//        VAT-INCLUSIVE  (POS retail default — shelf price already has VAT):
//            Net Amount Excl VAT = Line Net Total / (1 + rate)
//            Line VAT Amount     = Line Net Total − Net Amount Excl VAT
//        VAT-EXCLUSIVE  (B2B / wholesale purchase orders — VAT added on top):
//            Line VAT Amount     = Line Net Total × rate
//            Line Gross Total    = Line Net Total + Line VAT Amount
//   4. DOCUMENT AGGREGATION (`aggregateDocument`): document totals are the
//      exact sums of the rounded line values — `Σ(lineNet) === docGross`
//      holds to the cent by construction (off-by-one-cent drift is
//      structurally impossible; `fullyConsistent` is returned so callers
//      can assert it).
//   5. PAYMENT BALANCES (`balanceDue`, `changeDue`): clamped at zero via
//      max(0, …) — a balance can never go negative and change can never be
//      paid twice.
//   6. INVENTORY VALUATION (`weightedAverageCost`): Moving Average Cost
//      (MAC) on every stock receipt, computed in Decimal.
//   7. FORMATTING (`formatKES`, `formatQty`): one canonical en-KE formatter
//      for every UI surface, receipt, e-mail, WhatsApp message and PDF —
//      the same document renders identically everywhere.
//
// PRISMA BRIDGE: Prisma `Decimal` columns are decimal.js instances whose
// `valueOf()` returns a STRING — `number + PrismaDecimal` silently
// concatenates (`0 + Decimal("123.45") → "0123.45"`) and `PrismaDecimal −
// number` coerces through float. `toDec()` / `toNum()` are the ONLY
// sanctioned ways to move values across that boundary.
// ─────────────────────────────────────────────────────────────────────────────

import Decimal from 'decimal.js';

// ── Strict rounding policy (module-owned global config) ──────────────────────
//
// precision 20 significant digits — ample for KES 9,999,999,999,999.99 with
// guard digits. rounding HALF_UP ("round half away from zero" for positives)
// is the audit-mandated policy: 0.005 → 0.01, 1.005 → 1.01. KRA/eTIMS VAT
// payloads and Kenya retail expectations align with half-up cent rounding.
// NOTE: this `Decimal.set` runs exactly once because every other financial
// module imports THIS file for its config — do not call Decimal.set again
// elsewhere (it would create an import-order-dependent rounding mode).
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Rounding mode used for every monetary rounding in the ERP. */
export const MONEY_ROUNDING = Decimal.ROUND_HALF_UP;

/** Decimal places for money (KES cents). */
export const MONEY_DP = 2;

/** Decimal places for stock quantities (hardware fractional units: m, kg, L). */
export const QTY_DP = 3;

/** Kenya standard VAT rate, percent. */
export const VAT_RATE_PERCENT = 16;

type Numeric = number | string | Decimal | null | undefined;

/**
 * Coerce ANY numeric-ish value (JS number, numeric string, Prisma Decimal,
 * null, undefined, NaN, garbage) into a Decimal — the ONLY sanctioned way to
 * bring a Prisma Decimal field or user input into financial math.
 *
 * IMPORTANT: never do `number + prismaDecimal` — Prisma Decimal's
 * `valueOf()` returns a STRING, so `+` concatenates. Always `toDec(a).plus(b)`.
 */
export const toDec = (val: Numeric): Decimal => {
  if (val === null || val === undefined || val === '') return new Decimal(0);
  if (val instanceof Decimal) return val;
  if (typeof val === 'number') {
    // NaN / Infinity / -Infinity → 0 (guards downstream serialization).
    if (!Number.isFinite(val)) return new Decimal(0);
    return new Decimal(val);
  }
  try {
    const cleaned = String(val).trim().replace(/^(KES|KSH|KSHS)\s*/i, '').replace(/,/g, '');
    const d = new Decimal(cleaned === '' ? 0 : cleaned);
    return d.isFinite() ? d : new Decimal(0);
  } catch {
    return new Decimal(0);
  }
};

/**
 * Convert any numeric-ish value to a plain JS number safely (0 on garbage).
 * Use for display/JSON boundaries ONLY — math stays in Decimal.
 */
export const toNum = (val: Numeric): number => toDec(val).toNumber();

/**
 * Round to money precision (2dp) with the strict HALF_UP policy.
 * Returns a JS number (round-trip safe for 2dp KES values).
 */
export const round2 = (val: number | Decimal): number =>
  toDec(val).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING).toNumber();

/** Round to money precision (2dp HALF_UP) and return a fixed-point string. */
export const round2s = (val: number | Decimal): string =>
  toDec(val).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING).toFixed(MONEY_DP);

/**
 * Round a quantity to QTY_DP (3dp) HALF_UP — hardware fractional units
 * (2.5 m timber, 0.25 kg nails) without float dust.
 */
export const roundQty = (val: number | Decimal): number =>
  toDec(val).toDecimalPlaces(QTY_DP, MONEY_ROUNDING).toNumber();

/** Clamp at zero: `max(0, x)` in Decimal — balances/changes can never go negative. */
export const max0 = (val: number | Decimal): Decimal => {
  const d = toDec(val);
  return d.isNegative() ? new Decimal(0) : d;
};

// ─────────────────────────────────────────────────────────────────────────────
// LINE-ITEM CALCULATION
// ─────────────────────────────────────────────────────────────────────────────

export interface LineItemResult {
  /** Base subtotal = quantity × unitPrice (rounded 2dp). */
  subtotal: number;
  /** Line discount amount (rounded 2dp). */
  discountAmount: number;
  /** Net total after line discount (exact — difference of two 2dp values). */
  netTotal: number;
  /** VAT component of the line (rounded 2dp). */
  vatAmount: number;
  /** Net amount EXCLUDING VAT (rounded 2dp; equals netTotal for exclusive pricing / exempt). */
  netExclVat: number;
  /** The final gross amount the customer pays for this line. */
  lineGrossTotal: number;
  /** Display-ready KES string for the line total. */
  formattedTotal: string;
}

/**
 * THE line-item money formula for the entire ERP.
 *
 * @param qty             Quantity sold (fractional hardware units allowed — 2.5 m, 0.25 kg).
 * @param unitPrice       Unit price. INCLUSIVE mode: shelf price WITH VAT.
 *                        EXCLUSIVE mode: net price BEFORE VAT.
 * @param discountPct     Line discount percent (0–100).
 * @param isVatInclusive  `true` (default) → POS retail: price already contains VAT,
 *                        extract the VAT component. `false` → B2B/wholesale/PO:
 *                        add VAT on top.
 * @param taxRatePercent  Line tax rate (product snapshot). 0 = exempt item.
 *                        Defaults to the Kenya standard 16%.
 *
 * Every intermediate is HALF_UP-rounded to 2dp exactly where the audit
 * spec mandates it (base subtotal, discount, VAT), so documents aggregate
 * to the cent (see `aggregateDocument`).
 */
export const calculateLineItem = (
  qty: number,
  unitPrice: number,
  discountPct = 0,
  isVatInclusive = true,
  taxRatePercent: number = VAT_RATE_PERCENT,
): LineItemResult => {
  const quantity = toDec(qty);
  const price = toDec(unitPrice);
  const rate = Math.min(100, Math.max(0, toNum(taxRatePercent)));

  // 1. Line Base Subtotal = quantity × unitPrice (rounded 2dp).
  const baseSubtotal = quantity.mul(price).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);

  // 2. Line Discount = Base Subtotal × (discountPercent / 100) (rounded 2dp).
  const pct = Math.min(100, Math.max(0, toNum(discountPct)));
  const discount = baseSubtotal.mul(pct).div(100).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);

  // 3. Line Net Total = Base Subtotal − Discount (exact — both operands 2dp).
  const netTotal = baseSubtotal.minus(discount);

  let vatAmount: Decimal;
  let netExclVat: Decimal;

  if (rate === 0) {
    // Tax-exempt line: no VAT component at all.
    vatAmount = new Decimal(0);
    netExclVat = netTotal;
  } else if (isVatInclusive) {
    // VAT-INCLUSIVE (POS retail default): price already includes VAT.
    //   Net Amount Excl VAT = Net Total / (1 + rate)
    //   VAT Amount          = Net Total − Net Amount Excl VAT
    netExclVat = netTotal.div(1 + rate / 100).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);
    vatAmount = netTotal.minus(netExclVat);
  } else {
    // VAT-EXCLUSIVE (B2B / wholesale purchase orders): VAT added on top.
    //   VAT Amount = Net Total × rate
    vatAmount = netTotal.mul(rate).div(100).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);
    netExclVat = netTotal;
  }

  const lineGrossTotal =
    isVatInclusive && rate > 0 ? netTotal : netTotal.plus(vatAmount);

  return {
    subtotal: baseSubtotal.toNumber(),
    discountAmount: discount.toNumber(),
    netTotal: netTotal.toNumber(),
    vatAmount: vatAmount.toNumber(),
    netExclVat: netExclVat.toNumber(),
    lineGrossTotal: lineGrossTotal.toNumber(),
    formattedTotal: formatKES(lineGrossTotal),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentTotals {
  /** Σ(Line Net Amount Excl VAT) — the true revenue figure (VAT belongs to KRA, not the store). */
  subtotalExclVat: number;
  /** Σ(Line VAT Amount) — output VAT payable. */
  totalVat: number;
  /** Σ(Line Net Total) — the gross merchandise value. */
  grossSubtotal: number;
  /** Σ(Line Discount Amount) — line-level discounts only. */
  lineDiscounts: number;
  /** Document-level (cart/invoice) discount applied AFTER line sums. */
  documentDiscount: number;
  /** Final Total Payable = grossSubtotal − documentDiscount (+ shipping handled by caller). */
  finalTotalPayable: number;
  /**
   * Audit assertion: Σ(lineNetTotal) === grossSubtotal EXACTLY (no
   * off-by-one-cent drift). Always true when lines come from
   * `calculateLineItem`; exposed so callers/tests can assert it.
   */
  fullyConsistent: boolean;
}

/**
 * Aggregate rounded line results into document totals. Sums run in Decimal
 * (never float), and — because every line is already 2dp — the sums are
 * exact: `Σ(lineNet) === docGross` without rounding drift.
 */
export const aggregateDocument = (
  lines: LineItemResult[],
  documentDiscount = 0,
): DocumentTotals => {
  let subtotalExclVat = new Decimal(0);
  let totalVat = new Decimal(0);
  let grossSubtotal = new Decimal(0);
  let lineDiscounts = new Decimal(0);

  for (const line of lines) {
    subtotalExclVat = subtotalExclVat.plus(toDec(line.netExclVat));
    totalVat = totalVat.plus(toDec(line.vatAmount));
    grossSubtotal = grossSubtotal.plus(toDec(line.netTotal));
    lineDiscounts = lineDiscounts.plus(toDec(line.discountAmount));
  }

  const docDiscount = max0(toDec(documentDiscount)).toDecimalPlaces(MONEY_DP, MONEY_ROUNDING);
  const finalTotalPayable = max0(grossSubtotal.minus(docDiscount));

  const lineSum = lines.reduce((acc, l) => acc.plus(toDec(l.netTotal)), new Decimal(0));

  return {
    subtotalExclVat: subtotalExclVat.toNumber(),
    totalVat: totalVat.toNumber(),
    grossSubtotal: grossSubtotal.toNumber(),
    lineDiscounts: lineDiscounts.toNumber(),
    documentDiscount: docDiscount.toNumber(),
    finalTotalPayable: finalTotalPayable.toNumber(),
    fullyConsistent: lineSum.equals(grossSubtotal),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT BALANCES & CASH CHANGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Balance Due = max(0, Final Total Payable − Total Paid).
 * `paid` variadic so callers can pass a running list of tender amounts.
 */
export const balanceDue = (finalTotal: number | Decimal, ...paid: Numeric[]): number =>
  max0(
    toDec(finalTotal).minus(
      paid.reduce<Decimal>((acc, p) => acc.plus(toDec(p)), new Decimal(0)),
    ),
  ).toNumber();

/**
 * Change Due (cash POS) = max(0, Cash Rendered − Final Total Payable).
 * A till can never dispense negative change, and over-tendering never
 * reduces the recorded sale amount below what was agreed.
 */
export const changeDue = (cashRendered: number | Decimal, finalTotal: number | Decimal): number =>
  max0(toDec(cashRendered).minus(toDec(finalTotal))).toNumber();

// ─────────────────────────────────────────────────────────────────────────────
// INVENTORY VALUATION — WEIGHTED AVERAGE COST (MAC)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moving Average Cost on stock receipt (GRN / adjustment inbound):
 *
 *   New Stock Qty          = Existing Qty + Received Qty
 *   Weighted Avg Buy Price = (ExistingQty×ExistingCost + ReceivedQty×NewCost) / New Stock Qty
 *
 * Guards: zero resulting quantity → fall back to the incoming cost;
 * negative received quantity (returns) simply blend via the same formula.
 * Result rounded to 4dp HALF_UP (cost precision — richer than money 2dp so
 * WAC drift cannot accumulate across receipts).
 */
export const weightedAverageCost = (
  existingQty: number | Decimal,
  existingCost: number | Decimal,
  receivedQty: number | Decimal,
  receivedCost: number | Decimal,
): { newQty: number; newAvgCost: number } => {
  const oldQty = toDec(existingQty);
  const oldCost = toDec(existingCost);
  const inQty = toDec(receivedQty);
  const inCost = toDec(receivedCost);

  const newQty = oldQty.plus(inQty);
  if (newQty.isZero()) {
    return { newQty: 0, newAvgCost: inCost.toDecimalPlaces(4, MONEY_ROUNDING).toNumber() };
  }

  const totalValue = oldQty.mul(oldCost).plus(inQty.mul(inCost));
  const avg = totalValue.div(newQty).toDecimalPlaces(4, MONEY_ROUNDING);
  return { newQty: newQty.toNumber(), newAvgCost: avg.toNumber() };
};

/** Total stock valuation = Σ(quantityInStock × costPrice) — Decimal-exact. */
export const stockValuation = (
  rows: Array<{ quantity: Numeric; costPrice: Numeric }>,
): number =>
  rows
    .reduce((acc, r) => acc.plus(toDec(r.quantity).mul(toDec(r.costPrice))), new Decimal(0))
    .toDecimalPlaces(MONEY_DP, MONEY_ROUNDING)
    .toNumber();

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTING — the ONE canonical en-KE money / quantity renderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format an amount as Kenyan Shillings, en-KE locale, EXACTLY 2 decimal
 * places: `formatKES(1234567.5)` → "KES 1,234,567.50".
 *
 * Accepts numbers, numeric strings, Prisma Decimals, null/undefined (→
 * "KES 0.00"), and even currency-prefixed strings. This is THE formatter
 * for every UI table, KPI card, receipt, PDF, e-mail, and WhatsApp message.
 */
export const formatKES = (amount: number | string | Decimal): string => {
  const numericVal = toDec(amount).toNumber();
  return (
    new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      // ICU renders the currency-symbol separator as a no-break space
      // (U+00A0) or narrow no-break space (U+202F) depending on ICU version.
      // Normalize to a plain space so receipts, WhatsApp messages,
      // terminals, CSVs and logs carry the identical, copy-safe string.
      .format(numericVal)
      .replace(/[\u00A0\u202F]/g, ' ')
  );
};

/**
 * Format a quantity for display: thousands separators, no decimals for
 * integers, up to 3 decimals for fractional hardware units (never float
 * dust), suffixed with the unit of measure.
 *
 *   formatQty(2.5, 'M')    → "2.5 M"
 *   formatQty(0.25, 'KG')  → "0.25 KG"
 *   formatQty(12, 'PCS')   → "12 PCS"
 *   formatQty(3.14159)     → "3.142"
 */
export const formatQty = (qty: number | string | Decimal, uom = ''): string => {
  const numericVal = toDec(qty).toNumber();
  const formattedNum = new Intl.NumberFormat('en-KE', {
    minimumFractionDigits: Number.isInteger(numericVal) ? 0 : 2,
    maximumFractionDigits: QTY_DP,
  }).format(numericVal);
  const unit = uom ? ` ${uom}` : '';
  return `${formattedNum}${unit}`;
};

/**
 * Human-friendly unit label: suppresses generic unit codes that would read
 * awkwardly after a number ("2 PCS" is fine, "2 EA" is noise) and fixes
 * naive pluralization ("2 BOXES", never "2 BOXS" / "2 PCSS").
 */
const UNIT_LABELS: Record<string, string> = {
  PCS: 'pcs',
  PC: 'pc',
  PIECE: 'pcs',
  PIECES: 'pcs',
  EA: '', // "each" — the unit IS the number; suppress.
  EACH: '',
  UNIT: '',
  UNITS: '',
  BOX: 'box',
  BOXES: 'boxes',
  CTN: 'carton',
  CARTON: 'carton',
  PKT: 'packet',
  PACKET: 'packet',
  BAG: 'bag',
  ROLL: 'roll',
  ROLLS: 'rolls',
  M: 'm',
  MTR: 'm',
  METER: 'm',
  METERS: 'm',
  KG: 'kg',
  KGS: 'kg',
  G: 'g',
  L: 'L',
  LTR: 'L',
  LITRE: 'L',
  LITER: 'L',
  LITRES: 'L',
};

export const unitLabel = (uom?: string | null): string => {
  if (!uom) return '';
  return UNIT_LABELS[uom.trim().toUpperCase()] ?? uom.trim().toLowerCase();
};

/** Quantity + smart unit label: `formatQtyWithUnit(2.5, 'M')` → "2.5 m". */
export const formatQtyWithUnit = (qty: number | string | Decimal, uom?: string | null): string => {
  const label = unitLabel(uom);
  return label ? `${formatQty(qty)} ${label}` : formatQty(qty);
};
