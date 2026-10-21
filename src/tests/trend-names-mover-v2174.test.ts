import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { topMover, variancePct, type StoreTrendSlice } from '@/lib/org/summary-trend';

/**
 * v2.174.0 — the trend names which branch moved.
 *
 * The trend strip said "the week moved −7.14%" but not WHO moved it. This
 * release the strip names the branch: the top mover, computed by the pure
 * lib's topMover from per-store slices, exposed additively by the summary
 * route, and rendered as a `Top mover <name> <signed delta>` sub-line.
 *
 * The math is EXECUTED here, not pinned: the max-|delta| winner in both
 * directions, the honest nulls (no prior anywhere / all flat / one store),
 * the alphabetical tie-break, the zero-week mover, and round2 money
 * safety. The card contract pins render-shape, classes, and testids — and
 * the no-math rule (every number arrives server-computed).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/summary-trend.ts');
const route = readRepo('src/app/api/org/summary/route.ts');
const card = readRepo('src/components/workspace/org-console.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');

const slice = (id: string, name: string, current: number, prior: number): StoreTrendSlice => ({
  storeId: id,
  storeName: name,
  current,
  prior,
});

describe('topMover - the executed math', () => {
  it('names the branch with the largest ABSOLUTE delta (a rise)', () => {
    const m = topMover([
      slice('s1', 'Thika', 45_000, 10_000),
      slice('s2', 'Juja', 5_000, 4_000),
      slice('s3', 'Nanyuki', 0, 0),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Thika');
    expect(m?.delta).toBe(35_000);
    expect(m?.current).toBe(45_000);
    expect(m?.prior).toBe(10_000);
  });

  it('names a FALL just as readily — the biggest crash wins, signed negative', () => {
    const m = topMover([
      slice('s1', 'Thika', 45_000, 10_000),
      slice('s2', 'Juja', 1_000, 90_000),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Juja');
    expect(m?.delta).toBe(-89_000);
  });

  it('returns null when the prior week has no data anywhere (the honest-variance rule)', () => {
    expect(topMover([slice('s1', 'Thika', 45_000, 0), slice('s2', 'Juja', 5_000, 0)])).toBeNull();
  });

  it('returns null for an exactly flat week — silence, never a fabricated name', () => {
    expect(
      topMover([slice('s1', 'Thika', 45_000, 45_000), slice('s2', 'Juja', 5_000, 5_000)]),
    ).toBeNull();
  });

  it('returns null for fewer than two slices ("top" among one is noise)', () => {
    expect(topMover([slice('s1', 'Thika', 45_000, 10_000)])).toBeNull();
    expect(topMover([])).toBeNull();
  });

  it('breaks |delta| ties alphabetically so the same input names the same branch', () => {
    const m = topMover([
      slice('s2', 'Nanyuki', 20_000, 10_000),
      slice('s1', 'Juja', 30_000, 20_000),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Juja'); // both +10_000; "Juja" < "Nanyuki"
  });

  it('names a zero-week riser: prior 0 elsewhere can still win, with no percentage of its own', () => {
    const m = topMover([
      slice('s1', 'Thika', 50_000, 50_000),
      slice('s2', 'Juja', 7_500, 0),
      slice('s3', 'Nanyuki', 10_000, 12_000),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Juja');
    expect(m?.delta).toBe(7_500);
    expect(m?.prior).toBe(0);
    // the % clause belongs to the CARD's prior > 0 gate; the lib's
    // variancePct would be 0 here — the API ships it, the card hides it.
    expect(variancePct(m?.current ?? 0, m?.prior ?? 0)).toBe(0);
  });

  it('the delta is money-safe: float-heavy sums round to 2 dp, never 0.30000000000000004', () => {
    const m = topMover([
      slice('s1', 'Thika', 100 + (35.1 + 0.2), 100),
      slice('s2', 'Juja', 10, 5),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Thika');
    expect(m?.delta).toBe(35.3);
  });

  it('the count path is the same function — integers in, integer deltas out', () => {
    const m = topMover([
      slice('s1', 'Thika', 12, 5),
      slice('s2', 'Juja', 3, 4),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Thika');
    expect(m?.delta).toBe(7);
  });

  it('purity: the lib stays db-free, fetch-free and clock-free', () => {
    const stripped = lib
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    expect(stripped).not.toContain('Date.now');
    expect(stripped).not.toContain('rawDb');
    expect(stripped).not.toContain('fetch(');
  });
});

describe('the API contract - the mover rides the same Promise.all', () => {
  it('two per-store groupBys join the reads (current + prior windows)', () => {
    expect((route.match(/rawDb\.salesTransaction\.groupBy\(/g) || []).length).toBe(3); // today + 2 mover slices
    expect(route).toContain(
      'where: { ...TREND_WHERE, createdAt: { gte: windows.twoWeeksAgo, lt: windows.weekAgo } },',
    );
  });

  it('BOTH mover metrics come from ONE query per window (sum + count together)', () => {
    const moverBlock = route.split('v2.174.0: per-store CURRENT-week slices')[1]?.split(']);')[0] || '';
    expect(moverBlock).toContain('_sum: { totalAmount: true },');
    expect(moverBlock).toContain('_count: { _all: true },');
  });

  it('the slices are named through the ACTIVE store list — unnamed sales are counted but never spoken', () => {
    expect(route).toContain('const revSlices = stores.map((s) => ({');
    expect(route).toContain('const txSlices = stores.map((s) => ({');
    expect(route).toContain('storeName: s.name,');
  });

  it('each trend block exposes topMover additively (null honest, ±% server-computed)', () => {
    expect(route).toContain('topMover: revenueMover');
    expect(route).toContain('topMover: txMover');
    expect(route).toContain('variancePct: variancePct(revenueMover.current, revenueMover.prior)');
    expect(route).toContain('variancePct: variancePct(txMover.current, txMover.prior)');
  });

  it('the response stays additive — the v2.173.0 keys and role gate untouched', () => {
    expect(route).toContain('totals,\n        trend,\n        perStoreTrend,\n        hr,'); // v2.175.0: perStoreTrend joins additively
    expect(route).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];");
    expect(route).toContain('sparkBuckets(trendRows, windows.startToday, TREND_DAYS)');
    expect(route).toContain('countBuckets(trendRows, windows.startToday, TREND_DAYS)');
  });
});

describe('the card contract - the mover sub-line', () => {
  it('TrendFooter carries the optional mover (tolerant, like the strip itself)', () => {
    expect(card).toContain('mover?: TrendMoverSummary | null;');
  });

  it('both cards wire the server-computed mover — no math in the card', () => {
    expect(card).toContain('mover={summary.trend.revenue.topMover}');
    expect(card).toContain('mover={summary.trend.transactions.topMover}');
    expect(card).not.toContain('topMover(revSlices)');
  });

  it('the sub-line renders only when a mover exists, with its own testid', () => {
    expect(card).toContain('{mover && (');
    expect(card).toContain('data-testid={`${testId}-mover`}');
  });

  it('the sentence names the branch and signs the delta (abs + explicit sign)', () => {
    expect(card).toContain('Top mover{\' \'}'); // v2.175.0: the name may now be an anchor, so the JSX splits
    expect(card).toContain("{mover.delta >= 0 ? '+' : '-'}");
    expect(card).toContain('format(Math.abs(mover.delta))');
  });

  it('the ±% clause is gated on the mover\u2019s own prior > 0 (a zero week has no percentage)', () => {
    expect(card).toContain('{mover.prior > 0 && (');
    expect(card).toContain("{mover.variancePct >= 0 ? '+' : ''}");
  });

  it('the mover speaks the same contrast family as the badge (v2.159 lesson, dark -400)', () => {
    expect(card).toContain(
      "mover.delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'",
    );
  });

  it('the TrendMoverSummary type is declared and mirrors the lib shape (v2.175.0 grew the identity fields)', () => {
    expect(card).toContain('interface TrendMoverSummary {');
    expect(card).toContain(
      '  storeId: string;\n  storeName: string;\n  current: number;\n  prior: number;\n  delta: number;\n  variancePct: number;\n  slug?: string | null;\n  subdomain?: string | null;\n  isActive?: boolean;\n}',
    );
  });
});

describe('the doc contract', () => {
  it('the org console doc teaches the top-mover sub-line and its silences', () => {
    expect(doc).toContain('A top-mover sub-line on the same strip (v2.174.0)');
    expect(doc).toContain('never an invented ∞');
    expect(doc).toContain('an exactly flat week, or a single-store org name nobody');
  });

  it('the KPI table defines the top mover', () => {
    expect(doc).toContain('| Trend · top mover |');
    expect(doc).toContain('ties break alphabetically');
  });

  it('the v2.173.0 trend rows stay on the record', () => {
    expect(doc).toContain('| Trend · Revenue spark |');
    expect(doc).toContain('| Trend · variance badge |');
  });
});

describe('the release surfaces', () => {
  it('the changelog head speaks v2.174.0', () => {
    expect(readRepo('CHANGELOG.md')).toContain('## [2.174.0] The trend names which branch moved');
  });

  it('the whats-new feed leads with v2.174.0', () => {
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed).toContain("version: '2.174.0'");
    expect(feed.indexOf('2.174.0')).toBeLessThan(feed.indexOf('2.173.0'));
  });

  it('package.json leads the current version in all three slots (re-anchored for 2.181.0)', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.207.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.207.0');
    expect(pkg.mbumah.baseVersion).toBe('2.207.0');
  });
});
