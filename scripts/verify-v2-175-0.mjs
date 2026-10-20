#!/usr/bin/env node
// v2.175.0 verification — "the week reaches every branch row".
// Fresh-written (lesson 25). Pins the storeSparks lib (per-store filtering,
// honest zeros, purity), the identity pass-through (winner rides
// slug/subdomain/isActive — the lib never builds URLs), the API's storeId
// select + additive perStoreTrend, the card's 7d column + mover door
// contract, the release surfaces, and the doc rows. Comment-strip per
// lesson 49; comment-text pins trimmed to survive line-wraps (lesson: the
// v2.174 round's 'no second read' split across lines).
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

check("version: package.json leads 2.175.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.175.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.175.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.175.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-175-0"], "verify:v2-175-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.175.0] The week reaches every branch row"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.175.0'"), "whats-new head missing");
  assert(feed.indexOf("2.175.0") < feed.indexOf("2.174.0"), "2.175.0 is not the feed head");
});

check("counters re-anchored (64/65/66/97)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(64)"), "2.110.0 anchor not 64");
  assert(t.includes("toBe(97)"), "2.77.0 anchor not 97");
  assert(t.includes("Re-anchored for 2.175.0 joining the feed."), "re-anchor comment missing");
});

check("the lib gains storeSparks + the identity pass-through, still pure and gross", () => {
  const lib = strip(read("src/lib/org/summary-trend.ts"));
  assert(lib.includes("export function storeSparks("), "storeSparks missing");
  assert(lib.includes("rows.filter((r) => r.storeId === storeId)"), "per-store filter missing");
  assert(lib.includes("return sparkBuckets("), "storeSparks must reuse sparkBuckets");
  assert(lib.includes("slug?: string | null;") && lib.includes("isActive?: boolean;"), "identity pass-through fields missing");
  assert(lib.includes("slug: slice.slug,\n        subdomain: slice.subdomain,\n        isActive: slice.isActive,"), "winner identity pass-through missing");
  assert(!lib.includes("Date.now"), "lib must not read the clock");
  assert(!lib.includes("taxAmount"), "lib is GROSS — taxAmount must never appear");
  assert(!lib.includes("resolveBranchWorkspace") && !lib.includes("href"), "the lib must never build URLs");
});

check("the API feeds the per-branch sparks from the SAME rows (storeId in the select)", () => {
  const route = strip(read("src/app/api/org/summary/route.ts"));
  assert(route.includes("select: { createdAt: true, totalAmount: true, storeId: true },"), "findMany select missing storeId");
  assert((route.match(/rawDb\.salesTransaction\.findMany\(/g) || []).length === 1, "a second row fetch was spent");
  assert(route.includes("const perStoreTrend = stores.map((s) => ({"), "perStoreTrend not built from the store list");
  assert(route.includes("spark: storeSparks(trendRows, s.id, windows.startToday, TREND_DAYS),"), "per-branch spark not via storeSparks");
  assert(route.includes("weekTotal: round2(curMap.get(s.id)?.amount ?? 0),"), "weekTotal not from the current-week map");
  assert(route.includes("totals,\n        trend,\n        perStoreTrend,\n        hr,"), "response not additive");
  assert((route.match(/isActive: s\.status === 'ACTIVE',/g) || []).length === 2, "both slice maps must carry isActive");
  assert(route.includes("const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];"), "role gate changed");
});

check("the card draws the 7d column and opens the mover door", () => {
  const card = strip(read("src/components/workspace/org-console.tsx"));
  // 7d column
  assert(card.includes("perStoreTrend?: Array<{ storeId: string; spark: number[]; weekTotal: number }> | null;"), "tolerant perStoreTrend missing");
  assert(card.includes(">7d trend</th>"), "7d column header missing");
  assert(card.indexOf(">Revenue today</th>") < card.indexOf(">7d trend</th>"), "7d column must sit beside Revenue today");
  assert(card.includes("summary.perStoreTrend?.find((t) => t.storeId === store.id) ?? null"), "join not by storeId");
  assert(card.includes('stroke="#64748b"'), "muted slate stroke missing");
  assert(card.includes("width={72} height={20}"), "table spark not 72x20");
  assert(card.includes("title={`7-day revenue ${formatKES(storeTrend.weekTotal)} (gross)`}"), "tooltip missing");
  assert(card.includes('<span className="sr-only">7-day revenue {formatKES(storeTrend.weekTotal)}</span>'), "sr-only clause missing");
  assert(card.includes('<span className="text-muted-foreground" aria-hidden="true">'), "honest dash fallback missing");
  // mover door
  assert(card.includes("const moverHref = mover"), "resolver gate missing");
  assert(card.includes("resolveBranchWorkspace({"), "safe resolver not used");
  assert(card.includes('target="_blank"') && card.includes('rel="noopener noreferrer"'), "new-tab semantics missing");
  assert(card.includes('data-testid={`${testId}-mover-link`}'), "link testid missing");
  assert(card.includes('<span className="sr-only"> (opens in a new tab)</span>'), "sr-only new-tab clause missing");
  assert(card.includes("focus-visible:ring-2 focus-visible:ring-ring"), "focus ring missing");
  assert(card.includes("<span className=\"font-medium text-foreground/80\">{mover.storeName}</span>"), "plain-text fallback missing");
  // the v2.173/v2.174 strip stays intact underneath
  assert(card.includes("7d {format(weekTotal)} · prior {format(priorWeekTotal)}"), "v2.173.0 microcopy disturbed");
  assert(card.includes('priorWeekTotal > 0 &&'), "v2.173.0 badge gate disturbed");
  assert(card.includes("{mover.prior > 0 && ("), "v2.174.0 mover % gate disturbed");
});

check("the doc teaches the door and the 7d column", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("The mover's name is a door (v2.175.0)"), "mover-door bullet missing");
  assert(doc.includes("**7d trend** column"), "7d column bullet missing");
  assert(doc.includes("gained `storeId` in its select — no second query"), "same-rows rule missing");
  assert(doc.includes("| Trend · mover link |"), "mover-link KPI row missing");
  assert(doc.includes("| Trend · per-branch 7d spark |"), "per-branch spark KPI row missing");
  assert(doc.includes("| Trend · top mover |") && doc.includes("| Trend · variance badge |"), "v2.173/v2.174 rows disturbed");
});

check("the executed-math suite is registered and runs the lib", () => {
  const t = read("src/tests/trend-doors-v2175.test.ts");
  assert(t.includes("from '@/lib/org/summary-trend'"), "suite does not import the lib");
  assert(t.includes("storeSparks(rows, 's1', ANCHOR)"), "suite does not execute storeSparks");
  assert(t.includes("expect(spark).toEqual([0, 0, 0, 0, 0, 0, 0])"), "the honest flat line is not pinned");
  assert(t.includes("expect(m?.slug).toBeNull()"), "the null-slug pass-through is not pinned");
  assert(t.includes("expect(lib).not.toContain('resolveBranchWorkspace')"), "the no-URL lib rule is not pinned");
});

check("the v2.174.0 suite re-anchors to the evolved contract", () => {
  const t = read("src/tests/trend-names-mover-v2174.test.ts");
  assert(t.includes("totals,\\n        trend,\\n        perStoreTrend,\\n        hr,"), "response pin not re-anchored");
  assert(t.includes("Top mover{"), "mover sentence pin not re-anchored");
  assert(t.includes("isActive?: boolean;\\n}"), "interface pin not re-anchored");
});

console.log(`\nverify-v2-175-0: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
