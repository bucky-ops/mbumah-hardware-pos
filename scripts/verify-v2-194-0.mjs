#!/usr/bin/env node
// v2.194.0 verification — "the VAT face gets its spark".
// Fresh-written per the house convention. Pins the release end to end:
// the third bucket (the route's one-pass shape, the additive payload),
// the amber spark's mount (tolerant guards, the third hue, the height
// hierarchy), the dark-voice fix (the grid, both strips, the verdict
// chips' dark halves), the a11y surfaces (script + doc, FIXED), and the
// release surfaces. Comment-strip per lesson 49; comment-text pins
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

check("version: package.json leads 2.194.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.194.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.194.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.194.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-194-0"], "verify:v2-194-0 script missing");
  assert(pkg.scripts["verify:v2-193-0"], "verify:v2-193-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.194.0] The VAT face gets its spark"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.194.0]") < changelog.indexOf("## [2.193.0]"), "2.194.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.194.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The VAT face gets its spark'"), "whats-new title missing");
  assert(feed.indexOf("2.194.0") < feed.indexOf("2.193.0"), "2.194.0 is not the feed head");
});

check("the wire: the third bucket rides the SAME pass, the payload stays additive", () => {
  const route = read("src/app/api/org/kpi-summary/route.ts");
  assert(route.includes("const taxBuckets = new Array<number>(7).fill(0);"), "the tax buckets missing");
  assert(route.includes("taxBuckets[i] += toDec(row.taxAmount).toNumber();"), "the tax fill missing");
  assert(route.includes("const taxSpark = taxBuckets.map((v) => round2(v));"), "the round2 map missing");
  assert(route.includes("three faces of one read, one pass, no second query"), "the one-pass rationale missing");
  assert(route.includes("netTodayTotal: netToday,"), "the v2.187.0 block re-keyed");
  assert(route.includes("netSpark,"), "netSpark re-keyed");
  assert(route.includes("taxSpark,"), "the payload field missing");
});

check("the modal: the amber spark mounts, tolerant, a third hue", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes("{k.revenue.taxSpark != null && k.revenue.taxSpark.length > 0 && ("), "the tolerant guard missing");
  assert(kpi.includes('<Sparkline data={k.revenue.taxSpark} stroke="#d97706" width={380} height={36} />'), "the spark literals missing");
  assert(kpi.includes('data-testid="revenue-vat-spark"'), "the testid missing");
  assert(kpi.includes('title="VAT collected per day, last 7 days"'), "the title missing");
  assert(kpi.includes('<Sparkline data={k.revenue.spark} width={380} height={80} />'), "the gross spark moved");
  assert(kpi.includes('<Sparkline data={k.revenue.netSpark ?? []} stroke="#8b5cf6" width={380} height={80} />'), "the net spark moved");
  const type = read("src/components/org/primitives.tsx");
  assert(type.includes("taxSpark?: number[]"), "the client type missing");
});

check("the dark voice: the grid, both strips, the verdict chips", () => {
  const kpi = read("src/components/org/kpi-row.tsx");
  assert(kpi.includes('text-slate-500 dark:text-slate-400'), "the label dark fix missing");
  assert(kpi.includes('text-slate-800 dark:text-slate-100'), "the value dark fix missing");
  assert(kpi.includes("dark:border-violet-500/30 dark:bg-violet-500/10"), "the net strip dark half missing");
  assert(kpi.includes("dark:border-emerald-500/30 dark:bg-emerald-500/10"), "the VAT strip dark half missing");
  assert(kpi.includes("dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"), "the up verdict dark half missing");
  assert(kpi.includes("dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30"), "the down verdict dark half missing");
  assert(kpi.includes("dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/30"), "the flat verdict dark half missing");
  assert(kpi.includes("dark:bg-violet-500/20 dark:text-violet-300 dark:ring-violet-500/30"), "the prior chip dark half missing");
  assert(kpi.includes("dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/30"), "the net chip dark half missing");
});

check("the a11y surfaces: the script asserts, the doc closes FIXED", () => {
  const script = read("scripts/contrast-math-revenue-modal-v2194.mjs");
  assert(script.includes("src/components/org/kpi-row.tsx"), "the component source missing");
  assert(script.includes("src/components/ui/dialog.tsx"), "the dialog ground source missing");
  assert(script.includes("node_modules/tailwindcss/theme.css"), "the installed-theme source missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the revenue modal's dark-mode voice + the VAT spark's stroke (v2.194.0)"), "the doc section missing");
  assert(doc.includes("26/26"), "the verdict missing");
  assert(doc.includes("1.35:1"), "the discovery number missing");
  assert(doc.includes("FIXED, not"), "the FIXED close missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/vat-spark-v2194.test.ts");
  assert(suite.includes("the VAT face gets its spark"), "suite header missing");
  assert(suite.includes("expect(taxBuckets).toEqual([0, 0, 0, 0, 0, 0, 150]);"), "the bucket execution pin missing");
  assert(suite.includes("package.json rides at 2.194.0"), "the version pin missing");
});

check("the counters are re-anchored to the new head", () => {
  const counter = read("src/tests/console-changelog.test.ts");
  assert(counter.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(83);"), "the 83 counter missing");
  assert(counter.includes("Re-anchored for 2.194.0 joining the feed."), "the re-anchor note missing");
  const shell = read("src/tests/a11y-shell-v2148.test.ts");
  assert(shell.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(83);"), "the a11y-shell meta-pin drifted");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
