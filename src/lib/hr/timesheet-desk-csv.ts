// MBUMAH HARDWARE POS - timesheet desk pending-list CSV serializer (v2.137.0)
//
// Pure serializer behind the timesheet desk's "Export CSV" door. Same shape
// as discipline-ledger-csv.ts (v2.118.0) and discipline-list-csv.ts
// (v2.115.0): RFC 4180 cells (quote on comma, quote, CR or LF; double
// embedded quotes), CRLF line endings, header row first, nulls become empty
// cells.
//
// HONESTY CONTRACT: the column set is the desk row's column set — the desk
// reads back who, how many days, and WHICH days; the CSV can never carry
// more. Pay amounts, rates, and approvals have no column here and the row
// type has no field for them, so an export can never become a payslip
// preview or an approval-by-spreadsheet. Pinned by tests: if a column ever
// proposes to carry pay data, this array is the line that must change — and
// the test that guards it fails.

export interface TimesheetDeskCsvRow {
  employeeCode: string;
  employeeName: string;
  /** Pending day count as shown on the desk (the row's own number). */
  pendingDays: number;
  /** ISO date-only (YYYY-MM-DD) or '' when the row has none. */
  firstDay: string;
  /** ISO date-only (YYYY-MM-DD) or '' when the row has none. */
  lastDay: string;
  /** The exact pending days, ascending — joined with ';' in one cell. */
  pendingDates: readonly string[];
}

// Pinned by tests: the honest column set of the desk row itself.
const CSV_HEADERS = [
  'employee_code',
  'employee_name',
  'pending_days',
  'first_day',
  'last_day',
  'pending_dates',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeDeskCsvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The desk's pending list, one line per employee, in the order the desk
 * shows it (the caller passes rows already ordered by the gate's own
 * employeeCode asc — the serializer never re-sorts, so what you see is
 * what prints).
 */
export function buildTimesheetDeskCsv(rows: readonly TimesheetDeskCsvRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        escapeDeskCsvCell(row.employeeCode),
        escapeDeskCsvCell(row.employeeName),
        escapeDeskCsvCell(row.pendingDays),
        escapeDeskCsvCell(row.firstDay),
        escapeDeskCsvCell(row.lastDay),
        escapeDeskCsvCell((row.pendingDates ?? []).join(';')),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
