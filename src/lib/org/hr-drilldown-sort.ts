// v2.183.0 — the drill-down learns to sort.
//
// The org dashboard's HR drill-down ("People & payroll by branch") has been
// the console's THIRD dense table since v2.23.0 — fed by the summary's
// hrPerStore block, hidden behind its collapsible door — but its rows only
// ever appeared in the API's arrival order. This module is the ONE
// comparator the drill-down speaks: a PURE lib (no React, no DOM, no clock)
// that orders the rows for BOTH the table body and the CSV export, so the
// pixels and the file can never disagree about what "sorted" means.
//
// It is store-matrix-sort's SIBLING rather than a reuse: the hrPerStore row
// shares no fields with MatrixSortRow, and a guessed comparator is exactly
// what the sort libs refuse to be. The SEMANTICS are the matrix's, carried
// over verbatim:
//   • numeric columns sort loudest-first by default (desc) — an owner
//     clicking "Expiry alerts" wants the biggest exposure on top;
//   • text columns sort A→Z by default (asc);
//   • the payroll column sorts through the latestPayroll.periodName join,
//     and a branch with NO payroll run sorts LAST in BOTH directions —
//     honest absence never wins a loudest-first sort, and it never hides
//     at the bottom of a smallest-first one either (it is not a zero, it
//     is no comparison — the matrix's week rule, carried over);
//   • ties keep arrival order (Array.sort is stable) — the same input
//     always sorts the same way;
//   • null state → arrival order, copied (never the caller's array).

/** A row the comparator speaks — structurally satisfied by summary.hrPerStore's rows. */
export interface HrDrillSortRow {
  storeId: string;
  storeName: string;
  headcountActive: number;
  monthEmploymentCost: number;
  monthAbsenceRatePct: number;
  latestPayroll: { periodName: string; status: string; createdAt: string } | null;
  expiryAlerts: { documentsExpiring90Days: number; assetsOverdue: number };
}

export type HrDrillSortDir = 'asc' | 'desc';

/** One active sort: the column key + the direction it currently runs. */
export interface HrDrillSortState {
  key: string;
  dir: HrDrillSortDir;
}

/** The columns that sort loudest-first on a fresh click. */
export const HR_DRILL_NUMERIC_COLUMNS = ['headcount', 'cost', 'absence', 'alerts'] as const;

/** The columns that sort A→Z on a fresh click. */
export const HR_DRILL_TEXT_COLUMNS = ['branch', 'payroll'] as const;

const NUMERIC_FIELD: Record<string, (r: HrDrillSortRow) => number> = {
  headcount: (r) => r.headcountActive,
  cost: (r) => r.monthEmploymentCost,
  absence: (r) => r.monthAbsenceRatePct,
  // the alerts cell speaks the SUM (90d documents + overdue assets) — the
  // comparator sorts by the same number the cell shows, never a private one
  alerts: (r) => r.expiryAlerts.documentsExpiring90Days + r.expiryAlerts.assetsOverdue,
};

/**
 * The direction a FRESH sort on this column takes: numbers loudest-first,
 * text A→Z. An unknown key reads as text (the caller's ColDef decides what
 * is clickable; the lib stays total).
 */
export function defaultDirFor(key: string): HrDrillSortDir {
  return (HR_DRILL_NUMERIC_COLUMNS as readonly string[]).includes(key) ? 'desc' : 'asc';
}

/** The other direction — the click toggle's whole job. */
export function toggledDir(dir: HrDrillSortDir): HrDrillSortDir {
  return dir === 'asc' ? 'desc' : 'asc';
}

/**
 * The next sort state after one header click: the same column flips, a new
 * column starts at its default direction. Pure — the component stores the
 * result, the lib never remembers.
 */
export function nextSortState(current: HrDrillSortState | null, key: string): HrDrillSortState {
  if (current?.key === key) return { key, dir: toggledDir(current.dir) };
  return { key, dir: defaultDirFor(key) };
}

/**
 * Order the rows. `state` null → arrival order, copied. The payroll column
 * sorts through the latestPayroll.periodName join (a branch with NO run
 * sorts LAST in both directions); every other known column sorts by its
 * own field; an unknown key returns arrival order (the caller cannot sort
 * on a column the lib does not speak — deliberate, never a guessed
 * comparator).
 */
export function sortHrDrillRows<T extends HrDrillSortRow>(
  rows: readonly T[],
  state: HrDrillSortState | null,
): T[] {
  if (!state) return [...rows];
  const { key, dir } = state;
  const mul = dir === 'desc' ? -1 : 1;
  if (key === 'branch') {
    return [...rows].sort((a, b) => mul * a.storeName.localeCompare(b.storeName));
  }
  if (key === 'payroll') {
    return [...rows].sort((a, b) => {
      const pa = a.latestPayroll?.periodName;
      const pb = b.latestPayroll?.periodName;
      const missingA = pa == null;
      const missingB = pb == null;
      if (missingA && missingB) return 0;
      if (missingA) return 1;
      if (missingB) return -1;
      return mul * (pa as string).localeCompare(pb as string);
    });
  }
  const get = NUMERIC_FIELD[key];
  if (!get) return [...rows];
  return [...rows].sort((a, b) => (get(a) - get(b)) * mul);
}
