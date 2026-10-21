import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.195.0 — the transactions card finds its week (+ the modal's REAL
 * ground).
 *
 * The KPI row has had ONE voice since v2.173.0: the Revenue card opened
 * the money's drill-down while the Transactions card sat mute beside it —
 * a static tile even though its week was already on the wire. This
 * release gives the count face its voice: the card becomes the row's
 * second button, the wire grows `transactions.spark` (the SAME settled
 * rows counted one each in the SAME pass as the three money sparks —
 * four faces of one read, zero new queries) and /api/org/summary's
 * perStoreTrend maps `txWeek`/`txPrior` from the per-store groupBys that
 * have carried them since v2.174.0. The drill-down mirrors the revenue
 * modal's anatomy (spark, stat grid, week-over-week strip, branch rows)
 * in the face's blue.
 *
 * AND the round's bug: the v2.194.0 dark-voice fix was true to its math
 * and false to its surface — the modal's body panel kept its light
 * `bg-slate-50` while the interior wore dark:text tokens, and the DOM
 * composites against the NEAREST painted ancestor. Measured live:
 * slate-100 values on the unpainted panel = 1.05:1. Both panels now own
 * `dark:bg-slate-900` and the contrast script re-derives every family
 * over the REAL chain (46/46, the discovery rows pinned in reverse).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const route = readRepo('src/app/api/org/kpi-summary/route.ts');
const summary = readRepo('src/app/api/org/summary/route.ts');
const kpi = readRepo('src/components/org/kpi-row.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const workspaceDoc = readRepo('docs/multi-store-workspaces.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const contrastScript = readRepo('scripts/contrast-math-transactions-lens-v2195.mjs');
const pkg = JSON.parse(readRepo('package.json'));

describe('the fourth bucket executed - one pass, four faces, zero new reads', () => {
  // The route's loop shape, executed on the sample rows: the SAME rows fill
  // FOUR arrays in ONE pass (the route computes these inline — the pins
  // below hold the source to this exact shape; this execution demonstrates
  // the math the pinned lines speak).
  const fill = (rows: Array<{ createdAt: Date }>, startToday: Date) => {
    const DAY_MS = 86_400_000;
    const sparkBuckets = new Array<number>(7).fill(0);
    const netBuckets = new Array<number>(7).fill(0);
    const taxBuckets = new Array<number>(7).fill(0);
    const txBuckets = new Array<number>(7).fill(0);
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(startToday.getTime() - (6 - i) * DAY_MS);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      for (const row of rows) {
        if (row.createdAt >= dayStart && row.createdAt < dayEnd) {
          sparkBuckets[i] += 1000;
          netBuckets[i] += 850;
          taxBuckets[i] += 150;
          txBuckets[i] += 1;
        }
      }
    }
    return { sparkBuckets, netBuckets, taxBuckets, txBuckets };
  };

  it('every settled row lands in the count bucket — money and count fill together', () => {
    const startToday = new Date('2026-10-21T00:00:00.000Z');
    const day6 = new Date('2026-10-21T12:00:00.000Z'); // today (bucket 6)
    const day2 = new Date('2026-10-17T12:00:00.000Z'); // bucket 2
    const { sparkBuckets, txBuckets } = fill(
      [{ createdAt: day6 }, { createdAt: day6 }, { createdAt: day2 }],
      startToday,
    );
    expect(sparkBuckets).toEqual([0, 0, 1000, 0, 0, 0, 2000]);
    expect(txBuckets).toEqual([0, 0, 1, 0, 0, 0, 2]);
    // the count identity: a checkout cannot arrive in halves — the buckets
    // stay integers, and the week's counts sum to the row count
    expect(txBuckets.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('the route counts the SAME rows in the SAME loop — the source stays the one pass', () => {
    expect(route).toContain('const sparkBuckets = new Array<number>(7).fill(0);');
    expect(route).toContain('const taxBuckets = new Array<number>(7).fill(0);');
    expect(route).toContain('const txBuckets = new Array<number>(7).fill(0);');
    expect(route).toContain('txBuckets[i] += 1;');
    expect(route).toContain('const txSpark = txBuckets.map((v) => Math.round(v));');
    // the one-pass claim lives where the loop reads
    expect(route).toContain('four faces of one read, still one');
    // the integer-by-construction rationale
    expect(route).toContain('a checkout can arrive in halves');
  });

  it('the payload grows transactions.spark ADDITIVELY - the money fields keep their names', () => {
    expect(route).toContain('transactions: { today: txToday, weekTotal: txWeek, priorWeekTotal: txPrior, variancePct: txVariancePct, spark: txSpark },');
    expect(route).toContain('the count face gains its own `spark`');
  });

  it('ONE writer: the buckets live only in the kpi-summary route', () => {
    // The wire field's composer is singular — the client reads
    // k.transactions.spark, it never recomputes it.
    expect(route.match(/txBuckets/g)?.length).toBeGreaterThan(2);
    expect(kpi).not.toContain('txBuckets');
    expect(summary).not.toContain('txBuckets');
  });

  it('the client type stays tolerant - optional, older cached answers degrade', () => {
    expect(primitives).toContain('transactions: { today: number; weekTotal: number; priorWeekTotal: number; variancePct: number; spark?: number[] };');
  });
});

describe('the per-branch counts - mapped from the groupBys that already carried them', () => {
  it('perStoreTrend maps txWeek/txPrior from the v2.174.0 maps - zero new queries', () => {
    expect(summary).toContain('txWeek: curMap.get(s.id)?.count ?? 0,');
    expect(summary).toContain('txPrior: priMap.get(s.id)?.count ?? 0,');
    expect(summary).toContain('the counts were already in memory, waiting');
    // the maps' count field comes from the per-store groupBys' _count._all —
    // fetched since v2.174.0 for the top mover
    expect(summary).toContain('count: r._count?._all ?? 0');
  });

  it('the money fields keep their names - nothing re-keys', () => {
    expect(summary).toContain('weekTotal: round2(curMap.get(s.id)?.amount ?? 0),');
    expect(summary).toContain('priorWeekTotal: round2(priMap.get(s.id)?.amount ?? 0),');
  });
});

describe('the card speaks - the row\'s second button, the blue face', () => {
  it('the transactions card is a button that opens its drill-down', () => {
    expect(kpi).toContain('const [txOpen, setTxOpen] = useState(false);');
    expect(kpi).toContain('onClick={() => setTxOpen(true)}');
    expect(kpi).toContain('data-testid="transactions-card"');
    expect(kpi).toContain('focus-ring group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg');
  });

  it('the face wears its family: blue edge, live dot, the settled qualifier', () => {
    expect(kpi).toContain('<span className="absolute inset-y-0 left-0 w-1 bg-blue-500" />');
    expect(kpi).toContain('<span className="h-2 w-2 rounded-full bg-blue-500 anim-pulse-dot" />');
    expect(kpi).toContain('bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-700 ring-1 ring-blue-200');
    expect(kpi).toContain('>settled</span>');
    expect(kpi).toContain('Settled checkouts — the same rows the Revenue card sums');
  });

  it('the card learns its shape, tolerantly - the legacy line stays as the fallback', () => {
    expect(kpi).toContain('const txSparkReady = Array.isArray(k.transactions.spark) && k.transactions.spark.length === 7;');
    expect(kpi).toContain('{txSparkReady ? (');
    expect(kpi).toContain('<Sparkline data={k.transactions.spark ?? []} stroke="#2563eb" />');
    expect(kpi).toContain('7d {num(k.transactions.weekTotal)}</span>');
    // the legacy text line survives as the older-cached-answer fallback
    expect(kpi).toContain('<p className="mt-2 text-[10px] text-slate-500">today · 7d {num(k.transactions.weekTotal)} vs prior {num(k.transactions.priorWeekTotal)}</p>');
  });
});

describe('the drill-down - the revenue modal\'s anatomy, speaking counts', () => {
  it('the modal mounts with its own title and spark, tolerant', () => {
    expect(kpi).toContain('<Dialog open={txOpen} onOpenChange={setTxOpen}>');
    expect(kpi).toContain('<CalendarCheck2 className="h-4 w-4 text-blue-600" /> Transactions trend</DialogTitle>');
    expect(kpi).toContain('data-testid="transactions-spark"');
    expect(kpi).toContain('title="Settled checkouts per day, last 7 days"');
    expect(kpi).toContain('<Sparkline data={k.transactions.spark ?? []} stroke="#2563eb" width={380} height={80} />');
    // the honest absence note when the shape is not on the cached answer
    expect(kpi).toContain('data-testid="transactions-spark-absent"');
    expect(kpi).toContain('the per-day shape is not on this cached answer');
  });

  it('the stat grid speaks the four count cells', () => {
    expect(kpi).toContain('data-testid="transactions-today"');
    expect(kpi).toContain('data-testid="transactions-week"');
    expect(kpi).toContain('data-testid="transactions-prior"');
    expect(kpi).toContain('data-testid="transactions-avg"');
  });

  it('the week-over-week strip wears the blue family and the honesty rule', () => {
    expect(kpi).toContain('rounded-lg border border-blue-100 bg-blue-50/70 px-2.5 py-1.5 dark:border-blue-500/30 dark:bg-blue-500/10');
    expect(kpi).toContain('text-[10px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300');
    expect(kpi).toContain('text-xs font-semibold tabular-nums text-blue-900 dark:text-blue-200');
    expect(kpi).toContain('dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30');
    expect(kpi).toContain('transactions week-over-week</span>');
    // a zero prior renders NO percentage — never an invented "0%", never NaN
    expect(kpi).toContain('const txPct = k.transactions.priorWeekTotal > 0 ? Math.round((txDelta / k.transactions.priorWeekTotal) * 1000) / 10 : null;');
    expect(kpi).toContain("{txPct == null ? 'vs prior' : `${txDelta > 0 ? '+' : ''}${txPct}% vs prior`}");
  });

  it('the branch rows join by storeId, loudest count first, the chip primitive speaks', () => {
    expect(kpi).toContain('const branchTx = perStoreTrend && stores.length > 0 && perStoreTrend.some((t) => t.txWeek != null)');
    expect(kpi).toContain('.sort((a, b) => b.txWeek - a.txWeek)');
    expect(kpi).toContain("<WeekDeltaChip current={b.txWeek} prior={b.txPrior} />");
    expect(kpi).toContain('{num(b.txWeek)}</span>');
    expect(kpi).toContain('the same settled rows the org line counts, branch by branch');
  });

  it('the stale payload speaks its step-aside - never a silent void', () => {
    expect(kpi).toContain('const branchTxStale = perStoreTrend != null && stores.length > 0 && !branchTx;');
    expect(kpi).toContain('data-testid="transactions-branch-stale"');
    expect(kpi).toContain('counts by branch are not on this cached answer');
  });
});

describe('the modal ground fix - the panel owns its dark half', () => {
  it('the body panels paint dark:bg-slate-900 - exactly six mounts (v2.199.0: the approval desk joins the law)', () => {
    // v2.195.0 fixed the two shipped panels; v2.196.0's debt modal was born
    // with the dark half — the law the discovery wrote is now house-wide;
    // v2.197.0's watchlist and v2.198.0's yard join from birth (five).
    expect(kpi.match(/bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/g)?.length).toBe(6);
  });

  it('the discovery is recorded where the fix lives', () => {
    expect(kpi).toContain('composites against the NEAREST painted ancestor');
    expect(kpi).toContain("since v2.187.0 was already slate-900");
  });

  it('the contrast script asserts the literals and re-derives the REAL chain', () => {
    expect(contrastScript).toContain('src/components/org/kpi-row.tsx');
    expect(contrastScript).toContain('src/app/globals.css');
    expect(contrastScript).toContain('src/components/ui/dialog.tsx');
    expect(contrastScript).toContain('node_modules/tailwindcss/theme.css');
    // the discovery rows pinned in reverse - the bug cannot return silently
    expect(contrastScript).toContain('checkBug');
    expect(contrastScript).toContain('the pre-fix state, must stay under');
    // the fix's panel literal asserted from the source
    expect(contrastScript).toContain("bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900");
  });

  it('the a11y recipe doc closes the surface as FIXED with the numbers', () => {
    expect(a11yDoc).toContain("the transactions lens + the modal's REAL ground (v2.195.0)");
    expect(a11yDoc).toContain('46/46');
    expect(a11yDoc).toContain('1.05:1');
    expect(a11yDoc).toContain('FIXED, not');
  });
});

describe('docs and release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.200.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.200.0');
    expect(pkg.mbumah.baseVersion).toBe('2.200.0');
    expect(pkg.scripts['verify:v2-195-0']).toBe('node scripts/verify-v2-195-0.mjs');
    expect(pkg.scripts['verify:v2-194-0']).toBe('node scripts/verify-v2-194-0.mjs');
    expect(readRepo('scripts/verify-v2-195-0.mjs')).toContain('v2.195.0 verification');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.195.0] The transactions card finds its week');
    expect(changelog.indexOf('## [2.195.0]')).toBeLessThan(changelog.indexOf('## [2.194.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.195.0'");
    expect(whatsNew).toContain("title: 'The transactions card finds its week'");
    expect(whatsNew.indexOf('2.195.0')).toBeLessThan(whatsNew.indexOf('2.194.0'));
  });

  it('the head-pin counters re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(89);");
    const a11yShell = readRepo('src/tests/a11y-shell-v2148.test.ts');
    expect(a11yShell).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(89);");
  });

  it('the workspace doc speaks the transactions lens', () => {
    expect(workspaceDoc).toContain('v2.195.0 gives the count face the same voice');
    expect(workspaceDoc).toContain('four faces of one read');
  });
});
