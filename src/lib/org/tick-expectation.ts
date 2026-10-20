// v2.172.0 — the automation card's heartbeat EXPECTATION.
//
// The card could already say "Last tick 3h ago" (history). This module
// gives it the sentence it could not honestly compute before: WHEN the
// next tick is due, and whether the heartbeat is ON TIME — computed from
// the real cadences (the cron-hourly pinger fires at the top of every
// hour, UTC; Vercel's daily slot fires the dispatcher once per day) and
// anchored on the server's own read time.
//
// PURE module: no db, no network, no clock (the now anchor is passed in —
// the card feeds it automation.generatedAt, the server's own ledger-read
// stamp, so the math never trusts the browser clock), no DOM — vitest
// executes the math and pins the exact sentences.

import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';

/**
 * How late a top-of-hour slot may still land before the heartbeat is
 * called overdue. GitHub Actions scheduled runs routinely start a few
 * minutes past the hour; 15 minutes is a fair grace window that keeps
 * the line from crying wolf on scheduler jitter alone.
 */
export const TICK_GRACE_MINUTES = 15;

/** One hour in milliseconds — the designed heartbeat period. */
const HOUR_MS = 60 * 60 * 1000;

export type TickExpectationState = 'on-time' | 'overdue' | 'unarmed';

export interface TickExpectation {
  state: TickExpectationState;
  text: string;
}

export interface TickExpectationInput {
  /** automation.lastTick.at — the newest ledger row's ISO stamp. */
  lastTickAt: string;
  /** automation.generatedAt — the server-truth anchor for "now". */
  generatedAt: string;
  /** automation.secretConfigured — false/undefined means the pinger
   *  cannot fire, so no hourly slot is expected (never an incident). */
  secretConfigured?: boolean;
  /** automation.cadence.vercelHourUtc — the UTC hour of Vercel's daily
   *  slot; tolerated absent (older responses) with the documented
   *  default of 3 (vercel.json's "0 3 * * *"). */
  vercelHourUtc?: number;
}

/** The top of the hour (UTC) that contains `now`. */
export function slotTopOfHour(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
  );
}

/** The next top-of-hour (UTC) STRICTLY after `now` — an exact-slot
 *  instant rolls to the following hour, a mid-hour instant rounds up. */
export function nextTopOfHour(now: Date): Date {
  return new Date(slotTopOfHour(now).getTime() + HOUR_MS);
}

/** The next daily slot at `hourUtc`:00 UTC strictly after `now`. */
export function nextVercelSlot(now: Date, hourUtc = 3): Date {
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc),
  );
  if (candidate.getTime() > now.getTime()) return candidate;
  return new Date(candidate.getTime() + 24 * HOUR_MS);
}

/** Compact UTC wall clock, e.g. "13:00 UTC". */
export function formatUtcClock(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/** Compact EAT wall clock (UTC+3, the same shift formatEatStamp uses),
 *  e.g. "16:00 EAT". */
export function formatEatClock(d: Date): string {
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const hh = String(eat.getUTCHours()).padStart(2, '0');
  const mm = String(eat.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} EAT`;
}

/**
 * The single source for the card's expectation sentence. States:
 * - 'unarmed'  — CRON_SECRET is unset, so nothing pings the hourly
 *                dispatcher; the honest expectation is Vercel's daily
 *                slot. Muted, never amber: a daily heartbeat is "due"
 *                all day and an overdue hour is not an incident here.
 * - 'overdue'  — the gate is armed, the current top-of-hour slot began,
 *                no tick of any dispatcher has landed since it began,
 *                and now runs past slot + grace. Amber.
 * - 'on-time'  — armed and nothing is wrong: name the next due slot.
 *                Within the grace window with no tick yet the slot may
 *                still land, so the line stays quiet (on-time) — that
 *                IS the grace window's meaning.
 *
 * Ledger-level honesty: "no tick" means no ROW at all (either
 * dispatcher); the card's source label already names which dispatcher
 * last fired, so the expectation never guesses one.
 */
export function nextTickExpectation(input: TickExpectationInput): TickExpectation | null {
  const now = new Date(input.generatedAt);
  if (Number.isNaN(now.getTime())) return null;
  const lastTick = new Date(input.lastTickAt);
  if (Number.isNaN(lastTick.getTime())) return null;

  if (input.secretConfigured !== true) {
    const next = nextVercelSlot(now, input.vercelHourUtc ?? 3);
    return {
      state: 'unarmed',
      text: `Pinger not armed — the next expected tick is Vercel's daily slot ${formatUtcClock(next)} (${formatEatStamp(next)}).`,
    };
  }

  const slot = slotTopOfHour(now);
  const graceEnd = slot.getTime() + TICK_GRACE_MINUTES * 60 * 1000;
  if (lastTick.getTime() < slot.getTime() && now.getTime() >= graceEnd) {
    const minutesPast = Math.floor((now.getTime() - graceEnd) / 60000);
    return {
      state: 'overdue',
      text: `Heartbeat overdue — no tick since ${formatUtcClock(slot)} (${formatEatClock(slot)}), ${minutesPast}m past the ${TICK_GRACE_MINUTES}-minute grace window.`,
    };
  }

  const due = nextTopOfHour(now);
  return {
    state: 'on-time',
    text: `Next tick due ${formatUtcClock(due)} (${formatEatClock(due)}) — the hourly dispatcher's slot.`,
  };
}

/** The line's text tint per state — the card's established families
 *  (emerald healthy, amber attention, muted silent). */
export function expectationTextClass(state: TickExpectationState): string {
  if (state === 'overdue') return 'text-amber-700 dark:text-amber-400';
  if (state === 'on-time') return 'text-emerald-700 dark:text-emerald-400';
  return 'text-muted-foreground';
}

/** The state dot's solid fill (decorative, aria-hidden — but still kept
 *  solid rather than an alpha family, so the card's contrast discipline
 *  holds even where it is not audited). */
export function expectationDotClass(state: TickExpectationState): string {
  if (state === 'overdue') return 'bg-amber-600';
  if (state === 'on-time') return 'bg-emerald-600';
  return 'bg-slate-400 dark:bg-slate-600';
}
