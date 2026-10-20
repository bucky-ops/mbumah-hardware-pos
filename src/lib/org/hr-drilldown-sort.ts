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
//   • the payroll column sorts through the latestPayroll join, and a
//     branch with NO payroll run sorts LAST in BOTH directions —
//     honest absence never wins a loudest-first sort, and it never hides
//     at the bottom of a smallest-first one either (it is not a zero, it
//     is no comparison — the matrix's week rule, carried over);
//   • ties keep arrival order (Array.sort is stable) — the same input
//     always sorts the same way;
//   • null state → arrival order, copied (never the caller's array).
//
// v2.190.0 — the payroll column learns to RANK. The v2.183.0 join sorted
// by latestPayroll.periodName TEXT — a fragile proxy for recency that
// breaks across naming formats ("November 2025" sorts after "March 2026"
// alphabetically) and ignores the one thing the cell actually WEARS: the
// status badge. The house rule is that a comparator sorts what the cell
// shows (the alerts cell sorts its SUM, the payroll cell shows a badge),
// so the payroll column now sorts by STATUS RANK — the run's finality:
//   LOCKED/POSTED (money settled) > APPROVED (approved, awaiting
//   finality) > DRAFT (still open) > VOIDED (dead), unknown rank 0.
// One click answers the owner scan "which branches are settled vs still
// open" — locked clusters at the top on the fresh (desc) click, the
// open work beneath, voided and run-less branches last. Within one rank
// the ties break directionally: by createdAt (desc = the freshest run
// first, asc = the oldest first — Date.parse, NaN reads as 0, never a
// thrown or invented date), then periodName A→Z, then arrival order
// (stable). The asc click is the honest MIRROR: least-final first — the
// "who needs attention" scan.

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
export const HR_DRILL_TEXT_COLUMNS = ['branch'] as const;

/**
 * v2.190.0: the columns that sort by STATUS RANK on a fresh click —
 * desc (most final first), because a fresh click on "Latest payroll"
 * wants the settled branches on top, not the voided ones.
 */
export const HR_DRILL_RANK_COLUMNS = ['payroll'] as const;

/**
 * The run-status ladder — the payroll cell's OWN badge vocabulary, given
 * a number. LOCKED and POSTED share the top rank (both mean the money is
 * settled; the cell paints them the same emerald); VOIDED is dead work,
 * ranked below even a DRAFT. The wire speaks the Prisma enum (uppercase);
 * anything else — a future status, a corrupt payload — reads as 0 and
 * sorts beneath the known ladder, never throws, never guesses.
 */
export function payrollStatusRank(status: string): number {
  if (status === 'LOCKED' || status === 'POSTED') return 4;
  if (status === 'APPROVED') return 3;
  if (status === 'DRAFT') return 2;
  if (status === 'VOIDED') return 1;
  return 0;
}

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
 * rank columns most-final-first, text A→Z. An unknown key reads as text
 * (the caller's ColDef decides what is clickable; the lib stays total).
 */
export function defaultDirFor(key: string): HrDrillSortDir {
  return (HR_DRILL_NUMERIC_COLUMNS as readonly string[]).includes(key) ||
    (HR_DRILL_RANK_COLUMNS as readonly string[]).includes(key)
    ? 'desc'
    : 'asc';
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
 * sorts through the latestPayroll join by STATUS RANK (v2.190.0) — finality
 * first on desc, least-final first on asc, directional createdAt then
 * periodName ties inside a rank, and a branch with NO run sorts LAST in
 * both directions; every other known column sorts by its own field; an
 * unknown key returns arrival order (the caller cannot sort on a column
 * the lib does not speak — deliberate, never a guessed comparator).
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
      const ra = a.latestPayroll;
      const rb = b.latestPayroll;
      const missingA = ra == null;
      const missingB = rb == null;
      if (missingA && missingB) return 0;
      if (missingA) return 1;
      if (missingB) return -1;
      // Primary axis: the status rank (the cell's badge, scored).
      const rank = mul * (payrollStatusRank(ra.status) - payrollStatusRank(rb.status));
      if (rank !== 0) return rank;
      // Same rank: the run's own recency decides, directionally — desc
      // (the fresh click) puts the freshest run first, asc the oldest.
      // Date.parse on the wire's ISO stamps; an unparseable stamp reads
      // as 0 (the oldest within its rank) — deterministic, never NaN,
      // never a thrown date.
      const ta = Date.parse(ra.createdAt) || 0;
      const tb = Date.parse(rb.createdAt) || 0;
      const time = mul * (ta - tb);
      if (time !== 0) return time;
      // Same rank, same instant: the period name keeps its A→Z voice as
      // the final tie; the stable sort carries the rest.
      return mul * ra.periodName.localeCompare(rb.periodName);
    });
  }
  const get = NUMERIC_FIELD[key];
  if (!get) return [...rows];
  return [...rows].sort((a, b) => (get(a) - get(b)) * mul);
}
