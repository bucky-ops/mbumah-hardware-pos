#!/usr/bin/env node
// v2.169.0 verification — "the pill names the heartbeat".
// Fresh-written (lesson 25). Pins the parallel failedTickDispatchers read
// (tolerant, standardized-field-only), the card's parenthetical contract
// with the v2.167.0 helper pins preserved verbatim, the doc note, the
// contrast-math deliverable, and the release surfaces. Comment-strip per
// lesson 49.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`[PASS] ${name}`); }
  catch (e) { fail++; console.log(`[FAIL] ${name}\n       ${e.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

check("version: package.json leads 2.169.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.169.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.169.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.169.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-169-0"], "verify:v2-169-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.169.0] The pill names the heartbeat"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.169.0'"), "whats-new head missing");
  assert(feed.indexOf("2.169.0") < feed.indexOf("2.168.0"), "2.169.0 is not the feed head");
});

check("counters re-anchored (58/59/60/91)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(58)"), "2.110.0 anchor not 58");
  assert(t.includes("toBe(91)"), "2.77.0 anchor not 91");
  assert(t.includes("Re-anchored for 2.169.0 joining the feed."), "re-anchor comment missing");
});

check("the API reads the standardized field, tolerantly", () => {
  const a = read("src/app/api/org/automation/route.ts");
  const findMany = a.split("rawDb.systemLog.findMany({")[1].split("}),")[0];
  assert(findMany.includes("select: { createdAt: true, metadata: true }"), "metadata column not selected");
  assert(findMany.includes("take: 10"), "cap drifted");
  assert(a.includes("const failedTickDispatchers: (string | null)[] = failedTicks.map"), "parallel array missing");
  assert(a.includes("if (!r.metadata) return null;"), "absent-metadata guard missing");
  assert(a.includes("typeof d === 'string' && d.trim().length > 0 ? d : null"), "non-empty guard missing");
  assert(a.includes("} catch {"), "garbage guard missing");
  assert(a.includes("failedTickDispatchers,"), "response exposure missing");
  const writes = a.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
  assert(writes === null, "read-only broken");
});

check("the not-the-coupling distinction is on the record", () => {
  const a = read("src/app/api/org/automation/route.ts");
  assert(a.includes("NOT the coupling the v2.167.0 assessment"), "dated distinction missing");
  assert(a.includes("v2.167.0 assessment (built nowhere, kept here)"), "the v2.167.0 assessment itself drifted");
  assert(a.includes("The separate findMany stays: format-agnostic, same window,"), "keep-decision drifted");
});

check("the card zips by index and never guesses", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("failedTickDispatchers?: (string | null)[];"), "interface field missing");
  const helper = c.split("function failedTickTooltip(automation: AutomationSummary)")[1].split("function findDiagnosticFor")[0];
  assert(helper.includes(".map((s) => formatEatStamp(new Date(s)))"), "v2.167 stamps map drifted");
  assert(helper.includes("automation.lastTick.failedCount > automation.failedTickStamps.length"), "and-N-more comparison drifted");
  assert(helper.includes("more`"), "more-suffix drifted");
  assert(helper.includes("automation.failedTickDispatchers?.[i]"), "index zip missing");
  assert(helper.includes("typeof d === 'string' && d.length > 0 ? `${label} (${d})` : label"), "parenthetical contract missing");
  assert(c.includes('title={failedTickTooltip(automation)}'), "title surface drifted");
  assert(c.includes('tabIndex={failedTickTooltip(automation) ? 0 : undefined}'), "tab stop drifted");
  assert(c.includes('<span className="sr-only">{failedTickTooltip(automation)}</span>'), "sr-only drifted");
  assert(c.includes('data-testid="automation-failed-bubble"'), "visible bubble drifted");
});

check("the doc chronology carries v2.169.0", () => {
  const doc = read("docs/cron-operations.md");
  assert(doc.includes("The pill names the heartbeat (v2.169.0)"), "v2.169.0 note missing");
  assert(doc.includes("not the coupling the"), "distinction note missing");
  assert(doc.includes("The hints become visible (v2.168.0)"), "v2.168.0 note drifted");
  assert(doc.includes("The hints reach the keyboard (v2.167.0)"), "v2.167.0 note drifted");
});

check("the muted-button family is computed-passing, numbers recorded", () => {
  assert(existsSync(join(process.cwd(), "scripts/contrast-math-muted-button-v169.mjs")), "math script missing");
  const doc = read("docs/a11y/contrast-math.md");
  assert(doc.includes("muted-button family (v2.169.0)"), "doc entry missing");
  for (const r of ["5.73:1", "5.53:1", "5.48:1", "5.29:1"]) {
    assert(doc.includes(r), `ratio ${r} not recorded`);
  }
  assert(doc.includes("known\nquantity") || doc.includes("known quantity"), "known-quantity closing missing");
});

check("the v2169 suite exists and the API stays a server surface", () => {
  const t = read("src/tests/pill-names-heartbeat-v2169.test.ts");
  assert(t.includes("pill names the heartbeat"), "suite header missing");
  const a = read("src/app/api/org/automation/route.ts");
  assert(a.includes("runWithoutTenant"), "tenant runner drifted");
});

console.log(`\nverify-v2-169-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
