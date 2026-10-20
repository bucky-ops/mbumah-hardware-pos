#!/usr/bin/env node
// v2.166.0 verification — "the chips explain themselves".
// Fresh-written (lesson 25). Pins the sub-job hint map (all nine names,
// never-invent rule), the chip tooltip + cursor-help affordance, the
// failed-tick stamps API (take 10, same window, read-only), the card's
// EAT/and-N-more pill tooltip, and both doc notes.
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

check("version: package.json leads 2.166.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.166.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.166.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.166.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-166-0"], "verify:v2-166-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.166.0] The chips explain themselves"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.166.0'"), "whats-new head missing");
  assert(feed.indexOf("2.166.0") < feed.indexOf("2.165.0"), "2.166.0 is not the feed head");
});

check("counters re-anchored (55/56/57/88)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(55)"), "2.110.0 anchor not 55");
  assert(t.includes("toBe(88)"), "2.77.0 anchor not 88");
  assert(t.includes("Re-anchored for 2.166.0 joining the feed."), "re-anchor comment missing");
});

check("the hint map covers exactly the nine names", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("const AUTOMATION_SUBJOB_HINTS: Record<string, string> = {"), "hint map missing");
  const map = c.split("const AUTOMATION_SUBJOB_HINTS: Record<string, string> = {")[1].split("};")[0];
  const keys = [...map.matchAll(/^\s+'?([a-z0-9-]+)'?:/gm)].map((m) => m[1]);
  for (const n of ALL_NAMES) assert(keys.includes(n), `missing hint key: ${n}`);
  assert(keys.length === ALL_NAMES.length, `map has ${keys.length} keys, expected ${ALL_NAMES.length}`);
  assert(c.includes("the card never invents ownership for a sub-job it has"), "never-invent rule missing");
});

check("the chip wears the tooltip and the affordance", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("title={AUTOMATION_SUBJOB_HINTS[job.name]}"), "chip title missing");
  assert((c.match(/' cursor-help'/g) || []).length === 2, "conditional cursor-help must appear in both color families");
});

check("the API returns the failed-tick stamps (take 10, same window, read-only)", () => {
  const a = read("src/app/api/org/automation/route.ts");
  assert(a.includes("rawDb.systemLog.findMany({"), "findMany missing");
  const findMany = a.split("rawDb.systemLog.findMany({")[1].split("}),")[0];
  assert(findMany.includes("action: PARTIAL_FAILURE_ACTION"), "wrong action");
  assert(findMany.includes("createdAt: { gte: since }"), "window mismatch");
  assert(findMany.includes("orderBy: { createdAt: 'desc' }"), "order missing");
  assert(findMany.includes("take: 10"), "cap missing");
  assert(a.includes("const failedTickStamps = failedTicks.map((r) => r.createdAt.toISOString());"), "stamp mapping missing");
  assert(a.includes("failedTickStamps,"), "response field missing");
  const writes = a.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
  assert(writes === null, "the read must stay read-only");
});

check("the card tooltip: EAT stamps + honest and-N-more + honest absence", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes(".map((s) => formatEatStamp(new Date(s)))"), "EAT mapping missing");
  assert(c.includes("automation.lastTick.failedCount > automation.failedTickStamps.length"), "cap comparison missing");
  assert(c.includes("more`"), "and-N-more suffix missing");
  assert(c.includes(": undefined"), "honest absence missing");
  const iface = c.split("interface AutomationSummary {")[1].split("secretConfigured")[0];
  assert(iface.includes("failedTickStamps?: string[];"), "interface field missing");
});

check("cron-operations.md: both rosters + the heartbeat surfaces", () => {
  const d = read("docs/cron-operations.md");
  assert(d.includes("BOTH dispatchers carry sub-jobs (v2.166.0 note)"), "cadence note missing");
  assert(d.includes("the hourly carries SIX"), "hourly count missing");
  assert(d.includes("the nightly carries FOUR"), "nightly count missing");
  assert(d.includes('the sub-job chips carry a one-line "what this sub-job owns"'), "chip hint note missing");
  assert(d.includes('capped at 10 with an honest "and N more"'), "pill cap note missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
