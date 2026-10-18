#!/usr/bin/env node
// v2.102.0 verification — "the account opens its month".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

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

const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');
const BUILDER = read('src/lib/hr/payroll/period-journal.ts');
const ROUTE = read('src/app/api/payroll/period-journal/account/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-account-movement.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.102.0', () => {
  assert(atLeast(PKG.version, '2.102.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.102.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.102.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.102.0 and tells the movement story', () => {
  const i102 = WN.indexOf("version: '2.102.0'");
  const i101 = WN.indexOf("version: '2.101.0'");
  assert(i102 >= 0, 'no 2.102.0 entry');
  assert(i101 > i102, '2.101.0 must follow 2.102.0 (newest first)');
  const slice = WN.slice(i102, i101);
  assert(slice.includes("title: 'The account opens its month'"), 'missing headline');
  for (const phrase of [
    'chronological replay',
    'starts the month at zero',
    'the side letter instead of a bare negative',
    'closed doors',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `2.102.0 bullets miss "${phrase}"`);
  }
});

// ── 2. The pure builder ─────────────────────────────────────────────────────
check('buildAccountMovement exists with its honesty documented', () => {
  assert(BUILDER.includes('export function buildAccountMovement'), 'missing buildAccountMovement');
  assert(BUILDER.includes('export function signedBalance'), 'missing signedBalance');
  assert(BUILDER.includes('export interface AccountMovement'), 'missing AccountMovement');
  assert(BUILDER.includes('export interface AccountMovementSource'), 'missing AccountMovementSource');
  assert(BUILDER.includes('export interface AccountMovementRow'), 'missing AccountMovementRow');
  assert(BUILDER.includes('normalBalanceAssumed'), 'assumed-side flag missing');
  const section = BUILDER.split('v2.102.0')[1] ?? '';
  assert(section.includes('PURE module'), 'purity undocumented');
  assert(section.includes('closed door'), 'voided-entry stance undocumented');
  assert(section.includes('CHRONOLOGICAL'), 'replay order undocumented');
});

check('the running balance is money2 at every step', () => {
  const fn = BUILDER.split('export function buildAccountMovement')[1] ?? '';
  assert(fn.includes('running = money2(running + signedBalance(debit, credit, normalBalance));'), 'per-step rounding missing');
  assert(fn.includes('totals: { debit: money2(totalDebit), credit: money2(totalCredit) }'), 'recomputed totals missing');
  assert(fn.includes('closing: { balance: running }'), 'closing = last running step missing');
});

check('signedBalance reads the T-account way', () => {
  const fn = BUILDER.split('export function signedBalance')[1]?.split('export function buildAccountMovement')[0] ?? '';
  assert(fn.includes("normalBalance === 'CREDIT' ? money2(c - d) : money2(d - c)"), 'normal-side signing missing');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('the account route guards exactly like the ledger route', () => {
  assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission');
  assert(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"), 'wrong roles');
  assert(ROUTE.includes("export const dynamic = 'force-dynamic'"), 'dynamic missing');
  assert(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'period must be tenant-scoped');
  assert(ROUTE.includes('organizationId: store.organizationId'), 'account must be org-scoped');
});

check('the route is honest about what it counts', () => {
  assert(ROUTE.match(/isPosted: true/g)?.length >= 2, 'posted-only filter missing');
  assert(ROUTE.match(/isVoided: false/g)?.length >= 2, 'never-voided filter missing');
  assert(ROUTE.includes('windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);'), 'inclusive closing day missing');
  assert(ROUTE.includes('entryDate: { lt: period.startDate }'), 'prior-window filter missing');
  assert(ROUTE.includes('entryDate: { gte: period.startDate, lt: windowEnd }'), 'month-window filter missing');
  assert(ROUTE.includes("_count: { _all: true }"), 'priorLines aggregate missing');
  assert(ROUTE.includes("payrollRuns[0]?.runType ?? l.journalEntry.referenceType ?? 'JOURNAL'"), 'honest source resolution missing');
  assert(ROUTE.includes('orderBy: [{ journalEntry: { entryDate: \'asc\' } }, { createdAt: \'asc\' }]'), 'chronological order missing');
  assert(ROUTE.includes('buildAccountMovement('), 'must ride the pure builder');
});

check('param validation and honest 404s', () => {
  assert(ROUTE.includes('if (!periodId || !accountCode)'), 'param validation missing');
  assert(ROUTE.includes("{ status: 400 }"), '400 missing');
  assert(ROUTE.includes("error: 'Payroll period not found.'"), 'period 404 missing');
  assert(ROUTE.includes('No account ${accountCode} in this organization.'), 'account 404 missing');
});

check('a read endpoint lands no audit row', () => {
  assert(!ROUTE.includes('auditLog.create'), 'reads must not audit');
  assert(!ROUTE.includes('createAuditLog'), 'reads must not audit');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('every ledger line is a door', () => {
  assert(PAGE.includes('data-testid="payroll-ledger-line-door"'), 'door missing');
  assert(PAGE.includes("the account's month movement across this period's ledger"), 'aria label missing');
  assert(PAGE.includes("closest('[data-testid=payroll-ledger-line-door]')"), 'double-fire guard missing');
  assert(PAGE.includes('/api/payroll/period-journal/account?periodId='), 'drill fetch missing');
  assert(PAGE.includes('Movement API unreachable'), 'honest fetch error missing');
});

check('the movement dialog carries its anchors', () => {
  for (const tid of [
    'payroll-account-movement',
    'payroll-account-loading',
    'payroll-account-error',
    'payroll-account-retry',
    'payroll-account-opening',
    'payroll-account-empty',
    'payroll-account-row',
    'payroll-account-running',
    'payroll-account-closing',
    'payroll-account-back',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `lost anchor ${tid}`);
  }
});

check('the opening speaks and the side letter replaces the negative', () => {
  assert(PAGE.includes('No posted lines before this window — the account starts the month at zero.'), 'zero-opening honesty missing');
  assert(PAGE.includes('Summed from ${drill.opening.priorLines} posted'), 'priorLines honesty missing');
  assert(PAGE.includes("const normal = normalBalance === 'CREDIT' ? 'Cr' : 'Dr';"), 'side letter missing');
  assert(PAGE.includes('DEBIT was assumed'), 'assumed-side disclosure missing');
});

check('prior v2.100 / v2.101 anchors survive', () => {
  for (const tid of ['payroll-period-journal', 'payroll-ledger-entry', 'payroll-ledger-line', 'payroll-ledger-balanced', 'payroll-ledger-unsettled', 'payroll-ledger-missing', 'payroll-ledger-csv', 'payroll-ledger-csv-note']) {
    assert(PAGE.includes(`data-testid="${tid}"`), `lost anchor ${tid}`);
  }
});

// ── 5. Tests exist and mean it ──────────────────────────────────────────────
check('the test file exercises the real contract', () => {
  assert(TEST.includes('buildAccountMovement('), 'builder untested');
  assert(TEST.includes('signedBalance('), 'T-account signing untested');
  assert(TEST.includes("expect(movement.movements[2]?.running).toBe(0);"), 'float-trap pin missing');
  assert(TEST.includes('normalBalanceAssumed).toBe(true)'), 'assumed-flag pin missing');
  assert(TEST.includes("hrGuard('hr.payroll.read.all'"), 'route guard pin missing');
  assert(TEST.includes("expect(ROUTE).not.toContain('auditLog.create')"), 'no-audit pin missing');
  assert(TEST.includes("version: '2.102.0'"), 'whats-new pin missing');
});

console.log(`\nverify v2.102.0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
