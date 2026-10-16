// MBUMAH HARDWARE POS - leave sub-tab presentation helpers (v2.30.0)
//
// PURE module (no server imports, no side effects) so both the client tab
// and vitest can share the exact presentation rules. Extracted from
// src/app/(shell)/tabs/payroll-tab.tsx when the v2.30.0 contract fix rebuilt
// the Leave sub-tab on the flat /api/leaves DTO — the numbers managers act
// on (balance utilisation tones, initials, badge colors) now have one
// source of truth with regression tests.

/** Tailwind classes for the leave-type badge, keyed by leave type code. */
export const LEAVE_TYPE_STYLES: Record<string, string> = {
  ANNUAL: 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300',
  SICK: 'border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-300',
  MATERNITY: 'border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300',
  PATERNITY: 'border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-300',
  COMPASSIONATE: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300',
};

export function leaveTypeStyle(code: string): string {
  return LEAVE_TYPE_STYLES[code] ?? 'border-border text-muted-foreground';
}

/**
 * Used fraction of a leave balance, 0..1, clamped. Capacity includes the
 * carried-forward days (they are entitlement too). Returns 0 when capacity
 * is 0 so an unprovisioned balance renders an empty bar, not NaN.
 */
export function balanceUtilization(usedDays: number, allocatedDays: number, carryForwardDays: number): number {
  const capacity = Math.max(0, allocatedDays) + Math.max(0, carryForwardDays);
  if (capacity <= 0) return 0;
  const fraction = Math.max(0, usedDays) / capacity;
  return Math.min(1, fraction);
}

export interface BalanceTone {
  /** Progress-bar fill classes. */
  bar: string;
  /** Small caption classes for the "X% used" text. */
  text: string;
}

/**
 * Tone buckets for balance utilisation: <50% comfortable (emerald),
 * 50-79% watch (amber), >=80% or fully consumed (rose). Unknown/negative
 * inputs fall into the comfortable bucket — presentation must never throw.
 */
export function balanceTone(usedDays: number, allocatedDays: number, carryForwardDays: number): BalanceTone {
  const u = balanceUtilization(usedDays, allocatedDays, carryForwardDays);
  if (u >= 0.8) {
    return {
      bar: 'bg-rose-500 dark:bg-rose-500',
      text: 'text-rose-600 dark:text-rose-400',
    };
  }
  if (u >= 0.5) {
    return {
      bar: 'bg-amber-500 dark:bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    bar: 'bg-emerald-500 dark:bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  };
}

/** "Grace Achieng" -> "GA"; single name -> its first two letters; empty -> "?". */
export function initialsOf(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '');
  return (first + last).toUpperCase() || '?';
}

/**
 * v2.38.0: client-side mirror of the service's countWorkingDays — the exact
 * same weekend-skipping, UTC-anchored arithmetic the governed requestLeave()
 * path applies, so the HR desk's on-behalf dialog previews the day count the
 * server will store (half-day = whole range minus 0.5, matching the portal).
 * Invalid or inverted ranges yield 0; presentation never throws.
 */
export function previewWorkingDays(fromStr: string, toStr: string, halfDay: boolean): number {
  if (!fromStr || !toStr) return 0;
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;
  let days = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(0, halfDay ? days - 0.5 : days);
}
