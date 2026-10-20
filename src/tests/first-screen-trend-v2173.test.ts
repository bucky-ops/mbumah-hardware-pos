import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TREND_DAYS,
  trendWindows,
  variancePct,
  sparkBuckets,
  countBuckets,
} from '@/lib/org/summary-trend';

/**
 * v2.173.0 — the first screen learns to trend.
 *
 * The owner's landing console answered "how much today?" and stopped
 * there; the week's shape lived only in the expert console. This release
 * /api/org/summary gains a 7-day trend block (gross, matching the surface)
 * and the Revenue + Transactions cards draw the sparkline + variance strip.
 *
 * The math is EXECUTED here, not pinned: midnight anchors, the −6d/−13d
 * windows, the half-open bucket boundaries at the millisecond, the
 * oldest→newest ordering, the honest zeros, and the prior=0 variance rule.
 * The GROSS semantics is pinned structurally — the lib must never learn
 * the word taxAmount, because a net spark under a gross headline would be
 * a lying adjacency.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/summary-trend.ts');
const route = readRepo('src/app/api/org/summary/route.ts');
const card = readRepo('src/components/workspace/org-console.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');

// ── anchors: a fixed instant with a known local midnight ────────────────────
// 2026-10-20T09:45:00 local → midnight 2026-10-20T00:00:00 local.
const NOW = new Date(2026, 9, 20, 9, 45, 0, 123);
const DAY_MS = 86_400_000;

describe('trendWindows - the three anchors (mirrors kpi-summary)', () => {
  it('startToday is the caller day\u2019s local midnight (time stripped)', () => {
    const w = trendWindows(NOW);
    expect(w.startToday.getFullYear()).toBe(2026);
    expect(w.startToday.getMonth()).toBe(9);
    expect(w.startToday.getDate()).toBe(20);
    expect(w.startToday.getHours()).toBe(0);
    expect(w.startToday.getMinutes()).toBe(0);
    expect(w.startToday.getSeconds()).toBe(0);
    expect(w.startToday.getMilliseconds()).toBe(0);
  });

  it('weekAgo is exactly startToday minus 6 days (the current window\u2019s start)', () => {
    const w = trendWindows(NOW);
    const midnight = new Date(2026, 9, 20, 0, 0, 0, 0);
    expect(w.weekAgo.getTime()).toBe(midnight.getTime() - 6 * DAY_MS);
  });

  it('twoWeeksAgo is exactly startToday minus 13 days (the prior window\u2019s start)', () => {
    const w = trendWindows(NOW);
    const midnight = new Date(2026, 9, 20, 0, 0, 0, 0);
    expect(w.twoWeeksAgo.getTime()).toBe(midnight.getTime() - 13 * DAY_MS);
  });

  it('is pure: the comment-stripped lib never calls Date.now (anchors come from the caller)', () => {
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).not.toContain('Date.now');
  });

  it('is pure: the same now always yields the same windows (no clock reads)', () => {
    const a = trendWindows(NOW);
    const b = trendWindows(NOW);
    expect(a.weekAgo.getTime()).toBe(b.weekAgo.getTime());
    expect(a.twoWeeksAgo.getTime()).toBe(b.twoWeeksAgo.getTime());
  });

  it('TREND_DAYS is the exported 7 the route and card both speak', () => {
    expect(TREND_DAYS).toBe(7);
    expect(lib).toContain('export const TREND_DAYS = 7;');
  });
});

describe('variancePct - the week-over-week comparison', () => {
  it('a rising week is positive and round2\u2019d', () => {
    expect(variancePct(50, 40)).toBe(25);
  });

  it('a falling week is negative', () => {
    expect(variancePct(40, 50)).toBe(-20);
  });

  it('rounds half-up to 2 decimals (the financialMath policy)', () => {
    // 100/3 = 33.333… → 33.33; 2/3 = 66.666… → 66.67
    expect(variancePct(400, 300)).toBe(33.33);
    expect(variancePct(200, 120)).toBe(66.67);
  });

  it('a flat week with prior data is 0 (the badge shows +0% — honest)', () => {
    expect(variancePct(120, 120)).toBe(0);
  });

  it('prior = 0 returns 0 — and the CARD hides the badge (no fabricated comparison)', () => {
    expect(variancePct(500, 0)).toBe(0);
    expect(variancePct(0, 0)).toBe(0);
  });

  it('a zero current week against real prior data is -100 (the honest collapse)', () => {
    expect(variancePct(0, 250)).toBe(-100);
  });
});

describe('sparkBuckets - the gross per-day revenue sparkline', () => {
  const midnight = new Date(2026, 9, 20, 0, 0, 0, 0);

  it('buckets rows by their day, oldest to newest (index 0 = 6 days ago)', () => {
    const rows = [
      { createdAt: new Date(midnight.getTime() - 6 * DAY_MS + 3_600_000), amount: 100 }, // oldest day
      { createdAt: new Date(midnight.getTime() - 3 * DAY_MS + 7_200_000), amount: 250 }, // middle
      { createdAt: new Date(midnight.getTime() + 5 * 3_600_000), amount: 400 }, // today
    ];
    const spark = sparkBuckets(rows, midnight);
    expect(spark).toHaveLength(7);
    expect(spark[0]).toBe(100);
    expect(spark[3]).toBe(250);
    expect(spark[6]).toBe(400);
    expect(spark[1]).toBe(0);
    expect(spark[5]).toBe(0);
  });

  it('a bucket includes its opening millisecond (half-open [start, end))', () => {
    const dayStart = new Date(midnight.getTime() - 2 * DAY_MS);
    const spark = sparkBuckets([{ createdAt: dayStart, amount: 99 }], midnight);
    expect(spark[4]).toBe(99);
  });

  it('a bucket EXCLUDES its closing instant (a row at midnight belongs to today, not yesterday)', () => {
    // Bucket 5 spans [midnight − 1 day, midnight); a row stamped exactly at
    // midnight is bucket 6's opening instant and must NOT fall back into 5.
    const spark = sparkBuckets([{ createdAt: midnight, amount: 77 }], midnight);
    expect(spark[6]).toBe(77);
    expect(spark[5]).toBe(0);
  });

  it('a row at the last millisecond before midnight still lands in yesterday\u2019s bucket', () => {
    const lastMs = new Date(midnight.getTime() - 1);
    const spark = sparkBuckets([{ createdAt: lastMs, amount: 55 }], midnight);
    expect(spark[5]).toBe(55);
    expect(spark[6]).toBe(0);
  });

  it('sums multiple rows within one day', () => {
    const rows = [
      { createdAt: new Date(midnight.getTime() + 1_000), amount: 10.5 },
      { createdAt: new Date(midnight.getTime() + 2_000), amount: 20.25 },
      { createdAt: new Date(midnight.getTime() + 3_000), amount: 9.25 },
    ];
    expect(sparkBuckets(rows, midnight)[6]).toBe(40);
  });

  it('empty input yields seven honest zeros (a flat line, never a gap)', () => {
    expect(sparkBuckets([], midnight)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('honors the days parameter (the route passes TREND_DAYS explicitly)', () => {
    const spark = sparkBuckets([{ createdAt: midnight, amount: 5 }], midnight, 3);
    expect(spark).toHaveLength(3);
    expect(spark[2]).toBe(5);
  });
});

describe('countBuckets - the per-day transaction count sparkline', () => {
  const midnight = new Date(2026, 9, 20, 0, 0, 0, 0);

  it('counts rows per day, one each, ignoring amounts', () => {
    const rows = [
      { createdAt: new Date(midnight.getTime() + 1_000) },
      { createdAt: new Date(midnight.getTime() + 2_000) },
      { createdAt: new Date(midnight.getTime() + 3_000) },
      { createdAt: new Date(midnight.getTime() - 1 * DAY_MS + 1_000) },
    ];
    const counts = countBuckets(rows, midnight);
    expect(counts[6]).toBe(3);
    expect(counts[5]).toBe(1);
    expect(counts[0]).toBe(0);
  });

  it('respects the same half-open boundary as the revenue buckets', () => {
    const lastMs = new Date(midnight.getTime() - 1); // bucket 5’s last ms
    const counts = countBuckets([{ createdAt: lastMs }, { createdAt: midnight }], midnight);
    expect(counts[5]).toBe(1);
    expect(counts[6]).toBe(1);
  });

  it('empty input yields seven zeros', () => {
    expect(countBuckets([], midnight)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('the gross contract - pinned structurally', () => {
  it('the lib never touches taxAmount (gross = totalAmount as-is)', () => {
    expect(lib).not.toContain('taxAmount');
  });

  it('the route\u2019s trend block reads totalAmount and says gross in its own comment', () => {
    expect(route).toContain('_sum: { totalAmount: true }');
    expect(route).toContain('GROSS by contract');
  });

  it('the route documents the kpi-summary net-of-tax divergence (on the record)', () => {
    expect(route).toContain('kpi-summary computes revenue NET of tax');
  });
});

describe('the API contract - additive, same vocabulary, same gate', () => {
  it('the response gains trend without losing any existing key', () => {
    expect(route).toContain('generatedAt: new Date().toISOString(),');
    expect(route).toContain('totals,\n        trend,\n        perStoreTrend,\n        hr,'); // v2.175.0: perStoreTrend joins additively
    expect(route).toContain('stores: storeRows,');
    expect(route).toContain('recentAudit,');
  });

  it('the trend reads ride the SAME SALE + settled-status vocabulary as the totals', () => {
    const block = route.split('const TREND_WHERE')[1]?.split('};')[0] || '';
    expect(route).toContain("transactionType: 'SALE'");
    expect(route).toContain("paymentStatus: { in: ['COMPLETED', 'PARTIAL'] }");
    expect(block).not.toContain("paymentStatus: { in: ['PENDING'");
  });

  it('the prior window is strictly before the current window (gte twoWeeksAgo, lt weekAgo)', () => {
    expect(route).toContain('createdAt: { gte: windows.twoWeeksAgo, lt: windows.weekAgo }');
  });

  it('the role gate is untouched (SUPER_ADMIN, STORE_OWNER, ACCOUNTANT only)', () => {
    expect(route).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];");
  });

  it('the lib import list is the one the card-side tests pin', () => {
    expect(route).toContain(
      "import { TREND_DAYS, trendWindows, variancePct, sparkBuckets, countBuckets, topMover, storeSparks } from '@/lib/org/summary-trend';", // v2.175.0: storeSparks joins
    );
  });
});

describe('the card contract - the trend strip', () => {
  it('reuses the expert console\u2019s Sparkline primitive (one shape language)', () => {
    expect(card).toContain("import { Sparkline } from '@/components/org/primitives';");
  });

  it('renders two trend strips with their testids', () => {
    expect(card).toContain('testId="metric-trend-revenue"');
    expect(card).toContain('testId="metric-trend-transactions"');
  });

  it('the badge renders ONLY when the prior week has data', () => {
    expect(card).toContain('priorWeekTotal > 0 &&');
  });

  it('the badge speaks the v2.159 contrast lesson (emerald-700 / red-700, dark -400)', () => {
    expect(card).toContain("up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'");
  });

  it('the microcopy names both weeks (7d … · prior …)', () => {
    expect(card).toContain('7d {format(weekTotal)} · prior {format(priorWeekTotal)}');
  });

  it('trend is TOLERANT: optional and nullable in the OrgSummary interface', () => {
    expect(card).toContain('  trend?: {\n    revenue: { spark: number[]; weekTotal: number; priorWeekTotal: number; variancePct: number; topMover?: TrendMoverSummary | null };\n    transactions: { spark: number[]; weekTotal: number; priorWeekTotal: number; variancePct: number; topMover?: TrendMoverSummary | null };\n  } | null;');
  });

  it('each card gates its footer on summary.trend (older responses degrade, not crash)', () => {
    expect(card).toContain('footer={\n                summary.trend ? (');
    expect((card.match(/summary\.trend \? \(/g) || []).length).toBe(2);
  });

  it('the transactions spark carries the blue identity stroke (decorative, aria-hidden svg)', () => {
    expect(card).toContain('stroke="#2563eb"');
  });

  it('the sparkline stays decoration - the numbers below it are the content', () => {
    expect(card).toContain('(aria-hidden decoration; the numbers below it are the');
    expect(card).toContain('real content)');
  });

  it('the variance badge carries both arrows (up and down)', () => {
    expect(card).toContain('<ArrowUpRight className="h-3 w-3" aria-hidden="true" />');
    expect(card).toContain('<ArrowDownRight className="h-3 w-3" aria-hidden="true" />');
  });
});

describe('the doc contract', () => {
  it('the org console doc names the trend strip and its honesty rules', () => {
    expect(doc).toContain('A 7-day trend strip on the Revenue and Transactions cards (v2.173.0)');
    expect(doc).toContain('never a fabricated "+0%"');
    expect(doc).toContain('degrades to the plain cards when absent');
  });

  it('the KPI table defines the spark and the variance rule', () => {
    expect(doc).toContain('| Trend · Revenue spark |');
    expect(doc).toContain('| Trend · variance badge |');
    expect(doc).toContain('src/lib/org/summary-trend.ts');
  });

  it('the doc records the kpi-summary net-of-tax divergence too', () => {
    expect(doc).toContain('computes its revenue NET of tax');
  });
});
