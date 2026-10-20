#!/usr/bin/env node
// v2.187.0 verification — "the modal learns the lens".
// Fresh-written per the house convention. Pins the deepened VAT lens end to
// end: the net buckets fill in the SAME pass over the SAME rows (zero extra
// queries, the gross spark untouched), the missing net windows ride from the
// aggregates already fetched, the modal's explicit Gross/Net toggle is
// gated/tolerant/accessible, the net line wears violet, the branch rows step
// aside honestly in the net lens, and the ribbon's WoW chip gives
// taxPriorWeekTotal its first consumer without ever inventing a percentage.
// Comment-strip per lesson 49; comment-text pins trimmed to survive wraps.
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

check("version: package.json leads 2.187.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.187.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.187.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.187.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-187-0"], "verify:v2-187-0 script missing");
  assert(pkg.scripts["verify:v2-186-0"], "verify:v2-186-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.187.0] The modal learns the lens"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.187.0]") < changelog.indexOf("## [2.186.0]"), "2.187.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.187.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The modal learns the lens'"), "whats-new title missing");
  assert(feed.indexOf("2.187.0") < feed.indexOf("2.186.0"), "2.187.0 is not the feed head");
});

check("the read: net buckets fill in the SAME pass - zero extra queries", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("const netBuckets = new Array<number>(7).fill(0);"), "net bucket declaration missing");
  assert(route.includes("sparkBuckets[i] += toDec(row.totalAmount).toNumber();"), "the gross bucket line must keep its exact shape");
  assert(route.includes("netBuckets[i] += toDec(row.totalAmount).toNumber() - toDec(row.taxAmount).toNumber();"), "the net bucket derivation missing");
  assert(route.includes("const netSpark = netBuckets.map((v) => round2(v));"), "netSpark derivation missing");
  // One loop, two faces: the two additions sit inside the same inner for.
  const loop = route.slice(route.indexOf("for (const row of sparkRows)"), route.indexOf("const spark = sparkBuckets.map"));
  assert(loop.includes("sparkBuckets[i] +=") && loop.includes("netBuckets[i] +="), "the two faces must fill in ONE pass");
  assert(route.includes("const netToday = round2(toDec(todayAgg._sum.totalAmount).toNumber() - toDec(todayAgg._sum.taxAmount).toNumber());"), "netToday missing");
  assert(route.includes("const netPrior = round2(toDec(priorAgg._sum.totalAmount).toNumber() - toDec(priorAgg._sum.taxAmount).toNumber());"), "netPrior missing");
  // The v2.185.0 gross contract still holds on this route.
  assert(!route.includes("netOf"), "the forbidden netOf name returned");
  assert(!route.includes(".minus(toDec(sums.taxAmount))"), "the forbidden Decimal-minus subtraction returned");
});

check("the payload: the deepened lens rides ADDITIVELY", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("netTodayTotal: netToday,"), "netTodayTotal payload field missing");
  assert(route.includes("netPriorWeekTotal: netPrior,"), "netPriorWeekTotal payload field missing");
  assert(route.includes("netSpark,"), "netSpark payload field missing");
  assert(route.includes("taxWeekTotal: taxWeek,"), "the v2.185.0 lens block must stay");
  assert(route.includes("v2.187.0 (the lens deepens)"), "the route header must record the deepening");
});

check("the modal: an explicit, gated, accessible lens toggle", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes("useState<'gross' | 'net'>('gross')"), "gross must be the DEFAULT lens");
  assert(modal.includes("Array.isArray(k.revenue.netSpark) && k.revenue.netSpark.length === 7"), "the netReady tolerance gate missing");
  assert(modal.includes("{netReady && ("), "the toggle must render ONLY when the net buckets arrived");
  assert(modal.includes('role="group" aria-label="Revenue lens"'), "the group semantics missing");
  assert(modal.includes("aria-pressed={lens === l}"), "the pressed state missing");
  assert(modal.includes("'bg-emerald-600 text-white shadow'"), "the emerald gross active hue missing");
  assert(modal.includes("'bg-violet-600 text-white shadow'"), "the violet net active hue missing");
  assert(modal.includes("stroke=\"#8b5cf6\""), "the net line must wear violet");
  assert(modal.includes("lens === 'gross' ? 'Revenue trend (gross)' : 'Revenue trend (net)'"), "the lens-following title missing");
  assert(!modal.includes("Revenue trend (net of VAT)"), "the forbidden v2.185.0 phrasing returned");
});

check("the modal: the net grid mirrors gross cell for cell, never a NaN", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes('data-testid="revenue-net-today"'), "net Today cell missing");
  assert(modal.includes('data-testid="revenue-net-week"'), "net 7d cell missing");
  assert(modal.includes('data-testid="revenue-net-prior"'), "net Prior cell missing");
  assert(modal.includes('data-testid="revenue-net-avg"'), "net Avg cell missing");
  assert(modal.includes("k.revenue.netWeekTotal ?? k.revenue.weekTotal - (k.revenue.taxWeekTotal ?? 0)"), "the ?? fallback chain missing");
});

check("the modal: branch rows speak gross only - honest absence in the net lens", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes("branchWeek && branchWeek.length > 0 && lens === 'gross'"), "the gross gate missing");
  assert(modal.includes("branchWeek && branchWeek.length > 0 && lens === 'net'"), "the net gate missing");
  assert(modal.includes("net by branch is not on the wire"), "the honest absence note missing");
  assert(modal.includes("branch shapes and the org line above speak the same gross till face"), "the v2.185.0 one-till-face note must stay");
});

check("the ribbon: the VAT week-over-week, honest about a zero prior", () => {
  const modal = read("src/components/org/kpi-row.tsx");
  assert(modal.includes('data-testid="revenue-vat-wow"'), "the WoW chip missing");
  assert(modal.includes("k.revenue.taxPriorWeekTotal != null && (() => {"), "the WoW gate missing");
  assert(modal.includes("k.revenue.taxPriorWeekTotal > 0 ? Math.round((vatDelta / k.revenue.taxPriorWeekTotal) * 1000) / 10 : null"), "the no-invented-% honesty missing");
  assert(modal.includes("{k.revenue.taxWeekTotal != null && ("), "the v2.185.0 ribbon gate must stay");
  assert(modal.includes("net {kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - k.revenue.taxWeekTotal)}"), "the v2.185.0 net chip must stay");
});

check("the type: the deepened lens rides OPTIONAL", () => {
  const types = read("src/components/org/primitives.tsx");
  assert(types.includes("netTodayTotal?: number; netPriorWeekTotal?: number; netSpark?: number[]"), "the optional net fields missing");
  assert(types.includes("taxWeekTotal?: number; taxPriorWeekTotal?: number; netWeekTotal?: number"), "the v2.185.0 optional fields must stay");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/revenue-net-lens-v2187.test.ts");
  assert(suite.includes("the modal learns the lens"), "suite header missing");
  assert(suite.includes("netBuckets[i] += toDec(row.totalAmount).toNumber() - toDec(row.taxAmount).toNumber();"), "the same-pass pin missing");
  assert(suite.includes("package.json rides at 2.187.0"), "the version pin missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
