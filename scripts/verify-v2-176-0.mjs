#!/usr/bin/env node
// v2.176.0 verification — "the expert console reads the week by branch".
// Fresh-written (lesson 25). Pins the strip spark contract (muted slate
// 72×20, join by storeId, tooltip + sr-only, honest dash row), the KpiRow
// drill-down's week-by-branch section (sort, fallback label, net-vs-gross
// note, honest absence), the page wiring (no second fetch), the tolerant
// OrgSummaryData declaration, the doc rows, and the release surfaces.
// Comment-strip per lesson 49; comment-text pins trimmed to survive
// line-wraps.
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

check("version: package.json leads 2.176.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.176.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.176.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.176.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-176-0"], "verify:v2-176-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.176.0] The expert console reads the week by branch"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.176.0'"), "whats-new head missing");
  assert(feed.indexOf("2.176.0") < feed.indexOf("2.175.0"), "2.176.0 is not the feed head");
});

check("counters re-anchored (65/66/67/98)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(65)"), "2.110.0 anchor not 65");
  assert(t.includes("toBe(98)"), "2.77.0 anchor not 98");
  assert(t.includes("Re-anchored for 2.176.0 joining the feed."), "re-anchor comment missing");
});

check("OrgSummaryData grows the tolerant perStoreTrend (same declaration the dashboard speaks)", () => {
  const p = read("src/components/org/primitives.tsx");
  assert(p.includes("perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number }> | null;"), "tolerant perStoreTrend missing");
});

check("the strip: same vocabulary, joined by storeId, honest dash", () => {
  const page = strip(read("src/app/(shell)/console/page.tsx"));
  assert(page.includes("summary?.perStoreTrend?.find((t) => t.storeId === s.id) ?? null"), "join-by-storeId missing");
  assert(page.includes('stroke="#64748b"'), "muted slate stroke missing");
  assert(page.includes("width={72} height={20}"), "72x20 spark missing");
  assert(page.includes("title={`7-day revenue ${kes(storeTrend.weekTotal)} (gross)`}"), "title tooltip missing");
  assert(page.includes('<span className="sr-only">7-day revenue {kes(storeTrend.weekTotal)}</span>'), "sr-only clause missing");
  assert(page.includes("min-h-[20px] items-center"), "dash row height missing");
  assert(!page.match(/(^|[^:-])text-slate-400/), "bare text-slate-400 is forbidden (a11y sweep)");
  assert(page.includes("window.open(storeHref(s), '_blank', 'noopener')"), "workspace door changed");
});

check("the page wiring rides the polled summary — no second fetch", () => {
  const page = strip(read("src/app/(shell)/console/page.tsx"));
  assert(page.includes("perStoreTrend={summary?.perStoreTrend ?? null}"), "KpiRow trend prop missing");
  assert(page.includes("stores={stores}"), "KpiRow stores prop missing");
  assert(!page.includes("fetch(") || page.includes("authorizedFetchJson"), "unexpected raw fetch");
});

check("the drill-down: the week by branch, loudest first, both vocabularies labeled", () => {
  const kpiRow = strip(read("src/components/org/kpi-row.tsx"));
  assert(kpiRow.includes("The week by branch"), "section heading missing");
  assert(kpiRow.includes("branch shapes are gross — the org line above is net of VAT"), "net-vs-gross note missing");
  assert(kpiRow.includes("stores.find((s) => s.id === t.storeId)?.name ?? 'Branch'"), "join/fallback label missing");
  assert(kpiRow.includes(".sort((a, b) => b.weekTotal - a.weekTotal)"), "loudest-first sort missing");
  assert(kpiRow.includes("{branchWeek && branchWeek.length > 0 && ("), "honest-absence gate missing");
  assert(kpiRow.includes('<Sparkline data={b.spark} stroke="#64748b" width={72} height={20} />'), "row spark missing");
  assert(kpiRow.indexOf("Revenue trend (net of VAT)") < kpiRow.indexOf("The week by branch"), "org line must stay the lead");
  assert(kpiRow.includes("perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number }> | null;"), "tolerant prop missing");
  assert(kpiRow.includes("stores?: StoreRow[];"), "stores prop missing");
});

check("the doc teaches the expert console week", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("The expert console (`/console`) speaks the same week (v2.176.0)"), "expert week bullet missing");
  assert(doc.includes("| Trend · expert strip spark |"), "strip spark KPI row missing");
  assert(doc.includes("| Trend · expert drill-down by branch |"), "drill-down KPI row missing");
});

check("the v2.175 story stays intact (no regression of the dashboard's vocabulary)", () => {
  const dashboard = strip(read("src/components/workspace/org-console.tsx"));
  assert(dashboard.includes("summary.perStoreTrend?.find((t) => t.storeId === store.id) ?? null"), "dashboard join regressed");
  assert(dashboard.includes('stroke="#64748b"'), "dashboard stroke regressed");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
