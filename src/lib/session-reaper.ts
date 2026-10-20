// MBUMAH HARDWARE POS - session reaper contract (v2.163.0)
//
// PURE module - no db, no network, no clock reads.
//
// WHY THIS EXISTS (Task 156's option #2, the session-hygiene sweep):
//   The dev DB carried 60+ stale owner sessions because nothing ever
//   deleted a session whose `expiresAt` had passed. The idle contract
//   (v2.162.0) deletes a session ONLY when someone presents it again - an
//   employee who never comes back leaves the row behind until a reaper
//   exists. This module is the summary half of that reaper; the delete
//   itself lives in /api/cron/session-reaper (one deleteMany on the
//   indexed `expiresAt` column, folded into the hourly dispatcher with the
//   same x-cron-secret gate as every sibling sub-job).

/** The systemLog action the reaper writes on every completed sweep. */
export const SESSION_REAPER_LOG_ACTION = 'SESSIONS_REAPED' as const;

export interface SessionReaperSummary {
  /** A reaped-zero sweep is still a SUCCESS - clean is not a failure. */
  ok: boolean;
  /** The human sentence the route logs and returns verbatim. */
  message: string;
}

/**
 * Summarise one reaper sweep. Honest plurals, honest zero: garbage input
 * (NaN, negative, non-finite) degrades to the zero case rather than
 * inventing a count, and "nothing to do" is spoken as its own outcome -
 * not dressed up as work.
 */
export function sessionReaperSummary(deleted: number): SessionReaperSummary {
  const n =
    typeof deleted === 'number' &&
    Number.isFinite(deleted) &&
    deleted > 0
      ? Math.floor(deleted)
      : 0;
  if (n === 0) {
    return {
      ok: true,
      message: 'No expired sessions to reap - the session table is clean.',
    };
  }
  return {
    ok: true,
    message:
      n === 1
        ? 'Reaped 1 expired session (its expiresAt had passed).'
        : `Reaped ${n} expired sessions (their expiresAt had passed).`,
  };
}
