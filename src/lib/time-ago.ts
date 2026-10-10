/**
 * timeAgo - human relative-time strings for ISO timestamps / Date objects.
 *
 * Shared utility (v2.12.0 DASH-UI): the dashboard activity feeds, shift
 * snapshot and alerts card all render "x mins ago" style labels. There was
 * no shared helper in src/lib (only a private copy inside the admin fleet
 * component), so this is the ONE canonical implementation.
 *
 * Defensive by design: null/undefined/invalid input renders an em dash
 * instead of throwing - feed rows must never crash the dashboard.
 */
export function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return '-';
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return '-';

  const diffMs = Date.now() - t;
  // Future timestamps (clock skew, in-flight writes) read as "just now".
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} mins ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hr ago';
  if (hours < 24) return `${hours} hrs ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}
