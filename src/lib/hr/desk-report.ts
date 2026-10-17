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
// v2.72.0: the report reads the file — the second family of doors. A
// most-visited request row opens ITS drawer: every visit that request drew
// in the window, newest first, straight from the same ledger. The report
// answers three questions now: who worked the desk (reviewers), which files
// drew the traffic (requests), and what happened inside each — all from one
// read, so no drawer can contradict the roll-up above it.
//
// v2.74.0: the drawers talk to each other. Every row inside a drawer names
// the other family — a request's visit rows say WHO came, a reviewer's
// visit rows say WHICH file they were on — and those names are doors now:
// click a reviewer's name to open their drawer, click a file's name to open
// its drawer. The jump is honest about where it came from (a small "via"
// chip offers the way back), and the one-drawer rule holds — the page never
// shows two drawers at once, so the report never splits the reader's
// attention. The drill-downs complete each other.
//
// v2.78.0: the scope speaks the keyboard. The window and branch chips are
// a roving group now — arrows move between them (wrapping at the ends),
// Enter/Space commits the picked chip, and every re-key is ANNOUNCED: a
// quiet aria-live region says which window or branch the report just
// re-keyed to, so a keyboard or screen-reader user never wonders whether
// the click landed. The walk (j/k) covers the doors; the chips answer the
// arrows. Both speak, neither shouts.
//
// v2.79.0: the drawers file themselves. A drawer has always been a
// screen-only read — filing just one reviewer's or one request's visits
// meant hand-copying rows off the monitor. Now each drawer carries its own
// CSV, built from the SAME one-pass ledger the drawer reads (no second
// fetch, no server round-trip), so the filed copy cannot disagree with
// what the desk is looking at. One column voice for both families — the
// ledger holds every fact either way.
//
// v2.80.0: the report is addressable. An open drawer now rides the URL —
// the desk panel's drill-down hands a reviewer's name to the report as a
// link (?reviewer=…), the report opens that drawer on arrival, and any
// open drawer is reflected back into the address bar (?request=… /
// ?reviewer=…), so the state in front of you is the state you can share.
// The parser and the resolver live here, pure: one decision made against
// the same read the report renders, refusals named honestly (a doorless
// file says exactly that), and the one-drawer rule holds on arrival — a
// link asks for ONE drawer, never two.
//
// v2.81.0: the link carries the whole scope. A drawer address alone opens
// the DEFAULT window — a link to a 14-day, Juja-Main-narrowed report lost
// everything but the drawer. Now ?days= and ?branch= ride beside the
// drawer param: the arrival re-keys the report FIRST (the honest two-beat —
// the default window renders, then the link's scope lands, then the drawer
// resolves against the re-keyed read), the URL mirrors the FULL state
// (window, branch, drawer) from then on, and the desk panel's drill-down
// door hands its branch filter over with the reviewer's name. A drawer
// opened by a link wears a small "from the link" chip, the way a jumped
// drawer wears its "via" chip — the page always says how it got here.
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
 * The request drill-down (v2.72.0): one request's own visits from the
 * ledger, in the ledger's order (newest first — the filter preserves it).
 * The view calls this with the payload's ledger; an unknown requestId
 * derives to an honest empty list, never an error. Every visit of the same
 * request naturally shares its employee/type/status — those facts live on
 * the door row; the drawer adds what the roll-up aggregates away: WHEN the
 * desk came, WHO came, and whether the visit answered a correction.
 */
export function deskReportRequestLedger(
  ledger: readonly DeskReportVisitEntry[],
  requestId: string,
): DeskReportVisitEntry[] {
  return ledger.filter((entry) => entry.requestId === requestId);
}

// ── the cross-links (v2.74.0) ─────────────────────────────────────────

/**
 * The request's human title, read from its own ledger entries (v2.74.0):
 * "who the file belongs to and what kind of file it is". The reviewer
 * drill-down's rows name the request they were visiting; when that request
 * is one of the report's doors, this recovers its label from the SAME
 * ledger the drawer was filtered from — no second read, no prop drilling.
 * Entries of one request share employee/type by construction; the FIRST
 * match answers. Unknown requestId → null, and the caller stays text.
 */
export function deskReportRequestSubject(
  ledger: readonly DeskReportVisitEntry[],
  requestId: string,
): { employeeName: string; leaveTypeName: string } | null {
  const entry = ledger.find((e) => e.requestId === requestId);
  return entry ? { employeeName: entry.employeeName, leaveTypeName: entry.leaveTypeName } : null;
}

/**
 * Whether a request is one of the report's doors (v2.74.0). The request
 * drill-down renders only the window's most-visited requests — a cap, by
 * design (the section is a digest, not the whole ledger) — so a reviewer's
 * visit row may name a file with no drawer beneath it. This guard keeps
 * the cross-link honest: a door is promised only where one exists; the
 * rows that name a doorless file simply stay text.
 */
export function deskReportHasRequestDoor(
  topRequests: readonly { requestId: string }[],
  requestId: string,
): boolean {
  return topRequests.some((r) => r.requestId === requestId);
}

/**
 * The next chip index for an arrow keypress (v2.78.0) — the APG roving
 * pattern for the report's scope chips: ArrowRight/ArrowDown move forward,
 * ArrowLeft/ArrowUp move back, both WRAPPING at the group's ends; Home and
 * End jump to the first and last chip. Anything else (Tab, Enter, a letter)
 * is not the group's business → null, and the caller leaves the key alone.
 * A focus index outside the group, or an empty group, moves nothing — the
 * step is only honest when it starts somewhere real.
 */
export function deskReportChipStep(
  key: string,
  index: number,
  count: number,
): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * The scope re-key's announcement (v2.78.0) — one sentence naming what the
 * report just re-keyed to, for the aria-live region. A window pick names
 * the window; a branch pick names the branch; clearing the branch scope is
 * its own sentence ("All branches"), not a branch with an empty name.
 */
export function deskReportScopeAnnouncement(
  kind: 'window' | 'branch',
  label: string | null,
): string {
  if (kind === 'window') return `Window: ${label} — report re-keyed.`;
  return label ? `Branch: ${label} — report re-keyed.` : 'All branches — report re-keyed.';
}

// ── the deep links (v2.80.0) ──────────────────────────────────────────────

/**
 * The drawer a deep link asks for (v2.80.0). Reads a location.search-style
 * string ("?request=42" / "?reviewer=Jane Doe") and names the ONE drawer it
 * opens — the same one-drawer rule the page itself follows, so a link that
 * carries both params resolves to the more specific subject (the request)
 * and never asks the report for two drawers. Whitespace-only or missing
 * params are no link at all; scope params (days, branch) are not drawers
 * and are ignored.
 */
export function deskReportDrawerParam(
  search: string,
): { kind: DeskReportSliceKind; id: string } | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const request = params.get('request')?.trim();
  if (request) return { kind: 'request', id: request };
  const reviewer = params.get('reviewer')?.trim();
  if (reviewer) return { kind: 'reviewer', id: reviewer };
  return null;
}

/**
 * The scope a report address can carry (v2.81.0) — the window length and
 * the branch narrow, beside the drawer param. `days` rides only when it is
 * a REAL window (7/14/30) and not the default (7 needs no ink); `branch`
 * rides when non-empty.
 */
export interface DeskReportScopeParams {
  days?: number | null;
  branch?: string | null;
}

/**
 * The address of a report state (v2.81.0) — window, branch and drawer in
 * ONE deterministic string, the single composer both directions of every
 * link ride: the desk panel's per-reviewer door builds one to hand a name
 * (and its branch filter) into the report, and the report reflects its
 * whole state back into the address bar, so the URL always names exactly
 * what is on screen. Defaults leave no ink: 7 days and no branch compose
 * to the bare path.
 */
export function deskReportReportHref(
  days: number | null,
  branch: string | null,
  drawer: { kind: DeskReportSliceKind; id: string } | null,
): string {
  const parts: string[] = [];
  if (days && days !== DESK_REPORT_DEFAULT_DAYS && (DESK_REPORT_WINDOW_DAYS as readonly number[]).includes(days)) {
    parts.push(`days=${days}`);
  }
  if (branch) parts.push(`branch=${encodeURIComponent(branch)}`);
  if (drawer) parts.push(`${drawer.kind}=${encodeURIComponent(drawer.id)}`);
  return parts.length > 0 ? `/org/desk-report?${parts.join('&')}` : '/org/desk-report';
}

/**
 * The address of a drawer (v2.80.0, scope added v2.81.0) — the drawer param
 * first, with optional scope riding behind it (?reviewer=X&branch=store-juja).
 */
export function deskReportDrawerHref(
  kind: DeskReportSliceKind,
  id: string,
  scope?: DeskReportScopeParams,
): string {
  return deskReportReportHref(
    scope?.days ?? null,
    scope?.branch ?? null,
    { kind, id },
  );
}

/**
 * Everything an arrival link can ask for (v2.81.0) — parsed from a
 * location.search-style string in one read: the window re-key (only the
 * REAL windows count; anything else is not a scope and is ignored), the
 * branch narrow (any non-empty id — the report renders an honest empty
 * when the branch has no visits), and the drawer (via the v2.80.0 parser,
 * request precedence intact). Keys that are absent are null, not defaults
 * — the caller re-keys ONLY what the link actually carried.
 */
export function deskReportArrival(search: string): {
  days: number | null;
  branch: string | null;
  drawer: { kind: DeskReportSliceKind; id: string } | null;
} {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawDays = Number.parseInt(params.get('days') ?? '', 10);
  const days = (DESK_REPORT_WINDOW_DAYS as readonly number[]).includes(rawDays) ? rawDays : null;
  const branch = params.get('branch')?.trim() || null;
  return { days, branch, drawer: deskReportDrawerParam(search) };
}

/**
 * What a deep link resolves to (v2.80.0) — whether the arrival opens the
 * drawer, and the one sentence the page says about it. The decision is made
 * against the SAME read the report renders, so the opened drawer cannot
 * disagree with the page above it; every refusal is named, not swallowed.
 */
export interface DeskReportDeepLinkResult {
  open: boolean;
  announcement: string;
}

/**
 * The arrival's verdict (v2.80.0). A reviewer link opens when the reviewer
 * has a roll-up row (a door) in this window; a request link opens only when
 * the file is one of the most-visited doors — the cap is by design (the
 * section is a digest, not the whole ledger), so a doorless file with
 * visits in the ledger is refused WITH that fact named. Pure: same
 * constraint as every helper here — unit tests run without any mocking.
 */
export function deskReportResolveDeepLink(
  link: { kind: DeskReportSliceKind; id: string },
  data: {
    ledger: readonly DeskReportVisitEntry[];
    reviewers: readonly { name: string; visits: number }[];
    topRequests: readonly { requestId: string }[];
  },
): DeskReportDeepLinkResult {
  if (link.kind === 'reviewer') {
    const row = data.reviewers.find((r) => r.name === link.id);
    if (row) {
      return {
        open: true,
        announcement: `The link opened ${link.id}'s file — ${row.visits} ${row.visits === 1 ? 'visit' : 'visits'} in this window.`,
      };
    }
    return {
      open: false,
      announcement: `The link asked for ${link.id}'s file — no visits from ${link.id} in this window's report.`,
    };
  }
  if (deskReportHasRequestDoor(data.topRequests, link.id)) {
    const subject = deskReportRequestSubject(data.ledger, link.id);
    return {
      open: true,
      announcement: subject
        ? `The link opened ${subject.employeeName}'s ${subject.leaveTypeName}.`
        : 'The link opened this file.',
    };
  }
  const visits = deskReportRequestLedger(data.ledger, link.id).length;
  return visits > 0
    ? {
        open: false,
        announcement: `The link's file drew ${visits} ${visits === 1 ? 'visit' : 'visits'} in this window but is not among the report's ${DESK_REPORT_TOP_REQUESTS_LIMIT} most-visited — no drawer for it here.`,
      }
    : {
        open: false,
        announcement: 'The link\u2019s file drew no visits in this window — the report has no drawer for it.',
      };
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
  // UTC date is the day before the desk's). v2.82.0: the stamp is shared —
  // one helper, three filings, one voice.
  return `mbumah-desk-report-${deskReportFileStamp(report)}.csv`;
}

// ─── v2.79.0 — the drawers file themselves ───────────────────────────────

/**
 * Which family a slice CSV files. v2.79.0 added the two drawer families;
 * v2.82.0 adds 'all' — the whole ledger, filed from the report itself (the
 * "File all visits" toolbar door): every visit the report read, in the
 * ledger's own order, with the same header voice and the same guard.
 */
export type DeskReportSliceKind = 'reviewer' | 'request' | 'all';

/**
 * The Report header row's voice for each slice family — one map, so the
 * three filings can never drift into three different wordings.
 */
const DESK_REPORT_SLICE_VOICE: Record<DeskReportSliceKind, string> = {
  reviewer: 'Desk report — reviewer visits',
  request: 'Desk report — request visits',
  all: 'Desk report — all visits',
};

/**
 * The slice CSV's filing meta — the report page's own scope/window voice,
 * the same words the header and the print footer carry.
 */
export interface DeskReportSliceMeta {
  scopeLabel: string;
  windowLabel: string;
  windowDays: number;
  generatedAt?: Date;
}

/**
 * File ONE drawer's slice: the visits the open drawer is showing, nothing
 * more. The rows go in the LEDGER's own order (newest first) — the slice
 * never re-sorts, so the filed copy reads in the same order the desk just
 * read on screen. One column voice for both families: a reviewer slice
 * varies the Employee column, a request slice varies the Reviewer column,
 * and the format stays a single machine-readable shape either way. The
 * cells ride the digest CSV's escaper, so the OWASP formula-injection
 * guard covers the drawer's files too. RFC-4180: CRLF records, trailing
 * CRLF at end of file.
 */
export function deskReportSliceToCsv(
  kind: DeskReportSliceKind,
  subject: string,
  entries: readonly DeskReportVisitEntry[],
  meta: DeskReportSliceMeta,
): string {
  const generatedAt = meta.generatedAt ?? new Date();
  const lines: string[] = [];
  const row = (cells: Array<string | number>) => lines.push(cells.map(csvCell).join(','));

  row(['Report', DESK_REPORT_SLICE_VOICE[kind]]);
  row(['Subject', subject]);
  row(['Scope', meta.scopeLabel]);
  row(['Window', `${meta.windowLabel} (${meta.windowDays} EAT days)`]);
  row(['Generated (UTC)', generatedAt.toISOString()]);

  lines.push('');
  lines.push('Visits');
  row(['Date', 'Day', 'Time (EAT)', 'Branch', 'Reviewer', 'Employee', 'Leave type', 'Status', 'Recheck cleared']);
  for (const v of entries) {
    row([
      v.dayKey,
      deskReportDayLabel(v.dayKey),
      deskReportVisitTime(v.at),
      v.storeName,
      v.reviewer,
      v.employeeName,
      v.leaveTypeName,
      v.status,
      v.cleared ? 'yes' : 'no',
    ]);
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * The stamp every desk-report filename rides: window length + EAT wall-date
 * bounds + scope slug, e.g. 7d-2026-10-11_2026-10-17-all-branches — one
 * helper so the report, the drawer slices and the whole-ledger filing can
 * never disagree about how a filed copy names its window and scope.
 */
function deskReportFileStamp(report: DeskReportPayload): string {
  const start = deskReportDayKey(new Date(report.window.start));
  const end = deskReportDayKey(new Date(new Date(report.window.end).getTime() - DAY_MS));
  const scope = report.scope.branch
    ? report.scope.branch.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'branch'
    : 'all-branches';
  return `${report.window.days}d-${start}_${end}-${scope}`;
}

/**
 * The download filename for a drawer's slice CSV: subject + window bounds +
 * scope, e.g. mbumah-desk-reviewer-grace-wanjiku-7d-2026-10-11_2026-10-17-
 * all-branches.csv or mbumah-desk-request-david-otieno-s-sick-leave-… — the
 * same "filed copies never overwrite each other" rule as the report CSV.
 * An all-punctuation subject falls back to the kind, so the file is never
 * anonymous.
 */
export function deskReportSliceCsvFilename(
  kind: DeskReportSliceKind,
  subject: string,
  report: DeskReportPayload,
): string {
  const slug = subject.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || kind;
  return `mbumah-desk-${kind}-${slug}-${deskReportFileStamp(report)}.csv`;
}

// ─── v2.82.0 — the report files everything ────────────────────────────

/**
 * The whole ledger, filed: every visit the report read in this window and
 * scope, in the LEDGER's own order (newest first), through the same slice
 * builder the drawers use — the 'all' family is the drawers' filing grown
 * to the full read, so the voice, the columns and the OWASP guard are the
 * ones the desk already knows. The subject row reads plainly: this file is
 * All visits; the Scope and Window rows beside it say which.
 */
export function deskReportLedgerToCsv(
  entries: readonly DeskReportVisitEntry[],
  meta: DeskReportSliceMeta,
): string {
  return deskReportSliceToCsv('all', 'All visits', entries, meta);
}

/**
 * The download filename for the whole-ledger CSV — no subject slug (the
 * whole ledger has no subject but the report itself), so the kind names it:
 * mbumah-desk-all-7d-2026-10-11_2026-10-17-all-branches.csv. The same
 * window-bounds + scope stamp keeps filed copies from overwriting each
 * other, exactly like the report and drawer filings.
 */
export function deskReportLedgerCsvFilename(report: DeskReportPayload): string {
  return `mbumah-desk-all-${deskReportFileStamp(report)}.csv`;
}
