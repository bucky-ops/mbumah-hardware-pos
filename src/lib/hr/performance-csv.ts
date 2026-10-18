// src/lib/hr/performance-csv.ts
//
// v2.96.0: the performance reviews list files itself — a governed CSV of the
// EXACT filtered subset the Reviews tab shows, built by ONE server-side
// builder so a downloaded file can never disagree with the screen.
//
// v2.97.0: the family completes — cycles and goals file through the SAME
// contract (same header-block layout, same escaper, same filename honesty).
// The cycles filing carries a deliberate narrowing: CycleCsvRow has NO
// calibrationNotes field, because the export route is read-guarded
// (hr.performance.review) while notes are manage-only content — a reviewer
// who can file the list must not receive the manager's private notes in the
// file. The input type makes that leak impossible by construction, the same
// way the reviews builder's rating-free input does.
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

/**
 * v2.97.0: the filing row for one review cycle — deliberately NOT the full
 * CycleDto. The DTO carries calibrationNotes (manage-only content, shown in
 * the drawer behind canEditNotes); this slice omits it, so a read-guarded
 * export can compile-time never leak the notes into a reviewer's file.
 */
export interface CycleCsvRow {
  name: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  reviewCount: number;
  statusCounts: { DRAFT: number; SUBMITTED: number; ACKNOWLEDGED: number; CALIBRATED: number };
  createdAt: string;
}

export interface CycleCsvMeta {
  organizationName: string;
  scopeLabel: string;
}

/**
 * Build the governed CSV for the cycles list (v2.97.0). The cycles tab has
 * no filters — the file is the whole list the screen shows, newest period
 * first (the service's order). Status stays the raw lifecycle enum
 * (DRAFT / ACTIVE / CLOSED); the per-status counts ride as their own
 * columns so a reconciliation can rebuild the calibration meter offline.
 */
export function cyclesToCsv(
  cycles: readonly CycleCsvRow[],
  meta: CycleCsvMeta,
  generatedAt: Date = new Date(),
): ReviewCsvFile | null {
  if (cycles.length === 0) return null;

  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Performance cycles']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Cycles');
  row(['Cycle', 'Period start', 'Period end', 'Status', 'Reviews', 'Calibrated', 'Draft', 'Submitted', 'Acknowledged', 'Created']);
  for (const c of cycles) {
    row([
      c.name,
      dayKey(c.periodStart),
      dayKey(c.periodEnd),
      c.status,
      c.reviewCount,
      c.statusCounts.CALIBRATED,
      c.statusCounts.DRAFT,
      c.statusCounts.SUBMITTED,
      c.statusCounts.ACKNOWLEDGED,
      dayKey(c.createdAt),
    ]);
  }

  const csv = lines.join('\r\n') + '\r\n';
  const filename = 'mbumah-performance-cycles.csv';

  return { filename, csv, byteSize: Buffer.byteLength(csv, 'utf8') };
}

/**
 * v2.97.0: the filing row for one team goal — the board DTO's visible
 * facts. Values stay the service's fixed-two-decimal strings (machine-
 * readable, locale-independent); progress is the service's clamped 0-100
 * number. metricLabel is the CUSTOM metric's own name — the same honesty
 * the board card shows; empty when the source needs no label.
 */
export interface GoalCsvRow {
  title: string;
  employeeName: string | null;
  cycleName: string | null;
  metricSource: string;
  metricLabel: string | null;
  status: string;
  currentValue: string;
  targetValue: string;
  progressPct: number;
  dueDate: string | null;
}

export interface GoalCsvMeta {
  organizationName: string;
  scopeLabel: string;
  /** Human label of the source filter, e.g. "sales total" or "all". */
  sourceLabel: string;
  /** Human label of the status filter, e.g. "open" or "all". */
  statusLabel: string;
}

/**
 * Build the governed CSV for the goals list (v2.97.0) — the EXACT filtered
 * subset the Goals tab shows (employee / source / status filters ride the
 * query, re-run by the service). Deleted goals never file: the export
 * re-runs listGoals (live board), and the bench has its own reconcile view.
 */
export function goalsToCsv(
  goals: readonly GoalCsvRow[],
  meta: GoalCsvMeta,
  generatedAt: Date = new Date(),
): ReviewCsvFile | null {
  if (goals.length === 0) return null;

  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Team goals']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Source', meta.sourceLabel]);
  row(['Status', meta.statusLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Goals');
  row(['Goal', 'Employee', 'Cycle', 'Source', 'Metric', 'Status', 'Current', 'Target', 'Progress %', 'Due']);
  for (const g of goals) {
    row([
      g.title,
      g.employeeName ?? '',
      g.cycleName ?? '',
      g.metricSource,
      g.metricLabel ?? '',
      g.status,
      g.currentValue,
      g.targetValue,
      g.progressPct,
      dayKey(g.dueDate),
    ]);
  }

  const csv = lines.join('\r\n') + '\r\n';
  const source = slug(meta.sourceLabel, 'all');
  const status = slug(meta.statusLabel, 'all');
  const filename = `mbumah-performance-goals-${source}-${status}.csv`;

  return { filename, csv, byteSize: Buffer.byteLength(csv, 'utf8') };
}

/**
 * v2.99.0: the filing row for one bench goal — the DeletedGoalDto's visible
 * facts plus the bench's own honest stamp (deletedAt, the WHEN a goal
 * left). The bench is manage-only content (the list route is
 * hr.performance.manage-guarded and reviewers read the live board only),
 * so this row can carry the deletion stamp the board never shows: the
 * whole point of the filing is reconciling what left, with what values,
 * under which cycle, and when.
 */
export interface BenchCsvRow {
  title: string;
  employeeName: string | null;
  cycleName: string | null;
  metricSource: string;
  metricLabel: string | null;
  status: string;
  currentValue: string;
  targetValue: string;
  progressPct: number;
  dueDate: string | null;
  deletedAt: string;
}

export interface BenchCsvMeta {
  organizationName: string;
  scopeLabel: string;
  /**
   * Honesty about the bench's own window: the service returns the 50 most
   * recent deletions (take: 50). When the underlying bench is larger, the
   * header block says so instead of letting the file silently pose as the
   * whole bench. 'all' when nothing was cut.
   */
  windowLabel: string;
}

/**
 * Build the governed CSV for the goal bench (v2.99.0) — the exact rows the
 * bench dialog shows, newest deletion first (the service's order). The
 * family completes: reviews (v2.96), cycles + goals (v2.97), and now the
 * bench (v2.99) all file through the same header-block contract, the same
 * escaper, the same filename honesty. The Deleted column is the day key of
 * deletedAt — the same day precision every other date column uses.
 */
export function benchToCsv(
  goals: readonly BenchCsvRow[],
  meta: BenchCsvMeta,
  generatedAt: Date = new Date(),
): ReviewCsvFile | null {
  if (goals.length === 0) return null;

  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Goal bench (recently deleted)']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Window', meta.windowLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Bench');
  row(['Goal', 'Employee', 'Cycle', 'Source', 'Metric', 'Status', 'Current', 'Target', 'Progress %', 'Due', 'Deleted']);
  for (const g of goals) {
    row([
      g.title,
      g.employeeName ?? '',
      g.cycleName ?? '',
      g.metricSource,
      g.metricLabel ?? '',
      g.status,
      g.currentValue,
      g.targetValue,
      g.progressPct,
      dayKey(g.dueDate),
      dayKey(g.deletedAt),
    ]);
  }

  const csv = lines.join('\r\n') + '\r\n';
  const filename = 'mbumah-performance-bench.csv';

  return { filename, csv, byteSize: Buffer.byteLength(csv, 'utf8') };
}
