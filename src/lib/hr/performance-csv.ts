// src/lib/hr/performance-csv.ts
//
// v2.96.0: the performance reviews list files itself — a governed CSV of the
// EXACT filtered subset the Reviews tab shows, built by ONE server-side
// builder so a downloaded file can never disagree with the screen.
//
// WHY: the desk report (v2.70) and every per-table report tab (v2.58) file
// themselves through a governed builder — header block, OWASP formula-
// injection guard, honest filename. The performance reviews list was the
// last HR surface a manager could LOOK at but not FILE: a reconciliation or
// a compliance pack meant retyping rows by hand. This module gives the
// reviews tab the same filing contract, reusing the digest CSV's escaper so
// the injection guard is one implementation shared everywhere.
//
// PRIVACY FLOOR: the input is the ReviewListItemDto — the list shape the
// spec's rule 7 keeps rating-free. A filing copy of the list can therefore
// never carry a rating or a narrative; those live only in the gated detail
// dialog. The builder's input type makes the leak impossible by
// construction.
//
// This module is PURE: no db, no network, no env — unit tests run without
// any mocking.

import { csvCell } from '@/lib/hr/digest-csv';

/** The rating-free list row the Reviews tab renders (service DTO). */
export interface ReviewCsvRow {
  employeeName: string;
  jobTitle: string | null;
  cycleName: string;
  status: string;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface ReviewCsvMeta {
  organizationName: string;
  scopeLabel: string;
  /** Human label of the cycle filter, e.g. "H2 2026 Reviews" or "All cycles". */
  cycleLabel: string;
  /** Human label of the status filter, e.g. "draft" or "all". */
  statusLabel: string;
}

/** A ready-to-download governed file. `csv` is RFC-4180, UTF-8, CRLF-ended. */
export interface ReviewCsvFile {
  filename: string;
  csv: string;
  byteSize: number;
}

/** '2026-10-17T09:21:00.000Z' → '2026-10-17'; null/invalid → ''. */
function dayKey(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Lowercase, non-alphanumeric → '-', like every governed filename fragment
 * (digest-csv's slug). An all-punctuation label falls back to the fallback
 * so the file is never anonymous.
 */
function slug(value: string, fallback: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

/**
 * Build the governed CSV for the reviews list. Returns null when the list is
 * empty (nothing to file) — the route turns that into an honest 404
 * NO_REVIEW_DATA, exactly like the report export's NO_REPORT_DATA.
 *
 * Layout (the governed family: digest-csv tableToCsv, desk-report slices):
 *   Report,Performance reviews
 *   Organization,<org>
 *   Scope,<scope>
 *   Cycle,<cycle label>
 *   Status,<status label>
 *   Generated (UTC),<iso timestamp>
 *   (blank)
 *   Reviews
 *   Employee,Job title,Cycle,Status,Acknowledged,Created
 *   <one row per review, the order the screen shows>
 *
 * Dates are ISO day keys (YYYY-MM-DD, UTC) — the same day precision the
 * screen shows, unambiguous in any spreadsheet locale. Status values stay
 * the raw lifecycle enums (DRAFT / SUBMITTED / ACKNOWLEDGED / CALIBRATED)
 * the API speaks — machine-readable, and they match the desk report's
 * status column convention.
 */
export function reviewsToCsv(
  reviews: readonly ReviewCsvRow[],
  meta: ReviewCsvMeta,
  generatedAt: Date = new Date(),
): ReviewCsvFile | null {
  if (reviews.length === 0) return null;

  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Performance reviews']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Cycle', meta.cycleLabel]);
  row(['Status', meta.statusLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Reviews');
  row(['Employee', 'Job title', 'Cycle', 'Status', 'Acknowledged', 'Created']);
  for (const r of reviews) {
    row([
      r.employeeName,
      r.jobTitle ?? '',
      r.cycleName,
      r.status,
      dayKey(r.acknowledgedAt),
      dayKey(r.createdAt),
    ]);
  }

  const csv = lines.join('\r\n') + '\r\n';
  const cycle = slug(meta.cycleLabel, 'all-cycles');
  const status = slug(meta.statusLabel, 'all');
  const filename = `mbumah-performance-reviews-${cycle}-${status}.csv`;

  return { filename, csv, byteSize: Buffer.byteLength(csv, 'utf8') };
}
