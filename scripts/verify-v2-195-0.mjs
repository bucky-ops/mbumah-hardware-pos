#!/usr/bin/env node
// v2.195.0 verification — "the transactions card finds its week".
// Fresh-written per the house convention. Pins the release end to end:
// the fourth bucket (the route's one-pass shape, the additive payload),
// the per-branch counts (mapped from the groupBys that already carried
// them), the card's voice (the second button, the blue face, the settled
// qualifier, the tolerant spark), the drill-down (the grid, the blue
// week-over-week strip + the honesty rule, the branch rows, the step-
// aside), the modal-ground fix (both panels' dark halves, the REAL-chain
// contrast script, the a11y doc's FIXED close), and the release surfaces.
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

check("version: package.json leads 2.195.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.195.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.195.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.195.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-195-0"], "verify:v2-195-0 script missing");
  assert(pkg.scripts["verify:v2-194-0"], "verify:v2-194-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.195.0] The transactions card finds its week"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.195.0]") < changelog.indexOf("## [2.194.0]"), "2.195.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.195.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The transactions card finds its week'"), "whats-new title missing");
  assert(feed.indexOf("2.195.0") < feed.indexOf("2.194.0"), "2.195.0 is not the feed head");
});

check("the wire: the fourth bucket rides the SAME pass, the payload stays additive", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("const txBuckets = new Array<number>(7).fill(0);"), "the count buckets missing");
  assert(route.includes("txBuckets[i] += 1;"), "the count fill missing");
  assert(route.includes("const txSpark = txBuckets.map((v) => Math.round(v));"), "the integer map missing");
  assert(route.includes("four faces of one read, still one"), "the one-pass rationale missing");
  assert(route.includes("transactions: { today: txToday, weekTotal: txWeek, priorWeekTotal: txPrior, variancePct: txVariancePct, spark: txSpark },"), "the payload field missing");
  // the money faces keep their names
  assert(route.includes("taxSpark,"), "taxSpark re-keyed");
  assert(route.includes("netSpark,"), "netSpark re-keyed");
  const summary = read("src/app/api/org/summary/route.ts");
  assert(summary.includes("txWeek: curMap.get(s.id)?.count ?? 0,"), "the per-store count mapping missing");
  assert(summary.includes("txPrior: priMap.get(s.id)?.count ?? 0,"), "the per-store prior mapping missing");
});

check("the card: the row's second button, the blue face, the tolerant spark", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('onClick={() => setTxOpen(true)}'), "the button missing");
  assert(kpi.includes('data-testid="transactions-card"'), "the testid missing");
  assert(kpi.includes('<span className="absolute inset-y-0 left-0 w-1 bg-blue-500" />'), "the blue edge missing");
  assert(kpi.includes('>settled</span>'), "the settled qualifier missing");
  assert(kpi.includes('const txSparkReady = Array.isArray(k.transactions.spark) && k.transactions.spark.length === 7;'), "the readiness gate missing");
  assert(kpi.includes('<Sparkline data={k.transactions.spark ?? []} stroke="#2563eb" />'), "the card spark missing");
  assert(kpi.includes('<p className="mt-2 text-[10px] text-slate-500">today · 7d {num(k.transactions.weekTotal)} vs prior {num(k.transactions.priorWeekTotal)}</p>'), "the legacy fallback line missing");
  const type = read("src/components/org/primitives.tsx");
  assert(type.includes("transactions: { today: number; weekTotal: number; priorWeekTotal: number; variancePct: number; spark?: number[] };"), "the client type missing");
});

check("the drill-down: grid, blue strip + honesty rule, branch rows, step-aside", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('<Dialog open={txOpen} onOpenChange={setTxOpen}>'), "the modal missing");
  assert(kpi.includes('data-testid="transactions-spark"'), "the spark testid missing");
  assert(kpi.includes('data-testid="transactions-spark-absent"'), "the spark-absent note missing");
  for (const id of ["transactions-today", "transactions-week", "transactions-prior", "transactions-avg", "transactions-wow-strip", "transactions-wow", "transactions-wow-week", "transactions-wow-prior", "transactions-branch-stale"]) {
    assert(kpi.includes(`data-testid="${id}"`), `the testid ${id} missing`);
  }
  assert(kpi.includes("dark:border-blue-500/30 dark:bg-blue-500/10"), "the strip dark half missing");
  assert(kpi.includes("dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/30"), "the prior chip dark half missing");
  assert(kpi.includes("const txPct = k.transactions.priorWeekTotal > 0 ? Math.round((txDelta / k.transactions.priorWeekTotal) * 1000) / 10 : null;"), "the zero-prior honesty rule missing");
  assert(kpi.includes("<WeekDeltaChip current={b.txWeek} prior={b.txPrior} />"), "the branch verdict chip missing");
  assert(kpi.includes(".sort((a, b) => b.txWeek - a.txWeek)"), "the loudest-first sort missing");
});

check("the modal ground fix: both panels own dark:bg-slate-900, the real chain re-derived", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert((kpi.match(/bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/g) || []).length === 2, "both panel dark halves missing");
  const script = read("scripts/contrast-math-transactions-lens-v2195.mjs");
  assert(script.includes("checkBug"), "the discovery rows missing");
  assert(script.includes("the pre-fix state, must stay under"), "the reverse pin missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the transactions lens + the modal's REAL ground (v2.195.0)"), "the doc section missing");
  assert(doc.includes("46/46"), "the verdict missing");
  assert(doc.includes("1.05:1"), "the discovery number missing");
  assert(doc.includes("FIXED, not"), "the FIXED close missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/transactions-lens-v2195.test.ts");
  assert(suite.includes("the transactions card finds its week"), "suite header missing");
  assert(suite.includes("expect(txBuckets).toEqual([0, 0, 1, 0, 0, 0, 2]);"), "the bucket execution pin missing");
  assert(suite.includes("package.json rides at 2.195.0"), "the version pin missing");
});

check("the counters are re-anchored to the new head", () => {
  const counter = read("src/tests/console-changelog.test.ts");
  assert(counter.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(84);"), "the 84 counter missing");
  assert(counter.includes("Re-anchored for 2.195.0 joining the feed."), "the re-anchor note missing");
  const shell = read("src/tests/a11y-shell-v2148.test.ts");
  assert(shell.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(84);"), "the a11y-shell meta-pin drifted");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
