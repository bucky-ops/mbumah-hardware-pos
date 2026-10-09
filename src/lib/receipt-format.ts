/**
 * receipt-format - pure formatting helpers shared by EVERY receipt surface.
 *
 * v2.14.0 receipt-rendering spec:
 *   1. MONEY NEVER WRAPS - price/total cells render right-aligned with
 *      tabular numerals; the currency prefix is a separate span so the
 *      per-line "Ksh" can be dropped below 480px (stated once in the
 *      column headers instead).
 *   2. UNITS - abbreviated lowercase on screen ("1 pc", "1 bag", "1 kg"),
 *      full words in print/PDF (the print stylesheet and the PDF capture
 *      toggle swap the two spans via CSS, see globals.css + receipt-pdf.ts).
 *
 * This module is DOM-free and side-effect-free so it is directly unit-testable
 * (src/tests/lib/receipt-format.test.ts) and safe to import from server code.
 */

import { formatKES } from '@/lib/utils/financialMath';

/** Fixed receipt table column widths (percent) - Item/Qty/Price/Total. */
export const RECEIPT_TABLE_COL_WIDTHS = { item: 38, qty: 18, price: 22, total: 22 } as const;

/**
 * Fractional quantities stay exact: 2.5 -> "2.5", 3 -> "3" (never "2.50").
 * Moved here from receipt-print.tsx so every surface shares one definition.
 */
export function formatReceiptQuantity(qty: number): string {
  if (!Number.isFinite(qty)) return String(qty);
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
}

/** Unit normalization table: canonical key -> { abbr, full }. */
const UNIT_MAP: Record<string, { abbr: string; full: string }> = {
  pc: { abbr: 'pc', full: 'piece' },
  bag: { abbr: 'bag', full: 'bag' },
  kg: { abbr: 'kg', full: 'kilogram' },
  m: { abbr: 'm', full: 'metre' },
  cm: { abbr: 'cm', full: 'centimetre' },
  mm: { abbr: 'mm', full: 'millimetre' },
  l: { abbr: 'l', full: 'litre' },
  roll: { abbr: 'roll', full: 'roll' },
  box: { abbr: 'box', full: 'box' },
  pack: { abbr: 'pack', full: 'pack' },
  tin: { abbr: 'tin', full: 'tin' },
  carton: { abbr: 'carton', full: 'carton' },
  drum: { abbr: 'drum', full: 'drum' },
  bundle: { abbr: 'bundle', full: 'bundle' },
  bar: { abbr: 'bar', full: 'bar' },
  set: { abbr: 'set', full: 'set' },
  pair: { abbr: 'pair', full: 'pair' },
  each: { abbr: '', full: 'each' },
};

/**
 * Normalize a stored unitType token to its canonical key.
 * "BAGS" -> "bag", "KILOGRAMS" -> "kg", "PCS" -> "pc", "EACH"/"UNIT" -> "each".
 * Unknown units fall back to the lowercase singular token itself.
 */
function canonicalUnit(unitType: string | null | undefined): string {
  const raw = String(unitType ?? '').trim().toLowerCase();
  if (!raw) return '';
  // Singularize the common plural forms ("bags" -> "bag", "boxes" stays "box"
  // via the map, "pieces" -> "piece").
  const singular = raw.endsWith('s') && raw.length > 2 ? raw.slice(0, -1) : raw;
  const aliases: Record<string, string> = {
    piece: 'pc',
    pieces: 'pc',
    pcs: 'pc',
    pc: 'pc',
    each: 'each',
    ea: 'each',
    unit: 'each',
    units: 'each',
    bag: 'bag',
    bags: 'bag',
    kg: 'kg',
    kgs: 'kg',
    kilogram: 'kg',
    kilograms: 'kg',
    kilo: 'kg',
    kilos: 'kg',
    m: 'm',
    mtr: 'm',
    mtrs: 'm',
    meter: 'm',
    meters: 'm',
    metre: 'm',
    metres: 'm',
    cm: 'cm',
    mm: 'mm',
    l: 'l',
    ltr: 'l',
    litre: 'l',
    litres: 'l',
    liter: 'l',
    liters: 'l',
    roll: 'roll',
    rolls: 'roll',
    box: 'box',
    boxes: 'box',
    pack: 'pack',
    packs: 'pack',
    packet: 'pack',
    packets: 'pack',
    tin: 'tin',
    tins: 'tin',
    carton: 'carton',
    cartons: 'carton',
    drum: 'drum',
    drums: 'drum',
    bundle: 'bundle',
    bundles: 'bundle',
    bar: 'bar',
    bars: 'bar',
    set: 'set',
    sets: 'set',
    pair: 'pair',
    pairs: 'pair',
  };
  return aliases[raw] ?? aliases[singular] ?? singular;
}

/**
 * Abbreviated lowercase unit for ON-SCREEN receipt rows: "1 pc", "1 bag",
 * "1 kg". Returns '' for unitless counts (EA/UNIT or empty) - the bare
 * quantity renders alone, exactly like a count of items.
 */
export function abbreviateUnit(unitType: string | null | undefined): string {
  const key = canonicalUnit(unitType);
  if (!key) return '';
  return UNIT_MAP[key]?.abbr ?? key;
}

/**
 * Full-word unit for PRINT/PDF receipt rows ("1 piece", "1 bag",
 * "1 kilogram"). Returns '' when the item carries no unit at all so the
 * bare quantity prints alone.
 */
export function fullUnitLabel(unitType: string | null | undefined): string {
  const key = canonicalUnit(unitType);
  if (!key) return '';
  return UNIT_MAP[key]?.full ?? key;
}

export interface ReceiptMoneyParts {
  /** Currency prefix token, e.g. "Ksh" (empty when the value is bare). */
  currency: string;
  /** Locale-formatted amount, e.g. "1,234.56" (never wraps). */
  value: string;
}

/**
 * Split the ONE canonical KES formatter output ("Ksh 1,234.56") into its
 * currency prefix and numeric value so templates can style each part
 * independently (per-line prefix hidden below 480px, stated in headers).
 */
export function splitKES(amount: number | string | null | undefined): ReceiptMoneyParts {
  const formatted = formatKES((amount ?? 0) as number);
  const idx = formatted.indexOf(' ');
  if (idx === -1) return { currency: '', value: formatted };
  return { currency: formatted.slice(0, idx), value: formatted.slice(idx + 1) };
}

/**
 * Canonical PDF/receipt download filename: the receipt number itself.
 * `MBM-20261007-9D042` -> "MBM-20261007-9D042" (callers append ".pdf").
 * Falls back defensively to the transaction id / "transaction" when the
 * receipt number is missing (offline sync edges). Unsafe characters are
 * collapsed to hyphens so the name is valid on Windows/macOS/Linux.
 */
export function buildReceiptFileName(receiptNumber?: string | null, id?: string | null): string {
  const base = receiptNumber || id || 'transaction';
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'transaction';
}
