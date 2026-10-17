// v2.68.0 — the morning note rings the bell.
//
// v2.67.0 gave the desk its own morning note: the org console's Desk
// activity panel opens with a dawn-tinted strip summarizing the previous
// EAT calendar day of the LeaveReviewVisit ledger. But that note only
// greeted whoever opened the console — on a busy day the desk's story sat
// unread until someone clicked in. This module is the note's second voice:
// once per day (statefully deduped), when yesterday had visits, a bell row
// rings every org-role user with the same figures the strip shows.
//
// CONTRACT (mirrors the strip's, deliberately):
//   • ORG-WIDE — the note describes the previous EAT calendar day of the
//     whole ledger, never a branch slice, never a reviewer slice. Same rule
//     as the strip, `stats` and `branches` on the panel.
//   • EAT CALENDAR — "yesterday" is the desk's own Nairobi day
//     (a [00:00, 24:00) window on the EAT wall clock), not a trailing 24h.
//   • HONEST — a quiet day rings nothing (the strip already says so in
//     place; a bell row saying "nothing happened" is noise, not news).
//     Singular/plural copy stays exact ("1 visit · 1 correction answered").
//   • ONCE PER DAY — the dedupe key is the summarized day itself
//     (deskDigestDate = the EAT wall date of the note's window), so opening
//     the console twice in a morning rings the bell once, and the note for
//     a given day is written at most once even if several consoles load.
//   • BEST-EFFORT — the trigger rides GET /api/org/review-activity (the
//     panel's own read): any failure inside the note writer is swallowed;
//     the payload must never break because the bell refused to ring.
//
// Recipients are the SAME org roles the review-activity read is gated to
// (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER) — the people whose desk this
// is. ACCOUNTANT keeps the per-store matrix and stays out, per the v2.18.3
// reconciliation precedent the endpoint itself follows.

/** Feed + metadata marker — the notifications route's section 9 owns rows
 *  carrying this marker, exactly like the leave/payroll family. */
export const DESK_DIGEST_METADATA_MARKER = 'desk_digest';

/** The bell's audience = the review-activity endpoint's ORG_ROLES gate. */
export const DESK_DIGEST_ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

/** The deep link every desk-digest row carries — the panel that hosts the
 *  dawn strip this note summarizes. */
export const DESK_DIGEST_ACTION_URL = '/org/dashboard';

/** EAT (Kenya) offset in ms — the desk's own calendar. */
const EAT_OFFSET_MS = 3 * 3_600_000;

/** The figures the strip shows, in the shape the route's `yesterday` block
 *  already computes — the note writer consumes that block directly so the
 *  bell and the strip can never disagree about the day. */
export interface DeskDigestNoteFigures {
  /** The strip's server-rendered day label ("Fri, 16 Oct"). */
  label: string;
  visits: number;
  clears: number;
  reviewers: number;
  requests: number;
  busiestBranch: { storeName: string; visits: number } | null;
  topReviewer: { name: string; visits: number } | null;
}

/** The EAT wall date (YYYY-MM-DD) of the summarized day, derived from the
 *  window's start epoch (a UTC instant at EAT-midnight of that day). The
 *  dedupe key AND the human-facing date chip both come from here, so a
 *  note can never claim a day its window doesn't cover. */
export function deskDigestDateKey(windowStart: Date): string {
  return new Date(windowStart.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Honest singular/plural phrase — "1 visit" but "4 visits". Private to the
 *  copy builder; exported for tests. */
export function deskDigestPlural(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The strip's busiest-branch chip shortens the store display name
 *  ("MBUMAH HARDWARE - Juja Main" → "Juja Main"); the bell copy mirrors
 *  that chip language so the note reads the same in both voices. Same
 *  rule, same fallback (the original name when nothing matches). */
export function deskDigestShortStoreName(name: string): string {
  return name.replace(/^MBUMAH HARDWARE\s*-\s*/i, '') || name;
}

/** The bell row's copy, mirroring the strip's four figures. Returns null on
 *  a quiet day — the desk's honest silence (the strip tells that story in
 *  place; the bell stays quiet with it). */
export function deskDigestNoteCopy(
  figures: DeskDigestNoteFigures,
): { title: string; message: string } | null {
  if (figures.visits === 0) return null;
  const title = `Yesterday at the desk — ${figures.label}`;
  const parts = [
    deskDigestPlural(figures.visits, 'visit', 'visits'),
    deskDigestPlural(figures.clears, 'correction answered', 'corrections answered'),
    deskDigestPlural(figures.reviewers, 'reviewer', 'reviewers'),
    deskDigestPlural(figures.requests, 'request', 'requests'),
  ];
  const extras: string[] = [];
  if (figures.busiestBranch) {
    extras.push(
      `busiest: ${deskDigestShortStoreName(figures.busiestBranch.storeName)} (${figures.busiestBranch.visits})`,
    );
  }
  if (figures.topReviewer) {
    extras.push(`most active: ${figures.topReviewer.name} (${figures.topReviewer.visits})`);
  }
  const message = parts.join(' · ') + (extras.length ? ` — ${extras.join(' · ')}` : '');
  return { title, message };
}

/** The metadata stamped on every desk-digest Notification row. `kind` routes
 *  the feed row (section 9 of /api/notifications), `deskDigestDate` is the
 *  stateful dedupe key — one note per summarized day, globally. */
export function deskDigestMetadata(
  dateKey: string,
  figures: DeskDigestNoteFigures,
): Record<string, unknown> {
  return {
    kind: DESK_DIGEST_METADATA_MARKER,
    deskDigestDate: dateKey,
    visits: figures.visits,
    clears: figures.clears,
  };
}

/** The exact substring the dedupe guard searches for. Building the needle
 *  here (not inline in the route) keeps the writer and any future reader
 *  keyed to the same shape. */
export function deskDigestDedupeNeedle(dateKey: string): string {
  return `"deskDigestDate":"${dateKey}"`;
}
