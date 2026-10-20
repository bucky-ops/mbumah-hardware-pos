// ORG SUMMARY TREND (v2.173.0) — the owner's first screen learns to trend.
//
// PURE module — no db, no fetch, no Date.now (the tick-expectation
// convention: the caller passes the time anchors in, so tests can pin the
// math to the millisecond and the API route feeds it the read's own
// anchors). Mirrors the window/bucket/variance math the expert console's
// kpi-summary route has shipped since v2.18.3, with ONE deliberate
// divergence documented below.
//
// SEMANTICS CONTRACT (gross, not net):
//   The org dashboard's "Revenue today" StatCard totals `totalAmount` —
//   GROSS of tax (see /api/org/summary, the groupBy `_sum.totalAmount`).
//   This trend decorates THAT card on the SAME surface, so every number it
//   ships is gross too: a net-of-tax spark under a gross headline would be
//   a lying adjacency. The expert console (/api/org/kpi-summary) computes
//   its revenue NET of tax — a pre-existing cross-surface divergence
//   between the two consoles' "Revenue" labels, observed and recorded in
//   v2.173.0 but NOT reconciled here (changing the expert console's
//   contract is its own round). Within each surface, the numbers agree.

import { toDec, round2 } from '@/lib/utils/financialMath';

/** The trend window length in days — 7, matching kpi-summary's week. */
export const TREND_DAYS = 7;

const DAY_MS = 86_400_000;

/** The three anchors the trend math needs; all derived from the caller's `now`. */
export interface TrendWindows {
  /** Local midnight of the caller's today (bucket 6's end anchor). */
  startToday: Date;
  /** startToday − 6 days: the START of the current 7-day window (inclusive). */
  weekAgo: Date;
  /** startToday − 13 days: the START of the prior 7-day window (inclusive). */
  twoWeeksAgo: Date;
}

/**
 * The week windows, mirroring kpi-summary exactly: the "week" is the 7 days
 * ENDING today (today inclusive), the "prior week" is the 7 days before it.
 * A week therefore spans [weekAgo, startToday + 1 day) — the API route adds
 * no upper bound on the current week because a future-dated transaction is
 * a data problem the route's other reads already share.
 */
export function trendWindows(now: Date): TrendWindows {
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  return {
    startToday,
    weekAgo: new Date(startToday.getTime() - (TREND_DAYS - 1) * DAY_MS),
    twoWeeksAgo: new Date(startToday.getTime() - (2 * TREND_DAYS - 1) * DAY_MS),
  };
}

/**
 * Week-over-week variance in percent, round2'd — the same formula
 * kpi-summary uses. When the prior week has NO data the variance is
 * undefined, not zero: the caller (the card) hides the badge entirely
 * rather than showing a fabricated "+0%". The function returns 0 for that
 * case (kpi-summary parity) and the CARD, not the lib, decides to hide.
 */
export function variancePct(current: number, prior: number): number {
  if (prior <= 0) return 0;
  return round2(((current - prior) / prior) * 100);
}

/** One row the bucket builders consume: an instant plus (optionally) a weight. */
export interface TrendRow {
  createdAt: Date;
  /** Gross amount carried into the bucket (ignored by countBuckets). */
  amount: number;
}

/**
 * The 7-bucket revenue sparkline (oldest → newest). Bucket i covers
 * [startToday − (days−1−i) days, +1 day) — half-open, so a transaction
 * stamped exactly on a bucket's opening millisecond belongs to it and one
 * stamped on the closing millisecond belongs to the NEXT bucket. Empty
 * input yields `days` zeros (an honest flat line, never a gap).
 */
export function sparkBuckets(rows: TrendRow[], startToday: Date, days = TREND_DAYS): number[] {
  const buckets = new Array<number>(days).fill(0);
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(startToday.getTime() - (days - 1 - i) * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    for (const row of rows) {
      if (row.createdAt >= dayStart && row.createdAt < dayEnd) {
        buckets[i] = round2(toDec(buckets[i]).plus(toDec(row.amount)).toNumber());
      }
    }
  }
  return buckets;
}

/**
 * The 7-bucket transaction COUNT sparkline — same half-open buckets, each
 * row weighs 1. Kept separate from sparkBuckets so the amount path can
 * never silently become a count path (and vice versa) during a refactor.
 */
export function countBuckets(
  rows: Array<{ createdAt: Date }>,
  startToday: Date,
  days = TREND_DAYS,
): number[] {
  const buckets = new Array<number>(days).fill(0);
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(startToday.getTime() - (days - 1 - i) * DAY_MS);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    for (const row of rows) {
      if (row.createdAt >= dayStart && row.createdAt < dayEnd) {
        buckets[i] += 1;
      }
    }
  }
  return buckets;
}
