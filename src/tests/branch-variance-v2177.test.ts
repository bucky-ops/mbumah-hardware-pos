import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { weekDelta, variancePct } from '@/lib/org/summary-trend';
import { weekDeltaWords } from '@/components/org/primitives';

/**
 * v2.177.0 — the week by branch learns its own variance.
 *
 * The three trend surfaces speak every branch's week SHAPE (v2.175.0 the
 * table, v2.176.0 the strip + drill-down); this release every branch's
 * week also speaks its VERDICT — up, down, or flat — through ONE lib
 * classifier (weekDelta), ONE visible chip (WeekDeltaChip), and ONE
 * accessible phrasing (weekDeltaWords). Still ZERO new queries: the
 * per-branch prior-week slices have ridden the summary route's top-mover
 * math (priMap) since v2.174.0; the payload entries simply gain
 * `priorWeekTotal`.
 *
 * Pinned here: the honesty rule EXECUTED (no prior week → null, never a
 * fabricated "+0%" or an invented ∞; exactly flat IS a real comparison),
 * rounding parity with the org badge's variancePct, the API's additive
 * field sourced from priMap, the tolerant declarations in all three
 * files, the three surface contracts (chip classes, tooltip composition,
 * the byte-stable base sr-only clause + the second verdict sentence,
 * honest absence), the drill-down pass-through, and the release surfaces.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const lib = readRepo('src/lib/org/summary-trend.ts');
const route = readRepo('src/app/api/org/summary/route.ts');
const primitives = readRepo('src/components/org/primitives.tsx');
const dashboard = readRepo('src/components/workspace/org-console.tsx');
const page = readRepo('src/app/(shell)/console/page.tsx');
const kpiRow = readRepo('src/components/org/kpi-row.tsx');
const doc = readRepo('docs/multi-store-workspaces.md');
const whatsNew = readRepo('src/lib/whats-new.ts');

// v2.195.0: the KPI row's declaration grows the optional txWeek/txPrior
// count fields (the transactions drill-down's branch rows); the
// primitives + dashboard declarations keep the v2.176.0 shape.
const DECL = 'perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;';
const KPI_DECL = 'perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number; txWeek?: number; txPrior?: number }> | null;';

describe('weekDelta EXECUTED - the honesty rule', () => {
  it('a branch with NO prior week has NO comparison — null, never a fabricated "+0%"', () => {
    expect(weekDelta(200, 0)).toBeNull();
    expect(weekDelta(0, 0)).toBeNull();
    expect(weekDelta(1_000_000, 0)).toBeNull();
  });

  it('a negative prior is no prior — null, never an invented sign flip', () => {
    expect(weekDelta(200, -50)).toBeNull();
  });

  it('growth speaks up with the SAME variancePct math the org badge uses', () => {
    expect(weekDelta(120, 100)).toEqual({ pct: 20, dir: 'up' });
    expect(weekDelta(120, 100)?.pct).toBe(variancePct(120, 100));
  });

  it('a fall speaks down — the sign lives in the direction, the number stays positive', () => {
    expect(weekDelta(80, 100)).toEqual({ pct: -20, dir: 'down' });
  });

  it('an exactly flat week IS a real comparison — flat at 0%, spoken as one', () => {
    expect(weekDelta(100, 100)).toEqual({ pct: 0, dir: 'flat' });
    expect(weekDelta(0, 100)).toEqual({ pct: -100, dir: 'down' });
  });

  it('rounding parity with variancePct — the org total\u2019s own variance, per branch', () => {
    // the honest org story after the QA-sweep: 334,282 vs 409,140 → −18.3%
    expect(weekDelta(334_282, 409_140)).toEqual({ pct: -18.3, dir: 'down' });
    expect(weekDelta(334_282, 409_140)?.pct).toBe(variancePct(334_282, 409_140));
  });

  it('money-safe float paths round like every other lib number', () => {
    expect(weekDelta(1.1, 0.9)?.pct).toBe(22.22);
    expect(weekDelta(0.3, 0.1)?.pct).toBe(200);
  });

  it('purity — the lib never reads the clock (pure module, no Date.now call)', () => {
    const code = lib
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    expect(code).not.toMatch(/Date\.now/);
  });
});

describe('weekDeltaWords EXECUTED - the accessible twin', () => {
  it('up / down speak the percent with a direction word', () => {
    expect(weekDeltaWords(120, 100)).toBe('Up 20% vs prior week');
    expect(weekDeltaWords(80, 100)).toBe('Down 20% vs prior week');
    expect(weekDeltaWords(123_992, 9_048)).toBe('Up 1270.38% vs prior week');
  });

  it('flat speaks calmly, without a number that would mean nothing', () => {
    expect(weekDeltaWords(100, 100)).toBe('Flat vs prior week');
  });

  it('no prior week speaks NOTHING — the caller stays silent', () => {
    expect(weekDeltaWords(100, 0)).toBeNull();
    expect(weekDeltaWords(100, -1)).toBeNull();
  });
});

describe('the API contract - priorWeekTotal rides the SAME entries', () => {
  it('each perStoreTrend entry gains priorWeekTotal from the top-mover\u2019s own prior map', () => {
    expect(route).toContain('priorWeekTotal: round2(priMap.get(s.id)?.amount ?? 0),');
  });

  it('the field is sourced from the v2.174.0 prior groupBy — ZERO new queries', () => {
    expect(route).toContain('still ZERO new queries');
    expect(route).toContain('trendPriorByStore');
  });

  it('the v2.175.0 entry anatomy survives (storeId + spark + weekTotal)', () => {
    expect(route).toContain('spark: storeSparks(trendRows, s.id, windows.startToday, TREND_DAYS),');
    expect(route).toContain('weekTotal: round2(curMap.get(s.id)?.amount ?? 0),');
    expect(route).toContain('const perStoreTrend = stores.map((s) => ({');
  });

  it('the route still imports the lib through ONE line — weekDelta stays lib-side', () => {
    expect(route).toContain("import { TREND_DAYS, trendWindows, variancePct, sparkBuckets, countBuckets, topMover, storeSparks } from '@/lib/org/summary-trend';");
    expect(route).not.toContain("weekDelta } from '@/lib/org/summary-trend'");
  });
});

describe('the tolerant declarations - one contract, three files', () => {
  it('primitives.tsx OrgSummaryData grows the optional priorWeekTotal', () => {
    expect(primitives).toContain(DECL);
  });

  it('the dashboard card carries the SAME declaration', () => {
    expect(dashboard).toContain(DECL);
  });

  it('the KPI row carries the SAME declaration', () => {
    expect(kpiRow).toContain(KPI_DECL);
  });
});

describe('the chip contract - ONE visible vocabulary (primitives)', () => {
  it('the chip imports the lib\u2019s classifier — the math lives in ONE place', () => {
    expect(primitives).toContain("import { weekDelta } from '@/lib/org/summary-trend';");
    expect(primitives).toContain('export function WeekDeltaChip');
    expect(primitives).toContain('export function weekDeltaWords');
  });

  it('honest absence: no comparison renders NOTHING', () => {
    expect(primitives).toContain('if (!d) return null;');
  });

  it('the contrast family matches the header badge (v2.159 lesson): emerald-700 / red-700, dark -400 lifts', () => {
    expect(primitives).toContain("'text-emerald-700 dark:text-emerald-400'");
    expect(primitives).toContain("'text-red-700 dark:text-red-400'");
    expect(primitives).toContain("'text-muted-foreground'");
  });

  it('the chip is aria-hidden decoration — the verdict rides the caller\u2019s sr-only sentence', () => {
    expect(primitives).toContain('aria-hidden="true"');
    expect(primitives).toContain('Math.abs(d.pct)');
  });

  it('the lucide vocabulary matches the header badge\u2019s arrows', () => {
    expect(primitives).toContain("import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';");
  });

  it('the words keep ONE phrasing across all three surfaces', () => {
    expect(primitives).toContain("'Flat vs prior week'");
    expect(primitives).toContain('vs prior week');
  });
});

describe('the dashboard contract - the 7d cell stacks the verdict', () => {
  it('imports the chip twins through the primitives module (never the lib)', () => {
    expect(dashboard).toContain("import { Sparkline, WeekDeltaChip, weekDeltaWords } from '@/components/org/primitives';");
    expect(dashboard).not.toContain("from '@/lib/org/summary-trend'");
  });

  it('the chip renders from the SAME tolerant entry — absent prior degrades to nothing', () => {
    expect(dashboard).toContain('<WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />');
  });

  it('the tooltip gains the prior week exactly when one exists', () => {
    expect(dashboard).toContain("title={`7-day revenue ${formatKES(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${formatKES(storeTrend.priorWeekTotal)}` : ''}`}");
  });

  it('the base sr-only clause keeps its exact v2.175.0 shape; the verdict is a SECOND sentence', () => {
    expect(dashboard).toContain('<span className="sr-only">7-day revenue {formatKES(storeTrend.weekTotal)}</span>');
    expect(dashboard).toContain('{deltaWords ? <span className="sr-only">{deltaWords}</span> : null}');
  });

  it('the cell stacks (flex-col) — the column keeps its dancing-free w-[84px] width', () => {
    expect(dashboard).toContain('className="flex w-[76px] flex-col gap-0.5"');
    expect(dashboard).toContain('w-[84px] px-4 py-3');
  });

  it('the honest dash degrades exactly as v2.175.0 left it', () => {
    expect(dashboard).toContain('{storeTrend ? (');
    expect(dashboard).toContain('<span className="text-muted-foreground" aria-hidden="true">');
  });

  it('the words are computed once per branch in the map body — no per-render lib drift', () => {
    expect(dashboard).toContain('const deltaWords = storeTrend');
    expect(dashboard).toContain('weekDeltaWords(storeTrend.weekTotal, storeTrend.priorWeekTotal ?? 0)');
  });
});

describe('the expert console contract - the strip wears the same verdict', () => {
  it('imports the chip twins through the primitives module', () => {
    expect(page).toContain('WeekDeltaChip, weekDeltaWords');
  });

  it('the chip renders from the SAME tolerant entry inside the strip\u2019s join', () => {
    expect(page).toContain('<WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />');
  });

  it('the tooltip gains the prior week exactly when one exists (kes formatting)', () => {
    expect(page).toContain("title={`7-day revenue ${kes(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${kes(storeTrend.priorWeekTotal)}` : ''}`}");
  });

  it('the base sr-only clause keeps its exact v2.176.0 shape; the verdict is a SECOND sentence', () => {
    expect(page).toContain('<span className="sr-only">7-day revenue {kes(storeTrend.weekTotal)}</span>');
    expect(page).toContain('{deltaWords ? <span className="sr-only">{deltaWords}</span> : null}');
  });

  it('the strip card stacks (flex-col) and the calm dash row survives untouched', () => {
    expect(page).toContain('className="mt-1.5 flex w-[76px] flex-col gap-0.5"');
    expect(page).toContain('min-h-[20px] items-center');
  });
});

describe('the drill-down contract - each row speaks its own verdict', () => {
  it('the rows pass the prior week through — still the SAME payload entries', () => {
    expect(kpiRow).toContain('priorWeekTotal: t.priorWeekTotal,');
  });

  it('each row draws the chip beside its gross week total', () => {
    expect(kpiRow).toContain('<WeekDeltaChip current={b.weekTotal} prior={b.priorWeekTotal ?? 0} />');
    expect(kpiRow).toContain('{kes(b.weekTotal)}</span>');
  });

  it('the loudest-first sort and the honest fallback label survive v2.176.0 byte-exact', () => {
    expect(kpiRow).toContain('.sort((a, b) => b.weekTotal - a.weekTotal)');
    expect(kpiRow).toContain("stores.find((s) => s.id === t.storeId)?.name ?? 'Branch'");
  });

  it('the org gross lead still comes before the branch section (v2.185.0: gross, reconciled)', () => {
    expect(kpiRow.indexOf('Revenue trend (gross)')).toBeLessThan(kpiRow.indexOf('The week by branch'));
  });
});

describe('the doc contract', () => {
  it('the doc teaches the verdict chip', () => {
    expect(doc).toContain("Every branch's week learns its own verdict (v2.177.0)");
    expect(doc).toContain('| Trend · per-branch delta chip |');
  });

  it('the v2.173–v2.176 trend rows stay on the record', () => {
    expect(doc).toContain('| Trend · Revenue spark |');
    expect(doc).toContain('| Trend · top mover |');
    expect(doc).toContain('| Trend · per-branch 7d spark |');
    expect(doc).toContain('| Trend · expert strip spark |');
    expect(doc).toContain('| Trend · expert drill-down by branch |');
  });
});

describe('the release surfaces', () => {
  it('the changelog head speaks v2.177.0', () => {
    expect(readRepo('CHANGELOG.md')).toContain('## [2.177.0] The week by branch learns its own variance');
  });

  it('the whats-new feed leads with v2.177.0', () => {
    expect(whatsNew).toContain("version: '2.177.0'");
    expect(whatsNew.indexOf('2.177.0')).toBeLessThan(whatsNew.indexOf('2.176.0'));
  });

  it('package.json leads 2.177.0 in all three slots + the verify script', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.198.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.198.0');
    expect(pkg.mbumah.baseVersion).toBe('2.198.0');
    expect(pkg.scripts['verify:v2-177-0']).toBe('node scripts/verify-v2-177-0.mjs');
  });
});
