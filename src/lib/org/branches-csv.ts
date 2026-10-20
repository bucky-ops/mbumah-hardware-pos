// v2.149.0 — the org console's branches table gets the same client-side CSV
// export the Store Intelligence Matrix already has (surface parity: the
// owner-level console should never be the ONE surface where a table can be
// read but not taken away).
//
// PURE module: no db, no network, no clock (the generated stamp is passed in),
// no DOM — so vitest can pin the exact bytes without a browser. v2.178.0
// imports the ONE weekDelta classifier so the file's change % can never
// disagree with the chips — the verdict math lives in exactly one place.

import { weekDelta } from '@/lib/org/summary-trend';

/** Structural input: only the fields the CSV speaks. */
export interface BranchCsvRow {
  name: string;
  code: string;
  location: string;
  status: string;
  todayRevenue: number;
  todayTransactions: number;
  lowStockCount: number;
  overdueRentals: number;
  debtOutstanding: number;
  pendingMpesa: number;
}

/** v2.152.0: the People & payroll drill-down's own row shape. */
export interface BranchHrCsvRow {
  storeName: string;
  headcountActive: number;
  monthEmploymentCost: number;
  monthAbsenceRatePct: number;
  latestPayroll: { periodName: string; status: string } | null;
  expiryAlerts: number;
}

/**
 * v2.154.0: the desk's morning note as a CSV section — the yesterday digest
 * the Expert Console's desk-report panel renders (headlined figures plus the
 * per-branch visit breakdown). Shape mirrors DeskActivityData['yesterday'],
 * narrowed to what the file speaks.
 */
export interface BranchDeskCsvBlock {
  label: string;
  visits: number;
  clears: number;
  reviewers: number;
  requests: number;
  busiestBranch: { storeName: string; visits: number } | null;
  topReviewer: { name: string; visits: number } | null;
  branches: ReadonlyArray<{ storeName: string; visits: number }>;
  /**
   * v2.186.0: the full reviewer roster — the SAME rows the digest strip's
   * share-bar roster speaks (loudest-first, capped 24 by the read). Named
   * `reviewerRows` because THIS block's `reviewers` NUMBER (the distinct
   * count, mirroring DeskActivityData['yesterday']) predates it and keeps
   * its meaning. OPTIONAL by contract: an older answer (or a caller that
   * has not grown the field) exports WITHOUT the sub-section — the file
   * ends at the v2.185.0 shape, never a hole.
   */
  reviewerRows?: ReadonlyArray<{ name: string; visits: number }>;
}

/**
 * v2.178.0: one branch's week as the CSV's fourth section speaks it — the
 * pre-joined row the caller builds (the summary's perStoreTrend entry joined
 * to its branch name by storeId, the drill-down's own join). The change % is
 * NOT carried here: the lib computes it with the SAME weekDelta classifier
 * the chips speak, so the file can never disagree with the table's verdicts.
 */
export interface BranchTrendCsvRow {
  storeName: string;
  /** The branch's gross week total — the tooltip's own number. */
  weekTotal: number;
  /** Absent or ≤ 0 means NO comparison: the Change cell stays empty. */
  priorWeekTotal?: number;
}

/** RFC-4180 field quoting: wrap when the value carries , " \n or \r. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BRANCHES_CSV_COLUMNS = [
  'Branch',
  'Code',
  'Location',
  'Status',
  'Revenue today (KES)',
  'Transactions today',
  'Low stock',
  'Overdue rentals',
  'Debt outstanding (KES)',
  'M-Pesa pending',
] as const;

/** v2.178.0: the week section's own header — the table's 7d column, as numbers. */
export const BRANCHES_TREND_CSV_COLUMNS = [
  'Branch',
  'Revenue 7d (KES)',
  'Prior week (KES)',
  'Change (%)',
] as const;

export const BRANCHES_HR_CSV_COLUMNS = [
  'Branch',
  'Headcount',
  'Cost (month) (KES)',
  'Absence rate (%)',
  'Latest payroll period',
  'Latest payroll status',
  'Expiry alerts (90d docs + overdue assets)',
] as const;

/**
 * Build the branches CSV. Order is the table's own reading order. Numbers are
 * exported raw (no thousands separators) so the file re-imports into a
 * spreadsheet as numbers, not text. `generatedAt` stamps the header comment
 * line exactly like store-matrix's export does.
 *
 * v2.152.0: `hrPerStore` (when the summary payload carried it) appends a
 * second section — the People & payroll drill-down's rows — so one download
 * carries both tables the console shows. Absent or empty: the file ends
 * after the branches table exactly as v2.149.0 shipped it (honest absence).
 *
 * v2.154.0: `desk` (when the review-activity read answered) appends a third
 * section — the desk's yesterday digest: the headlined figures plus the
 * per-branch visit breakdown, the same morning note the desk-report panel
 * renders. Nullish: the file ends exactly where v2.152.0 ended (byte-pinned
 * by the tests); an empty branch list still prints the headline figures —
 * a quiet desk is an honest zero, not an absence.
 *
 * v2.178.0: `trend` (when the summary payload carried perStoreTrend) appends
 * a fourth section — the week by branch, the same loudest-first rows the
 * Revenue drill-down lists, each with its prior week and the SAME weekDelta
 * verdict the chips speak. Nullish or empty: the file ends exactly where
 * v2.177.0 ended (byte-pinned by the tests).
 */
export function buildBranchesCsv(
  stores: readonly BranchCsvRow[],
  generatedAt: Date = new Date(),
  hrPerStore?: readonly BranchHrCsvRow[] | null,
  desk?: BranchDeskCsvBlock | null,
  trend?: readonly BranchTrendCsvRow[] | null,
): string {
  const header = BRANCHES_CSV_COLUMNS.join(',');
  const rows = stores.map((s) =>
    [
      s.name,
      s.code,
      s.location,
      s.status,
      s.todayRevenue,
      s.todayTransactions,
      s.lowStockCount,
      s.overdueRentals,
      s.debtOutstanding,
      s.pendingMpesa,
    ]
      .map(csvField)
      .join(','),
  );
  const lines = [
    `Organization Console branches (generated ${generatedAt.toISOString()})`,
    header,
    ...rows,
    '',
  ];
  if (hrPerStore && hrPerStore.length > 0) {
    lines.push(
      'People & payroll by branch',
      BRANCHES_HR_CSV_COLUMNS.join(','),
      ...hrPerStore.map((r) =>
        [
          r.storeName,
          r.headcountActive,
          r.monthEmploymentCost,
          r.monthAbsenceRatePct,
          r.latestPayroll ? r.latestPayroll.periodName : '',
          r.latestPayroll ? r.latestPayroll.status : '',
          r.expiryAlerts,
        ]
          .map(csvField)
          .join(','),
      ),
      '',
    );
  }
  if (desk) {
    lines.push(
      `Desk report — ${desk.label}`,
      'Desk activity,Value',
      `Visits,${csvField(desk.visits)}`,
      `Corrections cleared,${csvField(desk.clears)}`,
      `Distinct reviewers,${csvField(desk.reviewers)}`,
      `Requests visited,${csvField(desk.requests)}`,
      `Busiest branch,${csvField(
        desk.busiestBranch
          ? `${desk.busiestBranch.storeName} (${desk.busiestBranch.visits} visits)`
          : 'None',
      )}`,
      `Most active reviewer,${csvField(
        desk.topReviewer
          ? `${desk.topReviewer.name} (${desk.topReviewer.visits} visits)`
          : 'None',
      )}`,
      '',
      'Branch,Visits (yesterday)',
      ...desk.branches.map((b) =>
        [b.storeName, b.visits].map(csvField).join(','),
      ),
      '',
      // v2.186.0: the "Reviews by reviewer" sub-section — WHO pulled the
      // desk, offline twin of the digest strip's share-bar roster (the
      // v2.180.0 file-mirrors-screen rule). Renders ONLY when the caller
      // carried the roster AND the window has visits to share out of — an
      // absent roster or a zero-visit window ends the section above, never
      // a divide-by-zero or an invented 0% column.
      ...(desk.reviewerRows && desk.reviewerRows.length > 0 && desk.visits > 0
        ? [
            'Reviews by reviewer,Reviewer,Visits,Share (%)',
            ...desk.reviewerRows.map((r) =>
              [
                r.name,
                r.visits,
                Math.round((r.visits / desk.visits) * 10000) / 100,
              ]
                .map(csvField)
                .join(','),
            ),
            '',
          ]
        : []),
    );
  }
  if (trend && trend.length > 0) {
    // v2.178.0: the week by branch — the drill-down's own rows, offline.
    // Loudest week first (the drill-down's sort; Array.sort is stable, so
    // tied weeks keep their arrival order). The change % is the SAME
    // weekDelta verdict the chips speak: signed (the sign IS the direction
    // in a spreadsheet), round2'd, and EMPTY when there is no comparison —
    // a missing or non-positive prior week prints nothing, never a
    // fabricated "+0%" or an invented infinity.
    const ordered = [...trend].sort((a, b) => b.weekTotal - a.weekTotal);
    lines.push(
      'The week by branch (7d)',
      BRANCHES_TREND_CSV_COLUMNS.join(','),
      ...ordered.map((t) => {
        const d =
          t.priorWeekTotal === undefined ? null : weekDelta(t.weekTotal, t.priorWeekTotal);
        return [
          t.storeName,
          t.weekTotal,
          t.priorWeekTotal === undefined ? '' : t.priorWeekTotal,
          d ? String(d.pct) : '',
        ]
          .map(csvField)
          .join(',');
      }),
      'Note,Branch week shapes are gross revenue — the org trend line and the expert console KPI agree (gross till face, reconciled v2.185.0)',
      '',
    );
  }
  return lines.join('\n');
}
