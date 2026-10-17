// src/lib/hr/digest-csv.ts
//
// v2.46.0: turn an HR report digest into a ready-to-file CSV attachment.
//
// WHY: digest emails until now carried the numbers only as HTML/text in the
// message body — a recipient who wanted to file or reconcile the figures had
// to retype them. Every scheduled and manual digest now travels with a
// RFC-4180 CSV built from the SAME aggregate-only payload the email body
// uses (no new data, no new scope, no names / national IDs / raw ids — the
// governed fail-closed contract is untouched).
//
// This module is PURE: no db, no network, no env. It imports only the
// digest data type from email-templates (itself a dependency-free module),
// so unit tests run without any mocking.

import type { HrReportDigestData } from '@/lib/email-templates';

/** A send-ready email attachment: base64 content + metadata for audit rows. */
export interface DigestCsvAttachment {
  /** e.g. mbumah-absence-2026-10-01_2026-10-31.csv */
  filename: string;
  /** RFC-4180 CSV, UTF-8, base64-encoded (Resend attachment contract). */
  content: string;
  /** Decoded byte size — for metadata, caps and the "CSV · X KB" chip. */
  byteSize: number;
}

// ── escaping ────────────────────────────────────────────────────────────────

/**
 * Escape one CSV cell (RFC-4180): wrap in quotes when the value contains a
 * comma, quote or newline, doubling embedded quotes.
 *
 * CSV FORMULA-INJECTION GUARD (OWASP): a cell that starts with `=`, `+`,
 * `-`, `@` or a tab would be interpreted as a formula by spreadsheets when
 * the file is opened. Those cells get a leading `'` so they render as text.
 * Every cell in a digest is a label or a non-negative aggregate, so this
 * never fires in practice — it is a defence against tampered data reaching
 * a spreadsheet, not a cosmetic rule.
 */
export function csvCell(value: string | number): string {
  const raw = String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Join one CSV record with CRLF (RFC-4180). */
function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(',');
}

/** Lowercase, non-alphanumeric → '-' (used for the attachment filename). */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** '2026-10-01 → 2026-10-31' → '2026-10-01_2026-10-31' (filename-safe). */
export function periodFilenameFragment(periodLabel: string): string {
  return periodLabel
    .split('→')
    .map((p) => p.trim())
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p))
    .join('_');
}

// ── the builder ─────────────────────────────────────────────────────────────

/**
 * Build the CSV attachment for a digest. Returns null when the digest has
 * neither headline metrics nor a table (nothing to file) — the caller then
 * sends the email without an attachment, exactly as before.
 *
 * Layout:
 *   Report,<label>
 *   Organization,<org>
 *   Scope,<scope>
 *   Period,<period>
 *   Frequency,<frequency>
 *   Generated (UTC),<iso timestamp>
 *   (blank)
 *   Summary
 *   Metric,Value
 *   <headline rows>
 *   (blank)
 *   <table caption>          ← only when the digest carries a table
 *   <column headers>
 *   <table rows>
 */
export function digestToCsv(
  digest: HrReportDigestData,
  generatedAt: Date = new Date(),
): DigestCsvAttachment | null {
  const headline = digest.headline ?? [];
  const table = digest.table;
  if (headline.length === 0 && (!table || table.rows.length === 0)) {
    return null;
  }

  const lines: string[] = [];
  lines.push(csvRow(['Report', digest.reportLabel]));
  lines.push(csvRow(['Organization', digest.organizationName]));
  lines.push(csvRow(['Scope', digest.scopeLabel]));
  lines.push(csvRow(['Period', digest.periodLabel]));
  lines.push(csvRow(['Frequency', digest.frequencyLabel]));
  lines.push(csvRow(['Generated (UTC)', generatedAt.toISOString()]));

  if (headline.length > 0) {
    lines.push('');
    lines.push(csvRow(['Summary']));
    lines.push(csvRow(['Metric', 'Value']));
    for (const line of headline) {
      lines.push(csvRow([line.label, line.value]));
    }
  }

  if (table && table.rows.length > 0) {
    lines.push('');
    lines.push(csvRow([table.caption]));
    lines.push(csvRow(table.columns));
    for (const row of table.rows) {
      lines.push(csvRow(row));
    }
  }

  // RFC-4180: CRLF between records, trailing CRLF at end of file.
  const csv = lines.join('\r\n') + '\r\n';
  const byteSize = Buffer.byteLength(csv, 'utf8');
  const period = periodFilenameFragment(digest.periodLabel) || 'period';
  const filename = `mbumah-${slug(digest.reportLabel)}-${period}.csv`;

  return {
    filename,
    content: Buffer.from(csv, 'utf8').toString('base64'),
    byteSize,
  };
}

/** '1234' bytes → '1.2 KB' (one decimal; < 1024 stays bytes). */
export function formatCsvSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── the table-section builder (v2.58.0) ────────────────────────────────────

/**
 * Build the TABLE-SECTION CSV for a report — the same governed file a digest
 * email carries (header block, injection guard, honest filename), minus the
 * Summary block, so a per-table "CSV" button on a report tab delivers the
 * table the user is LOOKING at in the exact shape every other filing file
 * uses. One builder on the server means a downloaded table can never
 * disagree with the email, and the OWASP formula-injection guard applies to
 * ad-hoc downloads too (the client-side builder it replaces had neither).
 *
 * Layout:
 *   Report,<label>
 *   Organization,<org>
 *   Scope,<scope>
 *   Period,<period>
 *   Frequency,<frequency>
 *   Generated (UTC),<iso timestamp>
 *   (blank)
 *   <table caption>
 *   <column headers>
 *   <table rows>
 *
 * Returns null when the digest carries no table (nothing to file at table
 * granularity) — the route turns that into an honest 404 NO_TABLE_DATA.
 */
export function tableToCsv(
  digest: HrReportDigestData,
  generatedAt: Date = new Date(),
): DigestCsvAttachment | null {
  const table = digest.table;
  if (!table || table.rows.length === 0) {
    return null;
  }

  const lines: string[] = [];
  lines.push(csvRow(['Report', digest.reportLabel]));
  lines.push(csvRow(['Organization', digest.organizationName]));
  lines.push(csvRow(['Scope', digest.scopeLabel]));
  lines.push(csvRow(['Period', digest.periodLabel]));
  lines.push(csvRow(['Frequency', digest.frequencyLabel]));
  lines.push(csvRow(['Generated (UTC)', generatedAt.toISOString()]));
  lines.push('');
  lines.push(csvRow([table.caption]));
  lines.push(csvRow(table.columns));
  for (const row of table.rows) {
    lines.push(csvRow(row));
  }

  // RFC-4180: CRLF between records, trailing CRLF at end of file.
  const csv = lines.join('\r\n') + '\r\n';
  const byteSize = Buffer.byteLength(csv, 'utf8');
  const period = periodFilenameFragment(digest.periodLabel) || 'period';
  const filename = `mbumah-${slug(digest.reportLabel)}-${period}-table.csv`;

  return {
    filename,
    content: Buffer.from(csv, 'utf8').toString('base64'),
    byteSize,
  };
}
