#!/usr/bin/env node
// v2.185.0 verification — "the two revenues agree".
// Fresh-written per the house convention. Pins the net-vs-gross
// reconciliation (recorded v2.173.0, labeled v2.178.0/v2.179.0, carried
// twice as the top pick): kpi-summary speaks the GROSS till face, the
// netOf subtraction is GONE, the VAT lens rides additively, the modal
// carries the tolerant emerald ribbon, and the recorded history (route
// comments, trend-lib contract, docs, both CSV notes) records the
// AGREEMENT instead of the gap.
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

check("version: package.json leads 2.185.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.185.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.185.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.185.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-185-0"], "verify:v2-185-0 script missing");
  assert(pkg.scripts["verify:v2-184-0"], "verify:v2-184-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.185.0] The two revenues agree"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.185.0]") < changelog.indexOf("## [2.184.0]"), "2.185.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.185.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The two revenues agree'"), "whats-new title missing");
  assert(feed.indexOf("2.185.0") < feed.indexOf("2.184.0"), "2.185.0 is not the feed head");
});

check("reconciliation: the netOf subtraction is GONE from the revenue path", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(!route.includes("netOf"), "netOf helper still exists");
  assert(!route.includes(".minus(toDec(sums.taxAmount))"), "a tax subtraction still rides the route");
  assert(route.includes("const grossOf = (sums: { totalAmount: Parameters<typeof toDec>[0] }) =>"), "grossOf helper missing");
  assert(route.includes("const revToday = round2(grossOf(todayAgg._sum));"), "today is not gross");
  assert(route.includes("const revWeek = round2(grossOf(weekAgg._sum));"), "week is not gross");
  assert(route.includes("const revPrior = round2(grossOf(priorAgg._sum));"), "prior is not gross");
  assert(route.includes("sparkBuckets[i] += toDec(row.totalAmount).toNumber();"), "spark still subtracts tax");
  assert(route.includes("7-day gross-revenue sparkline"), "spark comment not reconciled");
});

check("the VAT lens rides ADDITIVELY - computed from sums already fetched", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("const taxWeek = round2(toDec(weekAgg._sum.taxAmount));"), "taxWeek missing");
  assert(route.includes("const taxPrior = round2(toDec(priorAgg._sum.taxAmount));"), "taxPrior missing");
  assert(route.includes("const netWeek = round2(revWeek - taxWeek);"), "netWeek missing");
  assert(route.includes("taxWeekTotal: taxWeek,"), "payload taxWeekTotal missing");
  assert(route.includes("taxPriorWeekTotal: taxPrior,"), "payload taxPriorWeekTotal missing");
  assert(route.includes("netWeekTotal: netWeek,"), "payload netWeekTotal missing");
  assert(route.includes("REVENUE SEMANTICS (v2.185.0"), "route header contract missing");
});

check("the health detail speaks gross", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("7d gross KES ${revWeek.toLocaleString('en-KE')}"), "health revenue detail not gross-labeled");
});

check("the modal: gross title, gross pill, tolerant emerald ribbon", () => {
  const comp = read("src/components/org/kpi-row.tsx");
  assert(comp.includes("Revenue trend (gross)"), "modal title not gross");
  assert(!comp.includes("Revenue trend (net of VAT)"), "net title still present");
  assert(comp.includes(">gross</span>"), "the gross qualifier pill missing");
  assert(comp.includes("{k.revenue.taxWeekTotal != null && ("), "ribbon tolerance gate missing");
  assert(comp.includes("incl. VAT (7d)"), "ribbon VAT label missing");
  assert(comp.includes("net {kes(k.revenue.netWeekTotal ?? k.revenue.weekTotal - k.revenue.taxWeekTotal)}"), "ribbon net figure missing");
  assert(comp.includes("border-emerald-100 bg-emerald-50/70"), "ribbon emerald styling missing");
  assert(comp.includes("branch shapes and the org line above speak the same gross till face"), "branch note not reconciled");
  assert(!comp.includes("org line above is net of VAT"), "retired branch note still present");
});

check("the type carries the lens OPTIONAL - tolerant of an older answer", () => {
  const types = read("src/components/org/primitives.tsx");
  assert(types.includes("taxWeekTotal?: number; taxPriorWeekTotal?: number; netWeekTotal?: number"), "optional lens fields missing");
});

check("the one revenue contract across BOTH routes", () => {
  const summary = read("src/app/api/org/summary/route.ts");
  assert(summary.includes("GROSS by contract"), "summary's gross contract comment missing");
  assert(summary.includes("RECONCILED in v2.185.0"), "summary's reconciliation note missing");
  const trend = read("src/lib/org/summary-trend.ts");
  assert(trend.includes("RECONCILED in v2.185.0"), "trend lib's reconciliation note missing");
  assert(trend.includes("not one side of a divergence"), "trend lib's one-contract line missing");
  assert(!trend.includes("taxAmount"), "trend lib must never learn taxAmount (the v2.173.0 structural pin)");
});

check("the recorded history: docs + both CSV notes record the AGREEMENT", () => {
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("RECONCILED in v2.185.0"), "doc reconciliation missing");
  const branches = read("src/lib/org/branches-csv.ts");
  assert(branches.includes("the org trend line and the expert console KPI agree (gross till face, reconciled v2.185.0)"), "branches CSV note not reconciled");
  assert(!branches.includes("is net of VAT"), "branches CSV still carries the divergence label");
  const matrix = read("src/lib/org/store-matrix-csv.ts");
  assert(matrix.includes("the expert console KPI agrees (gross till face, reconciled v2.185.0)"), "matrix CSV note not reconciled");
  assert(!matrix.includes("is net of VAT"), "matrix CSV still carries the divergence label");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/revenue-reconciled-v2185.test.ts");
  assert(suite.includes("the two revenues agree"), "suite header missing");
  assert(suite.includes("not.toContain('netOf')"), "the netOf pin missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
