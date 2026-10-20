#!/usr/bin/env node
// v2.167.0 verification — "the hints reach the keyboard".
// Fresh-written (lesson 25). Pins the keyboard-reachable hint contract
// (focusable hinted chips, family-colored focus rings, three sr-only
// copies), the single-source failedTickTooltip helper and its honesty
// guards, the nine-row register drift pin, the doc notes, and the API's
// on-the-record assessment (still read-only). Comment-strip per lesson 49.
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

const ALL_NAMES = ['outbox', 'payments-sweeper', 'etims-retry', 'debt-reminders', 'b2c-recovery', 'session-reaper', 'reconciliation', 'retention', 'hr-report-digests'];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

check("version: package.json leads 2.167.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.167.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.167.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.167.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-167-0"], "verify:v2-167-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.167.0] The hints reach the keyboard"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.167.0'"), "whats-new head missing");
  assert(feed.indexOf("2.167.0") < feed.indexOf("2.166.0"), "2.167.0 is not the feed head");
});

check("counters re-anchored (56/57/58/89)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(56)"), "2.110.0 anchor not 56");
  assert(t.includes("toBe(89)"), "2.77.0 anchor not 89");
  assert(t.includes("Re-anchored for 2.167.0 joining the feed."), "re-anchor comment missing");
});

check("hinted chips are focusable; unhinted never become dead tab stops", () => {
  const c = stripComments(read("src/components/workspace/org-console.tsx"));
  assert(c.includes("tabIndex={AUTOMATION_SUBJOB_HINTS[job.name] ? 0 : undefined}"), "chip tabIndex conditional missing");
  assert(c.includes("tabIndex={failedTickTooltip(automation) ? 0 : undefined}"), "pill tabIndex conditional missing");
});

check("focus rings are family-colored and full-opacity (contrast discipline extends to focus)", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"), "emerald focus ring missing");
  assert(c.includes("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1"), "red focus ring missing");
  const cardStart = c.indexOf('data-testid="automation-card"');
  const card = c.slice(cardStart, c.indexOf('Recent audit events', cardStart));
  assert(!card.includes("/50"), "card gained an alpha family");
  assert(!/text-(emerald|red|amber)-600/.test(card), "card gained a text-*-600 family break");
});

check("the failed-tick sentence is computed once and rides both surfaces", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert((c.match(/Failed ticks: /g) || []).length === 1, "the sentence must live only in the helper");
  assert(c.includes("function failedTickTooltip(automation: AutomationSummary): string | undefined"), "helper signature missing");
  assert(c.includes("title={failedTickTooltip(automation)}"), "title not fed by the helper");
  assert(c.includes('<span className="sr-only">{failedTickTooltip(automation)}</span>'), "sr-only pill copy missing");
  const helper = c.split("function failedTickTooltip(automation: AutomationSummary)")[1].split("function findDiagnosticFor")[0];
  assert(helper.includes("if (!automation.failedTickStamps || automation.failedTickStamps.length === 0)"), "absent-stamps guard missing");
  assert(helper.includes(".map((s) => formatEatStamp(new Date(s)))"), "EAT mapping missing");
  assert(helper.includes("automation.lastTick.failedCount > automation.failedTickStamps.length"), "and-N-more comparison missing");
});

check("the ownership line rides an sr-only copy, guarded by the same lookup", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes('<span className="sr-only"> — {AUTOMATION_SUBJOB_HINTS[job.name]}</span>'), "chip sr-only copy missing");
});

check("the last-tick exact stamp reaches the screen-reader line", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("(recorded {formatEatStamp(new Date(automation.lastTick.at))})"), "last-tick sr-only stamp missing");
});

check("the register closes over all nine (drift pin, both directions)", () => {
  const doc = read("docs/cron-operations.md");
  assert(doc.includes("## The sub-jobs (nine, as of v2.167.0)"), "nine-row heading missing");
  for (const n of ALL_NAMES) assert(doc.includes(`| \`${n}\` |`), `register row missing: ${n}`);
  assert(doc.includes("The hints reach the keyboard (v2.167.0)"), "keyboard note missing");
  assert(doc.includes("never a dead tab stop"), "dead-tab-stop honesty note missing");
});

check("the stamps-via-metadata assessment is on the record; the read stays read-only", () => {
  const a = read("src/app/api/org/automation/route.ts");
  assert(a.includes("v2.167.0 assessment (built nowhere, kept here)"), "dated assessment comment missing");
  assert(a.includes("The separate findMany stays: format-agnostic, same window,"), "keep-decision missing");
  const findMany = a.split("rawDb.systemLog.findMany({")[1].split("}),")[0];
  assert(findMany.includes("action: PARTIAL_FAILURE_ACTION"), "findMany window drifted");
  assert(findMany.includes("take: 10"), "take-10 cap drifted");
  assert(!/\.(create|update|delete|upsert|updateMany|deleteMany)\(/.test(a), "read-only broken");
});

check("the v2166 suite is re-anchored with a dated note", () => {
  const t = read("src/tests/chip-hints-v2166.test.ts");
  assert(t.includes("## The sub-jobs (nine, as of v2.167.0)"), "v2166 heading pin not re-anchored");
  assert(t.includes("v2.167.0 re-anchor (dated)"), "dated re-anchor note missing");
});

console.log(`\nverify-v2-167-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
