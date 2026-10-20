#!/usr/bin/env node
// v2.188.0 verification — "the roster drills".
// Fresh-written per the house convention. Pins the two carried options end
// to end: the v2.186.0 roster rows become real drill controls (the panel's
// existing ?reviewer= filter, toggle semantics, the emerald drill language,
// the chevron affordance, the spoken state — the org-wide strip NEVER
// re-keys), and the net lens wears its own week-over-week verdict (the VAT
// ribbon's structural mirror in violet, the SAME honesty rule — no invented
// % on a zero prior). Comment-strip per lesson 49; comment-text pins
// trimmed to survive wraps.
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

check("version: package.json leads 2.188.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.188.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.188.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.188.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-188-0"], "verify:v2-188-0 script missing");
  assert(pkg.scripts["verify:v2-187-0"], "verify:v2-187-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.188.0] The roster drills"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.188.0]") < changelog.indexOf("## [2.187.0]"), "2.188.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.188.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The roster drills'"), "whats-new title missing");
  assert(feed.indexOf("2.188.0") < feed.indexOf("2.187.0"), "2.188.0 is not the feed head");
});

check("the drill: each roster row is a real, accessible control", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes('data-testid="desk-digest-roster-drill"'), "the drill testid missing");
  const drillIdx = panels.indexOf('data-testid="desk-digest-roster-drill"');
  const btnOpen = panels.lastIndexOf('<button', drillIdx);
  const btnHead = panels.slice(btnOpen, drillIdx);
  assert(btnHead.includes('type="button"'), "the button type missing");
  assert(btnHead.includes('aria-pressed={drilled}'), "the pressed state missing");
  assert(btnHead.includes('onClick={() => onFilterChange({ ...filter, reviewer: drilled ? null : r.name })}'), "the drill wiring missing");
  assert(panels.includes("aria-label={`${drilled ? 'Stop reviewing' : 'Review'} ${r.name}'s desk visits"), "the spoken label missing");
});

check("the drill: toggle semantics + the emerald drill language", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes('const drilled = reviewer === r.name;'), "the drilled derivation missing");
  assert(panels.includes('reviewer: drilled ? null : r.name'), "the toggle semantics missing");
  assert(panels.includes("'bg-emerald-50/90 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/40'"), "the drilled tint+ring missing");
  assert(panels.includes("'hover:bg-white/80 dark:hover:bg-slate-800/50'"), "the calm hover missing");
  assert(panels.includes("${drilled ? 'bg-emerald-600' : 'bg-emerald-500/80'}"), "the bar re-tint missing");
  assert(panels.includes("${drilled ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'}"), "the figure re-tint missing");
  assert(panels.includes('focus-visible:ring-2 focus-visible:ring-emerald-400'), "the house focus ring missing");
});

check("the drill: the chevron affordance + the invitations", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes("'-translate-x-0.5 text-slate-500 opacity-0 group-hover:translate-x-0 group-hover:opacity-70 dark:text-slate-500'"), "the hover chevron missing");
  assert(panels.includes("'translate-x-0 text-emerald-800 opacity-100 dark:text-emerald-400'"), "the drilled chevron missing");
  assert(!panels.includes("text-emerald-600"), "the banned text-emerald-600 token returned (the v2.149.0 sweep)");
  assert(panels.includes('· click a name to pull their file'), "the caption invitation missing");
  assert(panels.includes('Click a row — or a name in the digest roster —'), "the footer invitation missing");
});

check("the drill: the v2.186.0 strip pins HOLD - nothing re-keyed", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes('{yesterday.reviewerRows && yesterday.reviewerRows.length > 1 && ('), "the roster gate moved");
  assert(panels.includes('const share = yesterday.visits > 0 ? Math.round((r.visits / yesterday.visits) * 100) : 0;'), "the share math moved");
  assert(panels.includes('style={{ width: `${Math.min(100, share)}%` }}'), "the width cap moved");
  assert(panels.includes('yesterday.reviewerRows.slice(0, 6)'), "the six-row cap moved");
  assert(panels.includes('+{yesterday.reviewerRows.length - 6} more reviewer'), "the +N honesty moved");
});

check("the verdict: gated on the net lens AND the prior's arrival", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes("lens === 'net' && k.revenue.netPriorWeekTotal != null && (() => {"), "the verdict gate missing");
  assert(modal.includes('{k.revenue.taxWeekTotal != null && ('), "the v2.185.0 ribbon gate must stay");
  assert(modal.includes("{lens === 'gross' ? (") === true, "the lens conditional must stay");
});

check("the verdict: the fallback chain + the honesty rule", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes('const netWeek = k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0);'), "the fallback chain missing");
  assert(modal.includes('const netPrior = k.revenue.netPriorWeekTotal ?? 0;'), "the prior guard missing");
  assert(modal.includes('const netPct = netPrior > 0 ? Math.round((netDelta / netPrior) * 1000) / 10 : null;'), "the no-invented-% rule missing");
  assert(modal.includes("{netPct == null ? 'vs prior' : `${netDelta > 0 ? '+' : ''}${netPct}% vs prior`}"), "the verdict text missing");
  assert(modal.includes("{netDelta > 0 ? '▲' : netDelta < 0 ? '▼' : '—'}"), "the arrow semantics missing");
  assert(modal.includes("netDelta > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : netDelta < 0 ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-slate-50 text-slate-500 ring-slate-200'"), "the verdict hues missing");
});

check("the verdict: the violet family + the structural mirror", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes('data-testid="revenue-net-wow-strip"'), "the strip testid missing");
  assert(modal.includes('data-testid="revenue-net-wow-week"'), "the week testid missing");
  assert(modal.includes('data-testid="revenue-net-wow"'), "the verdict testid missing");
  assert(modal.includes('data-testid="revenue-net-wow-prior"'), "the prior testid missing");
  assert(modal.includes('border border-violet-100 bg-violet-50/70'), "the violet family missing");
  assert(modal.includes('text-[10px] font-semibold uppercase tracking-wide text-violet-800'), "the violet label missing");
  // the v2.187.0 VAT chip keeps its exact shape (the mirror's original)
  assert(modal.includes('data-testid="revenue-vat-wow"'), "the v2.187.0 VAT chip must stay");
  assert(modal.includes('stroke="#8b5cf6"'), "the v2.187.0 violet line must stay");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/roster-drills-v2188.test.ts");
  assert(suite.includes("the roster drills, and the net wears its verdict"), "suite header missing");
  assert(suite.includes('reviewer: drilled ? null : r.name'), "the toggle pin missing");
  assert(suite.includes('const netPct = netPrior > 0 ? Math.round((netDelta / netPrior) * 1000) / 10 : null;'), "the honesty pin missing");
  assert(suite.includes("package.json rides at 2.188.0"), "the version pin missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
