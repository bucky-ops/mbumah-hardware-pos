#!/usr/bin/env node
// v2.101.0 verification — "the ledger files itself".
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
const ROUTE = read('src/app/api/payroll/period-journal/export/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-ledger-csv.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.101.0', () => {
  assert(atLeast(PKG.version, '2.101.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.101.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.101.0'), 'baseVersion');
});

check('whats-new leads with 2.101.0 and tells the filing story', () => {
  const i101 = WN.indexOf("version: '2.101.0'");
  const i100 = WN.indexOf("version: '2.100.0'");
  assert(i101 >= 0, 'no 2.101.0 entry');
  assert(i100 > i101, '2.100.0 must follow 2.101.0 (newest first)');
  const slice = WN.slice(i101, i100);
  assert(slice.includes("title: 'The ledger files itself'"), 'missing headline');
  for (const phrase of [
    'governed CSV exit',
    'balances by itself',
    'Nothing posted means nothing to file',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `2.101.0 bullets miss "${phrase}"`);
  }
});

// ── 2. The pure builder ─────────────────────────────────────────────────────
check('periodLedgerToCsv exists in the ledger family, contract documented', () => {
  assert(BUILDER.includes('export function periodLedgerToCsv'), 'missing periodLedgerToCsv');
  assert(BUILDER.includes('export function periodSlug'), 'missing periodSlug');
  assert(BUILDER.includes('export interface PeriodLedgerCsvMeta'), 'missing PeriodLedgerCsvMeta');
  const fn = BUILDER.split('export function periodLedgerToCsv')[1] ?? '';
  assert(fn.includes('if (entries.length === 0) return null;'), 'null-on-empty missing');
  assert(fn.includes("row(['Report', 'Payroll period ledger']);"), 'header block missing');
  assert(fn.includes('Generated (UTC)'), 'Generated line missing');
  assert(fn.includes("'Totals',"), 'Totals line missing');
  assert(fn.includes('.toFixed(2)'), 'bare 2dp money missing');
  assert(fn.includes("mbumah-period-ledger-${periodSlug(meta.periodName, 'period')}.csv"), 'honest period filename missing');
  assert(fn.includes("lines.join('\\r\\n') + '\\r\\n'"), 'RFC-4180 CRLF missing');
});

check('the builder stays PURE and rides the shared escaper', () => {
  assert(BUILDER.includes("import { csvCell } from '@/lib/hr/digest-csv';"), 'must ride the shared escaper');
  const csvSection = BUILDER.split('v2.101.0')[1] ?? '';
  assert(!/from ['"]@\/lib\/db['"]/.test(csvSection), 'csv section must not import db');
  assert(BUILDER.includes('PURE module'), 'purity undocumented');
});

check('the Totals line makes the file balance by itself', () => {
  const fn = BUILDER.split('export function periodLedgerToCsv')[1] ?? '';
  assert(fn.includes('totalDebit += Number(l.debit || 0);'), 'debit accumulation missing');
  assert(fn.includes('totalCredit += Number(l.credit || 0);'), 'credit accumulation missing');
  assert(fn.includes('entries.length === 1 ? \'entry\' : \'entries\''), 'entry count missing');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('the export route guards exactly like the ledger route', () => {
  assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission');
  assert(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"), 'wrong roles');
  assert(ROUTE.includes("export const dynamic = 'force-dynamic'"), 'dynamic missing');
  assert(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'period must be tenant-scoped');
  assert(ROUTE.includes("where: { payrollPeriodId: periodId, storeId: session.storeId || '' }"), 'runs must be tenant-scoped');
  assert(ROUTE.includes("code: 'NO_LEDGER_DATA'"), '404 contract missing');
  assert(ROUTE.includes('Nothing has posted in this period — nothing to file.'), 'honest 404 message missing');
});

check('the export audits the filing, field names only', () => {
  assert(ROUTE.includes("action: 'PAYROLL_PERIOD_LEDGER_EXPORTED'"), 'audit action missing');
  assert(ROUTE.includes('HrEntityType.DATA_EXPORT'), 'resource type missing');
  assert(ROUTE.includes('resourceId: file.filename'), 'filename as resourceId missing');
  assert(ROUTE.includes('lineCount'), 'line count metadata missing');
  assert(ROUTE.includes('.catch(() => undefined);'), 'audit must never block the download');
});

check('the file inherits the screen: same shape, same order, period window', () => {
  assert(ROUTE.includes('buildPeriodLedger'), 'must ride the pure builder for order');
  assert(ROUTE.includes('digestOrgAndScope'), 'org/scope resolution missing');
  assert(ROUTE.includes("slice(0, 10)} → ${period.endDate"), 'period window missing');
  assert(ROUTE.includes("'Content-Type': 'text/csv; charset=utf-8'"), 'content type missing');
  assert(ROUTE.includes('attachment; filename='), 'content disposition missing');
  assert(ROUTE.includes("'Cache-Control': 'no-store'"), 'no-store missing');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('the drawer footer carries the CSV door with its own reasons', () => {
  assert(PAGE.includes('data-testid="payroll-ledger-csv"'), 'button missing');
  assert(PAGE.includes('data-testid="payroll-ledger-csv-note"'), 'note missing');
  assert(PAGE.includes('Nothing to file — nothing has posted in this period.'), 'empty-reason title missing');
  assert(PAGE.includes('Download the period ledger CSV'), 'aria-label missing');
  assert(PAGE.includes("'Building…' : 'Ledger CSV'"), 'busy label missing');
  assert(PAGE.includes('csvBusy || !payload || payload.entries.length === 0'), 'honest disable missing');
  assert(PAGE.includes('/api/payroll/period-journal/export?periodId='), 'export fetch missing');
  assert(PAGE.includes('}, [periodName]);'), 'stale-note hygiene missing');
});

check('prior v2.100 anchors survive', () => {
  for (const tid of ['payroll-period-journal', 'payroll-ledger-entry', 'payroll-ledger-line', 'payroll-ledger-balanced', 'payroll-ledger-unsettled', 'payroll-ledger-missing', 'payroll-ledger-retry']) {
    assert(PAGE.includes(`data-testid="${tid}"`), `lost anchor ${tid}`);
  }
});

// ── 5. Tests exist and mean it ──────────────────────────────────────────────
check('the test file exercises the real contract', () => {
  assert(TEST.includes("periodLedgerToCsv([mkEntry({})], META)"), 'builder untested');
  assert(TEST.includes("toBe('Totals,,,,,,,,516000.00,516000.00,2 entries')"), 'self-balancing Totals pin missing');
  assert(TEST.includes("'=SUM(A1) Office"), 'OWASP pin missing');
  assert(TEST.includes("mbumah-period-ledger-october-2026.csv"), 'filename pin missing');
  assert(TEST.includes("periodLedgerToCsv([], META)).toBeNull()"), 'null-on-empty pin missing');
  assert(TEST.includes("hrGuard('hr.payroll.read.all'"), 'route guard pin missing');
  assert(TEST.includes("code: 'NO_LEDGER_DATA'"), '404 pin missing');
});

console.log(`\nverify v2.101.0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
