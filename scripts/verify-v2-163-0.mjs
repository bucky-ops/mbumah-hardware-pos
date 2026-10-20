#!/usr/bin/env node
// v2.163.0 verification — "the session reaps itself — and the door swings
// back". Fresh-written (lesson 25). Pins the session-hygiene sweep (the
// reaper route + dispatcher fold + pure summary) and the ?next= return
// path (validator + overlay + notes + login screen + the contrast-math
// doc).
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

check("version: package.json leads 2.163.0 (all three slots)", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.version === "2.163.0", `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === "2.163.0", `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === "2.163.0", `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts["verify:v2-163-0"], "verify:v2-163-0 script missing");
});

check("release surfaces speak the version", () => {
  assert(read("CHANGELOG.md").includes("## [2.163.0] The session reaps itself"), "CHANGELOG head missing");
  const feed = read("src/lib/whats-new.ts");
  assert(feed.includes("version: '2.163.0'"), "whats-new head missing");
  assert(feed.indexOf("2.163.0") < feed.indexOf("2.162.0"), "2.163.0 is not the feed head");
});

check("counters re-anchored (52/53/54/85)", () => {
  const t = read("src/tests/console-changelog.test.ts");
  assert(t.includes("toBe(52)"), "2.110.0 anchor not 52");
  assert(t.includes("toBe(85)"), "2.77.0 anchor not 85");
  assert(t.includes("Re-anchored for 2.163.0 joining the feed."), "re-anchor comment missing");
});

check("the reaper route: expiresAt-only delete, cross-tenant, secret-gated", () => {
  const r = read("src/app/api/cron/session-reaper/route.ts");
  // lesson 49: strip comments before the scope assertion - the docstring
  // legitimately NAMES the idle column to explain why it is out of scope.
  const body = r.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(body.includes("db.session.deleteMany({"), "deleteMany missing");
  assert(body.includes("where: { expiresAt: { lt: new Date() } }"), "expiresAt-only where missing");
  assert(!body.includes("lastActiveAt"), "reaper grew an idle opinion - scope discipline broken");
  assert(r.includes("runWithoutTenant(()"), "cross-tenant wrap missing");
  assert(r.includes("headers.get('x-cron-secret')"), "secret gate missing");
  assert(r.includes("CRON_SECRET_UNSET"), "fail-open WARN missing");
  assert(r.includes("maxDuration = 60"), "maxDuration missing");
});

check("the reaper leaves an INFO ledger row with the summary", () => {
  const r = read("src/app/api/cron/session-reaper/route.ts");
  assert(r.includes("SESSION_REAPER_LOG_ACTION"), "log action missing");
  assert(r.includes("LogSeverity.INFO"), "INFO severity missing");
  assert(r.includes("sessionReaperSummary(result.count)"), "summary wiring missing");
});

check("the pure summary: honest plurals, honest zero, no clock reads", () => {
  const m = read("src/lib/session-reaper.ts");
  assert(m.includes("export const SESSION_REAPER_LOG_ACTION = 'SESSIONS_REAPED'"), "action const missing");
  assert(m.includes("No expired sessions to reap - the session table is clean."), "honest zero missing");
  assert(m.includes("Reaped 1 expired session (its expiresAt had passed)."), "singular missing");
  const body = m.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!body.includes("Date.now()") && !body.includes("new Date()"), "module reads the clock");
  assert(!body.includes("db.") && !body.includes("fetch("), "module is not pure");
});

check("the dispatcher folds the reaper as the sixth sub-job", () => {
  const d = read("src/app/api/cron/hourly/route.ts");
  assert(d.includes("import { GET as sessionReaperGET } from '@/app/api/cron/session-reaper/route';"), "import missing");
  assert(d.includes("{ name: 'session-reaper', run: () => sessionReaperGET(request) }"), "fold missing");
  assert(d.indexOf("'session-reaper'") > d.indexOf("'b2c-recovery'"), "reaper not after b2c-recovery");
});

check("safeReturnPath: the paranoid validator lives in the idle contract", () => {
  const m = read("src/lib/session-idle.ts");
  assert(m.includes("export function safeReturnPath("), "validator missing");
  assert(m.includes("export function buildPortalReturnHref("), "href builder missing");
  assert(m.includes("path.startsWith('//')"), "protocol-relative guard missing");
  assert(m.includes("path.includes('\\\\')"), "backslash guard missing");
  assert(m.includes("/^[a-zA-Z][a-zA-Z0-9+.-]*:/"), "scheme guard missing");
  assert(m.includes("SAFE_RETURN_PATH_MAX = 512"), "length cap missing");
  const body = m.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert(!body.includes("Date.now()"), "validator reads the clock");
});

check("the overlay carries the return path and speaks the promise", () => {
  const o = read("src/components/hr/self-service-idle-watch.tsx");
  assert(o.includes("href={buildPortalReturnHref(returnPath)}"), "href not built by the validator");
  assert(o.includes("setReturnPath(window.location.pathname)"), "pathname capture missing");
  assert(o.includes('data-testid="self-idle-return-hint"'), "hint testid missing");
  assert(o.includes("Signing in brings you straight back to this page."), "hint copy missing");
});

check("the portal notes: returnPath prop + all six callers wired", () => {
  const p = read("src/app/(selfservice)/employees/me/self-portal.tsx");
  assert(p.includes("returnPath?: string;"), "PortalNote prop missing");
  assert(p.includes("portalPath?: string,"), "loadSelfPortal param missing");
  const callers = [
    ["payslips/page.tsx", "loadSelfPortal('hr.payroll.read.own', '/employees/me/payslips')"],
    ["attendance/page.tsx", "loadSelfPortal('hr.attendance.record.own', '/employees/me/attendance')"],
    ["leave/page.tsx", "loadSelfPortal('hr.leave.read.own', '/employees/me/leave')"],
    ["goals/page.tsx", "loadSelfPortal('hr.performance.read.own', '/employees/me/goals')"],
    ["documents/page.tsx", "loadSelfPortal('hr.documents.read.own', '/employees/me/documents')"],
    ["page.tsx", "loadSelfPortal('hr.payroll.read.own', '/employees/me')"],
  ];
  for (const [f, pin] of callers) {
    const src = read(`src/app/(selfservice)/employees/me/${f}`);
    assert(src.includes(pin), `${f} caller pin missing: ${pin}`);
  }
});

check("the login screen: next wins over the role default, rotation gates first", () => {
  const l = read("src/components/login-screen.tsx");
  assert(l.includes("new URLSearchParams(window.location.search).get('next')"), "next read missing");
  assert(l.includes("safeReturnPath(nextParam) ?? postLoginRedirect(flaggedUser)"), "next-wins wiring missing");
  assert(l.includes("import { safeReturnPath } from '@/lib/session-idle';"), "import missing");
  const handler = l.split("handleSubmit")[1].split("catch (err")[0];
  assert(handler.indexOf("mustChangePassword") < handler.indexOf("safeReturnPath(nextParam)"), "rotation no longer gates first");
});

check("the contrast-math doc + reference implementation are committed", () => {
  const d = read("docs/a11y/contrast-math.md");
  assert(d.includes("oklchToSrgb()"), "math reference missing");
  assert(d.includes("Badges ignore the glass"), "false-fail family 1 missing");
  assert(d.includes("Outside-card text sits on the page"), "false-fail family 2 missing");
  const s = read("scripts/contrast-audit-login.mjs");
  assert(s.includes("function oklchToSrgb"), "script implementation missing");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
