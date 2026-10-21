import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.194.0 — the VAT face gets its spark.
 *
 * The revenue modal has spoken three faces since v2.187.0 — the gross till
 * (the lens chart), the net lens (violet chart + its own week-over-week
 * strip since v2.188.0), and the VAT strip (figures + its arrowed
 * week-over-week chip) — but the VAT face stayed mute about its own SHAPE.
 * The wire already carried everything needed: the spark rows have selected
 * taxAmount since the VAT lens first shipped, and the net buckets are
 * computed as gross − tax per day in the same loop. This release buckets
 * the SAME rows' tax in the SAME pass — zero additional reads — and the
 * VAT strip gains its spark in the face's own amber (a THIRD stroke hue so
 * emerald gross, violet net and amber VAT never merge). The same release
 * fixes the modal's dark-mode voice: the dialog paints bg-background
 * (dark oklch(0.145)) while the modal's texts were light-only — the grid's
 * slate-800 VALUES measured 1.35:1 near-invisible — so the strips wear the
 * house's proven dark chip pattern and the grid wears slate-400/slate-100
 * (26/26 measured families, the a11y doc closes FIXED).
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const route = readRepo('src/app/api/org/kpi-summary/route.ts');
const kpi = readRepo('src/components/org/kpi-row.tsx');
const primitives = readRepo('src/components/org/primitives.tsx');
const a11yDoc = readRepo('docs/a11y/contrast-math.md');
const changelog = readRepo('CHANGELOG.md');
const whatsNew = readRepo('src/lib/whats-new.ts');
const contrastScript = readRepo('scripts/contrast-math-revenue-modal-v2194.mjs');
const pkg = JSON.parse(readRepo('package.json'));

describe('the third bucket executed - one pass, three faces, zero new reads', () => {
  // The route's loop shape, executed on the sample rows: the SAME rows fill
  // THREE arrays in ONE pass (the route computes these inline — the pins
  // below hold the source to this exact shape; this execution demonstrates
  // the math the pinned lines speak).
  const fill = (rows: Array<{ createdAt: Date; totalAmount: number; taxAmount: number }>, startToday: Date) => {
    const DAY_MS = 86_400_000;
    const sparkBuckets = new Array<number>(7).fill(0);
    const netBuckets = new Array<number>(7).fill(0);
    const taxBuckets = new Array<number>(7).fill(0);
    for (let i = 0; i < 7; i++) {
      const dayStart = new Date(startToday.getTime() - (6 - i) * DAY_MS);
      const dayEnd = new Date(dayStart.getTime() + DAY_MS);
      for (const row of rows) {
        if (row.createdAt >= dayStart && row.createdAt < dayEnd) {
          sparkBuckets[i] += row.totalAmount;
          netBuckets[i] += row.totalAmount - row.taxAmount;
          taxBuckets[i] += row.taxAmount;
        }
      }
    }
    return { sparkBuckets, netBuckets, taxBuckets };
  };

  it('a tax-bearing row lands in all THREE buckets; a zero-tax row only in gross and net', () => {
    const startToday = new Date('2026-10-21T00:00:00.000Z');
    const day6 = new Date('2026-10-21T12:00:00.000Z'); // today (bucket 6)
    const day2 = new Date('2026-10-17T12:00:00.000Z'); // bucket 2
    const { sparkBuckets, netBuckets, taxBuckets } = fill(
      [
        { createdAt: day6, totalAmount: 1150, taxAmount: 150 },
        { createdAt: day2, totalAmount: 1000, taxAmount: 0 },
      ],
      startToday,
    );
    expect(sparkBuckets).toEqual([0, 0, 1000, 0, 0, 0, 1150]);
    expect(netBuckets).toEqual([0, 0, 1000, 0, 0, 0, 1000]);
    expect(taxBuckets).toEqual([0, 0, 0, 0, 0, 0, 150]);
    // the arithmetic identity the three faces share: gross − tax = net
    expect(sparkBuckets[6] - taxBuckets[6]).toBe(netBuckets[6]);
    expect(sparkBuckets[2] - taxBuckets[2]).toBe(netBuckets[2]);
  });

  it('the route buckets taxAmount in the SAME loop — the source stays the one pass', () => {
    expect(route).toContain('const sparkBuckets = new Array<number>(7).fill(0);');
    expect(route).toContain('const netBuckets = new Array<number>(7).fill(0);');
    expect(route).toContain('const taxBuckets = new Array<number>(7).fill(0);');
    expect(route).toContain('netBuckets[i] += toDec(row.totalAmount).toNumber() - toDec(row.taxAmount).toNumber();');
    expect(route).toContain('taxBuckets[i] += toDec(row.taxAmount).toNumber();');
    expect(route).toContain('const taxSpark = taxBuckets.map((v) => round2(v));');
    // the one-pass claim lives where the loop reads
    expect(route).toContain('three faces of one read, one pass, no second query');
  });

  it('the payload grows taxSpark ADDITIVELY - nothing re-keys', () => {
    expect(route).toContain('taxSpark,');
    expect(route).toContain("the VAT face's own spark");
    // the additive neighbors keep their names (the v2.187.0 block intact)
    expect(route).toContain('netTodayTotal: netToday,');
    expect(route).toContain('netPriorWeekTotal: netPrior,');
    expect(route).toContain('netSpark,');
  });

  it('the client type stays tolerant - optional, older cached answers degrade', () => {
    expect(primitives).toContain('taxSpark?: number[]');
    expect(primitives).toContain('netSpark?: number[]');
  });
});

describe('the modal renders the amber spark - a third hue, the lens charts stay the lead', () => {
  it('the VAT spark mounts under the strip, tolerant and honest', () => {
    expect(kpi).toContain('{k.revenue.taxSpark != null && k.revenue.taxSpark.length > 0 && (');
    expect(kpi).toContain('<Sparkline data={k.revenue.taxSpark} stroke="#d97706" width={380} height={36} />');
    expect(kpi).toContain('data-testid="revenue-vat-spark"');
    expect(kpi).toContain('title="VAT collected per day, last 7 days"');
  });

  it('the three faces keep their hues - emerald gross, violet net, amber VAT', () => {
    expect(kpi).toContain('<Sparkline data={k.revenue.spark} width={380} height={80} />');
    expect(kpi).toContain('<Sparkline data={k.revenue.netSpark ?? []} stroke="#8b5cf6" width={380} height={80} />');
    expect(kpi).toContain('stroke="#d97706"');
    // the height hierarchy is deliberate: 80 lead, 36 quiet
    expect(kpi).toContain('the lens chart stays the lead, this is the strip\'s quiet');
  });

  it('Sparkline itself emits nothing for an empty array - the guard doubles it', () => {
    expect(primitives).toContain('if (!data.length) return null;');
  });
});

describe('the dark voice fixed - the house pattern over the dialog ground', () => {
  it('the grid wears slate-400 labels under slate-100 values', () => {
    expect(kpi).toContain('<span className="text-slate-500 dark:text-slate-400">Today</span><p className="font-bold text-slate-800 dark:text-slate-100">');
    expect(kpi).toContain('<span className="text-slate-500 dark:text-slate-400">7d total</span>');
    expect(kpi).toContain('<span className="text-slate-500 dark:text-slate-400">Prior 7d</span>');
    expect(kpi).toContain('<span className="text-slate-500 dark:text-slate-400">Avg / day (7d)</span>');
    // both lens grids speak the same vocabulary (8 labels) + the lens note
    // rides the same voice (9 mounts); v2.195.0: the transactions grid's
    // 4 label+value cells joined (13/12 mounts total); v2.196.0: the debt
    // ledger's families join (its grid labels + shares + headline + meta)
    // AND the section headers/sub-lines gain the dark voice (the 4.15:1
    // discovery fix); v2.197.0: the reorder watchlist's families join (its
    // meta, grid label + share, item sub-line, and its two section
    // headers + sub-lines); v2.198.0: the rental yard's families join (its
    // meta, grid label + share, two row sub-lines, and its two section
    // headers + sub-lines) — 50 mounts total
    expect(kpi.match(/text-slate-500 dark:text-slate-400/g)?.length).toBe(50);
    // v2.198.0: the yard's four bucket values join the value voice (15)
    expect(kpi.match(/text-slate-800 dark:text-slate-100/g)?.length).toBe(15);
    expect(kpi).toContain('className="text-[10px] text-slate-500 dark:text-slate-400"');
  });

  it('both strips wear the proven dark chip pattern', () => {
    expect(kpi).toContain('rounded-lg border border-violet-100 bg-violet-50/70 px-2.5 py-1.5 dark:border-violet-500/30 dark:bg-violet-500/10');
    expect(kpi).toContain('rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5 dark:border-emerald-500/30 dark:bg-emerald-500/10');
    expect(kpi).toContain('text-violet-800 dark:text-violet-300');
    expect(kpi).toContain('text-violet-900 dark:text-violet-200');
    expect(kpi).toContain('text-emerald-800 dark:text-emerald-300');
    expect(kpi).toContain('text-emerald-900 dark:text-emerald-200');
  });

  it('the verdict chips\' three states and the nested chips gain their dark halves', () => {
    expect(kpi).toContain('dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30');
    expect(kpi).toContain('dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30');
    expect(kpi).toContain('dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30');
    expect(kpi).toContain('dark:bg-violet-500/20 dark:text-violet-300 dark:ring-violet-500/30');
    expect(kpi).toContain('dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/30');
  });

  it('the a11y recipe doc closes the surface as FIXED with the numbers', () => {
    expect(a11yDoc).toContain("the revenue modal's dark-mode voice + the VAT spark's stroke (v2.194.0)");
    expect(a11yDoc).toContain('26/26');
    expect(a11yDoc).toContain('1.35:1');
    expect(a11yDoc).toContain('FIXED, not');
  });

  it('the contrast script asserts the literals from the component source', () => {
    expect(contrastScript).toContain('src/components/org/kpi-row.tsx');
    expect(contrastScript).toContain('src/app/globals.css');
    expect(contrastScript).toContain('src/components/ui/dialog.tsx');
    expect(contrastScript).toContain('node_modules/tailwindcss/theme.css');
  });
});

describe('docs and release surfaces', () => {
  it('package.json rides at 2.198.0 (all three slots) and the verify script is wired', () => {
    expect(pkg.version).toBe('2.198.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.198.0');
    expect(pkg.mbumah.baseVersion).toBe('2.198.0');
    expect(pkg.scripts['verify:v2-194-0']).toBe('node scripts/verify-v2-194-0.mjs');
    expect(pkg.scripts['verify:v2-193-0']).toBe('node scripts/verify-v2-193-0.mjs');
    expect(readRepo('scripts/verify-v2-194-0.mjs')).toContain('v2.194.0 verification');
  });

  it('the CHANGELOG heads with this release', () => {
    expect(changelog).toContain('## [2.194.0] The VAT face gets its spark');
    expect(changelog.indexOf('## [2.194.0]')).toBeLessThan(changelog.indexOf('## [2.193.0]'));
  });

  it('the whats-new feed leads with this release', () => {
    expect(whatsNew).toContain("version: '2.194.0'");
    expect(whatsNew).toContain("title: 'The VAT face gets its spark'");
    expect(whatsNew.indexOf('2.194.0')).toBeLessThan(whatsNew.indexOf('2.193.0'));
  });

  it('the head-pin counters re-anchored to the new head', () => {
    const counter = readRepo('src/tests/console-changelog.test.ts');
    expect(counter).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(87);");
    const a11yShell = readRepo('src/tests/a11y-shell-v2148.test.ts');
    expect(a11yShell).toContain("expect(whatsNewUnreadCount('2.110.0')).toBe(87);");
  });
});
