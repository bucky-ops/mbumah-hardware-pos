#!/usr/bin/env node
// v2.173.0 verification — "the first screen learns to trend".
// Fresh-written (lesson 25). Pins the pure trend lib (windows, variance,
// buckets, gross semantics), the API's additive trend contract, the card's
// render contract, the release surfaces, and the doc rows. Comment-strip
// per lesson 49.
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

check("version: package.json leads 2.173.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.173.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.173.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.173.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-173-0"], "verify:v2-173-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.173.0] The first screen learns to trend"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.173.0'"), "whats-new head missing");
  assert(feed.indexOf("2.173.0") < feed.indexOf("2.172.0"), "2.173.0 is not the feed head");
});

check("counters re-anchored (62/63/64/95)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(62)"), "2.110.0 anchor not 62");
  assert(t.includes("toBe(95)"), "2.77.0 anchor not 95");
  assert(t.includes("Re-anchored for 2.173.0 joining the feed."), "re-anchor comment missing");
});

check("the trend lib exists, is pure, and exports the full surface", () => {
  const lib = strip(read("src/lib/org/summary-trend.ts"));
  assert(lib.includes("export const TREND_DAYS = 7;"), "TREND_DAYS missing");
  assert(lib.includes("export function trendWindows("), "trendWindows missing");
  assert(lib.includes("export function variancePct("), "variancePct missing");
  assert(lib.includes("export function sparkBuckets("), "sparkBuckets missing");
  assert(lib.includes("export function countBuckets("), "countBuckets missing");
  assert(!lib.includes("Date.now"), "lib must not read the clock");
  assert(!lib.includes("rawDb"), "lib must stay db-free");
  assert(!lib.includes("taxAmount"), "lib is GROSS — taxAmount must never appear");
});

check("the API adds the trend block additively with the same vocabulary", () => {
  const route = strip(read("src/app/api/org/summary/route.ts"));
  const routeRaw = read("src/app/api/org/summary/route.ts");
  assert(route.includes("trendWindows(today)"), "windows not anchored on the route's today");
  assert(route.includes("transactionType: 'SALE',"), "SALE vocabulary missing");
  assert(route.includes("paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },"), "settled-status vocabulary missing");
  assert(route.includes("createdAt: { gte: windows.twoWeeksAgo, lt: windows.weekAgo }"), "prior window not strictly before");
  assert(route.includes("totals,\n        trend,\n        hr,"), "trend not additive in the response");
  assert(route.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];"), "role gate changed");
  assert(routeRaw.includes("GROSS by contract"), "the gross semantics is not documented on the route");
  assert(routeRaw.includes("kpi-summary computes revenue NET of tax"), "the cross-surface divergence is not on the record");
  assert(route.includes("sparkBuckets(trendRows, windows.startToday, TREND_DAYS)"), "revenue spark not wired");
  assert(route.includes("countBuckets(trendRows, windows.startToday, TREND_DAYS)"), "transaction spark not wired");
});

check("the card renders the trend strip with the honest-variance gate", () => {
  const card = strip(read("src/components/workspace/org-console.tsx"));
  assert(card.includes("import { Sparkline } from '@/components/org/primitives';"), "Sparkline not reused");
  assert(card.includes('testId="metric-trend-revenue"'), "revenue testid missing");
  assert(card.includes('testId="metric-trend-transactions"'), "transactions testid missing");
  assert(card.includes("priorWeekTotal > 0 &&"), "badge gate missing");
  assert(card.includes("up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'"), "contrast lesson classes missing");
  assert(card.includes("7d {format(weekTotal)} · prior {format(priorWeekTotal)}"), "microcopy missing");
  assert(card.includes("stroke=\"#2563eb\""), "transactions stroke missing");
  assert((card.match(/summary\.trend \? \(/g) || []).length === 2, "both cards must gate on summary.trend");
});

check("the card's trend type is tolerant (optional + nullable)", () => {
  const card = strip(read("src/components/workspace/org-console.tsx"));
  assert(card.includes("trend?: {"), "trend not optional");
  assert(card.includes("} | null;"), "trend not nullable");
});

check("the doc teaches the trend strip and its honesty rules", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("A 7-day trend strip on the Revenue and Transactions cards (v2.173.0)"), "trend bullet missing");
  assert(doc.includes("| Trend · Revenue spark |"), "spark KPI row missing");
  assert(doc.includes("| Trend · variance badge |"), "variance KPI row missing");
  assert(doc.includes("never a fabricated \"+0%\""), "honest-variance rule missing");
});

check("the executed-math suite is registered and names the lib", () => {
  const t = read("src/tests/first-screen-trend-v2173.test.ts");
  assert(t.includes("from '@/lib/org/summary-trend'"), "suite does not import the lib");
  assert(t.includes("sparkBuckets"), "suite does not execute the buckets");
  assert(t.includes("variancePct(0, 250)).toBe(-100)"), "the honest -100 collapse is not pinned");
});

console.log(`\nverify-v2-173-0: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
