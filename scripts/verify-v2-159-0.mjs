#!/usr/bin/env node
// v2.159.0 verification — "the dispatcher keeps its hours".
// Fresh-written (lesson 25). Pins the hourly pinger workflow, the tick
// ledger, the automation read, the org card, and the trend style fix.
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

check("version: package.json leads 2.159.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.159.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.159.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.159.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-159-0"], "verify:v2-159-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.159.0] The dispatcher keeps its hours"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.159.0'"), "whats-new head missing");
  assert(feed.indexOf("2.159.0") < feed.indexOf("2.158.0"), "2.159.0 is not the feed head");
});

check("counters re-anchored (48/49/50/81)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(48)"), "2.110.0 anchor not 48");
  assert(t.includes("toBe(81)"), "2.77.0 anchor not 81");
});

check("the cron-hourly workflow pings production hourly with the secret", () => {
  const wf = read(".github/workflows/cron-hourly.yml");
  assert(wf.includes("cron: \"0 * * * *\""), "hourly schedule missing");
  assert(wf.includes("workflow_dispatch"), "manual trigger missing");
  assert(wf.includes("x-cron-secret: ${CRON_SECRET}"), "secret header missing");
  assert(wf.includes("secrets.PROD_URL"), "PROD_URL secret missing");
  assert(wf.includes("body.success !== true"), "payload success check missing");
  assert((wf.match(/exit 1/g) || []).length >= 2 && (wf.match(/process\.exit\(1\)/g) || []).length >= 3, "honest failure exits missing");
});

check("the dispatcher writes the tick ledger on every dispatch", () => {
  const r = read("src/app/api/cron/hourly/route.ts");
  assert(r.includes("action: 'CRON_DISPATCH_TICK'"), "tick ledger missing");
  assert(r.includes("severity: LogSeverity.INFO"), "ledger not INFO");
  const tickIdx = r.indexOf("action: 'CRON_DISPATCH_TICK'");
  assert(r.slice(tickIdx, tickIdx + 700).includes("results.map((r) => ({ name: r.name, ok: r.ok, status: r.status }))"), "ledger lacks the results map");
  // the partial-failure WARN survives for severity filtering
  assert(r.includes("action: 'CRON_DISPATCH_PARTIAL_FAILURE'"), "partial-failure WARN lost");
});

check("GET /api/org/automation honors the org contract and stays read-only", () => {
  const r = read("src/app/api/org/automation/route.ts");
  assert(r.includes("['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT']"), "ORG_ROLES missing");
  assert(r.includes("requireAuth(orgAutomationHandler, { roles: ORG_ROLES })"), "guard not wired");
  assert(r.includes("runWithoutTenant"), "org-wide read missing");
  assert(!/\.(create|update|delete|upsert|updateMany|deleteMany)\(/.test(r), "write call found in read-only route");
  assert(r.includes("Boolean(process.env.CRON_SECRET)"), "secret posture missing");
  assert(r.includes("7 * 24 * 60 * 60 * 1000"), "7-day tail missing");
});

check("the org console carries the Automation pulse card (all honest states)", () => {
  const c = read("src/components/workspace/org-console.tsx");
  for (const tid of ["automation-card", "automation-secret-posture", "automation-retry", "automation-error", "automation-empty", "automation-last-tick", "automation-failed-count", "automation-subjob-chip", "automation-cadence-line"]) {
    assert(c.includes(`data-testid="${tid}"`), `testid ${tid} missing`);
  }
  assert(c.includes("authorizedFetchJson('/api/org/automation')"), "ledger fetch missing");
  assert(c.includes("No dispatch has been recorded yet"), "empty state missing");
  assert(c.includes("this is a read failure, not a dispatch failure"), "honest error copy missing");
  // contrast families on the card
  const cardStart = c.indexOf('data-testid="automation-card"');
  const card = c.slice(cardStart, c.indexOf("Recent audit events", cardStart));
  assert(card.includes("text-emerald-700") && card.includes("text-red-700") && card.includes("text-amber-700"), "contrast families missing");
  assert(!/text-(emerald|red|amber)-600/.test(card), "bare -600 text found on the card");
});

check("the POS trend affordance reads at 9px (the style fix)", () => {
  const s = read("src/components/pos/dashboard-stats.tsx");
  assert(s.includes('text-[9px] text-muted-foreground" aria-hidden="true"'), "arrow alpha fix missing");
  assert(!s.includes("text-muted-foreground/50\">→"), "the /50 arrow survived");
  assert(s.includes("'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'"), "trend red-700 missing");
  assert(!s.includes("text-red-600 dark:text-red-400"), "the knife-edge red-600 survived");
});

check("the cron operations doc tells the story in order", () => {
  const d = read("docs/cron-operations.md");
  assert(d.includes("v2.16.0"), "the 401 wall missing");
  assert(d.includes("v2.158.0"), "the pass-through missing");
  assert(d.includes("cron-hourly.yml"), "pinger missing");
  assert(d.includes("CRON_DISPATCH_TICK"), "ledger missing");
  assert(d.includes("must stay idempotent"), "idempotency contract missing");
});

check("the round's test file rides the suite", () => {
  const t = read("src/tests/cron-pulse-v2159.test.ts");
  const count = (t.match(/\bit\(/g) || []).length;
  assert(count === 20, `expected 20 tests, found ${count}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
