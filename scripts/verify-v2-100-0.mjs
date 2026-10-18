#!/usr/bin/env node
// v2.100.0 verification — "the period opens its ledger".
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
const ROUTE = read('src/app/api/payroll/period-journal/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-journal.test.ts');
const GROUPS = read('src/lib/hr/payroll/run-groups.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.100.0', () => {
  assert(atLeast(PKG.version, '2.100.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.100.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.100.0'), 'baseVersion');
});

check('whats-new leads with 2.100.0 and tells the ledger story', () => {
  const i100 = WN.indexOf("version: '2.100.0'");
  const i99 = WN.indexOf("version: '2.99.0'");
  assert(i100 >= 0, 'no 2.100.0 entry');
  assert(i99 > i100, '2.99.0 must follow 2.100.0 (newest first)');
  const slice = WN.slice(i100, i99);
  assert(slice.includes("title: 'The period opens its ledger'"), 'missing headline');
  for (const phrase of [
    'Ledger button',
    'Balanced chip',
    'counted as waiting, never priced',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `2.100.0 bullets miss "${phrase}"`);
  }
});

// ── 2. The pure builder ─────────────────────────────────────────────────────
check('buildPeriodLedger exists in the pure family, honesty documented', () => {
  assert(BUILDER.includes('export function buildPeriodLedger'), 'missing buildPeriodLedger');
  assert(BUILDER.includes('export interface PeriodLedger'), 'missing PeriodLedger');
  assert(BUILDER.includes('export function isLedgerBalanced'), 'missing isLedgerBalanced');
  assert(BUILDER.includes('export function sumLedgerLines'), 'missing sumLedgerLines');
  assert(BUILDER.includes("import { SETTLED_RUN_STATUSES } from './run-groups'"), 'must inherit the settled statuses');
  assert(BUILDER.includes('PURE module'), 'purity undocumented');
});

check('the honesty contract: voided nowhere, missing surfaced, in-motion counted', () => {
  const fn = BUILDER.split('export function buildPeriodLedger')[1] ?? '';
  assert(fn.includes("if (run.status === 'VOIDED') continue;"), 'voided runs must appear nowhere');
  assert(fn.includes('missingJournal.push'), 'missing journal must be surfaced');
  assert(fn.includes('unsettled.push'), 'in-motion runs must be counted');
  assert(fn.includes('return db - da; // newest first'), 'newest-first ordering missing');
  assert(fn.includes('return 0; // stable'), 'stability missing');
});

check('balance is proven at 2dp money precision', () => {
  assert(BUILDER.includes('Math.round((Number(v) + Number.EPSILON) * 100) / 100'), '2dp money rounding missing');
  assert(BUILDER.includes('isLedgerBalanced(sums.debit, sums.credit) &&'), 'line-sum balance check missing');
  assert(BUILDER.includes('isLedgerBalanced(Number(e.totalDebit), Number(e.totalCredit))'), 'header-total balance check missing');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('the route guards exactly like the runs list', () => {
  assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission');
  assert(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"), 'wrong roles');
  assert(ROUTE.includes("export const dynamic = 'force-dynamic'"), 'dynamic missing');
  assert(ROUTE.includes("success: false, error: 'periodId is required.'"), '400 contract missing');
  assert(ROUTE.includes("success: false, error: 'Payroll period not found.'"), '404 contract missing');
  assert(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'period must be tenant-scoped');
  assert(ROUTE.includes("where: { payrollPeriodId: periodId, storeId: session.storeId || '' }"), 'runs must be tenant-scoped');
  assert(ROUTE.includes("account: { select: { code: true, name: true, type: true } }"), 'accounts must resolve into lines');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('the period header carries its ledger door BESIDE the fold', () => {
  assert(PAGE.includes('data-testid="payroll-period-journal"'), 'rail button missing');
  assert(PAGE.includes('flex min-w-0 flex-1 flex-wrap items-center'), 'fold lost min-w-0');
  assert(PAGE.includes('border-l border-border/70'), 'rail divider missing');
  assert(PAGE.includes('Open the ${group.periodName} journal ledger'), 'aria-label missing');
  assert(PAGE.includes('void openPeriodJournal(group.runs[0]?.payrollPeriodId ?? \'\', group.periodName)'), 'open call missing');
});

check('the drawer renders the whole honest story', () => {
  for (const tid of [
    'payroll-ledger-entry',
    'payroll-ledger-line',
    'payroll-ledger-balanced',
    'payroll-ledger-unsettled',
    'payroll-ledger-missing',
    'payroll-ledger-retry',
    'payroll-ledger-empty',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `missing drawer anchor ${tid}`);
  }
  assert(PAGE.includes('print:hidden max-h-[85vh]'), 'drawer must never join a printed page');
  assert(PAGE.includes('no journal yet'), 'unsettled honesty missing');
  assert(PAGE.includes('this must never happen'), 'missing-journal alarm missing');
});

check('prior v2.98 anchors survive the restructure', () => {
  for (const tid of ['payroll-period-toggle', 'payroll-period-rollup', 'payroll-period-net', 'payroll-periods-toggle-all', 'payroll-run-waiting-since']) {
    assert(PAGE.includes(`data-testid="${tid}"`), `lost anchor ${tid}`);
  }
  assert(PAGE.includes('payrollPeriodId: string;'), 'runs DTO must carry the period id');
  assert(PAGE.includes('/api/payroll/period-journal?periodId='), 'fetch path missing');
});

// ── 5. Tests exist and mean it ──────────────────────────────────────────────
check('the test file exercises the real contract', () => {
  assert(TEST.includes("buildPeriodLedger("), 'builder untested');
  assert(TEST.includes("isLedgerBalanced(100.005, 100.01)"), 'money-precision case missing');
  assert(TEST.includes("toEqual(['JE-A', 'JE-C', 'JE-B'])"), 'stable ordering case missing');
  assert(TEST.includes("not.toContain('void-1')"), 'voided-nowhere case missing');
  assert(TEST.includes("hrGuard('hr.payroll.read.all'"), 'route guard pin missing');
  assert(TEST.includes("toEqual(['draft-1', 'wait-1', 'appr-1'])"), 'unsettled case missing');
});

check('run-groups honesty contract untouched', () => {
  assert(GROUPS.includes("export const SETTLED_RUN_STATUSES = ['POSTED', 'LOCKED'] as const;"), 'settled statuses changed');
  assert(GROUPS.includes('settledNet'), 'the settled arithmetic must stand');
});

console.log(`\nverify v2.100.0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
