// MBUMAH HARDWARE POS - pre-flight run gate CSV serializer (v2.133.0)
//
// Pure serializer behind the gate panel's CSV door. Same RFC 4180 discipline
// as the house exports before it (discipline-list-csv.ts v2.115.0,
// discipline-ledger-csv.ts v2.118.0, consent-branch export v2.132.0): quote
// on comma, quote, CR or LF; double embedded quotes; CRLF line endings;
// header row first; nulls become empty cells.
//
// HONESTY CONTRACT: the column set is the GATE REPORT's own column set — the
// same words the panel renders. The gate reads consent/timesheet verdicts;
// the CSV carries who, their state, and which gate prepare would report
// first. No payslip amounts, no earnings, no deductions, no period totals —
// the row type has no field for them, so an export can never become a back
// door around the payslip itself. Pinned by tests: if a column ever proposes
// to carry money, this array is the line that must change — and the test
// that guards it fails.

export interface RunGateCsvRow {
  period: string;
  checkedAtIso: string;
  employeeCode: string;
  employeeName: string;
  gateState: string;
  /** The FIRST block prepare would report — empty for a CLEAR employee. */
  prepareWouldReport: string;
}

// Pinned by tests: the honest column set of the gate panel itself.
const CSV_HEADERS = [
  'period',
  'checked_at_iso',
  'employee_code',
  'employee_name',
  'gate_state',
  'prepare_would_report',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeRunGateCsvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build the gate export: one row per employee, the panel's verdict verbatim.
 * `checkedAtIso` degrades honestly — a missing or unparseable timestamp
 * becomes an empty cell, never a fabricated date.
 */
export function buildRunGateCsv(rows: RunGateCsvRow[]): string {
  const checkedAt = (row: RunGateCsvRow): string => {
    const d = new Date(row.checkedAtIso);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  };
  const lines = [
    CSV_HEADERS.join(','),
    ...rows.map((r) =>
      [
        escapeRunGateCsvCell(r.period),
        escapeRunGateCsvCell(checkedAt(r)),
        escapeRunGateCsvCell(r.employeeCode),
        escapeRunGateCsvCell(r.employeeName),
        escapeRunGateCsvCell(r.gateState),
        escapeRunGateCsvCell(r.prepareWouldReport),
      ].join(','),
    ),
  ];
  return lines.join('\r\n') + '\r\n';
}
