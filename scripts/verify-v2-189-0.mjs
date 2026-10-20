#!/usr/bin/env node
// v2.189.0 verification — "the roster keeps its week".
// Fresh-written per the house convention. Pins the release end to end:
// the read's week roster (`stats.weekReviewerRows`, additive — the
// `weekReviewers` NUMBER keeps its meaning), the panel's week strip (the
// same share-bar affordance family + the clears chip, the SAME drill,
// org-wide by contract), the branches CSV's "Reviews by reviewer (7d)"
// sub-section (lib-computed shares, absence honesty), the tolerant parse,
// and the printable report's share bars + CSV Share column. Comment-strip
// per lesson 49; comment-text pins trimmed to survive wraps.
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

check("version: package.json leads 2.189.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.189.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.189.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.189.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-189-0"], "verify:v2-189-0 script missing");
  assert(pkg.scripts["verify:v2-188-0"], "verify:v2-188-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.189.0] The roster keeps its week"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.189.0]") < changelog.indexOf("## [2.188.0]"), "2.189.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.189.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The roster keeps its week'"), "whats-new title missing");
  assert(feed.indexOf("2.189.0") < feed.indexOf("2.188.0"), "2.189.0 is not the feed head");
});

check("the read: the week roster rides additively", () => {
  const ra = read("src/app/api/org/review-activity/route.ts");
  assert(ra.includes("weekReviewerNames, weekRosterRaw, branchRows"), "the tuple order moved");
  assert(ra.includes("const weekRosterAgg = new Map<string, { visits: number; clears: number }>();"), "the one-pass aggregation missing");
  assert(ra.includes(".sort((a, b) => b[1].visits - a[1].visits || a[0].localeCompare(b[0]))"), "the loudest-first + A-Z tie ordering missing");
  assert(ra.includes(".slice(0, 24)"), "the 24 cap missing");
  assert(ra.includes("weekReviewers: weekReviewerNames.length"), "the count's meaning moved");
  assert(ra.includes("weekReviewerRows: weekRoster,"), "the additive field missing");
});

check("the strip: the week face renders with the full affordance family", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes("data-testid=\"desk-week-roster\""), "the strip testid missing");
  assert(panels.includes("{stats.weekVisits > 0 && stats.weekReviewerRows && stats.weekReviewerRows.length > 0 && ("), "the gate missing");
  assert(panels.includes("who pulled the week · share of"), "the caption missing");
  assert(panels.includes("const weekShare = stats.weekVisits > 0 ? Math.round((r.visits / stats.weekVisits) * 100) : 0;"), "the share math missing");
  assert(panels.includes("style={{ width: `${Math.min(100, weekShare)}%` }}"), "the width cap missing");
  assert(panels.includes("stats.weekReviewerRows.slice(0, 6)"), "the six-row cap missing");
  assert(panels.includes("on the week roster"), "the +N honesty missing");
  assert(panels.includes("data-testid=\"desk-week-roster-clears\""), "the clears chip missing");
  assert(panels.includes("data-testid=\"desk-week-roster-drill\""), "the drill testid missing");
  assert(panels.includes("onClick={() => onFilterChange({ ...filter, reviewer: weekDrilled ? null : r.name })}"), "the drill wiring missing");
  assert(panels.includes("aria-pressed={weekDrilled}"), "the pressed state missing");
  assert(panels.includes("const weekDrilled = reviewer === r.name;"), "the drilled derivation missing");
  assert(panels.includes("'bg-emerald-50/90 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:ring-emerald-500/40'"), "the drilled tint+ring missing");
  assert(panels.includes("'hover:bg-white/80 dark:hover:bg-slate-800/50'"), "the calm hover missing");
  assert(panels.includes("focus-visible:ring-2 focus-visible:ring-emerald-400"), "the house focus ring missing");
  assert(panels.includes("className=\"mb-3 border-t border-slate-100 pt-2 dark:border-slate-800\""), "the slate divider missing");
});

check("the strip: the yesterday contract keeps its exact shape", () => {
  const panels = read("src/components/org/panels.tsx");
  assert(panels.includes("{yesterday.reviewerRows && yesterday.reviewerRows.length > 1 && ("), "the yesterday gate moved");
  assert(panels.includes("const drilled = reviewer === r.name;"), "the yesterday derivation moved");
  assert(panels.includes("const share = yesterday.visits > 0 ? Math.round((r.visits / yesterday.visits) * 100) : 0;"), "the yesterday share math moved");
  assert(!panels.includes("text-emerald-600"), "the banned text-emerald-600 token returned (the v2.149.0 sweep)");
});

check("the types: the roster rides optional under stats", () => {
  const prim = read("src/components/org/primitives.tsx");
  assert(prim.includes("weekReviewerRows?: Array<{ name: string; visits: number; clears: number }>;"), "the optional type missing");
});

check("the CSV: the week sub-section files with lib-computed shares", () => {
  const csv = read("src/lib/org/branches-csv.ts");
  assert(csv.includes("week?: { visits: number; reviewerRows?: ReadonlyArray<{ name: string; visits: number }> } | null;"), "the week block type missing");
  assert(csv.includes("'Reviews by reviewer (7d),Reviewer,Visits,Share (%)'"), "the week section header missing");
  assert(csv.includes("Math.round((r.visits / week.visits) * 10000) / 100,"), "the lib-computed share missing");
});

check("the parse: the tolerant ride", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("weekReviewerRows?: unknown; // v2.189.0: the week roster array"), "the parse field missing");
  assert(oc.includes("typeof st.weekVisits === 'number' && weekRows && weekRows.length > 0"), "the denominator guard missing");
  assert(oc.includes("? { visits: st.weekVisits, reviewerRows: weekRows }"), "the week build missing");
});

check("the report: the rows wear the share", () => {
  const view = read("src/components/org/desk-report-view.tsx");
  assert(view.includes("const share = data.totals.visits > 0 ? Math.round((r.visits / data.totals.visits) * 100) : 0;"), "the share derivation missing");
  assert(view.includes("const loudest = r === data.reviewers[0];"), "the loudest derivation missing");
  assert(view.includes("data-testid=\"desk-report-reviewer-share\""), "the share figure testid missing");
  assert(view.includes("{share}%"), "the print-honest % figure missing");
  assert(view.includes("bars show each reviewer&apos;s share"), "the caption invitation missing");
  const lib = read("src/lib/hr/desk-report.ts");
  assert(lib.includes("row(['Name', 'Visits', 'Corrections answered', 'Branches', 'Last visit (UTC)', 'Share (%)']);"), "the CSV Share column missing");
  assert(lib.includes("report.totals.visits > 0 ? Math.round((r.visits / report.totals.visits) * 10000) / 100 : ''"), "the lib-computed report share missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/roster-week-v2189.test.ts");
  assert(suite.includes("the roster keeps its week"), "suite header missing");
  assert(suite.includes("weekReviewerRows: weekRoster,"), "the additive naming pin missing");
  assert(suite.includes("package.json rides at 2.189.0"), "the version pin missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
