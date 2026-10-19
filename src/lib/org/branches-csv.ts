// v2.149.0 — the org console's branches table gets the same client-side CSV
// export the Store Intelligence Matrix already has (surface parity: the
// owner-level console should never be the ONE surface where a table can be
// read but not taken away).
//
// PURE module: no db, no network, no clock (the generated stamp is passed in),
// no DOM — so vitest can pin the exact bytes without a browser.

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
 */
export function buildBranchesCsv(
  stores: readonly BranchCsvRow[],
  generatedAt: Date = new Date(),
  hrPerStore?: readonly BranchHrCsvRow[] | null,
  desk?: BranchDeskCsvBlock | null,
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
    );
  }
  return lines.join('\n');
}
