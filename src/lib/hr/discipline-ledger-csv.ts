// MBUMAH HARDWARE POS - restricted-access ledger CSV serializer (v2.118.0)
//
// Pure serializer behind the ledger card's "Export CSV" door. Same shape as
// discipline-list-csv.ts (v2.115.0): RFC 4180 cells (quote on comma, quote,
// CR or LF; double embedded quotes), CRLF line endings, header row first,
// nulls become empty cells, timestamps become ISO strings.
//
// CONFIDENTIALITY CONTRACT (spec Phase 4.7 acceptance 5, continued): the
// column set is the LEDGER payload's column set — the ledger reads back who,
// when, and which case; the CSV can never carry more. Case descriptions and
// resolution notes have no column here and the row type has no field for
// them, so an export can never become a back door around the detail view's
// gate. Pinned by tests: if a column ever proposes to carry case content,
// this array is the line that must change — and the test that guards it
// fails.

export interface AccessLedgerCsvRow {
  timestamp: string;
  denied: boolean;
  userName: string | null;
  caseId: string;
  employeeName: string | null;
}

// Pinned by tests: the honest column set of the ledger payload itself.
const CSV_HEADERS = [
  'when_iso',
  'event',
  'who',
  'case_id',
  'case_employee',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeLedgerCsvCell(value: unknown): string {
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
 * The event column speaks the ledger's own language — the same two words the
 * chips wear on screen ("Open" / "Denied" become OPEN / DENIED here), derived
 * from the boolean the fold computed, never from a free-text action string.
 */
export function ledgerEventLabel(denied: boolean): string {
  return denied ? 'DENIED' : 'OPEN';
}

function iso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Serialize ledger rows to RFC 4180 CSV (CRLF line endings, header row
 * first). Rows keep their input order — the ledger sorts newest first.
 */
export function buildAccessLedgerCsv(rows: AccessLedgerCsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        escapeLedgerCsvCell(iso(r.timestamp)),
        escapeLedgerCsvCell(ledgerEventLabel(r.denied)),
        escapeLedgerCsvCell(r.userName ?? ''),
        escapeLedgerCsvCell(r.caseId),
        escapeLedgerCsvCell(r.employeeName ?? ''),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
