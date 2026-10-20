#!/usr/bin/env node
// v2.190.0 verification — "the drill-down ranks its payrolls".
// Fresh-written per the house convention. Pins the release end to end:
// the rank ladder (`payrollStatusRank`, total, uppercase-exact), the
// payroll column's STATUS RANK sort (finality primary, directional
// createdAt/periodName ties, missing runs LAST both directions, the fresh
// click desc / asc the honest mirror), the component's honest title hint,
// the avatar-hue contrast-math surfaces (script + doc), and the release
// surfaces. Comment-strip per lesson 49; comment-text pins trimmed to
// survive wraps.
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

check("version: package.json leads 2.190.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.190.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.190.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.190.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-190-0"], "verify:v2-190-0 script missing");
  assert(pkg.scripts["verify:v2-189-0"], "verify:v2-189-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.190.0] The drill-down ranks its payrolls"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.190.0]") < changelog.indexOf("## [2.189.0]"), "2.190.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.190.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The drill-down ranks its payrolls'"), "whats-new title missing");
  assert(feed.indexOf("2.190.0") < feed.indexOf("2.189.0"), "2.190.0 is not the feed head");
});

check("the lib: the rank ladder is total and uppercase-exact", () => {
  const lib = read("src/lib/org/hr-drilldown-sort.ts");
  assert(lib.includes("export function payrollStatusRank(status: string): number"), "the rank fn missing");
  assert(lib.includes("if (status === 'LOCKED' || status === 'POSTED') return 4;"), "the shared top rank missing");
  assert(lib.includes("if (status === 'APPROVED') return 3;"), "APPROVED rung missing");
  assert(lib.includes("if (status === 'DRAFT') return 2;"), "DRAFT rung missing");
  assert(lib.includes("if (status === 'VOIDED') return 1;"), "VOIDED rung missing");
  assert(lib.includes("return 0;"), "the unknown fallback missing");
  assert(lib.includes("export const HR_DRILL_RANK_COLUMNS = ['payroll'] as const;"), "the rank category missing");
  assert(lib.includes("export const HR_DRILL_TEXT_COLUMNS = ['branch'] as const;"), "payroll still in TEXT");
});

check("the lib: the payroll sort speaks the rank language", () => {
  const lib = read("src/lib/org/hr-drilldown-sort.ts");
  assert(lib.includes("const rank = mul * (payrollStatusRank(ra.status) - payrollStatusRank(rb.status));"), "the rank primary axis missing");
  assert(lib.includes("const ta = Date.parse(ra.createdAt) || 0;"), "the directional recency tie missing");
  assert(lib.includes("return mul * ra.periodName.localeCompare(rb.periodName);"), "the periodName final tie missing");
  assert(lib.includes("(HR_DRILL_RANK_COLUMNS as readonly string[]).includes(key)"), "the rank default dir missing");
  assert(lib.includes("if (missingA) return 1;"), "the missing-last rule moved");
  assert(lib.includes("if (missingB) return -1;"), "the missing-last rule moved");
});

check("the component: the honest hint rides the driven header", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("title={c.hint}"), "the hint render missing");
  assert(oc.includes("Sorts by run finality: locked & posted first, then approved, draft, voided."), "the hint copy missing");
  assert(oc.includes("Click again for the mirror (least final first). Branches with no runs sort last."), "the mirror + absence copy missing");
  assert(oc.includes("hint?: string;"), "the col-def hint field missing");
  assert(oc.includes("() => (summary?.hrPerStore ? sortHrDrillRows(summary.hrPerStore, hrSort) : []),"), "the ONE sorted memo moved");
});

check("the a11y surfaces: the avatar-hue family carries its numbers", () => {
  const script = read("scripts/contrast-math-avatar-hues-v2190.mjs");
  assert(script.includes("node_modules/tailwindcss/theme.css"), "the installed-theme source missing");
  assert(script.includes("'calm'"), "the calm stack missing");
  assert(script.includes("'hover'"), "the hover stack missing");
  assert(script.includes("'drilled'"), "the drilled stack missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the desk roster's avatar-hue family (v2.190.0)"), "the doc section missing");
  assert(doc.includes("24/24"), "the verdict missing");
  assert(doc.includes("4.54:1"), "the tightest corner missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/hr-drilldown-rank-v2190.test.ts");
  assert(suite.includes("the drill-down ranks its payrolls"), "suite header missing");
  assert(suite.includes("expect(payrollStatusRank('LOCKED')).toBe(4);"), "the rank pin missing");
  assert(suite.includes("'new-period-early-year', 'old-period-late-year'"), "the recency-trap pin missing");
  assert(suite.includes("package.json rides at 2.190.0"), "the version pin missing");
});

check("the v2.183.0 suite evolved deliberately, not silently", () => {
  const suite = read("src/tests/hr-drilldown-prefs-v2183.test.ts");
  assert(suite.includes("v2.190.0 pin evolution (deliberate)"), "the reasoning comments missing");
  assert(suite.includes("expect(defaultDirFor('payroll')).toBe('desc');"), "the default-direction pin missing");
  assert(suite.includes("expect([...HR_DRILL_TEXT_COLUMNS]).toEqual(['branch']);"), "the vocabulary pin missing");
});

check("the counters are re-anchored to the new head", () => {
  const counter = read("src/tests/console-changelog.test.ts");
  assert(counter.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(79);"), "the 79 counter missing");
  assert(counter.includes("Re-anchored for 2.190.0 joining the feed."), "the re-anchor note missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
