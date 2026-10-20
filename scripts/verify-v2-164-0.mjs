#!/usr/bin/env node
// v2.164.0 verification — "the pulse speaks the reaper".
// Fresh-written (lesson 25). Pins the ledger promotion (dispatcher →
// automation API → org card chip + header pill), the cron doc's six
// sub-job register, and the spec parity appendix.
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

check("version: package.json leads 2.164.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.164.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.164.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.164.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-164-0"], "verify:v2-164-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.164.0] The pulse speaks the reaper"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.164.0'"), "whats-new head missing");
  assert(feed.indexOf("2.164.0") < feed.indexOf("2.163.0"), "2.164.0 is not the feed head");
});

check("counters re-anchored (53/54/55/86)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(53)"), "2.110.0 anchor not 53");
  assert(t.includes("toBe(86)"), "2.77.0 anchor not 86");
  assert(t.includes("Re-anchored for 2.164.0 joining the feed."), "re-anchor comment missing");
});

check("the dispatcher's ledgerEntry promotes the count honestly", () => {
  const d = read("src/app/api/cron/hourly/route.ts");
  assert(d.includes("function ledgerEntry("), "ledgerEntry missing");
  const fn = d.split("function ledgerEntry(")[1].split("async function dispatchAll")[0];
  assert(fn.includes("typeof deleted === 'number'"), "number guard missing");
  assert(fn.includes("Number.isFinite(deleted)"), "finite guard missing");
  assert(fn.includes("deleted >= 0"), "non-negative guard missing");
  assert(fn.includes("...(carryDeleted ? { deleted } : {})"), "spread-omit missing");
  assert(d.includes("const ledgerResults = results.map(ledgerEntry);"), "mapping missing");
  assert((d.match(/metadata: \{ results: ledgerResults \}/g) || []).length === 2, "both ledger rows must use the promoted entries");
  assert(!d.includes("results.map((r) => ({ name: r.name, ok: r.ok, status: r.status }))"), "old inline mapping still present");
  assert(d.includes("SO THE PULSE CAN SPEAK IT"), "docstring rationale missing");
});

check("the automation API guard accepts honest absence or real numbers", () => {
  const a = read("src/app/api/org/automation/route.ts");
  assert(a.includes("deleted?: number;"), "optional field missing");
  // The guard destructures once (TS cannot narrow cast-property accesses
  // across a chain; no-non-null-assertion is house lint policy).
  const guard = a.split("const { name, ok, status, deleted } = job;")[1] || "";
  assert(guard.includes("if (deleted === undefined) return true;"), "absence acceptance missing");
  assert(guard.includes("typeof deleted === 'number'"), "number guard missing");
  assert(guard.includes("deleted >= 0"), "non-negative guard missing");
});

check("the card: chip suffix + header pill, both honest", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("data-testid=\"automation-reaped-pill\""), "header pill missing");
  assert(c.includes("(automation.lastTick.subJobs.find((j) => j.name === 'session-reaper')?.deleted ??"), "pill guard missing");
  assert(c.includes("· {job.deleted > 0 ? `reaped ${job.deleted}` : 'clean'}"), "chip suffix missing");
  assert(c.includes("dark:border-sky-700 dark:bg-sky-950 dark:text-sky-300"), "pill dark twins missing");
  const iface = c.split("interface AutomationSubJob {")[1].split("}")[0];
  assert(iface.includes("deleted?: number;"), "interface field missing");
});

check("cron-operations.md: six sub-jobs + the ledger extension", () => {
  const d = read("docs/cron-operations.md");
  assert(d.includes("## The sub-jobs (six, as of v2.163.0)"), "sub-job register missing");
  assert(d.includes("| `session-reaper` |"), "reaper row missing");
  assert(d.includes("extended v2.164.0"), "ledger extension note missing");
  assert(d.includes("never `lastActiveAt`"), "scope rule missing");
  assert(d.includes("`· reaped N` / `· clean`"), "card surface named");
});

check("payroll-run-lifecycle.md: the spec parity appendix", () => {
  const d = read("docs/payroll-run-lifecycle.md");
  assert(d.includes("## Spec parity appendix (v2.164.0)"), "appendix missing");
  assert(d.includes("| 4.1 Foundations |"), "4.1 row missing");
  assert(d.includes("| 4.6 Payroll run lifecycle"), "4.6 row missing");
  assert(d.includes("v2.19.0 (Stage G)"), "4.7 delivery missing");
  assert(d.includes("v2.20.0 (Stage H)"), "4.8 delivery missing");
  assert(d.includes("every row cites a RELEASE that shipped"), "parity rule missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
