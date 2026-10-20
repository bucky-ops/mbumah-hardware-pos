#!/usr/bin/env node
// v2.191.0 verification — "the drill-down opens the run".
// Fresh-written per the house convention. Pins the release end to end:
// the run-detail door (the shared builder, the testid, the spoken label,
// the recorded timestamp, the house affordance), the honest degradation
// (no runId → the plain text, never a dead link), the CSV's no-runId
// shape, the status-badge contrast-math surfaces (script + doc), and the
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

check("version: package.json leads 2.191.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.191.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.191.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.191.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-191-0"], "verify:v2-191-0 script missing");
  assert(pkg.scripts["verify:v2-190-0"], "verify:v2-190-0 script missing (the prior surface must stay wired)");
});

check("release surfaces speak the version", () => {
  const changelog = read("CHANGELOG.md");
  assert(changelog.includes("## [2.191.0] The drill-down opens the run"), "CHANGELOG head missing");
  assert(changelog.indexOf("## [2.191.0]") < changelog.indexOf("## [2.190.0]"), "2.191.0 is not the changelog head");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.191.0'"), "whats-new head missing");
  assert(feed.includes("title: 'The drill-down opens the run'"), "whats-new title missing");
  assert(feed.indexOf("2.191.0") < feed.indexOf("2.190.0"), "2.191.0 is not the feed head");
});

check("the component: the door rides the shared builder", () => {
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("buildRunDeepLinkHref"), "the shared builder not imported");
  assert(oc.includes('href={buildRunDeepLinkHref(row.latestPayroll.runId)}'), "the door href missing");
  assert(oc.includes('data-testid="org-console-hr-run-door"'), "the door testid missing");
  assert(oc.includes("aria-label={`Open the payroll run detail for ${row.latestPayroll.periodName} — ${row.storeName}`}"), "the spoken label missing");
  assert(oc.includes("title={`Open the ${row.latestPayroll.periodName} run detail (recorded"), "the timestamp title missing");
  assert(oc.includes('runId?: string;'), "the tolerant type field missing");
  assert(oc.includes('const statusBadge = ('), "the badge-as-value refactor missing");
  assert(oc.includes('never a dead link, never a guessed href'), "the degradation rationale missing");
  assert(oc.includes('<span className="text-xs text-muted-foreground">no runs yet</span>'), "the no-run fallback moved");
  assert(oc.includes('hover:text-orange-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400'), "the door affordance missing");
});

check("the CSV: doors do not belong in files", () => {
  const csv = read("src/lib/org/branches-csv.ts");
  assert(!csv.includes("runId"), "the CSV lib carries runId");
  const oc = read("src/components/workspace/org-console.tsx");
  assert(oc.includes("? { periodName: r.latestPayroll.periodName, status: r.latestPayroll.status }"), "the CSV map no longer strips runId");
});

check("the a11y surfaces: the badge families carry their numbers", () => {
  const script = read("scripts/contrast-math-drilldown-badges-v2191.mjs");
  assert(script.includes("src/app/globals.css"), "the card token source missing");
  assert(script.includes("'emerald-950'), 0.4"), "the emerald alpha missing");
  assert(script.includes("'amber-950'), 0.4"), "the amber alpha missing");
  assert(script.includes("'slate-900'), 0.6"), "the slate alpha missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("the drill-down's status-badge families (v2.191.0)"), "the doc section missing");
  assert(doc.includes("6/6"), "the verdict missing");
  assert(doc.includes("12.20:1"), "the widest margin missing");
});

check("the suite exists and pins the contract", () => {
  const suite = read("src/tests/hr-run-door-v2191.test.ts");
  assert(suite.includes("the drill-down opens the run"), "suite header missing");
  assert(suite.includes("buildRunDeepLinkHref('cmvf2sfxj0005slvo34wut2cw')"), "the builder execution pin missing");
  assert(suite.includes("package.json rides at 2.191.0"), "the version pin missing");
});

check("the counters are re-anchored to the new head", () => {
  const counter = read("src/tests/console-changelog.test.ts");
  assert(counter.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(80);"), "the 80 counter missing");
  assert(counter.includes("Re-anchored for 2.191.0 joining the feed."), "the re-anchor note missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
