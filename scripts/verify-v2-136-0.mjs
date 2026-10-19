#!/usr/bin/env node
// v2.136.0 verification — "the second door finds its desk".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the parity contract: the pending read must mirror the gate's own where
// (unapproved days, ACTIVE employees, code-ascending order) so the desk can
// never offer a day the gate would never count; the approve must ride the
// ONE audited approveTimesheet service; the gate row's door must deep-link
// the blocked employee; and every surface must keep its dark twins and its
// honest empty/error states. Comment-stripping before code searches (house
// lesson 49): a comment that QUOTES a string is not the string living in
// code.

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
/** Strip line comments so a quoted example in prose never satisfies a code pin. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

const PURE = 'src/lib/hr/attendance-desk.ts';
const ROUTE = 'src/app/api/attendance/timesheets/pending/route.ts';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';
const LAYOUT = 'src/app/(shell)/hr/layout.tsx';
const TEST = 'src/tests/timesheet-desk-v2136.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.136.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.136.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.136.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.136.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-136-0'], 'verify script entry missing');
});

check('release: whats-new leads 2.136.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  assert(feed.includes("version: '2.136.0'"), 'whats-new 2.136.0 missing');
  assert(feed.includes('The second door finds its desk'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.136.0] The second door finds its desk'), 'CHANGELOG entry missing');
});

// ── the pure desk layer ────────────────────────────────────────────────────
check('pure: attendance-desk.ts stays pure (no db, no network, no clock)', () => {
  const src = stripComments(read(PURE));
  assert(!src.includes("@/lib/db"), 'pure module imports the db');
  assert(!src.includes('fetch('), 'pure module fetches');
  assert(!src.includes('new Date()'), 'pure module reads the clock');
  for (const exp of ['groupUnapprovedByEmployee', 'deskDateOnly', 'deskDayLabel', 'deskDayStrip', 'deskRangeLabel']) {
    assert(src.includes(`export function ${exp}`), `missing export ${exp}`);
  }
});

check('pure: UTC date-only semantics pinned (no locale drift)', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('T00:00:00Z'), 'UTC midnight parse missing');
  assert(src.includes('getUTCDate'), 'UTC date parts missing');
  assert(!src.includes('toLocaleDateString'), 'locale formatting crept in');
  assert(!src.includes('toLocaleString'), 'locale formatting crept in');
});

// ── the pending read (gate parity) ─────────────────────────────────────────
check('pending route: rides the gate read-right quartet', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission key');
  assert(src.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"), 'quartet missing');
});

check('pending route: the gate unapproved where, line for line', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes('checkIn: { not: null }'), 'checkIn pin missing');
  assert(src.includes('timesheetApprovedByUserId: null'), 'unapproved pin missing');
  assert(src.includes("employee: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' }"), 'employee parity where missing');
});

check('pending route: honest 404 + grouped through the pure builder', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes("'PERIOD_NOT_FOUND'"), 'code missing');
  assert(src.includes('status: 404'), '404 missing');
  assert(src.includes('groupUnapprovedByEmployee'), 'pure builder unused');
  assert(!src.includes('updateMany') && !src.includes('.create('), 'route mutates — read-only broken');
});

// ── the desk page ──────────────────────────────────────────────────────────
check('desk: approve rides the ONE service route, range in, no double-stamp', () => {
  const src = stripComments(read(DESK));
  assert(src.includes("fetch('/api/attendance/timesheets/approve'"), 'approve endpoint missing');
  assert(src.includes('employeeId: row.employeeId, from: row.firstDay, to: row.lastDay'), 'range body missing');
  assert(src.includes('disabled={approvingId !== null}'), 'in-flight disable missing');
});

check('desk: the door deep link answers (lazy init, strip-on-mount, aria-current)', () => {
  const src = stripComments(read(DESK));
  assert(src.includes(".get('employee')"), 'focus param missing');
  assert(src.includes("searchParams.delete('employee')"), 'param strip missing');
  assert(src.includes('window.history.replaceState(null'), 'replaceState missing');
  assert(src.includes("aria-current={focused ? 'true' : undefined}"), 'aria-current missing');
});

check('desk: honest states (clear strip, error + Retry, skeleton, scope line)', () => {
  const src = stripComments(read(DESK));
  for (const pin of [
    'data-testid="hr-timesheet-clear"',
    'data-testid="hr-timesheet-error"',
    'data-testid="hr-timesheet-desk"',
    'data-testid="hr-timesheet-scope-picker"',
    'data-testid="hr-timesheet-strip-overflow"',
    'the desk stays dark rather than guess',
    "useState<string>('__all__')",
  ]) {
    assert(src.includes(pin), `missing ${pin}`);
  }
});

check('desk: styling contract (amber chips, dark twins, tabular numerals, focus rings)', () => {
  const src = stripComments(read(DESK));
  for (const pin of [
    'dark:bg-amber-950/50 dark:text-amber-300',
    'tabular-nums',
    'ring-inset ring-amber-300 dark:bg-amber-950/30 dark:ring-amber-700',
    'focus-visible:ring-2 focus-visible:ring-amber-400',
  ]) {
    assert(src.includes(pin), `missing ${pin}`);
  }
});

// ── the gate door ──────────────────────────────────────────────────────────
check('gate panel: the timesheet door deep-links the blocked employee (amber family)', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('data-testid="payroll-gate-timesheet-door"'), 'door missing');
  assert(src.includes('/hr/timesheets?employee=${encodeURIComponent(r.employeeId)}'), 'deep link missing');
  assert(src.includes('aria-label={`Open the timesheet desk to approve days for ${r.employeeName}`}'), 'aria missing');
  assert(src.includes('dark:hover:ring-amber-800'), 'amber dark twin missing');
  assert(src.includes('data-testid="payroll-gate-consent-door"'), 'consent door lost');
  assert(src.includes('href="/hr/reports?tab=privacy"'), 'consent target lost');
});

// ── navigation + tests ─────────────────────────────────────────────────────
check('nav: Timesheets joins the HR nav between Payroll and Performance', () => {
  const src = stripComments(read(LAYOUT));
  assert(src.includes("{ href: '/hr/timesheets', label: 'Timesheets' }"), 'nav item missing');
  const a = src.indexOf("href: '/hr/payroll'");
  const b = src.indexOf("href: '/hr/timesheets'");
  const c = src.indexOf("href: '/hr/performance'");
  assert(b > a && b < c, 'slot order wrong');
});

check('tests: the v2.136.0 suite exists and names the release contract', () => {
  const src = read(TEST);
  assert(src.includes('v2.136.0'), 'release named in suite missing');
  assert(src.includes('the second door finds its desk'), 'headline missing from suite');
  assert(src.includes('groupUnapprovedByEmployee'), 'pure coverage missing');
  assert(src.includes('payroll-gate-timesheet-door'), 'door coverage missing');
});

check('counters: console-changelog re-anchored for 2.136.0', () => {
  const src = stripComments(read('src/tests/console-changelog.test.ts'));
  assert(src.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(25)"), '2.110 anchor stale');
  assert(src.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(58)"), '2.77 anchor stale');
});

console.log(`\nverify-v2-136-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
