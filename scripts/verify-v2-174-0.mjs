#!/usr/bin/env node
// v2.174.0 verification — "the trend names which branch moved".
// Fresh-written (lesson 25). Pins the topMover lib (honest nulls, max-|delta|
// winner, tie-break), the API's two per-store groupBys + additive exposure,
// the card's mover sub-line contract, the release surfaces, and the doc
// rows. Comment-strip per lesson 49.
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

check("version: package.json leads 2.174.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.174.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.174.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.174.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-174-0"], "verify:v2-174-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.174.0] The trend names which branch moved"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.174.0'"), "whats-new head missing");
  assert(feed.indexOf("2.174.0") < feed.indexOf("2.173.0"), "2.174.0 is not the feed head");
});

check("counters re-anchored (63/64/65/96)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(63)"), "2.110.0 anchor not 63");
  assert(t.includes("toBe(96)"), "2.77.0 anchor not 96");
  assert(t.includes("Re-anchored for 2.174.0 joining the feed."), "re-anchor comment missing");
});

check("the lib gains topMover with the full honesty surface", () => {
  const lib = strip(read("src/lib/org/summary-trend.ts"));
  assert(lib.includes("export interface StoreTrendSlice {"), "StoreTrendSlice missing");
  assert(lib.includes("export interface TrendMover {"), "TrendMover missing");
  assert(lib.includes("export function topMover("), "topMover missing");
  assert(lib.includes("if (slices.length < 2) return null;"), "single-store silence missing");
  assert(lib.includes("if (priorTotal <= 0) return null;"), "no-prior silence missing");
  assert(lib.includes("Math.abs(delta) === Math.abs(winner.delta) && slice.storeName < winner.storeName"), "alphabetical tie-break missing");
  assert(lib.includes("round2(toDec(slice.current).minus(toDec(slice.prior)).toNumber())"), "money-safe delta missing");
  assert(!lib.includes("Date.now"), "lib must not read the clock");
  assert(!lib.includes("taxAmount"), "lib is GROSS — taxAmount must never appear");
});

check("the API adds two per-store groupBys and exposes topMover additively", () => {
  const route = strip(read("src/app/api/org/summary/route.ts"));
  assert((route.match(/rawDb\.salesTransaction\.groupBy\(/g) || []).length === 3, "expected today + 2 mover groupBys");
  assert(route.includes("createdAt: { gte: windows.twoWeeksAgo, lt: windows.weekAgo }"), "prior window not strictly before");
  assert(route.includes("topMover: revenueMover") && route.includes("topMover: txMover"), "topMover not exposed on both blocks");
  assert(route.includes("variancePct: variancePct(revenueMover.current, revenueMover.prior)"), "mover % not server-computed (revenue)");
  assert(route.includes("variancePct: variancePct(txMover.current, txMover.prior)"), "mover % not server-computed (transactions)");
  assert(route.includes("const revSlices = stores.map((s) => ({"), "slices not named through the active store list");
  assert(route.includes("totals,\n        trend,\n        hr,"), "response not additive");
  assert(route.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];"), "role gate changed");
});

check("the card renders the mover sub-line with the honesty gates", () => {
  const card = strip(read("src/components/workspace/org-console.tsx"));
  assert(card.includes("mover?: TrendMoverSummary | null;"), "mover prop missing");
  assert(card.includes("mover={summary.trend.revenue.topMover}"), "revenue mover not wired");
  assert(card.includes("mover={summary.trend.transactions.topMover}"), "transactions mover not wired");
  assert(card.includes("{mover && ("), "presence gate missing");
  assert(card.includes('data-testid={`${testId}-mover`}'), "mover testid missing");
  assert(card.includes("{mover.prior > 0 && ("), "zero-week % gate missing");
  assert(card.includes("{mover.delta >= 0 ? '+' : '-'}"), "signed delta missing");
  assert(card.includes("format(Math.abs(mover.delta))"), "abs-formatted delta missing");
  assert(card.includes("mover.delta >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'"), "contrast family missing");
  assert(card.includes("interface TrendMoverSummary {"), "card-side type missing");
  // the v2.173.0 strip stays byte-identical underneath
  assert(card.includes("7d {format(weekTotal)} · prior {format(priorWeekTotal)}"), "v2.173.0 microcopy disturbed");
  assert(card.includes('priorWeekTotal > 0 &&'), "v2.173.0 badge gate disturbed");
});

check("the doc teaches the top mover and its silences", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("A top-mover sub-line on the same strip (v2.174.0)"), "mover bullet missing");
  assert(doc.includes("| Trend · top mover |"), "mover KPI row missing");
  assert(doc.includes("ties break alphabetically"), "tie-break rule missing");
  assert(doc.includes('never an invented ∞'), "zero-week % rule missing");
  assert(doc.includes("| Trend · Revenue spark |") && doc.includes("| Trend · variance badge |"), "v2.173.0 rows disturbed");
});

check("the executed-math suite is registered and runs the lib", () => {
  const t = read("src/tests/trend-names-mover-v2174.test.ts");
  assert(t.includes("from '@/lib/org/summary-trend'"), "suite does not import the lib");
  assert(t.includes("topMover(["), "suite does not execute topMover");
  assert(t.includes("expect(topMover([slice('s1', 'Thika', 45_000, 0), slice('s2', 'Juja', 5_000, 0)])).toBeNull()"), "the no-prior null is not pinned");
  assert(t.includes("expect(m?.delta).toBe(-89_000)"), "the signed fall is not pinned");
});

check("the v2.173.0 suite re-anchors to the evolved contract", () => {
  const t = read("src/tests/first-screen-trend-v2173.test.ts");
  assert(t.includes("countBuckets, topMover } from '@/lib/org/summary-trend';"), "import-list pin not re-anchored");
  assert(t.includes("topMover?: TrendMoverSummary | null };"), "interface pin not re-anchored");
});

console.log(`\nverify-v2-174-0: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
