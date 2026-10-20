#!/usr/bin/env node
// v2.192.0 verification — "the drill-down opens the alerts".
// Fresh-written per the house convention. Pins the release end to end:
// the two role-gated doors (the shared builders, the drill-down testid
// vocabulary, the spoken labels, the house affordance), the honest
// degradation ladder (gated-out roles keep the plain sum, zero halves
// never links), the CSV's sum shape, the desk digest's contrast-math
// surfaces (script + doc, the ground asserted from the component), and
// the release surfaces. Comment-strip per lesson 49; comment-text pins
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

check("version: package.json leads 2.192.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.192.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.192.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.192.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-192-0"], "verify:v2-192-0 script missing");
  assert(pkg.scripts["verify:v2-191-0"], "verify:v2-191-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.192.0] The drill-down opens the alerts"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.192.0]") < changelog.indexOf("## [2.191.0]"), "2.192.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.192.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The drill-down opens the alerts'"), "whats-new title missing");
  assert(feed.indexOf("2.192.0") < feed.indexOf("2.191.0"), "2.192.0 is not the feed head");
});

check("the gates: the shared panel contract is the ONE source", () => {
  const cfg = read("src/lib/app-config.ts");
  assert(cfg.includes("EMPLOYEE_LIST_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER', 'BRANCH_MANAGER']"), "the employees gate drifted");
  assert(cfg.includes("ASSET_LIST_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER']"), "the assets gate drifted");
  const links = read("src/lib/workspace/links.ts");
  assert(links.includes("export function buildExpiringEmployeesHref(storeId: string, days = 90): string"), "the docs builder missing");
  assert(links.includes("export function buildOverdueAssetsHref(storeId: string): string"), "the assets builder missing");
});

check("the component: the alerts cell speaks the split vocabulary", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("href={buildExpiringEmployeesHref(row.storeId)}"), "the docs door href missing");
  assert(oc.includes("href={buildOverdueAssetsHref(row.storeId)}"), "the assets door href missing");
  assert(oc.includes('data-testid="org-console-hr-docs-door"'), "the docs door testid missing");
  assert(oc.includes('data-testid="org-console-hr-assets-door"'), "the assets door testid missing");
  assert(oc.includes("const canOpenDocs = EMPLOYEE_LIST_READ_ROLES.includes(role);"), "the docs gate missing");
  assert(oc.includes("const canOpenAssets = ASSET_LIST_READ_ROLES.includes(role);"), "the assets gate missing");
  assert(oc.includes("a door that 403s is a"), "the honesty rationale missing");
  assert(oc.includes("hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"), "the door affordance missing");
  assert(oc.includes("Overdue asset assignments: ${assets} — see the Assets page"), "the gated assets fallback moved");
  assert(oc.includes("alerts > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground'"), "the plain fallback voice moved");
  assert(oc.includes("title={title}"), "the breakdown title missing");
});

check("the prior doors and sorts ride untouched", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("href={buildRunDeepLinkHref(row.latestPayroll.runId)}"), "the run door moved");
  assert(oc.includes('data-testid="org-console-hr-run-door"'), "the run door testid moved");
  assert(oc.includes("title={c.hint}"), "the rank hint moved");
  const panel = read("src/components/finance/people-payroll-by-branch.tsx");
  assert(panel.includes('data-testid="people-payroll-expiry-door"'), "the shared panel's own docs door moved");
  assert(panel.includes('data-testid="people-payroll-assets-door"'), "the shared panel's own assets door moved");
});

check("the CSV: doors do not belong in files", () => {
  const csv = read("src/lib/org/branches-csv.ts");
  assert(!csv.includes("buildExpiringEmployeesHref"), "the CSV lib carries the docs builder");
  assert(!csv.includes("buildOverdueAssetsHref"), "the CSV lib carries the assets builder");
  assert(csv.includes("'Expiry alerts (90d docs + overdue assets)'"), "the CSV sum column drifted");
});

check("the a11y surfaces: the digest families carry their numbers", () => {
  const script = read("scripts/contrast-math-digest-avatars-v2192.mjs");
  assert(script.includes("src/components/org/panels.tsx"), "the ground source missing");
  assert(script.includes("dark:bg-slate-900"), "the literal ground assertion missing");
  assert(script.includes("'PENDING'") && script.includes("'CANCELLED'"), "the status chips missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the desk digest's avatar + status-chip families (v2.192.0)"), "the doc section missing");
  assert(doc.includes("36/36"), "the verdict missing");
  assert(doc.includes("4.55:1"), "the tightest status corner missing");
  assert(doc.includes("the transfer is now proven, not assumed"), "the transfer note missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/hr-alerts-doors-v2192.test.ts");
  assert(suite.includes("the drill-down opens the alerts"), "suite header missing");
  assert(suite.includes("buildOverdueAssetsHref('store-1')"), "the builder execution pin missing");
  assert(suite.includes("package.json rides at 2.192.0"), "the version pin missing");
});

check("the counters are re-anchored to the new head", () => {
  const counter = read("src/tests/console-changelog.test.ts");
  assert(counter.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(81);"), "the 81 counter missing");
  assert(counter.includes("Re-anchored for 2.192.0 joining the feed."), "the re-anchor note missing");
  const shell = read("src/tests/a11y-shell-v2148.test.ts");
  assert(shell.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(81);"), "the a11y-shell meta-pin drifted");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
