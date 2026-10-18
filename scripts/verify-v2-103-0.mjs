#!/usr/bin/env node
// v2.103.0 verification — "the account files its month".
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
const ROUTE = read('src/app/api/payroll/period-journal/account/export/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-account-movement-csv.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.103.0', () => {
  assert(atLeast(PKG.version, '2.103.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.103.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.103.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.103.0 and tells the filing story', () => {
  const i103 = WN.indexOf("version: '2.103.0'");
  const i102 = WN.indexOf("version: '2.102.0'");
  assert(i103 >= 0, 'no 2.103.0 entry');
  assert(i102 > i103, '2.102.0 must follow 2.103.0 (newest first)');
  const slice = WN.slice(i103, i102);
  assert(slice.includes("title: 'The account files its month'"), 'missing headline');
  for (const phrase of [
    'Movement CSV',
    'closes its own loop',
    'mbumah-account-movement-5200-salaries-expense-october-2026.csv',
    'never a bare negative',
    'Nothing posted inside the window means nothing to file',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `2.103.0 bullets miss "${phrase}"`);
  }
});

// ── 2. The pure builder ─────────────────────────────────────────────────────
check('accountMovementToCsv exists with its honesty documented', () => {
  assert(BUILDER.includes('export function accountMovementToCsv'), 'missing accountMovementToCsv');
  assert(BUILDER.includes('export function movementSideCell'), 'missing movementSideCell');
  assert(BUILDER.includes('export interface AccountMovementCsvMeta'), 'missing AccountMovementCsvMeta');
  const section = BUILDER.split('v2.103.0')[1] ?? '';
  assert(section.includes('THE DIALOG'), 'file-is-the-dialog stance undocumented');
  assert(section.includes('CLOSES THE LOOP BY ITSELF'), 'self-closing loop undocumented');
  assert(section.includes('never silently picks a side'), 'assumed-side stance undocumented');
  assert(section.includes('NO_MOVEMENT_DATA'), 'honest-empty code undocumented');
});

check('movementSideCell files the accountant way', () => {
  const fn = BUILDER.split('export function movementSideCell')[1]?.split('export interface AccountMovementCsvMeta')[0] ?? '';
  assert(fn.includes("'0.00 —'"), 'zero em-dash missing');
  assert(fn.includes("normalBalance === 'CREDIT' ? 'Cr' : 'Dr'"), 'normal-side letter missing');
  assert(fn.includes('Math.abs'), 'magnitude missing');
});

check('the CSV closes its own loop in the builder', () => {
  const fn = BUILDER.split('export function accountMovementToCsv')[1]?.split('const filename =')[0] ?? '';
  assert(fn.includes('movement.movements.length === 0) return null'), 'null-on-empty missing');
  assert(fn.includes('movementSideCell(movement.movements[movement.movements.length - 1].running'), 'closing = last running cell missing');
  assert(fn.includes("'Running (Dr/Cr)'"), 'running column header missing');
  assert(fn.includes("'Opening Basis'"), 'opening-basis honesty row missing');
  assert(fn.includes('(assumed — no known normal side)'), 'assumed-side filing missing');
  assert(fn.includes('csvCell'), 'shared escaper missing');
  assert(fn.includes("'\\r\\n'"), 'CRLF missing');
  assert(BUILDER.includes('mbumah-account-movement-'), 'honest filename missing');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('the export route guards exactly like the account route', () => {
  assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission');
  assert(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"), 'wrong roles');
  assert(ROUTE.includes("export const dynamic = 'force-dynamic'"), 'dynamic missing');
  assert(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'period must be tenant-scoped');
  assert(ROUTE.includes('organizationId: store.organizationId'), 'account must be org-scoped');
});

check('the export route mirrors the account route honesty', () => {
  assert(ROUTE.match(/isPosted: true/g)?.length >= 2, 'posted-only filter missing');
  assert(ROUTE.match(/isVoided: false/g)?.length >= 2, 'never-voided filter missing');
  assert(ROUTE.includes('windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);'), 'inclusive closing day missing');
  assert(ROUTE.includes('entryDate: { lt: period.startDate }'), 'prior-window filter missing');
  assert(ROUTE.includes('entryDate: { gte: period.startDate, lt: windowEnd }'), 'month-window filter missing');
  assert(ROUTE.includes('orderBy: [{ journalEntry: { entryDate: \'asc\' } }, { createdAt: \'asc\' }]'), 'chronological order missing');
  assert(ROUTE.includes('buildAccountMovement('), 'must ride the pure builder');
  assert(ROUTE.includes('accountMovementToCsv('), 'must ride the CSV builder');
});

check('the export 404s honestly and audits the filing', () => {
  assert(ROUTE.includes("code: 'NO_MOVEMENT_DATA'"), 'honest 404 missing');
  assert(ROUTE.includes('Nothing posted on this account inside the window — nothing to file.'), 'honest reason missing');
  assert(ROUTE.includes("action: 'PAYROLL_ACCOUNT_MOVEMENT_EXPORTED'"), 'audit action missing');
  assert(ROUTE.includes('HrEntityType.DATA_EXPORT'), 'audit entity missing');
  assert(ROUTE.includes('resourceId: file.filename'), 'audit resource missing');
  assert(ROUTE.includes("channel: 'ad_hoc_download'"), 'audit channel missing');
  assert(ROUTE.includes('accountCode: account.code'), 'account code metadata missing');
  assert(ROUTE.includes("'Content-Type': 'text/csv; charset=utf-8'"), 'family headers missing');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('the movement dialog grew the filing door', () => {
  assert(PAGE.includes('data-testid="payroll-account-csv"'), 'CSV door missing');
  assert(PAGE.includes('data-testid="payroll-account-csv-note"'), 'CSV note missing');
  assert(PAGE.includes('Download the account movement CSV'), 'aria label missing');
  assert(PAGE.includes('/api/payroll/period-journal/account/export?periodId='), 'export fetch missing');
  assert(PAGE.includes('encodeURIComponent(drillCode)'), 'account code must ride the fetch');
  assert(PAGE.includes("text: `Movement CSV downloaded — ${filename}."), 'download note missing');
  assert(PAGE.includes('the file closes its own loop'), 'loop story missing');
  assert(PAGE.includes('Nothing to file — nothing posted on this account inside the window.'), 'honest disabled reason missing');
});

check('the drill note rides the stale-state hygiene', () => {
  assert(PAGE.includes('const [movementCsvBusy, setMovementCsvBusy] = useState(false);'), 'busy flag missing');
  assert(PAGE.includes('const [movementCsvNote, setMovementCsvNote] = useState<{ tone: \'ok\' | \'err\'; text: string } | null>(null);'), 'note state missing');
  assert(PAGE.includes('setMovementCsvNote(null);\n  }, [periodName]);'), 'per-period reset missing');
  assert(PAGE.includes('the note belongs to THIS drill'), 'per-drill reset missing');
});

check('the other-side balance wears the amber eyebrow', () => {
  assert(PAGE.includes("m.running < 0 && Math.round(Math.abs(m.running) * 100) !== 0"), 'other-side detection missing');
  assert(PAGE.includes("'text-amber-700 dark:text-amber-400'"), 'amber tint missing');
});

check('prior v2.102 / v2.101 / v2.100 anchors survive', () => {
  for (const tid of [
    'payroll-account-movement', 'payroll-account-loading', 'payroll-account-error', 'payroll-account-retry',
    'payroll-account-opening', 'payroll-account-empty', 'payroll-account-row', 'payroll-account-running',
    'payroll-account-closing', 'payroll-account-back',
    'payroll-period-journal', 'payroll-ledger-entry', 'payroll-ledger-line', 'payroll-ledger-balanced',
    'payroll-ledger-unsettled', 'payroll-ledger-missing', 'payroll-ledger-csv', 'payroll-ledger-csv-note',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `lost anchor ${tid}`);
  }
});

// ── 5. Tests exist and mean it ──────────────────────────────────────────────
check('the test file exercises the real contract', () => {
  assert(TEST.includes('accountMovementToCsv('), 'builder untested');
  assert(TEST.includes('movementSideCell('), 'side cell untested');
  assert(TEST.includes("toBe('516000.00 Dr')"), 'side-letter pin missing');
  assert(TEST.includes("toBe('70414.80 Cr')"), 'other-side pin missing');
  assert(TEST.includes("toBe('0.00 —')"), 'zero em-dash pin missing');
  assert(TEST.includes("'Closing,,,,,,259500.00,700.00,258800.00 Dr'"), 'self-closing-loop pin missing');
  assert(TEST.includes('NO_MOVEMENT_DATA'), 'route 404 pin missing');
  assert(TEST.includes("hrGuard('hr.payroll.read.all'"), 'route guard pin missing');
  assert(TEST.includes("version: '2.103.0'"), 'whats-new pin missing');
});

console.log(`\nverify v2.103.0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
