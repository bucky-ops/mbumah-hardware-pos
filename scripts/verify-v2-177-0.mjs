#!/usr/bin/env node
// v2.177.0 verification — "the week by branch learns its own variance".
// Fresh-written (lesson 25). Pins the lib's weekDelta honesty rule, the
// API's additive priorWeekTotal (sourced from priMap — zero new queries),
// the tolerant declarations in all three files, the WeekDeltaChip /
// weekDeltaWords vocabulary, the three surface contracts (chip + tooltip
// composition + byte-stable base sr-only clause + the second verdict
// sentence + honest absence), the drill-down pass-through, the doc rows,
// and the release surfaces. Comment-strip per lesson 49; comment-text pins
// trimmed to survive line-wraps.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

check("version: package.json leads 2.177.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.177.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.177.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.177.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-177-0"], "verify:v2-177-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.177.0] The week by branch learns its own variance"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.177.0'"), "whats-new head missing");
  assert(feed.indexOf("2.177.0") < feed.indexOf("2.176.0"), "2.177.0 is not the feed head");
});

check("counters re-anchored (66/67/68/99)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(66)"), "2.110.0 anchor not 66");
  assert(t.includes("toBe(99)"), "2.77.0 anchor not 99");
  assert(t.includes("Re-anchored for 2.177.0 joining the feed."), "re-anchor comment missing");
});

check("lib: weekDelta exists, exports the WeekDelta verdict, honesty rule in code", () => {
  const code = strip(read("src/lib/org/summary-trend.ts"));
  assert(code.includes("export interface WeekDelta {"), "WeekDelta interface missing");
  assert(code.includes("export function weekDelta(current: number, prior: number): WeekDelta | null {"), "weekDelta missing");
  assert(code.includes("if (prior <= 0) return null;"), "honesty guard missing");
  assert(code.includes("const pct = variancePct(current, prior);"), "pct not via variancePct");
  assert(code.includes("return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };"), "classifier missing");
});

check("API: perStoreTrend entries gain priorWeekTotal from priMap — zero new queries", () => {
  const route = read("src/app/api/org/summary/route.ts");
  assert(route.includes("priorWeekTotal: round2(priMap.get(s.id)?.amount ?? 0),"), "priorWeekTotal missing");
  assert(route.includes("weekTotal: round2(curMap.get(s.id)?.amount ?? 0),"), "weekTotal anatomy changed");
  assert(route.includes("still ZERO new queries"), "zero-new-queries comment missing");
  assert(route.includes("trendPriorByStore"), "prior groupBy gone");
  const importLine = "import { TREND_DAYS, trendWindows, variancePct, sparkBuckets, countBuckets, topMover, storeSparks } from '@/lib/org/summary-trend';";
  assert(route.includes(importLine), "route import line changed");
});

check("tolerant declarations carry priorWeekTotal? in all three files", () => {
  const DECL = "perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number; priorWeekTotal?: number }> | null;";
  for (const f of ["src/components/org/primitives.tsx", "src/components/workspace/org-console.tsx", "src/components/org/kpi-row.tsx"]) {
    assert(read(f).includes(DECL), `${f} declaration not evolved`);
  }
});

check("primitives: WeekDeltaChip + weekDeltaWords — one vocabulary, honest absence", () => {
  const p = read("src/components/org/primitives.tsx");
  assert(p.includes("export function WeekDeltaChip"), "chip missing");
  assert(p.includes("export function weekDeltaWords"), "words missing");
  assert(p.includes("import { weekDelta } from '@/lib/org/summary-trend';"), "lib import missing");
  assert(p.includes("if (!d) return null;"), "honest absence missing");
  assert(p.includes("'text-emerald-700 dark:text-emerald-400'"), "up family missing");
  assert(p.includes("'text-red-700 dark:text-red-400'"), "down family missing");
  assert(p.includes("'text-muted-foreground'"), "flat family missing");
  assert(p.includes("Math.abs(d.pct)"), "abs missing (double-negative guard)");
  assert(p.includes("'Flat vs prior week'"), "flat phrasing missing");
  assert(p.includes("import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';"), "lucide vocabulary missing");
});

check("dashboard: 7d cell stacks the chip, tooltip gains prior, second sr-only sentence", () => {
  const d = read("src/components/workspace/org-console.tsx");
  assert(d.includes("<WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />"), "chip usage missing");
  assert(d.includes("title={`7-day revenue ${formatKES(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${formatKES(storeTrend.priorWeekTotal)}` : ''}`}"), "tooltip not evolved");
  assert(d.includes('<span className="sr-only">7-day revenue {formatKES(storeTrend.weekTotal)}</span>'), "base sr-only clause changed");
  assert(d.includes("{deltaWords ? <span className=\"sr-only\">{deltaWords}</span> : null}"), "second sentence missing");
  assert(d.includes('className="flex w-[76px] flex-col gap-0.5"'), "cell not stacked");
  assert(d.includes("const deltaWords = storeTrend"), "deltaWords not computed in the map body");
  assert(d.includes('<span className="text-muted-foreground" aria-hidden="true">'), "honest dash changed");
  assert(!d.match(/(^|[^:-])text-slate-400/), "bare text-slate-400 is forbidden (a11y sweep)");
});

check("expert console: strip wears the same verdict (kes formatting)", () => {
  const p = read("src/app/(shell)/console/page.tsx");
  assert(p.includes("<WeekDeltaChip current={storeTrend.weekTotal} prior={storeTrend.priorWeekTotal ?? 0} />"), "chip usage missing");
  assert(p.includes("title={`7-day revenue ${kes(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${kes(storeTrend.priorWeekTotal)}` : ''}`}"), "tooltip not evolved");
  assert(p.includes('<span className="sr-only">7-day revenue {kes(storeTrend.weekTotal)}</span>'), "base sr-only clause changed");
  assert(p.includes("{deltaWords ? <span className=\"sr-only\">{deltaWords}</span> : null}"), "second sentence missing");
  assert(p.includes('className="mt-1.5 flex w-[76px] flex-col gap-0.5"'), "card not stacked");
  assert(p.includes("min-h-[20px] items-center"), "calm dash row changed");
});

check("drill-down: rows pass the prior through and draw the chip beside the total", () => {
  const k = read("src/components/org/kpi-row.tsx");
  assert(k.includes("priorWeekTotal: t.priorWeekTotal,"), "pass-through missing");
  assert(k.includes("<WeekDeltaChip current={b.weekTotal} prior={b.priorWeekTotal ?? 0} />"), "chip usage missing");
  assert(k.includes("{kes(b.weekTotal)}</span>"), "total span changed");
  assert(k.includes(".sort((a, b) => b.weekTotal - a.weekTotal)"), "sort changed");
  assert(k.indexOf("Revenue trend (net of VAT)") < k.indexOf("The week by branch"), "org lead reordered");
});

check("docs: the verdict bullet + KPI table row, prior rows intact", () => {
  const d = read("docs/multi-store-workspaces.md");
  assert(d.includes("Every branch's week learns its own verdict (v2.177.0)"), "bullet missing");
  assert(d.includes("| Trend · per-branch delta chip |"), "KPI row missing");
  for (const row of ["| Trend · Revenue spark |", "| Trend · top mover |", "| Trend · per-branch 7d spark |", "| Trend · expert strip spark |", "| Trend · expert drill-down by branch |"]) {
    assert(d.includes(row), `prior row missing: ${row}`);
  }
});

check("prior-suite pins evolved deliberately (import line + tooltips + declarations)", () => {
  const v2173 = read("src/tests/first-screen-trend-v2173.test.ts");
  assert(v2173.includes("import { Sparkline, WeekDeltaChip, weekDeltaWords } from '@/components/org/primitives';"), "v2173 import pin not evolved");
  const v2175 = read("src/tests/trend-doors-v2175.test.ts");
  assert(v2175.includes("title={`7-day revenue ${formatKES(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${formatKES(storeTrend.priorWeekTotal)}` : ''}`}"), "v2175 tooltip pin not evolved");
  assert(v2175.includes("expect(pkg.version).toBe('2.177.0');"), "v2175 pkg pin not re-anchored");
  const v2176 = read("src/tests/expert-week-v2176.test.ts");
  assert(v2176.includes("title={`7-day revenue ${kes(storeTrend.weekTotal)} (gross)${storeTrend.priorWeekTotal ? ` · prior ${kes(storeTrend.priorWeekTotal)}` : ''}`}"), "v2176 tooltip pin not evolved");
  assert(v2176.includes("expect(pkg.version).toBe('2.177.0');"), "v2176 pkg pin not re-anchored");
  const v2174 = read("src/tests/trend-names-mover-v2174.test.ts");
  assert(v2174.includes("expect(pkg.version).toBe('2.177.0');"), "v2174 pkg pin not re-anchored");
});

check("no non-null assertions in the new suite (lint invariant)", () => {
  const t = read("src/tests/branch-variance-v2177.test.ts");
  assert(!/\)\!\./.test(t) && !/\w\!\./.test(t.replace(/\?\./g, "")), "non-null assertion found");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
