// src/lib/hr/desk-report.ts
//
// v2.69.0: the desk files its report — a printable per-branch roll-up of the
// LeaveReviewVisit ledger over an EXPLICIT window (7, 14 or 30 EAT calendar
// days, today included), optionally narrowed to one branch.
//
// v2.71.0: the report opens its ledger — the same one-pass derivation now
// also produces the visit-scale LEDGER (every visit in the window, newest
// first), and the view drills into any reviewer's own rows without a second
// fetch: the roll-up and the drill-down can never disagree because both come
// from the same read.
//
// WHY: the morning-note family (v2.67.0 strip, v2.68.0 bell) tells the org
// what happened YESTERDAY; a filing desk needs more than yesterday. The
// report answers the window questions in one printable page — totals, a
// per-branch roll-up, the day-by-day rhythm, the reviewers who did the desk
// work and the most-visited requests — from the SAME ledger, computed
// server-side so a printed copy can never disagree with the screen.
//
// SCOPE CONTRACT (differs from the morning note on purpose): the digest note
// is always org-wide — it is the org's shared yesterday. The report is an
// explicit scope the caller chooses: window chips (7/14/30) and an optional
// branch narrow both re-key the whole report, and the UI says which scope it
// is printing. The route that serves this is a pure READ — no bell, no
// notification writes; printing a report never rings anything.
//
// This module is PURE: no db, no network, no env (same constraint as
// desk-digest-note.ts) — unit tests run without any mocking.

// The CSV builder reuses the digest CSV's escaper (OWASP formula-injection
// guard included) — one escaping implementation for every filing file.
import { csvCell } from '@/lib/hr/digest-csv';

/** The selectable window lengths, in EAT calendar days (today included). */
export const DESK_REPORT_WINDOW_DAYS = [7, 14, 30] as const;

/** Absent/invalid ?days= falls back to this. */
export const DESK_REPORT_DEFAULT_DAYS: number = 7;

/** The most-visited requests listed at the foot of the report. */
export const DESK_REPORT_TOP_REQUESTS_LIMIT = 5;

/** The report serves the same audience the desk activity panel does. */
export const DESK_REPORT_ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

const EAT_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Resolve the ?days= query param: a member of DESK_REPORT_WINDOW_DAYS stands
 * as-is; anything else (absent, non-numeric, out of range) falls back to the
 * default — the report never errors on a mistyped window, it just narrows to
 * the honest default.
 */
export function resolveDeskReportDays(raw: string | null | undefined): number {
  const n = Number(raw ?? NaN);
  return (DESK_REPORT_WINDOW_DAYS as readonly number[]).includes(n)
    ? n
    : DESK_REPORT_DEFAULT_DAYS;
}

/**
 * The report window: the LAST `days` EAT (UTC+3, Nairobi) calendar days,
 * TODAY included — a real calendar window, not a trailing 24h*N. Returns
 * [start, end) epochs where end = EAT-midnight of tomorrow, so every visit
 * from local midnight `days-1` days ago through 23:59:59 today counts.
 */
export function deskReportWindow(
  now: Date,
  days: number,
): { start: Date; end: Date } {
  const eatNow = new Date(now.getTime() + EAT_OFFSET_MS);
  const todayStartEAT = Date.UTC(
    eatNow.getUTCFullYear(), eatNow.getUTCMonth(), eatNow.getUTCDate(),
  );
  const end = new Date(todayStartEAT + DAY_MS - EAT_OFFSET_MS);
  const start = new Date(end.getTime() - days * DAY_MS);
  return { start, end };
}

/** The EAT wall date key ('YYYY-MM-DD') of an epoch — the desk's calendar. */
export function deskReportDayKey(at: Date): string {
  return new Date(at.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** '2026-10-16' → 'Fri, 16 Oct' — the same en-GB label the strip uses. */
export function deskReportDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/**
 * 'Fri, 10 Oct → Sat, 17 Oct' — the window label the report header prints.
 * `end` is exclusive, so the right-hand day is the day before it.
 */
export function deskReportWindowLabel(start: Date, end: Date): string {
  const endKey = deskReportDayKey(new Date(end.getTime() - DAY_MS));
  return `${deskReportDayLabel(deskReportDayKey(start))} → ${deskReportDayLabel(endKey)}`;
}

/** Store names share the "MBUMAH HARDWARE - X" prefix — chips wear the rest. */
export function deskReportShortStoreName(name: string): string {
  return name.replace(/^MBUMAH HARDWARE\s*-\s*/i, '') || name;
}

// v2.65.0 precedent: per-reviewer avatar hue — a deterministic hash of the
// name picks one of six soft duotones so the same reviewer reads as the same
// person on the report as they do on the console panel. Light + dark.
export const DESK_REPORT_AVATAR_HUES = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
] as const;

export function deskReportAvatarHue(name: string): string {
  const hash = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return DESK_REPORT_AVATAR_HUES[hash % DESK_REPORT_AVATAR_HUES.length];
}

// ── data shapes ─────────────────────────────────────────────────────────────

/** One ledger row as the route selects it (visit-scale, already joined). */
export interface DeskReportVisitRow {
  /** The visit's own id — the drill-down ledger keys its rows with it. */
  id: string;
  visitedByName: string;
  createdAt: Date;
  clearedRecheck: boolean;
  leaveRequestId: string;
  leaveRequest: {
    status: string;
    storeId: string;
    store: { name: string } | null;
    employee: { firstName: string; lastName: string };
    leaveType: { name: string } | null;
  };
}

export interface DeskReportBranchRow {
  storeId: string;
  storeName: string;
  visits: number;
  clears: number;
  reviewers: number;
  requests: number;
  lastVisitAt: string | null;
}

export interface DeskReportReviewerRow {
  name: string;
  visits: number;
  clears: number;
  branches: number;
  lastVisitAt: string | null;
}

/**
 * One visit in the drill-down ledger (v2.71.0) — a compact, UI-ready mirror
 * of a DeskReportVisitRow: the same facts the roll-up aggregates, per visit,
 * newest first. The view filters this by reviewer; the CSV ignores it (the
 * filed format stays the roll-up).
 */
export interface DeskReportVisitEntry {
  id: string;
  /** ISO instant of the visit. */
  at: string;
  /** EAT wall date key ('YYYY-MM-DD') — the desk's calendar. */
  dayKey: string;
  storeId: string;
  storeName: string;
  reviewer: string;
  employeeName: string;
  leaveTypeName: string;
  status: string;
  cleared: boolean;
  requestId: string;
}

export interface DeskReportSeriesPoint {
  key: string;
  label: string;
  visits: number;
  clears: number;
}

export interface DeskReportRequestRow {
  requestId: string;
  employeeName: string;
  leaveTypeName: string;
  storeName: string | null;
  status: string;
  visits: number;
  lastVisitAt: string | null;
}

export interface DeskReportData {
  window: { start: string; end: string; label: string; days: number };
  totals: { visits: number; clears: number; reviewers: number; requests: number };
  branches: DeskReportBranchRow[];
  reviewers: DeskReportReviewerRow[];
  series: DeskReportSeriesPoint[];
  topRequests: DeskReportRequestRow[];
  /** v2.71.0 — every visit in the window, newest first (the drill-down). */
  ledger: DeskReportVisitEntry[];
}

/**
 * The full API payload of GET /api/org/desk-report: the derived report plus
 * the read metadata (generatedAt) and the explicit scope the caller picked
 * (branch id + the human store name resolved from the rows, null = org-wide).
 */
export type DeskReportPayload = DeskReportData & {
  generatedAt: string;
  scope: { branch: string | null; branchName: string | null };
};

/**
 * Derive the whole report from the window rows in ONE pass — the ledger is
 * visit-scale (one row per dialog open), so a full scan of the window is the
 * honest cheap read. Every series day is present even when empty (honest
 * zeros keep the bar strip truthful); empty rows derive to an all-zero
 * report and the UI says the desk was quiet.
 */
export function deriveDeskReport(
  rows: readonly DeskReportVisitRow[],
  win: { start: Date; end: Date; days: number },
): DeskReportData {
  const dayKeys = Array.from({ length: win.days }, (_, i) =>
    deskReportDayKey(new Date(win.start.getTime() + i * DAY_MS)),
  );
  const dayVisits = new Map<string, number>(dayKeys.map((k) => [k, 0]));
  const dayClears = new Map<string, number>(dayKeys.map((k) => [k, 0]));

  const branchAgg = new Map<string, {
    storeName: string; visits: number; clears: number;
    reviewers: Set<string>; requests: Set<string>; last: Date | null;
  }>();
  const reviewerAgg = new Map<string, {
    visits: number; clears: number; branches: Set<string>; last: Date | null;
  }>();
  const requestAgg = new Map<string, {
    employeeName: string; leaveTypeName: string; storeName: string | null;
    status: string; visits: number; last: Date | null;
  }>();

  // v2.71.0: the drill-down ledger grows in the SAME pass — one row in, one
  // entry out (plus the aggregates), so the ledger and the roll-up are
  // derived from the same scan by construction.
  const ledger: DeskReportVisitEntry[] = [];

  let clears = 0;
  for (const row of rows) {
    if (row.clearedRecheck) clears += 1;

    const dayKey = deskReportDayKey(row.createdAt);
    if (dayVisits.has(dayKey)) {
      dayVisits.set(dayKey, (dayVisits.get(dayKey) ?? 0) + 1);
      if (row.clearedRecheck) dayClears.set(dayKey, (dayClears.get(dayKey) ?? 0) + 1);
    }

    const storeName = row.leaveRequest.store?.name ?? row.leaveRequest.storeId;
    const storeId = row.leaveRequest.storeId;
    ledger.push({
      id: row.id,
      at: row.createdAt.toISOString(),
      dayKey,
      storeId,
      storeName,
      reviewer: row.visitedByName,
      employeeName: `${row.leaveRequest.employee.firstName} ${row.leaveRequest.employee.lastName}`,
      leaveTypeName: row.leaveRequest.leaveType?.name ?? 'Leave',
      status: row.leaveRequest.status,
      cleared: row.clearedRecheck,
      requestId: row.leaveRequestId,
    });
    const branch = branchAgg.get(storeId) ?? {
      storeName, visits: 0, clears: 0, reviewers: new Set<string>(), requests: new Set<string>(), last: null as Date | null,
    };
    branch.visits += 1;
    if (row.clearedRecheck) branch.clears += 1;
    branch.reviewers.add(row.visitedByName);
    branch.requests.add(row.leaveRequestId);
    if (!branch.last || row.createdAt > branch.last) branch.last = row.createdAt;
    branchAgg.set(storeId, branch);

    const reviewer = reviewerAgg.get(row.visitedByName) ?? {
      visits: 0, clears: 0, branches: new Set<string>(), last: null as Date | null,
    };
    reviewer.visits += 1;
    if (row.clearedRecheck) reviewer.clears += 1;
    reviewer.branches.add(storeId);
    if (!reviewer.last || row.createdAt > reviewer.last) reviewer.last = row.createdAt;
    reviewerAgg.set(row.visitedByName, reviewer);

    const request = requestAgg.get(row.leaveRequestId) ?? {
      employeeName: `${row.leaveRequest.employee.firstName} ${row.leaveRequest.employee.lastName}`,
      leaveTypeName: row.leaveRequest.leaveType?.name ?? 'Leave',
      storeName: row.leaveRequest.store?.name ?? null,
      status: row.leaveRequest.status,
      visits: 0,
      last: null as Date | null,
    };
    request.visits += 1;
    if (!request.last || row.createdAt > request.last) request.last = row.createdAt;
    requestAgg.set(row.leaveRequestId, request);
  }

  const branches = [...branchAgg.entries()]
    .map(([storeId, b]) => ({
      storeId,
      storeName: b.storeName,
      visits: b.visits,
      clears: b.clears,
      reviewers: b.reviewers.size,
      requests: b.requests.size,
      lastVisitAt: b.last ? b.last.toISOString() : null,
    }))
    .sort((a, b) => b.visits - a.visits || a.storeName.localeCompare(b.storeName));

  const reviewers = [...reviewerAgg.entries()]
    .map(([name, r]) => ({
      name,
      visits: r.visits,
      clears: r.clears,
      branches: r.branches.size,
      lastVisitAt: r.last ? r.last.toISOString() : null,
    }))
    .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));

  const series = dayKeys.map((key) => ({
    key,
    label: deskReportDayLabel(key),
    visits: dayVisits.get(key) ?? 0,
    clears: dayClears.get(key) ?? 0,
  }));

  const topRequests = [...requestAgg.entries()]
    .map(([requestId, r]) => ({
      requestId,
      employeeName: r.employeeName,
      leaveTypeName: r.leaveTypeName,
      storeName: r.storeName,
      status: r.status,
      visits: r.visits,
      lastVisitAt: r.last ? r.last.toISOString() : null,
    }))
    .sort((a, b) =>
      b.visits - a.visits
      || (b.lastVisitAt ?? '').localeCompare(a.lastVisitAt ?? '')
      || a.employeeName.localeCompare(b.employeeName),
    )
    .slice(0, DESK_REPORT_TOP_REQUESTS_LIMIT);

  // Newest first, deterministic on its own (the pure module never relies on
  // db ordering): latest instant wins, the id breaks exact ties.
  ledger.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

  return {
    window: {
      start: win.start.toISOString(),
      end: win.end.toISOString(),
      label: deskReportWindowLabel(win.start, win.end),
      days: win.days,
    },
    totals: {
      visits: rows.length,
      clears,
      reviewers: reviewerAgg.size,
      requests: requestAgg.size,
    },
    branches,
    reviewers,
    series,
    topRequests,
    ledger,
  };
}

// ── the drill-down (v2.71.0) ────────────────────────────────────────────────

/**
 * The reviewer drill-down: one reviewer's own visits from the ledger, in the
 * ledger's order (newest first — the filter preserves it). The view calls
 * this with the payload's ledger; an unknown reviewer derives to an honest
 * empty list, never an error.
 */
export function deskReportReviewerLedger(
  ledger: readonly DeskReportVisitEntry[],
  reviewer: string,
): DeskReportVisitEntry[] {
  return ledger.filter((entry) => entry.reviewer === reviewer);
}

/**
 * '10:00' — the EAT wall clock time of a visit, for the drill-down rows.
 * The desk reads Nairobi time; a UTC slice would lie by three hours.
 */
export function deskReportVisitTime(at: string): string {
  return new Date(new Date(at).getTime() + EAT_OFFSET_MS).toISOString().slice(11, 16);
}

// ── the CSV builder (v2.70.0) ───────────────────────────────────────────────


/**
 * Build the ready-to-file CSV for a desk report — the same figures the page
 * prints, serialized server-side so a downloaded file can never disagree
 * with the screen (the same rule the digest CSVs follow since v2.46.0). The
 * OWASP formula-injection guard rides along free: every cell goes through
 * the shared csvCell escaper (a leading `=`, `+`, `-`, `@` or tab gets a
 * `'` prefix), so a tampered store or reviewer name can never arrive as a
 * spreadsheet formula.
 *
 * Layout (RFC-4180, CRLF records):
 *   Report,Desk report
 *   Organization,<org>
 *   Scope,All branches | Branch: <name>
 *   Window,<label> (<days> EAT days)
 *   Generated (UTC),<iso>
 *   (blank)
 *   Summary
 *   Metric,Value
 *   <4 totals rows>
 *   (blank)
 *   Day by day
 *   Date,Day,Visits,Corrections answered
 *   <one row per window day, honest zeros included>
 *   (blank)
 *   By branch
 *   Branch,Visits,Corrections answered,Reviewers,Requests,Last visit (UTC)
 *   <one row per branch, visits desc>
 *   (blank)
 *   Reviewers
 *   Name,Visits,Corrections answered,Branches,Last visit (UTC)
 *   <one row per reviewer, visits desc>
 *   (blank)
 *   Most-visited requests
 *   Employee,Leave type,Branch,Status,Visits,Last visit (UTC)
 *   <up to five rows>
 *
 * The report is derived from the ledger either way — an empty window yields
 * the honest header + all-zero series (a quiet window still files).
 */
export function deskReportToCsv(
  report: DeskReportData,
  meta: { organizationName: string; scopeLabel: string; generatedAt?: Date },
): string {
  const generatedAt = meta.generatedAt ?? new Date();
  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', 'Desk report']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Window', `${report.window.label} (${report.window.days} EAT days)`]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Summary');
  row(['Metric', 'Value']);
  row(['Visits', report.totals.visits]);
  row(['Corrections answered', report.totals.clears]);
  row(['Reviewers', report.totals.reviewers]);
  row(['Requests touched', report.totals.requests]);

  lines.push('');
  lines.push('Day by day');
  row(['Date', 'Day', 'Visits', 'Corrections answered']);
  for (const p of report.series) {
    row([p.key, p.label, p.visits, p.clears]);
  }

  lines.push('');
  lines.push('By branch');
  row(['Branch', 'Visits', 'Corrections answered', 'Reviewers', 'Requests', 'Last visit (UTC)']);
  for (const b of report.branches) {
    row([b.storeName, b.visits, b.clears, b.reviewers, b.requests, b.lastVisitAt ?? '']);
  }

  lines.push('');
  lines.push('Reviewers');
  row(['Name', 'Visits', 'Corrections answered', 'Branches', 'Last visit (UTC)']);
  for (const r of report.reviewers) {
    row([r.name, r.visits, r.clears, r.branches, r.lastVisitAt ?? '']);
  }

  lines.push('');
  lines.push('Most-visited requests');
  row(['Employee', 'Leave type', 'Branch', 'Status', 'Visits', 'Last visit (UTC)']);
  for (const r of report.topRequests) {
    row([r.employeeName, r.leaveTypeName, r.storeName ?? '', r.status, r.visits, r.lastVisitAt ?? '']);
  }

  // RFC-4180: CRLF between records, trailing CRLF at end of file.
  return lines.join('\r\n') + '\r\n';
}

/**
 * The download filename for the CSV: window bounds + scope, e.g.
 * mbumah-desk-report-7d-2026-10-11_2026-10-17-all-branches.csv (EAT wall
 * dates of the window bounds; the branch slug when narrowed — filed copies
 * never overwrite each other).
 */
export function deskReportCsvFilename(report: DeskReportPayload): string {
  // EAT wall dates, not UTC slices of the window epochs — the filename names
  // the days the desk means (the window start is an EAT-midnight epoch whose
  // UTC date is the day before the desk's).
  const start = deskReportDayKey(new Date(report.window.start));
  const end = deskReportDayKey(new Date(new Date(report.window.end).getTime() - DAY_MS));
  const scope = report.scope.branch
    ? report.scope.branch.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'branch'
    : 'all-branches';
  return `mbumah-desk-report-${report.window.days}d-${start}_${end}-${scope}.csv`;
}
