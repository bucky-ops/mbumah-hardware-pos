// MBUMAH HARDWARE POS - discipline desk UI helpers (v2.115.0)
//
// Pure, unit-testable helpers behind the /hr/discipline page's countdown
// chips. Kept out of the page component so the boundary arithmetic is pinned
// by tests, not by scrolling a table on a Tuesday.

export const DAY_MS = 86_400_000;

// v2.115.0: an OPEN warning inside this window wears an amber "in Nd" chip
// (spec acceptance rule 4 made warnings expire — the countdown makes the
// expiry visible while there is still time to act). Past-due never shows:
// the sweep expires those server-side before the list is built, and the
// days < 0 guard keeps a stale client honest even if it renders one.
//
// The countdown counts CALENDAR days (the viewer's local dates), not
// millisecond ceilings — an expiry at 23:00 today is "expires today" no
// matter how many hours remain, and 00:30 tomorrow is honestly "in 1d".
export const EXPIRES_SOON_DAYS = 14;

export function expiresSoonLabel(
  expiresOn: string | null | undefined,
  status: string,
): string | null {
  if (!expiresOn || status !== 'OPEN') return null;
  const d = new Date(expiresOn);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfExpiry = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfExpiry - startOfToday) / DAY_MS);
  if (days < 0 || days > EXPIRES_SOON_DAYS) return null;
  return days === 0 ? 'expires today' : `in ${days}d`;
}

// ── Access-trail read-back (v2.116.0) ───────────────────────────────────────
//
// v2.115.0 made restricted reads WRITE a trail; v2.116.0 lets the desk READ
// it back. The audit rows for a case's DISCIPLINARY_RESTRICTED_VIEWED /
// _DENIED actions are folded into one honest summary: how many prior opens,
// how many denied attempts, and who last opened the record (before the
// current view — the service queries BEFORE writing its own event, so
// "last opened by" always means someone else or an earlier session, never
// the reader's own in-flight call).
//
// Pure: no db, no clock. The service owns the query and the name resolution;
// this owns the arithmetic and the filters.

/** The only audit actions that belong to the confidentiality trail. */
export const RESTRICTED_TRAIL_ACTIONS = [
  'DISCIPLINARY_RESTRICTED_VIEWED',
  'DISCIPLINARY_RESTRICTED_DENIED',
] as const;

export interface TrailEvent {
  action: string;
  userId: string | null;
  timestamp: Date | string;
}

export interface AccessTrailDto {
  /** Prior granted restricted reads (the current view is NOT counted). */
  viewCount: number;
  /** Denied attempts by roles outside the confidentiality allow-list. */
  deniedCount: number;
  lastViewedAt: string | null;
  lastViewedByUserId: string | null;
  lastDeniedAt: string | null;
}

/**
 * Fold audit rows into the trail summary. Unrelated actions are ignored,
 * input order does not matter (sorted chronologically first), and an empty
 * or all-irrelevant set is honestly null — "no trail to read back", which
 * the desk renders as the first-logged-view state.
 */
export function buildAccessTrail(
  events: readonly TrailEvent[],
): AccessTrailDto | null {
  const ts = (e: TrailEvent) => {
    const t = new Date(e.timestamp).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const trail = events
    .filter((e) => (RESTRICTED_TRAIL_ACTIONS as readonly string[]).includes(e.action))
    .slice()
    .sort((a, b) => ts(a) - ts(b));
  if (trail.length === 0) return null;
  const views = trail.filter((e) => e.action === 'DISCIPLINARY_RESTRICTED_VIEWED');
  const denied = trail.filter((e) => e.action === 'DISCIPLINARY_RESTRICTED_DENIED');
  const lastViewed = views[views.length - 1] ?? null;
  const lastDenied = denied[denied.length - 1] ?? null;
  return {
    viewCount: views.length,
    deniedCount: denied.length,
    lastViewedAt: lastViewed ? new Date(lastViewed.timestamp).toISOString() : null,
    lastViewedByUserId: lastViewed?.userId ?? null,
    lastDeniedAt: lastDenied ? new Date(lastDenied.timestamp).toISOString() : null,
  };
}

// ── Access-ledger read-back (v2.117.0) ──────────────────────────────────────
//
// The single-case trail (buildAccessTrail) answers "who opened THIS record";
// the ledger answers "who has been opening restricted records LATELY" — a
// cross-case, read-only view over the same audit events. Same content-free
// contract: who, when, which case's employee — never the description.

/** Default report window (days). */
export const ACCESS_LEDGER_WINDOW_DAYS = 30;
/** Hard cap — an unbounded window is an unbounded scan. */
export const ACCESS_LEDGER_MAX_DAYS = 90;
/** Row cap for the report payload. */
export const ACCESS_LEDGER_LIMIT = 200;

/**
 * Clamp the requested window: non-positive / non-numeric falls back to the
 * default, anything above the cap is capped. The floor keeps the param honest
 * instead of silently returning "everything".
 */
export function clampLedgerWindow(days: unknown): number {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return ACCESS_LEDGER_WINDOW_DAYS;
  return Math.min(Math.floor(n), ACCESS_LEDGER_MAX_DAYS);
}

export interface LedgerEvent {
  entityId: string;
  action: string;
  userId: string | null;
  timestamp: Date | string;
}

export interface LedgerRow {
  caseId: string;
  employeeName: string | null;
  action: string;
  denied: boolean;
  userId: string | null;
  userName: string | null;
  timestamp: string;
}

/**
 * Join audit events to the case/user names the service resolved in batch.
 * Unrelated actions are filtered again here (defence in depth on the fold),
 * order is preserved (the query owns the sort — newest first), and a name
 * that cannot resolve degrades to null, never a fabricated label.
 */
export function foldAccessLedger(
  events: readonly LedgerEvent[],
  caseNames: Record<string, string | null>,
  userNames: Record<string, string | null>,
): LedgerRow[] {
  return events
    .filter((e) => (RESTRICTED_TRAIL_ACTIONS as readonly string[]).includes(e.action))
    .map((e) => ({
      caseId: e.entityId,
      employeeName: caseNames[e.entityId] ?? null,
      action: e.action,
      denied: e.action === 'DISCIPLINARY_RESTRICTED_DENIED',
      userId: e.userId,
      userName: (e.userId != null && userNames[e.userId] !== undefined ? userNames[e.userId] : null) ?? null,
      timestamp: new Date(e.timestamp).toISOString(),
    }));
}

/**
 * Relative time for ledger rows: "just now" / "Nm ago" / "Nh ago", then
 * CALENDAR days ("2d ago") — the same calendar-day honesty as the countdown
 * chips, not ms ceilings. A future timestamp (clock skew) clamps to
 * "just now"; garbage is honestly null and the UI falls back to the absolute.
 */
export function relativeTimeLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diff = now.getTime() - d.getTime();
  if (diff <= 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const startOfThen = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((startOfNow - startOfThen) / DAY_MS);
  return `${Math.max(days, 1)}d ago`;
}
