// MBUMAH HARDWARE POS - self-service session idle contract (v2.162.0)
//
// PURE module - no db, no network, no clock reads. Every function takes
// `now` explicitly so tests can pin the boundary without fake timers.
//
// WHY THIS EXISTS (the spec's own question, answered):
//   spec line 843.6 - "Does idle timeout protect unattended tills and
//   potentially employee self-service sessions?"
//   spec line 1068.7 - "Can self-service reuse auth and idle timeout safely?"
//
// The till surface answered the first half in v2.6.0 (client-side
// useIdleTimeout in main-app.tsx clears the SPA tokens after 30 minutes).
// The self-service portal had NO answer: a 24-hour cookie session stayed
// valid on an unattended browser indefinitely. v2.162.0 reuses the SAME
// 30-minute cadence for the portal, enforced SERVER-side (a client timer
// alone cannot protect a re-opened tab) and scoped to the self-service
// surface ONLY, so till behaviour is byte-identical to v2.6.0's contract.
//
// The Session table has carried `lastActiveAt` ("Track session activity")
// since its creation - v2.162.0 is the first reader/writer of that column.

/** The idle window: 30 minutes, the SAME cadence the till surface has used
 *  since v2.6.0. One number, two surfaces - the spec's "reuse ... safely". */
export const SELF_SERVICE_IDLE_MS = 30 * 60 * 1000;

/**
 * Is the session idle-expired as of `now`?
 *
 * Degradation contract (the same honest-garbage posture the attendance desk
 * uses): a session with NO `lastActiveAt` (legacy rows created before
 * v2.162.0 ever wrote the column) or an UNPARSEABLE date is treated as NOT
 * expired - the mechanism degrades to v2.161.0 behaviour (absolute 24h
 * expiry only) rather than inventing a lockout from missing data.
 *
 * Boundary: a pause of EXACTLY the window counts as expired (>= window),
 * matching the till's setTimeout which fires AT the 30-minute mark.
 */
export function idleExpired(
  lastActiveAt: Date | string | null | undefined,
  now: Date,
  windowMs: number = SELF_SERVICE_IDLE_MS,
): boolean {
  if (lastActiveAt === null || lastActiveAt === undefined) return false;
  const last =
    typeof lastActiveAt === 'string' ? new Date(lastActiveAt) : lastActiveAt;
  const lastMs = last instanceof Date && !Number.isNaN(last.getTime()) ? last.getTime() : NaN;
  if (Number.isNaN(lastMs)) return false;
  return now.getTime() - lastMs >= windowMs;
}

/**
 * The 401 payload shape for an idle-expired self-service request. The code
 * is stable and machine-readable; the message is the human sentence the
 * portal's error notes show verbatim.
 */
export const SESSION_IDLE_EXPIRED_CODE = 'SESSION_IDLE_EXPIRED' as const;

export function sessionIdleExpiredResponse(): Response {
  return Response.json(
    {
      success: false,
      error:
        'Signed out after 30 minutes of inactivity. Sign in again to continue.',
      code: SESSION_IDLE_EXPIRED_CODE,
    },
    { status: 401 },
  );
}
