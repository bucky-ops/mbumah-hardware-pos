// v2.180.0 — the Store Intelligence Matrix learns to sort.
//
// The matrix has been the expert console's densest table since v2.18.3 —
// resizable, hideable, exportable (v2.179.0 offline twin) — but its rows
// only ever appeared in the API's arrival order. This module is the ONE
// comparator the matrix speaks: a PURE lib (no React, no DOM, no clock)
// that orders the rows for BOTH the table body and the CSV export, so the
// pixels and the file can never disagree about what "sorted" means.
//
// SORT SEMANTICS (the honesty contract):
//   • numeric columns sort loudest-first by default (desc) — an owner
//     clicking "Debt Total" wants the biggest exposure on top;
//   • text columns sort A→Z by default (asc);
//   • the week column sorts by weekTotal through the caller's join, and a
//     store with NO trend entry sorts LAST in BOTH directions — honest
//     absence never wins a loudest-first sort, and it never hides at the
//     bottom of a smallest-first one either (it is not a zero, it is no
//     comparison — the v2.175.0 dash rule carried into ordering);
//   • ties keep arrival order (Array.sort is stable) — the same input
//     always sorts the same way;
//   • null state → arrival order, copied (never the caller's array).

/** A row the comparator speaks — structurally satisfied by the StoreRow. */
export interface MatrixSortRow {
  id: string;
  code: string | null;
  status: string;
  todayRevenue: number;
  todayTransactions: number;
  lowStockCount: number;
  overdueRentals: number;
  debtOutstanding: number;
  debtCount: number;
  pendingMpesa: number;
}

export type MatrixSortDir = 'asc' | 'desc';

/** One active sort: the column key + the direction it currently runs. */
export interface MatrixSortState {
  key: string;
  dir: MatrixSortDir;
}

/** The columns that sort loudest-first on a fresh click. */
export const MATRIX_NUMERIC_COLUMNS = [
  'revenue',
  'week',
  'txns',
  'low',
  'overdue',
  'debt',
  'debtcount',
  'mpesa',
] as const;

/** The columns that sort A→Z on a fresh click. */
export const MATRIX_TEXT_COLUMNS = ['store', 'status'] as const;

const NUMERIC_FIELD: Record<string, (r: MatrixSortRow) => number> = {
  revenue: (r) => r.todayRevenue,
  txns: (r) => r.todayTransactions,
  low: (r) => r.lowStockCount,
  overdue: (r) => r.overdueRentals,
  debt: (r) => r.debtOutstanding,
  debtcount: (r) => r.debtCount,
  mpesa: (r) => r.pendingMpesa,
};

/**
 * The direction a FRESH sort on this column takes: numbers loudest-first,
 * text A→Z. An unknown key reads as text (the caller's ColDef decides what
 * is clickable; the lib stays total).
 */
export function defaultDirFor(key: string): MatrixSortDir {
  return (MATRIX_NUMERIC_COLUMNS as readonly string[]).includes(key) ? 'desc' : 'asc';
}

/** The other direction — the click toggle's whole job. */
export function toggledDir(dir: MatrixSortDir): MatrixSortDir {
  return dir === 'asc' ? 'desc' : 'asc';
}

/**
 * The next sort state after one header click: the same column flips, a new
 * column starts at its default direction. Pure — the component stores the
 * result, the lib never remembers.
 */
export function nextSortState(current: MatrixSortState | null, key: string): MatrixSortState {
  if (current?.key === key) return { key, dir: toggledDir(current.dir) };
  return { key, dir: defaultDirFor(key) };
}

/**
 * Order the rows. `state` null → arrival order, copied. The `weekOf`
 * callback hands the comparator each row's week total (undefined = no
 * trend entry): the week column sorts by it, absence last in BOTH
 * directions. Every other known column sorts by its own field; an unknown
 * key returns arrival order (the caller cannot sort on a column the lib
 * does not speak — deliberate, never a guessed comparator).
 */
export function sortMatrixRows<T extends MatrixSortRow>(
  rows: readonly T[],
  state: MatrixSortState | null,
  weekOf?: (row: T) => number | undefined,
): T[] {
  if (!state) return [...rows];
  const { key, dir } = state;
  const mul = dir === 'desc' ? -1 : 1;
  if (key === 'week') {
    return [...rows].sort((a, b) => {
      const wa = weekOf?.(a);
      const wb = weekOf?.(b);
      const missingA = wa === undefined;
      const missingB = wb === undefined;
      if (missingA && missingB) return 0;
      if (missingA) return 1;
      if (missingB) return -1;
      return dir === 'desc' ? (wb as number) - (wa as number) : (wa as number) - (wb as number);
    });
  }
  if (key === 'store') {
    return [...rows].sort((a, b) => mul * (a.code ?? a.id).localeCompare(b.code ?? b.id));
  }
  if (key === 'status') {
    return [...rows].sort((a, b) => mul * a.status.localeCompare(b.status));
  }
  const get = NUMERIC_FIELD[key];
  if (!get) return [...rows];
  return [...rows].sort((a, b) => (get(a) - get(b)) * mul);
}
