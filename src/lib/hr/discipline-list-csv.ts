// MBUMAH HARDWARE POS - disciplinary case list CSV serializer (v2.115.0)
//
// Pure serializer behind the /hr/discipline page's "Export CSV" door. Kept
// out of the page so the escaping rules are unit-testable: CSV cells follow
// RFC 4180 (quote a cell when it contains a comma, quote, CR or LF; double
// any embedded quotes). Nulls become empty cells; dates become ISO strings.
//
// CONFIDENTIALITY CONTRACT (spec Phase 4.7 acceptance 5): the column set is
// the LIST payload's column set — descriptions and resolution notes have no
// column here, the same rule the list API has always enforced. Exporting the
// list can never become a back door for the sensitive text the detail view
// permission-gates and (since 2.115.0) audit-logs.

export interface DisciplineCsvRow {
  id: string;
  employeeName: string | null;
  type: string;
  severity: number | null;
  status: string;
  confidentiality: string;
  issuedOn: string;
  expiresOn: string | null;
}

// Pinned by tests: if a column ever proposes to carry the description, this
// array is the line that must change — and the test that guards it fails.
const CSV_HEADERS = [
  'case_id',
  'employee',
  'type',
  'severity',
  'status',
  'confidentiality',
  'issued_on',
  'expires_on',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeDisciplineCsvCell(value: unknown): string {
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

function iso(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Serialize case-list rows to RFC 4180 CSV (CRLF line endings, header row
 * first). Rows keep their input order — the page sorts newest issued first.
 */
export function buildDisciplineListCsv(rows: DisciplineCsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        escapeDisciplineCsvCell(r.id),
        escapeDisciplineCsvCell(r.employeeName ?? ''),
        escapeDisciplineCsvCell(r.type),
        escapeDisciplineCsvCell(r.severity ?? ''),
        escapeDisciplineCsvCell(r.status),
        escapeDisciplineCsvCell(r.confidentiality),
        escapeDisciplineCsvCell(iso(r.issuedOn)),
        escapeDisciplineCsvCell(iso(r.expiresOn)),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
