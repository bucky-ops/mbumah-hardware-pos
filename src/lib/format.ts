import Decimal from "decimal.js";
import type { CartLine, CartTotals, ReceiptLine } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Financial math core — ALL money arithmetic MUST go through Decimal.js.
// Never use native float math on money (0.1 + 0.2 !== 0.3, price * 1.16 drift).
// Rounding policy: ROUND_HALF_UP to 2dp at the LINE level (Kenya eTIMS),
// then exact summation for document totals (no per-total re-rounding drift).
// ─────────────────────────────────────────────────────────────────────────────

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Safe Decimal constructor for number | string | Decimal | Prisma Decimal. */
export function D(value: unknown): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === "object" && value !== null && "toDecimalPlaces" in (value as object)) {
    return new Decimal((value as Decimal).toString());
  }
  return new Decimal(value as number | string);
}

/** Round half-up to 2 decimal places → number. */
export function round2(value: number | string | Decimal): number {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** Round half-up to 3 decimal places (fractional stock qty: kg, feet, litres). */
export function round3(value: number | string | Decimal): number {
  return D(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
}

const kesFormatter = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** KES currency formatting for every UI surface / receipt. */
export function formatKES(amount: number | string | Decimal): string {
  return kesFormatter.format(D(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber());
}

/** Quantity formatting: integers render bare, fractions get 2–3dp + unit. */
export function formatQty(qty: number | string | Decimal, uom = "PCS"): string {
  const n = D(qty).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toNumber();
  const formatted = new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 3,
  }).format(n);
  return `${formatted} ${uom}`;
}

export const VAT_RATE = new Decimal("0.16"); // Kenya standard rate 16%
export const VAT_DIVISOR = new Decimal("1.16");

export interface LineMath {
  base: number; // qty × unitPrice
  discount: number; // line-level discount amount (half-up 2dp)
  net: number; // base − discount
  vat: number; // line-level VAT (half-up 2dp)
  netExcl: number; // net − vat (inclusive) — exclusive: net − net*0.16
  total: number; // amount payable for the line (tax-inclusive basis)
}

/**
 * Line-item math. Discount is applied BEFORE VAT (eTIMS-compliant).
 *  - Inclusive (POS retail default): NetExcl = Net / 1.16, VAT = Net − NetExcl
 *  - Exclusive (B2B/quote):          VAT = Net × 0.16, Total = Net + VAT
 * Tax-exempt lines carry 0 VAT in both modes.
 */
export function computeLine(
  qty: number | string | Decimal,
  unitPrice: number | string | Decimal,
  discountPct = 0,
  opts: { vatInclusive?: boolean; taxExempt?: boolean } = {}
): LineMath {
  const { vatInclusive = true, taxExempt = false } = opts;
  const base = D(qty).mul(D(unitPrice));
  const discount = base.mul(D(discountPct).div(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const net = base.sub(discount);

  if (taxExempt) {
    return { base: base.toNumber(), discount: discount.toNumber(), net: net.toNumber(), vat: 0, netExcl: net.toNumber(), total: net.toNumber() };
  }

  if (vatInclusive) {
    const netExcl = net.div(VAT_DIVISOR).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const vat = net.sub(netExcl).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return { base: base.toNumber(), discount: discount.toNumber(), net: net.toNumber(), vat: vat.toNumber(), netExcl: netExcl.toNumber(), total: net.toNumber() };
  }
  const vat = net.mul(VAT_RATE).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const total = net.add(vat).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { base: base.toNumber(), discount: discount.toNumber(), net: net.toNumber(), vat: vat.toNumber(), netExcl: net.toNumber(), total: total.toNumber() };
}

export interface CartComputation {
  lines: LineMath[];
  totals: CartTotals;
}

/**
 * Document-level roll-up with the exact-sum assertion property:
 * grandTotal === Σ(line.total) and vat === Σ(line.vat) exactly —
 * all rounding happens per-line (2dp half-up), totals are pure sums.
 */
export function computeCart(
  lines: Array<Pick<CartLine, "qty" | "unitPrice" | "discountPct" | "isTaxExempt" | "uom" | "description">>,
  opts: { orderDiscountPct?: number; vatInclusive?: boolean } = {}
): CartComputation {
  const { orderDiscountPct = 0, vatInclusive = true } = opts;
  const lineMaths = lines.map((l) =>
    computeLine(l.qty, l.unitPrice, l.discountPct, { vatInclusive, taxExempt: !!l.isTaxExempt })
  );

  const grossSubtotal = lineMaths.reduce((s, l) => s + l.base, 0);
  const lineDiscounts = lineMaths.reduce((s, l) => s + l.discount, 0);
  const netBeforeOrderDiscount = lineMaths.reduce((s, l) => s + l.net, 0);
  const vatSum = lineMaths.reduce((s, l) => s + l.vat, 0);

  // Order-level discount is spread pro-rata over lines, then re-rounded per line
  // so the printed document still sums exactly.
  const orderDiscountTotal = D(netBeforeOrderDiscount)
    .mul(D(orderDiscountPct).div(100))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  let allocated = new Decimal(0);
  const adjusted = lineMaths.map((l, i) => {
    if (orderDiscountPct <= 0) return l;
    const isLast = i === lineMaths.length - 1;
    const share = isLast
      ? orderDiscountTotal.sub(allocated).toNumber() // remainder to the last line → exact sum
      : D(l.net).mul(D(orderDiscountPct).div(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
    allocated = allocated.add(share);
    const net = round2(l.net - share);
    const netExcl = vatInclusive ? round2(net / 1.16) : net;
    const vat = l.vat === 0 ? 0 : vatInclusive ? round2(net - netExcl) : round2(net * 0.16);
    return { ...l, discount: round2(l.discount + share), net, netExcl, vat, total: vatInclusive ? net : round2(net + vat) };
  });

  // RECONCILIATION INVARIANT: grossSubtotal − lineDiscounts − orderDiscount ===
  // netTotal. lineDiscounts therefore MUST sum the PRE-allocation line-level
  // discounts (lineMaths) — summing `adjusted` would re-count the order-discount
  // shares that were merged into each line's `discount` field for the printed
  // document (this exact bug inflated persisted discountAmount + receipt Gross
  // and showed the order discount twice in the cart totals panel).
  const totals: CartTotals = {
    grossSubtotal: round2(adjusted.reduce((s, l) => s + l.base, 0)),
    lineDiscounts: round2(lineMaths.reduce((s, l) => s + l.discount, 0)),
    orderDiscount: orderDiscountTotal.toNumber(),
    netTotal: round2(adjusted.reduce((s, l) => s + l.net, 0)),
    vatAmount: round2(adjusted.reduce((s, l) => s + l.vat, 0)),
    netExclVat: round2(adjusted.reduce((s, l) => s + l.netExcl, 0)),
    grandTotal: round2(adjusted.reduce((s, l) => s + (vatInclusive ? l.net : l.net + l.vat), 0)),
  };

  void vatSum;
  return { lines: adjusted, totals };
}

/** Balance due never goes negative; change is computed on cash. */
export function balanceDue(grandTotal: number, totalPaid: number): number {
  return Math.max(0, round2(D(grandTotal).sub(D(totalPaid))));
}
export function changeDue(cashRendered: number, grandTotal: number): number {
  return Math.max(0, round2(D(cashRendered).sub(D(grandTotal))));
}

/** Moving-average cost after a GRN/restock — used by inventory adjustments. */
export function weightedAverageCost(
  existingQty: number | string | Decimal,
  existingPrice: number | string | Decimal,
  receivedQty: number | string | Decimal,
  newPrice: number | string | Decimal
): number {
  const q0 = D(existingQty), q1 = D(receivedQty);
  const totalQty = q0.add(q1);
  if (totalQty.lte(0)) return D(newPrice).toNumber();
  const weighted = q0.mul(D(existingPrice)).add(q1.mul(D(newPrice))).div(totalQty);
  return weighted.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}
