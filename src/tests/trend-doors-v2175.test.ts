import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storeSparks, topMover, TREND_DAYS, type TrendRow, type StoreTrendSlice } from '@/lib/org/summary-trend';

/**
 * v2.175.0 — the week reaches every branch row + the mover becomes a door.
 *
 * The trend strip named which branch moved the week (v2.174.0) but the
 * branches table below it stayed shape-blind. This release:
 *   1. the table gains a 7d trend column — one muted spark per branch,
 *      bucketed from the SAME week rows the header sparks speak (the
 *      route's findMany gained storeId; no second query);
 *   2. the mover's name deep-links to the branch workspace through the
 *      SAME safe resolver the table speaks, plain text when no safe URL
 *      exists (the safe-builder contract verbatim).
 *
 * The math is EXECUTED here (storeSparks' filtering, bucket boundaries,
 * honest zeros), the identity pass-through is pinned (winner carries
 * slug/subdomain/isActive — the lib never builds URLs), and the API/card
 * contracts pin render-shape, testids, and the tolerant degradations.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/summary-trend.ts');
const route = readRepo('src/app/api/org/summary/route.ts');
const card = readRepo('src/components/workspace/org-console.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');

// The same fixed midnight anchor the v2.173/v2.174 suites pin to (a fixed
// local midnight so bucket math is exact to the millisecond).
const ANCHOR = new Date(2026, 9, 20, 0, 0, 0, 0); // 2026-10-20 local midnight

const row = (storeId: string, dayOffset: number, hour: number, amount: number): TrendRow & { storeId: string } => ({
  storeId,
  createdAt: new Date(ANCHOR.getTime() - dayOffset * 86_400_000 + hour * 3_600_000),
  amount,
});

const slice = (
  id: string,
  name: string,
  current: number,
  prior: number,
  identity?: { slug?: string | null; subdomain?: string | null; isActive?: boolean },
): StoreTrendSlice => ({ storeId: id, storeName: name, current, prior, ...identity });

describe('storeSparks - the executed math', () => {
  it("filters to ONLY the named store's rows — another branch's sales never leak into its shape", () => {
    const rows = [
      row('s1', 0, 10, 100), // s1, today
      row('s2', 0, 11, 999), // s2, today — must NOT appear in s1's buckets
      row('s1', 1, 9, 50), // s1, yesterday
    ];
    const spark = storeSparks(rows, 's1', ANCHOR);
    expect(spark).toHaveLength(TREND_DAYS);
    expect(spark[6]).toBe(100); // today's bucket: only s1's 100
    expect(spark[5]).toBe(50); // yesterday's bucket
    expect(spark[0]).toBe(0); // 6 days back: nothing
  });

  it('buckets are half-open — the opening ms belongs, the closing ms belongs to the NEXT day', () => {
    const dayStartMinus2 = new Date(ANCHOR.getTime() - 2 * 86_400_000);
    const nextDayStart = new Date(dayStartMinus2.getTime() + 86_400_000);
    const rows = [
      { storeId: 's1', createdAt: dayStartMinus2, amount: 10 }, // opening instant → bucket 4
      { storeId: 's1', createdAt: new Date(nextDayStart.getTime() - 1), amount: 20 }, // last ms → bucket 4
      { storeId: 's1', createdAt: nextDayStart, amount: 40 }, // closing instant → bucket 5
    ];
    const spark = storeSparks(rows, 's1', ANCHOR);
    expect(spark[4]).toBe(30);
    expect(spark[5]).toBe(40);
  });

  it('a quiet branch draws the honest flat line — zeros, never a gap', () => {
    const rows = [row('s2', 3, 12, 500)];
    const spark = storeSparks(rows, 's1', ANCHOR);
    expect(spark).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(storeSparks([], 's1', ANCHOR)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('same-day rows SUM with round2 money safety (35.1 + 0.2 = 35.3, never ...00000004)', () => {
    const rows = [row('s1', 0, 9, 35.1), row('s1', 0, 15, 0.2)];
    const spark = storeSparks(rows, 's1', ANCHOR);
    expect(spark[6]).toBe(35.3);
  });

  it('the days param shrinks the window (a caller may want a shorter week)', () => {
    const rows = [row('s1', 1, 10, 70)]; // 1 day back → middle bucket of a 3-day window
    expect(storeSparks(rows, 's1', ANCHOR, 3)).toEqual([0, 70, 0]);
  });

  it('purity: the lib stays db-free, fetch-free and clock-free (comment-stripped)', () => {
    const stripped = lib
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    expect(stripped).not.toContain('Date.now');
    expect(stripped).not.toContain('rawDb');
    expect(stripped).not.toContain('fetch(');
  });
});

describe('the identity pass-through - the winner rides the table identity', () => {
  it('topMover carries the winning slice slug/subdomain/isActive untouched', () => {
    const m = topMover([
      slice('s1', 'Thika', 45_000, 10_000, { slug: 'thika', subdomain: 'thika', isActive: true }),
      slice('s2', 'Juja', 5_000, 4_000, { slug: 'juja', subdomain: null, isActive: true }),
    ]);
    expect(m).not.toBeNull();
    expect(m?.storeName).toBe('Thika');
    expect(m?.slug).toBe('thika');
    expect(m?.subdomain).toBe('thika');
    expect(m?.isActive).toBe(true);
  });

  it('a null slug flows through as null — the card will render plain text, never a guessed URL', () => {
    const m = topMover([
      slice('s1', 'Juja', 5_000, 4_000, { slug: null, subdomain: null, isActive: true }),
      slice('s2', 'Thika', 45_000, 10_000, { slug: null, subdomain: null, isActive: true }),
    ]);
    expect(m?.storeName).toBe('Thika');
    expect(m?.slug).toBeNull();
    expect(m?.subdomain).toBeNull();
  });

  it('slices WITHOUT identity still move — the fields are optional, the winner carries undefined', () => {
    const m = topMover([slice('s1', 'Thika', 45_000, 10_000), slice('s2', 'Juja', 5_000, 4_000)]);
    expect(m?.storeName).toBe('Thika');
    expect(m?.slug).toBeUndefined();
    expect(m?.isActive).toBeUndefined();
  });

  it('identity never changes WHO wins — the same slices name the same branch with or without it', () => {
    const bare = topMover([slice('s1', 'Thika', 45_000, 10_000), slice('s2', 'Juja', 1_000, 90_000)]);
    const dressed = topMover([
      slice('s1', 'Thika', 45_000, 10_000, { slug: 'thika', isActive: true }),
      slice('s2', 'Juja', 1_000, 90_000, { slug: 'juja', isActive: false }),
    ]);
    expect(bare?.storeName).toBe(dressed?.storeName);
    expect(bare?.delta).toBe(dressed?.delta);
    expect(dressed?.isActive).toBe(false); // an inactive branch CAN be named; the card just cannot link it
  });

  it('the lib never builds or validates URLs — no href, no resolveBranchWorkspace, no slug backfill logic', () => {
    expect(lib).not.toContain('resolveBranchWorkspace');
    expect(lib).not.toContain('href');
    expect(lib).not.toContain('/stores/');
  });
});

describe('the API contract - one findMany feeds every spark', () => {
  it('the week-row select gains storeId — the SAME rows feed the per-branch sparks', () => {
    expect(route).toContain('select: { createdAt: true, totalAmount: true, storeId: true },');
  });

  it('no second row fetch was spent — still exactly ONE salesTransaction.findMany', () => {
    expect((route.match(/rawDb\.salesTransaction\.findMany\(/g) || []).length).toBe(1);
  });

  it('the trendRows mapping carries storeId through to the bucket callers', () => {
    expect(route).toContain('storeId: r.storeId,');
  });

  it('perStoreTrend is built from the shared row set via storeSparks, keyed by storeId', () => {
    expect(route).toContain('const perStoreTrend = stores.map((s) => ({');
    expect(route).toContain('spark: storeSparks(trendRows, s.id, windows.startToday, TREND_DAYS),');
    expect(route).toContain('weekTotal: round2(curMap.get(s.id)?.amount ?? 0),');
  });

  it('perStoreTrend rides the response additively (after trend, before hr)', () => {
    expect(route).toContain('totals,\n        trend,\n        perStoreTrend,\n        hr,');
  });

  it('both slice maps carry the workspace identity pass-throughs', () => {
    expect(route).toContain('slug: s.slug,');
    expect(route).toContain('subdomain: s.subdomain,');
    expect((route.match(/isActive: s\.status === 'ACTIVE',/g) || []).length).toBe(2);
  });

  it('the v2.174.0 groupBy pair and the role gate stay untouched', () => {
    expect((route.match(/rawDb\.salesTransaction\.groupBy\(/g) || []).length).toBe(3);
    expect(route).toContain("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];");
    expect(route).toContain("import { TREND_DAYS, trendWindows, variancePct, sparkBuckets, countBuckets, topMover, storeSparks } from '@/lib/org/summary-trend';");
  });

  it('the gross contract comment stays on the record beside the per-branch block', () => {
    expect(route).toContain('no second findMany is spent');
    expect(route).toContain('the honest flat line');
  });
});

describe('the card contract - the 7d column and the door', () => {
  it('OrgSummary grows the TOLERANT perStoreTrend (optional + nullable, keyed by storeId)', () => {
    expect(card).toContain('perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;');
  });

  it('the branches table gains the 7d trend column, beside the revenue column it decorates', () => {
    // v2.182.0 pin evolution (deliberate): the branches table's headers are
    // now DRIVEN by the BRANCH_TABLE_COLS spec (sortable, resizable,
    // hideable — the matrix's owner vocabulary), so the header text lives
    // in the spec, not in literal <th> markup. The column ORDER the old
    // pins guarded is the spec's array order: revenue, then week, then
    // txns — the same vocabulary, one place.
    expect(card).toContain("{ key: 'revenue', label: 'Revenue today'");
    expect(card).toContain("{ key: 'week', label: '7d trend'");
    expect(card).toContain("{ key: 'txns', label: 'Txns'");
    expect(card.indexOf("{ key: 'revenue', label: 'Revenue today'")).toBeLessThan(
      card.indexOf("{ key: 'week', label: '7d trend'"),
    );
    expect(card.indexOf("{ key: 'week', label: '7d trend'")).toBeLessThan(
      card.indexOf("{ key: 'txns', label: 'Txns'"),
    );
  });

  it('the row joins by storeId — never row order', () => {
    expect(card).toContain('summary.perStoreTrend?.find((t) => t.storeId === store.id) ?? null');
  });

  it('the spark is the SAME primitive, muted slate, 72×20 — a table of sparks never out-screams the cards', () => {
    expect(card).toContain('stroke="#64748b"');
    expect(card).toContain('width={72} height={20}');
  });

  it('the numbers ride the title tooltip AND an sr-only clause — the svg stays aria-hidden decoration', () => {
    // evolved for v2.177.0: the tooltip gains the prior week exactly when one
    // exists; the base sr-only clause keeps its exact v2.175.0 shape (the
    // verdict rides a SECOND sentence).
    expect(card).toContain("title={`7-day revenue ${formatKES(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${formatKES(storeTrend.priorWeekTotal)}` : ''}`}");
    expect(card).toContain('<span className="sr-only">7-day revenue {formatKES(storeTrend.weekTotal)}</span>');
  });

  it('an absent payload degrades to a muted dash — honest absence, never a fabricated shape', () => {
    expect(card).toContain('{storeTrend ? (');
    expect(card).toContain('<span className="text-muted-foreground" aria-hidden="true">');
  });

  it('the mover name becomes a DOOR through the table\u2019s own safe resolver', () => {
    expect(card).toContain('const moverHref = mover');
    expect(card).toContain('resolveBranchWorkspace({');
    expect(card).toContain("isActive: mover.isActive ?? false");
  });

  it('the anchor speaks new-tab semantics + its own testid + the a11y clauses', () => {
    expect(card).toContain('target="_blank"');
    expect(card).toContain('rel="noopener noreferrer"');
    expect(card).toContain('data-testid={`${testId}-mover-link`}');
    expect(card).toContain('<span className="sr-only"> (opens in a new tab)</span>');
    expect(card).toContain('focus-visible:ring-2 focus-visible:ring-ring');
    expect(card).toContain('underline decoration-muted-foreground/40 underline-offset-2');
  });

  it('no safe URL → plain text (the safe-builder contract verbatim, still bolded for parity)', () => {
    expect(card).toContain('{moverHref ? (');
    expect(card).toContain("<span className=\"font-medium text-foreground/80\">{mover.storeName}</span>");
  });

  it('TrendMoverSummary carries the optional identity fields', () => {
    expect(card).toContain('interface TrendMoverSummary {');
    expect(card).toContain('  slug?: string | null;\n  subdomain?: string | null;\n  isActive?: boolean;\n}');
  });

  it('the card stays math-free — it imports the resolver and the primitive, never the trend lib', () => {
    // evolved for v2.177.0: the import grew the WeekDeltaChip twins — the
    // chip still imports the PRIMITIVES module, never the trend lib (the
    // lib stays server/pure-side; primitives owns the client vocabulary).
    expect(card).toContain("import { Sparkline, WeekDeltaChip, weekDeltaWords } from '@/components/org/primitives';");
    expect(card).not.toContain("from '@/lib/org/summary-trend'");
    expect(card).toContain("import { buildPeoplePayrollDeepLink } from '@/lib/workspace/links';");
  });
});

describe('the doc contract', () => {
  it('the org console doc teaches the mover door and its fallback', () => {
    expect(doc).toContain("The mover's name is a door (v2.175.0)");
    expect(doc).toContain('no safe URL, no link, calm fallback');
  });

  it('the doc teaches the 7d column: same rows, muted slate, honest flat line, tolerant dash', () => {
    expect(doc).toContain('**7d trend** column');
    expect(doc).toContain('gained `storeId` in its select — no second query');
    expect(doc).toContain('an older cached response without it degrades to a muted "—" per row');
  });

  it('the KPI table defines both v2.175.0 rows', () => {
    expect(doc).toContain('| Trend · mover link |');
    expect(doc).toContain('| Trend · per-branch 7d spark |');
  });

  it('the v2.173/v2.174 trend rows stay on the record', () => {
    expect(doc).toContain('| Trend · Revenue spark |');
    expect(doc).toContain('| Trend · variance badge |');
    expect(doc).toContain('| Trend · top mover |');
  });
});

describe('the release surfaces', () => {
  it('the changelog head speaks v2.175.0', () => {
    expect(readRepo('CHANGELOG.md')).toContain('## [2.175.0] The week reaches every branch row');
  });

  it('the whats-new feed leads with v2.175.0', () => {
    const feed = readRepo('src/lib/whats-new.ts');
    expect(feed).toContain("version: '2.175.0'");
    expect(feed.indexOf('2.175.0')).toBeLessThan(feed.indexOf('2.174.0'));
  });

  it('package.json leads the current version in all three slots (re-anchored for 2.181.0) + this round\u2019s verify script', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.190.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.190.0');
    expect(pkg.mbumah.baseVersion).toBe('2.190.0');
    expect(pkg.scripts['verify:v2-175-0']).toBe('node scripts/verify-v2-175-0.mjs');
  });
});
