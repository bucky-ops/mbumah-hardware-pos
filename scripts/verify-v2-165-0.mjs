#!/usr/bin/env node
// v2.165.0 verification — "every heartbeat writes its ledger".
// Fresh-written (lesson 25). Pins the nightly reaper fold, the nightly
// always-row, the dispatcher identity on both dispatchers' ledger rows,
// the tolerant API read, the card's EAT tooltip + source label, and the
// cron doc's two-read arming verification.
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
// lesson 49: strip comments before a not.toContain — prose legitimately
// names what the code must not.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

check("version: package.json leads 2.165.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.165.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.165.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.165.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-165-0"], "verify:v2-165-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.165.0] Every heartbeat writes its ledger"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.165.0'"), "whats-new head missing");
  assert(feed.indexOf("2.165.0") < feed.indexOf("2.164.0"), "2.165.0 is not the feed head");
});

check("counters re-anchored (54/55/56/87)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(54)"), "2.110.0 anchor not 54");
  assert(t.includes("toBe(87)"), "2.77.0 anchor not 87");
  assert(t.includes("Re-anchored for 2.165.0 joining the feed."), "re-anchor comment missing");
});

check("the nightly dispatcher folds the reaper and writes its always-row", () => {
  const n = read("src/app/api/cron/nightly/route.ts");
  assert(n.includes("import { GET as sessionReaperGET } from '@/app/api/cron/session-reaper/route';"), "reaper import missing");
  assert(n.includes("{ name: 'session-reaper', run: () => sessionReaperGET(request) }"), "reaper fold missing");
  assert(n.includes("expiresAt only, never lastActiveAt"), "scope rule comment missing");
  assert(n.includes("idempotent"), "idempotency rationale missing");
  // the identical ledgerEntry contract
  assert(n.includes("function ledgerEntry("), "ledgerEntry missing");
  const fn = n.split("function ledgerEntry(")[1].split("async function nightlyCronHandler")[0];
  assert(fn.includes("typeof deleted === 'number'"), "number guard missing");
  assert(fn.includes("Number.isFinite(deleted)"), "finite guard missing");
  assert(fn.includes("deleted >= 0"), "non-negative guard missing");
  assert(fn.includes("...(carryDeleted ? { deleted } : {})"), "spread-omit missing");
  // the always-row names its heartbeat
  assert(n.includes("action: 'CRON_DISPATCH_TICK'"), "tick row missing");
  assert(n.includes("severity: LogSeverity.INFO"), "INFO severity missing");
  assert(n.includes("metadata: { dispatcher: 'nightly', results: ledgerResults }"), "nightly identity missing");
  assert(n.includes("Nightly cron tick recorded:"), "nightly message missing");
});

check("the hourly dispatcher stamps its identity on both ledger rows", () => {
  const d = read("src/app/api/cron/hourly/route.ts");
  assert((d.match(/metadata: \{ dispatcher: 'hourly', results: ledgerResults \}/g) || []).length === 2, "both hourly rows must carry the identity");
  // hourly keeps its own reaper fold (comments stripped per lesson 49)
  const body = stripComments(d);
  assert(body.includes("{ name: 'session-reaper', run: () => sessionReaperGET(request) }"), "hourly reaper fold lost");
});

check("the automation API reads the dispatcher tolerantly", () => {
  const a = read("src/app/api/org/automation/route.ts");
  assert(a.includes("let tickDispatcher: string | undefined;"), "dispatcher slot missing");
  assert(a.includes("typeof rawDispatcher === 'string' && rawDispatcher.length > 0"), "honest string guard missing");
  assert(a.includes("...(tickDispatcher ? { dispatcher: tickDispatcher } : {}),"), "spread-omit missing");
  const writes = a.match(/\.(create|update|delete|upsert|updateMany|deleteMany)\(/g);
  assert(writes === null, "the read must stay read-only");
});

check("the card: exact EAT stamp tooltip + honest source label", () => {
  const c = read("src/components/workspace/org-console.tsx");
  assert(c.includes("import { formatEatStamp } from '@/lib/hr/payroll/payslip-bundle';"), "formatEatStamp import missing");
  assert(c.includes("title={`Tick recorded ${formatEatStamp(new Date(automation.lastTick.at))}`}"), "tooltip missing");
  assert(c.includes('data-testid="automation-tick-source"'), "source label missing");
  assert(c.includes("· {automation.lastTick.dispatcher} dispatcher"), "source text missing");
  const iface = c.split("interface AutomationSummary {")[1].split("} | null;")[0];
  assert(iface.includes("dispatcher?: string;"), "interface field missing");
  // the card's contrast discipline holds across the new surfaces
  const cardStart = c.indexOf('data-testid="automation-card"');
  const card = c.slice(cardStart, c.indexOf('Recent audit events', cardStart));
  assert(!card.includes("/50"), "an alpha family entered the card");
  assert(!/text-(emerald|red|amber)-600/.test(card), "a bare -600 entered the card");
});

check("cron-operations.md: arming verification + both writers + fold rule", () => {
  const d = read("docs/cron-operations.md");
  assert(d.includes("### Verifying the arming (two reads, five minutes, v2.165.0)"), "arming verification missing");
  assert(d.includes("Arming is not done until it is OBSERVED done"), "observed-done rule missing");
  assert(d.includes("## The tick ledger (v2.159.0, extended v2.164.0 + v2.165.0)"), "ledger section stale");
  assert(d.includes("**v2.165.0**: BOTH dispatchers write the ledger."), "both-writers note missing");
  assert(d.includes("rides BOTH dispatchers since v2.165.0"), "sub-job table stale");
  assert(d.includes("idempotent jobs only"), "fold rule missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
