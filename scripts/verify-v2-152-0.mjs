#!/usr/bin/env node
// v2.152.0 verification — "counts that read".
// Fresh-written (lesson 25). Pins the six-node resolution at its true roots:
// the transform-only keyframe, the two count badges with margin, the footer
// health tokens, the desk-report pair unification, and the two-section CSV.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

check("version: package.json leads 2.152.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.152.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.152.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.152.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-152-0"], "verify:v2-152-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.152.0] Counts that read"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.152.0'"), "whats-new head missing");
  assert(feed.indexOf("2.152.0") < feed.indexOf("2.151.0"), "2.152.0 is not the feed head");
});

check("counter test re-anchored (41/42/43/74)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(41)"), "2.110.0 anchor not 41");
  assert(t.includes("toBe(74)"), "2.77.0 anchor not 74");
});

check("keyframes: console-slide-fade is transform-only (no opacity ramp)", () => {
  const css = read("src/app/globals.css");
  const at = css.indexOf("@keyframes console-slide-fade");
  assert(at > -1, "keyframe missing");
  const block = css.slice(at, at + 140);
  assert(block.includes("transform:translateY(8px)"), "keyframe lost its slide");
  assert(!block.includes("opacity"), "keyframe still ramps opacity");
});

check("count badges clear with margin", () => {
  const matrix = stripComments(read("src/components/org/store-matrix.tsx"));
  assert(matrix.includes('bg-red-100 text-red-800 hover:bg-red-100'), "matrix badge not red-800");
  const panels = stripComments(read("src/components/org/panels.tsx"));
  assert(panels.includes("value > 0 ? 'border-orange-300 text-orange-800 dark:border-orange-500/40 dark:text-orange-300' : 'text-slate-500'"), "QueueRow not orange-800");
  const bareOrange = panels.match(/(^|[^:-])text-orange-600/g)?.length ?? 0;
  assert(bareOrange === 0, `panels still carries ${bareOrange} bare text-orange-600`);
});

check("console footer health: light tokens on the light footer, rail untouched", () => {
  const chrome = stripComments(read("src/components/org/chrome.tsx"));
  assert(chrome.includes("'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'"), "footer health tokens wrong");
  assert(chrome.includes("text-xs font-bold text-emerald-400"), "rail health token changed unexpectedly");
});

check("desk-report: light halves unified, dark halves preserved", () => {
  const src = stripComments(read("src/components/org/desk-report-view.tsx"));
  const bare = src.match(/(^|[^:-])text-slate-400/g)?.length ?? 0;
  assert(bare === 0, `desk-report still carries ${bare} bare text-slate-400`);
  assert((src.match(/dark:text-slate-400/g)?.length ?? 0) >= 15, "dark preservation drifted");
  // no conflicting doubles in either order
  assert(!src.includes("dark:text-slate-500 dark:text-slate-400"), "doubled dark tokens (400 after 500)");
  assert(!src.includes("dark:text-slate-400 dark:text-slate-500"), "doubled dark tokens (500 after 400)");
});

check("CSV: the two-section builder + the wired handler", () => {
  const lib = stripComments(read("src/lib/org/branches-csv.ts"));
  assert(lib.includes("export interface BranchHrCsvRow"), "HR row type missing");
  assert(lib.includes("BRANCHES_HR_CSV_COLUMNS"), "HR columns missing");
  assert(lib.includes("hrPerStore?: readonly BranchHrCsvRow[] | null"), "optional param missing");
  assert(lib.includes("People & payroll by branch"), "section header missing");
  assert(lib.includes("r.latestPayroll ? r.latestPayroll.periodName : ''"), "honest absence missing");
  const org = stripComments(read("src/components/workspace/org-console.tsx"));
  assert(org.includes("(summary.hrPerStore ?? []).map((r) => ({"), "handler not wired");
});

check("prior round contracts still stand", () => {
  const shell = stripComments(read("src/components/console/unified-console.tsx"));
  assert(shell.includes("w-full min-w-0 flex-1"), "shell width contract lost");
  const org = stripComments(read("src/components/workspace/org-console.tsx"));
  assert((org.match(/role="region"/g)?.length ?? 0) === 2, "region roles lost");
  const dash = stripComments(read("src/app/(shell)/tabs/dashboard-tab.tsx"));
  assert(dash.includes("to-[#047857]"), "banner gradient regressed");
});

check("the follow-up test suite pins the contract", () => {
  const t = read("src/tests/console-org-v2152.test.ts");
  assert(t.includes("v2.152.0"), "suite does not speak the version");
  assert(t.includes("console-slide-fade"), "keyframe unpinned");
  assert(t.includes("BRANCHES_HR_CSV_COLUMNS"), "CSV section unpinned");
});

console.log(`\nverify-v2-152-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
