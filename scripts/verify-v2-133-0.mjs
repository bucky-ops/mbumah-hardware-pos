#!/usr/bin/env node
// v2.133.0 verification — "the gate speaks first".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The parity
// checks are the point: the pre-flight gate MIRRORS preparePayrollRun's
// gates, and these pins are what stop the mirror from drifting.

import { readFileSync, existsSync } from 'node:fs';
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

const GATE = 'src/lib/hr/payroll/run-gate.ts';
const SERVICE = 'src/lib/hr/payroll/run-service.ts';
const ROUTE = 'src/app/api/payroll/runs/gate/route.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.133.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.133.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.133.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.133.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-133-0'], 'verify script entry missing');
});

check('whats-new: 2.133.0 leads the feed with the gate story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.133.0'");
  assert(head > -1, 'no 2.133.0 entry');
  assert(head < wn.indexOf("version: '2.132.0'"), '2.133.0 does not lead');
  assert(wn.includes('The gate speaks first'), 'title missing');
});

check('changelog: [2.133.0] carries Added + Changed with both beats', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.133.0]');
  assert(head > -1, 'no [2.133.0] section');
  assert(head < cl.indexOf('## [2.132.0]'), '[2.133.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.132.0]'));
  assert(section.includes('### Added'), 'no Added');
  assert(section.includes('### Changed'), 'no Changed');
  assert(section.includes('run-gate.ts'), 'service missing');
  assert(section.includes('Gate door'), 'door missing');
});

// ── the parity contract (the gate mirrors prepare) ─────────────────────────
check('parity: same employee where and order as preparePayrollRun', () => {
  const where = "where: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' }";
  const order = "orderBy: { employeeCode: 'asc' }";
  assert(read(GATE).includes(where), 'gate employee where missing');
  assert(read(SERVICE).includes(where), 'prepare employee where missing');
  assert(read(GATE).includes(order), 'gate order missing');
  assert(read(SERVICE).includes(order), 'prepare order missing');
});

check('parity: same consent gate (withdrawnAt: null) in both files', () => {
  const where = 'where: { employeeId: employee.id, withdrawnAt: null },';
  assert(read(GATE).includes(where), 'gate consent where missing');
  assert(read(SERVICE).includes(where), 'prepare consent where missing');
});

check('parity: same timesheet helper, same import', () => {
  const imp = "import { hasUnapprovedTimesheet } from '../attendance-service';";
  assert(read(GATE).includes(imp), 'gate import missing');
  assert(read(SERVICE).includes(imp), 'prepare import missing');
});

check('the gate read never writes', () => {
  const s = read(GATE);
  for (const verb of ['.create(', '.update(', '.delete(', 'preparePayrollRun', 'createPayrollRun']) {
    assert(!s.includes(verb), `write verb found: ${verb}`);
  }
});

check('honest 404 for an unknown or cross-branch period; voided is reported', () => {
  const s = read(GATE);
  assert(s.includes("throw new PayrollGateError('PERIOD_NOT_FOUND', 'Payroll period not found.', 404)"), 'no 404');
  assert(s.includes('storeId: ctx.storeId'), 'no store scoping');
  assert(s.includes('status: true'), 'period status not selected');
  assert(s.includes("deriveGateState"), 'pure derivation missing');
});

// ── the route ──────────────────────────────────────────────────────────────
check('route: GET-only, read-right quartet, query param, house error convention', () => {
  const s = read(ROUTE);
  assert(s.includes('export const GET'), 'no GET');
  for (const verb of ['export const POST', 'export const PATCH', 'export const PUT', 'export const DELETE']) {
    assert(!s.includes(verb), `mutation verb found: ${verb}`);
  }
  assert(s.includes("hrGuard('hr.payroll.read.all'"), 'wrong guard');
  assert(s.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const"), 'wrong quartet');
  assert(read('src/app/api/payroll/runs/route.ts').includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const"), 'runs route quartet changed');
  assert(s.includes("searchParams.get('periodId')"), 'no query param');
  assert(s.includes('const mapped = payrollErrorResponse(error);'), 'error convention missing');
});

// ── the door ───────────────────────────────────────────────────────────────
check('door: Gate pill on the rail beside Ledger, aria + tooltip + testid', () => {
  const s = read(PAGE);
  assert(s.includes('data-testid="payroll-period-gate"'), 'no pill testid');
  assert(s.includes('aria-label={`Check the ${group.periodName} run gate`}'), 'no aria');
  assert(s.includes('Who the run gate would block, before anyone tries — the same gates prepare enforces, read-only'), 'no honesty tooltip');
  assert(s.indexOf('data-testid="payroll-period-gate"') < s.indexOf('data-testid="payroll-period-journal"'), 'pill not beside Ledger');
});

check('panel: counts, clear strip, voided strip, blocked rows, both-blocks hint, failure strip', () => {
  const s = read(PAGE);
  assert(s.includes('data-testid="payroll-gate-panel"'), 'no panel');
  assert(s.includes('data-testid="payroll-gate-counts"'), 'no counts');
  assert(s.includes('The gate is clear — prepare would proceed for all'), 'no clear strip');
  assert(s.includes('This period is voided — runs are closed; the gate has nothing to gate.'), 'no voided strip');
  assert(s.includes('data-testid="payroll-gate-blocked-row"'), 'no blocked rows');
  assert(s.includes('(prepare would report {r.blocks[0]} first)'), 'no both-blocks hint');
  assert(s.includes('data-testid="payroll-gate-error"'), 'no failure strip');
  assert(s.includes('failed — the desk stays dark rather than guess.'), 'failure does not speak');
  assert(s.includes('aria-label={`Retry the ${periodName} gate read`}'), 'no scoped retry');
  assert(s.includes('`/api/payroll/runs/gate?periodId=${encodeURIComponent(periodId)}`'), 'fetch missing');
  assert(s.includes("credentials: 'include'"), 'fetch does not ride the cookie');
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: the v2.133.0 test file exists with the parity pins', () => {
  const p = 'src/tests/run-gate-v2133.test.ts';
  assert(existsSync(join(process.cwd(), p)), 'test file missing');
  const s = read(p);
  assert(s.includes('deriveGateState'), 'no pure derivation tests');
  assert(s.includes('the same employee where and order'), 'no parity pin');
  assert(s.includes("expect(s.includes(verb)).toBe(false)"), 'no write-verb pin');
});

check('counter: console-changelog re-anchored for 2.133.0 joining the feed', () => {
  const s = read('src/tests/console-changelog.test.ts');
  assert(s.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(22)"), '2.110.0 anchor stale');
  assert(s.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(55)"), '2.77.0 anchor stale');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
