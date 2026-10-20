// v2.179.0 — the Store Intelligence Matrix's export becomes the offline twin
// of its table. The matrix has exported a client-side CSV since v2.18.3, but
// the bytes were assembled inline in the component (untestable, and blind to
// the week the rest of the console speaks since v2.174.0). This module moves
// the file into a PURE lib — no db, no network, no DOM (the generated stamp
// is passed in) — and grows the week into it: the SAME three week fields the
// branches CSV's fourth section speaks (v2.178.0), inline after Revenue, so
// one download carries today AND the week.
//
// The Change % is NOT carried in: the lib computes it with the SAME weekDelta
// classifier the chips speak (imported, never re-derived), so the file can
// never disagree with the matrix's own verdict chips.

import { weekDelta } from '@/lib/org/summary-trend';

/**
 * Structural input: only the fields the CSV speaks. The caller maps its
 * StoreRow onto this (the `code` field is the matrix's own storeCode —
 * code ?? slug ?? id-prefix — resolved by the caller, exactly as the old
 * inline export did).
 */
export interface StoreMatrixCsvStoreRow {
  /** The join key — the trend row is found by id, never by row order. */
  id: string;
  code: string;
  status: string;
  todayRevenue: number;
  todayTransactions: number;
  lowStockCount: number;
  overdueRentals: number;
  debtOutstanding: number;
  debtCount: number;
  pendingMpesa: number;
}

/**
 * One store's week as the CSV speaks it — the summary's perStoreTrend entry
 * (the caller passes the block through; the join by `storeId` happens here).
 * `priorWeekTotal` absent or ≤ 0 means NO comparison: the Prior cell prints
 * nothing when absent, and the Change cell stays EMPTY either way — never a
 * fabricated "+0%", never an invented infinity.
 */
export interface StoreMatrixTrendCsvRow {
  storeId: string;
  weekTotal: number;
  priorWeekTotal?: number;
}

/** The file's header — the matrix's own reading order with the week inline. */
export const STORE_MATRIX_CSV_COLUMNS = [
  'Store',
  'Status',
  'Revenue',
  'Week 7d (KES)',
  'Prior week (KES)',
  'Change (%)',
  'Txns',
  'Low Stock',
  'Overdue Rentals',
  'Debt Total',
  'Debt Accts',
  'M-Pesa Pending',
] as const;

/**
 * The closing note — the v2.173.0 gross-vs-net divergence label carried into
 * the offline artifact (the same parity move the branches CSV made in
 * v2.178.0): the matrix's week shapes come from /api/org/summary (gross of
 * tax), while the expert console's revenue KPI is net. Rides only when the
 * trend block is present and non-empty — an absent week never adds a note.
 */
export const STORE_MATRIX_TREND_NOTE =
  'Note,Store week shapes are gross revenue — the expert console\u2019s revenue KPI is net of VAT';

/** RFC-4180 field quoting: wrap when the value carries , " \n or \r. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the store matrix CSV. Order is the matrix's own reading order.
 * Numbers are exported raw (no thousands separators) so the file re-imports
 * into a spreadsheet as numbers, not text — the old inline export's exact
 * convention. The week fields are computed per store from the `trend` block
 * (joined by `storeId`): a store with no entry — or a block that is nullish
 * or empty — leaves its Week, Prior and Change cells EMPTY (the columns
 * always exist; the header is stable, the honesty lives in the cells).
 */
export function buildStoreMatrixCsv(
  stores: readonly StoreMatrixCsvStoreRow[],
  generatedAt: Date = new Date(),
  trend?: readonly StoreMatrixTrendCsvRow[] | null,
): string {
  const byId = new Map((trend ?? []).map((t) => [t.storeId, t]));
  const rows = stores.map((s) => {
    const t = byId.get(s.id) ?? null;
    const d = t ? (t.priorWeekTotal === undefined ? null : weekDelta(t.weekTotal, t.priorWeekTotal)) : null;
    return [
      s.code,
      s.status,
      s.todayRevenue,
      t ? t.weekTotal : '',
      t && t.priorWeekTotal !== undefined ? t.priorWeekTotal : '',
      d ? String(d.pct) : '',
      s.todayTransactions,
      s.lowStockCount,
      s.overdueRentals,
      s.debtOutstanding,
      s.debtCount,
      s.pendingMpesa,
    ]
      .map(csvField)
      .join(',');
  });
  const lines = [
    `Store Intelligence Matrix (generated ${generatedAt.toISOString()})`,
    STORE_MATRIX_CSV_COLUMNS.join(','),
    ...rows,
  ];
  if (trend && trend.length > 0) lines.push(STORE_MATRIX_TREND_NOTE);
  return lines.join('\n') + '\n';
}
