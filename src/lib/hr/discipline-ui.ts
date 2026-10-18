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
