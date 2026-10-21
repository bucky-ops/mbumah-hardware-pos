#!/usr/bin/env node
// v2.193.0 verification — "the absence cell opens the report".
// Fresh-written per the house convention. Pins the release end to end:
// the builder (the ONE writer of the composed deep link), the drill-down
// door (threshold, spoken labels, affordance), the shared panel's ONE
// AbsenceCell with its two mounts, the below-threshold calm text, the
// no-403 guard composition, the desk report's contrast-math surfaces
// (script + doc), and the release surfaces. Comment-strip per lesson 49;
// comment-text pins trimmed to survive wraps.
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

check("version: package.json leads 2.193.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.193.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.193.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.193.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-193-0"], "verify:v2-193-0 script missing");
  assert(pkg.scripts["verify:v2-192-0"], "verify:v2-192-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.193.0] The absence cell opens the report"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.193.0]") < changelog.indexOf("## [2.192.0]"), "2.193.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.193.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The absence cell opens the report'"), "whats-new title missing");
  assert(feed.indexOf("2.193.0") < feed.indexOf("2.192.0"), "2.193.0 is not the feed head");
  const doc = read("docs/multi-store-workspaces.md");
  assert(doc.includes("v2.193.0 — the absence cell opens the report"), "the workspace doc sentence missing");
});

check("the builder: the ONE writer of the composed shape", () => {
  const links = read("src/lib/workspace/links.ts");
  assert(links.includes("export function buildAbsenceReportHref(storeId: string): string"), "the builder missing");
  assert(links.includes("params.set('tab', 'absence');"), "the tab param missing");
  assert(links.includes("params.set('storeId', storeId || '');"), "the storeId param missing");
  // the destination's OWN contract: the tab key is a REPORT_TAB_KEYS member
  const page = read("src/app/(shell)/hr/reports/page.tsx");
  assert(page.includes("'absence'"), "the absence tab key missing from the reports page");
  // the guard composition: no door where it would 403
  const api = read("src/app/api/hr/reports/summary/route.ts");
  assert(api.includes("['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER']"), "the reports guard drifted");
  assert(links.includes("so the door never renders where it would 403"), "the honesty rationale missing");
});

check("the drill-down door: the amber voice becomes the affordance", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("row.monthAbsenceRatePct >= 10 ? ("), "the threshold gate missing");
  assert(oc.includes("href={buildAbsenceReportHref(row.storeId)}"), "the door href missing");
  assert(oc.includes('data-testid="org-console-hr-absence-door"'), "the door testid missing");
  assert(oc.includes("absence rate at ${row.storeName} this month — open the absence report narrowed to ${row.storeName}"), "the spoken label missing");
  assert(oc.includes("hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"), "the door affordance missing");
  assert(oc.includes("<ExternalLink className=\"h-3 w-3 shrink-0\" aria-hidden=\"true\" />"), "the glyph missing");
  assert(oc.includes("`${row.monthAbsenceRatePct}%`\n                                )}"), "the below-threshold calm text moved");
});

check("the shared panel: ONE AbsenceCell, two mounts, one vocabulary", () => {
  const panel = read("src/components/finance/people-payroll-by-branch.tsx");
  assert(panel.includes("function AbsenceCell({ row }: { row: HrPerStoreRow })"), "the shared cell missing");
  assert(panel.includes('data-testid="people-payroll-absence-door"'), "the panel door testid missing");
  const mounts = panel.split("<AbsenceCell row={row} />").length - 1;
  assert(mounts === 2, `the cell mounts ${mounts} times, not 2 (table + mobile card)`);
  assert(panel.includes("import { buildAbsenceReportHref, buildExpiringEmployeesHref, buildOverdueAssetsHref, buildRunDeepLinkHref } from '@/lib/workspace/links';"), "the panel import moved");
  assert(!panel.includes("row.monthAbsenceRatePct >= 10\n                          ? 'font-semibold"), "the OLD conditional amber voice survives");
});

check("the prior doors and sorts ride untouched", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("href={buildRunDeepLinkHref(row.latestPayroll.runId)}"), "the run door moved");
  assert(oc.includes('data-testid="org-console-hr-docs-door"'), "the docs door moved");
  assert(oc.includes('data-testid="org-console-hr-assets-door"'), "the assets door moved");
  assert(oc.includes("title={c.hint}"), "the rank hint moved");
  const panel = read("src/components/finance/people-payroll-by-branch.tsx");
  assert(panel.includes('data-testid="people-payroll-expiry-door"'), "the shared panel's own docs door moved");
  assert(panel.includes('data-testid="people-payroll-assets-door"'), "the shared panel's own assets door moved");
});

check("the CSV: doors do not belong in files", () => {
  const csv = read("src/lib/org/branches-csv.ts");
  assert(!csv.includes("buildAbsenceReportHref"), "the CSV lib carries the absence builder");
  assert(csv.includes("'Expiry alerts (90d docs + overdue assets)'"), "the CSV sum column drifted");
});

check("the a11y surfaces: the desk report families carry their numbers", () => {
  const script = read("scripts/contrast-math-desk-report-chips-v2193.mjs");
  assert(script.includes("src/components/org/desk-report-view.tsx"), "the component source missing");
  assert(script.includes("src/app/globals.css"), "the ground source missing");
  assert(script.includes("node_modules/tailwindcss/theme.css"), "the installed-theme source missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the desk report's emerald action + status families (v2.193.0)"), "the doc section missing");
  assert(doc.includes("23/23"), "the verdict missing");
  assert(doc.includes("4.55:1"), "the tightest status corner missing");
  assert(doc.includes("first numbers, not a re-run"), "the first-numbers note missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/hr-absence-door-v2193.test.ts");
  assert(suite.includes("the absence cell opens the report"), "suite header missing");
  assert(suite.includes("buildAbsenceReportHref('store-1')"), "the builder execution pin missing");
  assert(suite.includes("package.json rides at 2.193.0"), "the version pin missing");
});

check("the counters are re-anchored to the new head", () => {
  const counter = read("src/tests/console-changelog.test.ts");
  assert(counter.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(82);"), "the 82 counter missing");
  assert(counter.includes("Re-anchored for 2.193.0 joining the feed."), "the re-anchor note missing");
  const shell = read("src/tests/a11y-shell-v2148.test.ts");
  assert(shell.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(82);"), "the a11y-shell meta-pin drifted");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
