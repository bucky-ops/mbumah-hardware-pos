#!/usr/bin/env node
// v2.129.0 verification — "the ledger shows its timeline".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.129.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.129.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.129.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.129.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-129-0'], 'verify script entry missing');
});

check('whats-new: 2.129.0 leads the feed with the timeline story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.129.0'");
  assert(head > -1, 'no 2.129.0 entry');
  assert(head < wn.indexOf("version: '2.128.0'"), '2.129.0 does not lead');
  assert(wn.includes('The ledger shows its timeline'), 'title missing');
  assert(wn.includes('History button'), 'the door missing from bullets');
  assert(wn.includes('append-only'), 'append-only missing from bullets');
});

check('changelog: [2.129.0] section leads with the timeline story', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.129.0]');
  assert(head > -1, 'no [2.129.0] section');
  assert(head < cl.indexOf('## [2.128.0]'), '[2.129.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.128.0]'));
  assert(section.includes('listConsentHistory'), 'service name missing');
  assert(section.includes('stoodDays'), 'stoodDays story missing');
  assert(section.includes('append-only'), 'append-only missing');
});

// ── the service: the timeline read-back ────────────────────────────────────
check('service: listConsentHistory scope-checked, chronological, server-side clock', () => {
  const s = read('src/lib/hr/data-protection.ts');
  assert(s.includes('export async function listConsentHistory'), 'export missing');
  // the scope discipline: deleted + branch scope both ride the where
  const body = s.slice(s.indexOf('export async function listConsentHistory'), s.indexOf('async function consentTargetEmployee'));
  assert(body.includes('deletedAt: null'), 'deletedAt filter missing');
  assert(body.includes('employeeScopeWhere(session)'), 'scope where missing');
  assert(body.includes("orderBy: { grantedAt: 'asc' }"), 'chronological order missing');
  assert(body.includes('CONSENT_HISTORY_NOT_FOUND'), '404 code missing');
  assert(body.includes('86_400_000'), 'day math missing');
  // stoodDays: null while standing, floored whole days once withdrawn
  assert(body.includes('stoodDays: c.withdrawnAt ? Math.max(0, Math.floor(stoodMs / 86_400_000)) : null'), 'stoodDays fold missing');
  assert(body.includes('cycle: i + 1'), '1-based cycle missing');
});

check('service: the timeline types are exported for the drawer to mirror', () => {
  const s = read('src/lib/hr/data-protection.ts');
  assert(s.includes('export interface ConsentHistoryEvent'), 'event type missing');
  assert(s.includes('export interface ConsentHistory'), 'history type missing');
});

// ── the route: a view right, not a decision right ──────────────────────────
check('route: guard trio + dynamic param + error mapping', () => {
  const s = read('src/app/api/hr/privacy/consent/[employeeId]/history/route.ts');
  assert(s.includes("hrGuard('hr.report.branch', VIEW_ROLES)"), 'guard missing');
  assert(s.includes("['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER']"), 'view trio missing');
  assert(s.includes('await context?.params'), 'param read missing');
  assert(s.includes('toErrorResponse(error)'), 'error mapping missing');
  // read-only: no mutation verbs on the history route
  assert(!/\b(POST|PATCH|DELETE|PUT)\s*=/.test(s), 'history route must be read-only');
});

// ── the drawer: the door + the timeline ────────────────────────────────────
check('page: the History door renders for every viewer (outside canDecide)', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('data-testid="hr-privacy-consent-history-open"'), 'door testid missing');
  assert(s.includes('aria-label={`Consent history — ${r.employeeName}`}'), 'door aria missing');
  // the door must NOT live inside the decision gate: it renders before canDecide branches
  const door = s.indexOf('hr-privacy-consent-history-open');
  const decide = s.indexOf('{consent.canDecide ? (', door);
  assert(door > -1 && decide > door, 'door should precede the canDecide branch');
  assert(s.includes('variant="ghost"'), 'door should be a ghost read');
});

check('page: the drawer carries the timeline with honest states', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('data-testid="hr-privacy-consent-history"'), 'drawer testid missing');
  assert(s.includes('data-testid="hr-privacy-consent-history-timeline"'), 'timeline testid missing');
  assert(s.includes("'hr-privacy-consent-history-dot-closed'"), 'closed dot missing');
  assert(s.includes("'hr-privacy-consent-history-dot-standing'"), 'standing dot missing');
  assert(s.includes('data-testid="hr-privacy-consent-history-empty"'), 'empty state missing');
  assert(s.includes('data-testid="hr-privacy-consent-history-footer"'), 'footer missing');
  assert(s.includes('aria-label="Retry consent history"'), 'retry missing');
  assert(s.includes('stood {ev.stoodDays} day'), 'stood chip missing');
  assert(s.includes('re-grant'), 're-grant chip missing');
});

check('page: dark twins ride the timeline (dots, border, chips)', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('bg-amber-500 dark:bg-amber-400'), 'amber dot dark twin missing');
  assert(s.includes('bg-emerald-500 dark:bg-emerald-400'), 'emerald dot dark twin missing');
  assert(s.includes('border-l-2 border-slate-200 pl-5 dark:border-slate-700'), 'timeline border twin missing');
  assert(s.includes('border-background'), 'dot rim must match the dialog surface');
});

check('page: all drawer state resets on close (stale hygiene)', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  const body = s.slice(s.indexOf('const closeHistory = useCallback'), s.indexOf('// v2.119.0: the consent ledger loads'));
  for (const reset of ['setHistoryEmp(null)', 'setHistoryPayload(null)', 'setHistoryError(null)', 'setHistoryLoading(false)']) {
    assert(body.includes(reset), `missing reset: ${reset}`);
  }
});

// ── the ledger story stays pinned ──────────────────────────────────────────
check('continuity: the v2.128.0 re-grant chip still counts beside the new door', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('data-testid="hr-privacy-consent-regrant"'), 'v2.128 marker missing');
  assert(s.includes('{r.priorGrants > 0 ? ('), 'marker gate missing');
});

check('tests: consent-history-v2129.test.ts pins 14 assertions of honesty', () => {
  const s = read('src/tests/consent-history-v2129.test.ts');
  const count = (s.match(/\bit\(/g) || []).length;
  assert(count === 14, `expected 14 its, found ${count}`);
  assert(s.includes('CONSENT_HISTORY_NOT_FOUND'), '404 pin missing');
  assert(s.includes('stoodDays').valueOf(), 'stoodDays pin missing');
});

console.log(`\nverify-v2-129-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
