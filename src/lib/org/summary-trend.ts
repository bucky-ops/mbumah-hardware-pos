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

/**
 * One store's week-vs-prior slice, as the API's per-store groupBys see it.
 * v2.175.0: the slice carries the SAME identity fields the branches table
 * speaks (slug / subdomain / isActive) so the winner can be deep-linked by
 * the SAME safe resolver the table's "Open workspace" button uses. They are
 * pure pass-through — the lib never derives, validates, or builds URLs; a
 * slice without them still moves (the fields are optional) and the card
 * falls back to plain text when they are absent, exactly as the table's
 * safe-builder contract prescribes (no safe URL → no link, calm fallback).
 */
export interface StoreTrendSlice {
  storeId: string;
  storeName: string;
  /** The store's current-week total (gross amount, or transaction count). */
  current: number;
  /** The store's prior-week total — the SAME vocabulary as `current`. */
  prior: number;
  /** v2.175.0: workspace identity pass-throughs (optional — see above). */
  slug?: string | null;
  subdomain?: string | null;
  isActive?: boolean;
}

/**
 * The store whose week moved the most — the honest top mover. v2.175.0:
 * carries the winner's workspace identity (slug / subdomain / isActive)
 * UNTOUCHED so the card can deep-link through the safe resolver; absent
 * fields mean the card renders plain text, never a guessed URL.
 */
export interface TrendMover {
  storeId: string;
  storeName: string;
  current: number;
  prior: number;
  /** round2(current − prior), signed — negative means the branch fell. */
  delta: number;
  /** v2.175.0: identity pass-throughs from the winning slice. */
  slug?: string | null;
  subdomain?: string | null;
  isActive?: boolean;
}

/**
 * v2.174.0: which branch moved the week? The largest ABSOLUTE week-vs-prior
 * delta wins — a branch that fell hardest is named as readily as one that
 * jumped (the sign on the card tells the direction; the lib never hides a
 * crash behind a rise). Honest silences, mirroring the variance badge's
 * rules: no prior data anywhere → null (no comparison exists); every delta
 * exactly zero → null (a flat week names no mover); fewer than two slices
 * → null ("top" among one is noise — the org variance already says it).
 * Ties on |delta| break alphabetically by name so the same input always
 * names the same branch. The delta is money-safe (toDec/round2) so a
 * float-heavy revenue path can never ship 0.30000000000000004.
 */
export function topMover(slices: StoreTrendSlice[]): TrendMover | null {
  if (slices.length < 2) return null;
  const priorTotal = slices.reduce((acc, s) => acc + s.prior, 0);
  if (priorTotal <= 0) return null;
  let winner: TrendMover | null = null;
  for (const slice of slices) {
    const delta = round2(toDec(slice.current).minus(toDec(slice.prior)).toNumber());
    if (delta === 0) continue;
    if (
      !winner ||
      Math.abs(delta) > Math.abs(winner.delta) ||
      (Math.abs(delta) === Math.abs(winner.delta) && slice.storeName < winner.storeName)
    ) {
      winner = {
        storeId: slice.storeId,
        storeName: slice.storeName,
        current: slice.current,
        prior: slice.prior,
        delta,
        slug: slice.slug,
        subdomain: slice.subdomain,
        isActive: slice.isActive,
      };
    }
  }
  return winner;
}

/**
 * v2.175.0: ONE branch's revenue spark — the rows belonging to `storeId`
 * filtered out of the shared week-row set, then bucketed by the SAME
 * sparkBuckets math the header spark speaks (half-open per-day buckets,
 * honest zeros when the branch's week is empty — a quiet branch draws a
 * flat line, never a gap). Pure: the caller passes every anchor in; the
 * function never reads the clock and never mutates the input rows.
 */
export function storeSparks(
  rows: Array<TrendRow & { storeId: string }>,
  storeId: string,
  startToday: Date,
  days = TREND_DAYS,
): number[] {
  return sparkBuckets(
    rows.filter((r) => r.storeId === storeId),
    startToday,
    days,
  );
}
