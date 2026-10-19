#!/usr/bin/env node
// v2.153.0 verification — "the tinted cards tell the truth".
// Fresh-written (lesson 25). Pins the lesson-65 sweep: tinted-card tokens,
// the filter chip's dark text, the aging badge, the People & payroll pass.

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

check("version: package.json leads 2.153.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.153.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.153.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.153.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-153-0"], "verify:v2-153-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.153.0] The tinted cards tell the truth"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.153.0'"), "whats-new head missing");
  assert(feed.indexOf("2.153.0") < feed.indexOf("2.152.0"), "2.153.0 is not the feed head");
});

check("counter test re-anchored (42/43/44/75)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(42)"), "2.110.0 anchor not 42");
  assert(t.includes("toBe(75)"), "2.77.0 anchor not 75");
});

check("alert cards: SEV_TEXT on -700s, detail on slate-600", () => {
  const panels = stripComments(read("src/components/org/panels.tsx"));
  assert(panels.includes("critical: 'text-red-700', warning: 'text-amber-700', info: 'text-blue-700'"), "SEV_TEXT wrong");
  assert(panels.includes('<p className="text-xs text-slate-600">{a.detail}</p>'), "detail line wrong");
  const bare = panels.match(/(^|[^:-])text-red-600/g)?.length ?? 0;
  assert(bare === 0, `panels still carries ${bare} bare text-red-600`);
});

check("live feed filter: slate-950 on the orange fill, never white", () => {
  const panels = stripComments(read("src/components/org/panels.tsx"));
  assert(panels.includes("filter === l ? 'bg-orange-500 text-slate-950 hover:bg-orange-400' : ''"), "filter chip wrong");
});

check("kpi row: 60d badge on orange-800, no bare orange-600 left", () => {
  const kpi = stripComments(read("src/components/org/kpi-row.tsx"));
  assert(kpi.includes('className="px-1 py-0 text-orange-800">60d'), "60d badge wrong");
  assert((kpi.match(/(^|[^:-])text-orange-600/g)?.length ?? 0) === 0, "kpi-row still has orange-600");
});

check("people-payroll: hint + links pass, dark halves kept", () => {
  const src = stripComments(read("src/components/finance/people-payroll-by-branch.tsx"));
  assert(src.includes("text-slate-500 dark:text-slate-400 sm:inline"), "hint wrong");
  assert((src.match(/(^|[^:-])text-amber-600/g)?.length ?? 0) === 0, "amber-600 links remain");
  assert(!src.includes("hover:text-orange-600"), "hover tone not deepened");
  assert((src.match(/dark:text-amber-400/g)?.length ?? 0) >= 2, "dark halves lost");
});

check("prior round contracts still stand", () => {
  const css = read("src/app/globals.css");
  const at = css.indexOf("@keyframes console-slide-fade");
  assert(!css.slice(at, at + 140).includes("opacity"), "keyframe opacity ramp returned");
  const matrix = stripComments(read("src/components/org/store-matrix.tsx"));
  assert(matrix.includes("bg-red-100 text-red-800"), "matrix badge regressed");
  const org = stripComments(read("src/components/workspace/org-console.tsx"));
  assert(org.includes("(summary.hrPerStore ?? []).map((r) => ({"), "CSV handler lost");
});

check("the follow-up test suite pins the contract", () => {
  const t = read("src/tests/console-org-v2153.test.ts");
  assert(t.includes("v2.153.0"), "suite does not speak the version");
  assert(t.includes("SEV_TEXT"), "alert tokens unpinned");
});

console.log(`\nverify-v2-153-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
