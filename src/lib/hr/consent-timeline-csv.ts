// MBUMAH HARDWARE POS - consent timeline CSV serializer (v2.130.0)
//
// Pure serializer behind the consent timeline drawer's "Export CSV" door.
// Same shape as discipline-ledger-csv.ts (v2.118.0) and the discipline list
// CSV before it (v2.115.0): RFC 4180 cells (quote on comma, quote, CR or LF;
// double embedded quotes), CRLF line endings, header row first, nulls become
// empty cells, timestamps become ISO strings.
//
// CONFIDENTIALITY CONTRACT (the export-honesty theme, third beat): the
// column set is the TIMELINE payload's column set — the ledger reads back
// who, when, and what purpose; the CSV can never carry more. The purpose
// string is the consent scope the card already shows (e.g.
// PAYROLL_PROCESSING); there is no free-text content field on a
// ConsentRecord and no column here for one, so an export can never become a
// back door. Pinned by tests: if a column ever proposes to carry more, this
// array is the line that must change — and the test that guards it fails.

export interface ConsentTimelineCsvRow {
  /** 1-based chronological position (≥2 = a re-grant cycle). */
  cycle: number;
  grantedAt: string;
  withdrawnAt: string | null;
  /** Whole days the consent stood; null while it still stands. */
  stoodDays: number | null;
  purpose: string;
  policyVersion: string | null;
  employeeCode: string;
  employeeName: string;
}

// Pinned by tests: the honest column set of the timeline payload itself.
const CSV_HEADERS = [
  'cycle',
  'state',
  'granted_at',
  'withdrawn_at',
  'stood_days',
  'purpose',
  'policy_version',
  'employee_code',
  'employee_name',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeConsentCsvCell(value: unknown): string {
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
 * The state column speaks the timeline's own language — the same two words
 * the chips wear on screen ("Standing" / "Withdrawn"), derived from the
 * withdrawnAt the ledger stores, never from a free-text status string.
 */
export function consentTimelineStateLabel(withdrawnAt: string | null): string {
  return withdrawnAt ? 'WITHDRAWN' : 'STANDING';
}

function iso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Serialize timeline events to RFC 4180 CSV (CRLF line endings, header row
 * first). Rows keep their input order — the timeline arrives oldest →
 * newest, and a ledger reads top to bottom. A standing consent leaves
 * withdrawn_at and stood_days empty: the row says STANDING, and an open
 * consent has no honest day count to file.
 */
export function buildConsentTimelineCsv(rows: ConsentTimelineCsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        escapeConsentCsvCell(r.cycle),
        escapeConsentCsvCell(consentTimelineStateLabel(r.withdrawnAt)),
        escapeConsentCsvCell(iso(r.grantedAt)),
        escapeConsentCsvCell(r.withdrawnAt ? iso(r.withdrawnAt) : ''),
        escapeConsentCsvCell(r.stoodDays ?? ''),
        escapeConsentCsvCell(r.purpose),
        escapeConsentCsvCell(r.policyVersion ?? ''),
        escapeConsentCsvCell(r.employeeCode),
        escapeConsentCsvCell(r.employeeName),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** The drawer's file name: consent-timeline-{code}-{date}.csv, sanitized. */
export function consentTimelineCsvFilename(employeeCode: string, when: Date = new Date()): string {
  const code = employeeCode.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const day = when.toISOString().slice(0, 10);
  return `consent-timeline-${code}-${day}.csv`;
}
