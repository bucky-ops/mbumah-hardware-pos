#!/usr/bin/env node
// v2.107.0 verification — "the chart files its month".
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
const BUNDLE = read('src/lib/hr/payroll/account-bundle.ts');
const ROUTE = read('src/app/api/payroll/period-journal/accounts/export-bundle/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-account-bundle.test.ts');
const CHANGELOG = read('src/tests/console-changelog.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.107.0', () => {
  assert(atLeast(PKG.version, '2.107.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.107.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.107.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.107.0 and tells the bundle story', () => {
  const i107 = WN.indexOf("version: '2.107.0'");
  const i106 = WN.indexOf("version: '2.106.0'");
  assert(i107 >= 0, 'no 2.107.0 entry');
  assert(i106 > i107, '2.106.0 must follow 2.107.0 (newest first)');
  const slice = WN.slice(i107, i106);
  assert(slice.includes("title: 'The chart files its month'"), 'missing headline');
  for (const phrase of [
    'governed exit',
    'MANIFEST.txt',
    'Quiet is a fact, not a file',
    'byte-auditable',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `bullet missing: ${phrase}`);
  }
});

// ── 2. The pure zip writer ──────────────────────────────────────────────────
check('bundle: the store-only writer is dependency-free and exported', () => {
  assert(BUNDLE.includes('export function crc32('), 'no crc32');
  assert(BUNDLE.includes('export function dosDateTime('), 'no dosDateTime');
  assert(BUNDLE.includes('export function zipStore('), 'no zipStore');
  assert(BUNDLE.includes('export function buildAccountBundle('), 'no bundle builder');
  const imports = BUNDLE.split('\n').filter((l) => l.startsWith('import ')).join('\n');
  assert(!imports.includes('from \u0027jszip\u0027') && !imports.includes('require('), 'no zip dependency allowed');
});

check('bundle: the CRC is the canonical poly, the writer is store-only', () => {
  assert(BUNDLE.includes('0xedb88320'), 'CRC poly missing');
  assert(BUNDLE.includes('u16(view, o + 8, 0); // method: store'), 'store method missing');
  assert(BUNDLE.includes('0x04034b50'), 'local header sig missing');
  assert(BUNDLE.includes('0x02014b50'), 'central dir sig missing');
  assert(BUNDLE.includes('0x06054b50'), 'EOCD sig missing');
  assert(BUNDLE.includes('u16(view, o + 6, 0x0800); // flags: UTF-8 names'), 'UTF-8 flag missing');
});

check('bundle: realm-safe narrowing — bytes ride as bytes in ANY realm', () => {
  assert(BUNDLE.includes('ArrayBuffer.isView(entry.bytes)'), 'isView narrowing missing');
  assert(BUNDLE.includes("new Uint8Array(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength)"), 'same-memory rewrap missing');
  // the DATA line itself must not gate on instanceof (a cross-realm
  // Uint8Array would fall to the String() else) — the word may only
  // appear in the lesson's comment
  const dataLine = BUNDLE.split('\n').find((l) => l.includes('const data = ')) ?? '';
  assert(dataLine.includes('ArrayBuffer.isView'), 'the data line must narrow with isView');
  assert(!dataLine.includes('instanceof'), 'the data line must not gate on instanceof');
});

check('bundle: the manifest is the file\u2019s own honesty through the shared guard', () => {
  assert(BUNDLE.includes("import { csvCell } from '@/lib/hr/digest-csv';"), 'shared csvCell not used');
  assert(BUNDLE.includes("row(['Report', 'Payroll account movements bundle']);"), 'manifest headline missing');
  assert(BUNDLE.includes("'Quiet accounts (no posted lines in the window — not filed)',"), 'quiet honesty missing');
  assert(BUNDLE.includes("row(['Account Code', 'Posted Lines', 'File']);"), 'manifest index header missing');
  assert(BUNDLE.includes("name: 'MANIFEST.txt', bytes: encoder.encode(manifest)"), 'manifest must ride first');
  assert(BUNDLE.includes('periodSlug(meta.periodName, \u0027period\u0027)'), 'governed slug missing');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('route: the drill\u2019s exact read contract (permission + roles)', () => {
  assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission');
  assert(ROUTE.includes("'HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'"), 'wrong roles');
});

check('route: tenant scope and honest failures (400, 3×404, NO_MOVEMENT_DATA)', () => {
  assert(ROUTE.includes("'periodId is required.'"), 'missing 400');
  assert(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'period not store-scoped');
  assert(ROUTE.includes("where: { organizationId: store.organizationId }"), 'accounts not org-scoped');
  const count404 = ROUTE.split('{ status: 404 }').length - 1;
  assert(count404 >= 3, `expected >=3 404s, got ${count404}`);
  assert(ROUTE.includes('NO_MOVEMENT_DATA'), 'empty-window honesty missing');
});

check('route: the window defaults to the drawer\u2019s OWN month — year is explicit', () => {
  assert(ROUTE.includes('monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);'), 'window not end+1day');
  // v2.114.0 chore re-anchor: the bounds now flow through windowStart/windowEnd
  // (the v2.108.0 year-window refactor); the honest pin is that BOTH fall back
  // to the period's own month when no explicit window is asked.
  assert(ROUTE.includes("const windowStart = window === 'year' ? new Date(Date.UTC(year, 0, 1)) : period.startDate;"), 'windowStart fallback missing');
  assert(ROUTE.includes("const windowEnd = window === 'year' ? new Date(Date.UTC(year + 1, 0, 1)) : monthEnd;"), 'windowEnd fallback missing');
  assert(ROUTE.includes('entryDate: { gte: windowStart, lt: windowEnd },'), 'window bounds missing');
  assert(ROUTE.includes('isPosted: true,'), 'posted filter missing');
  assert(ROUTE.includes('isVoided: false,'), 'voided filter missing');
  // v2.108.0 added an EXPLICIT window param — the honest pin is that month
  // REMAINS the default, not that the param cannot exist.
  assert(ROUTE.includes("windowParam === 'year' ? 'year' : 'month'"), 'month must stay the default');
});

check('route: built from the SAME builders; audited with COUNTS only', () => {
  assert(ROUTE.includes('buildAccountMovement('), 'movement builder missing');
  assert(ROUTE.includes('accountMovementToCsv('), 'csv builder missing');
  assert(ROUTE.includes('buildAccountBundle('), 'bundle builder missing');
  assert(ROUTE.includes("'PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED'"), 'audit action missing');
  const meta = ROUTE.split('metadata: {')[1]?.split('}).catch')[0] ?? '';
  assert(meta.includes('files: bundle.fileCount'), 'file count missing');
  assert(meta.includes('postedLines: bundle.totalLines'), 'line count missing');
  assert(meta.includes('quietAccounts:'), 'quiet count missing');
  assert(!meta.includes('accountCode'), 'codes ride the manifest, never the row');
});

check('route: answers a zip attachment, never a page', () => {
  assert(ROUTE.includes("'Content-Type': 'application/zip',"), 'wrong content type');
  assert(ROUTE.includes('attachment; filename='), 'no disposition');
  assert(ROUTE.includes("'Cache-Control': 'no-store',"), 'no no-store');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('page: the browse box carries its governed exit', () => {
  for (const tid of [
    'payroll-account-bundle-row',
    'payroll-account-bundle-door',
    'payroll-account-bundle-note',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `missing data-testid: ${tid}`);
  }
  assert(PAGE.includes('pickerAccounts.filter((a) => a.periodLines > 0).length'), 'active gate missing');
  assert(PAGE.includes('bundleActiveCount > 0 && ('), 'door must hide when nothing posted');
  assert(PAGE.includes("{bundleBusy ? 'Building…' : `File all ${bundleActiveCount} accounts`}"), 'busy label missing');
  assert(PAGE.includes('one zip · month window'), 'window honesty missing');
  assert(PAGE.includes('role="status"'), 'note must speak');
});

check('page: the exit rides the route and the download discipline; stale state reset', () => {
  assert(PAGE.includes('/api/payroll/period-journal/accounts/export-bundle?periodId='), 'fetch URL missing');
  assert(PAGE.includes('encodeURIComponent(payload.period.id)'), 'anchor not encoded');
  assert(PAGE.includes('URL.createObjectURL(blob)'), 'blob discipline missing');
  assert(PAGE.includes('URL.revokeObjectURL(objUrl)'), 'revoke missing');
  const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
  assert(effect.includes('setBundleNote(null)'), 'note not reset per period');
  assert(effect.includes('setBundleBusy(false)'), 'busy not reset per period');
});

check('page: prior v2.98–v2.106 anchors survive the restructure', () => {
  for (const tid of [
    'payroll-ledger-line',
    'payroll-ledger-csv',
    'payroll-account-movement',
    'payroll-account-window-month',
    'payroll-account-window-year',
    'payroll-account-year-strip',
    'payroll-account-picker',
    'payroll-account-picker-idle',
    'payroll-account-picker-recent-chip',
    'payroll-account-picker-browse-door',
    'payroll-account-picker-browse',
    'payroll-account-picker-hint',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `prior anchor lost: ${tid}`);
  }
  assert(PAGE.includes('if (pickerOpen) e.preventDefault();'), 'layered veto lost');
  assert(PAGE.includes("void openAccountMovement(code, 'month');"), 'month-door doctrine lost');
});

// ── 5. The tests exist and are house-shaped ─────────────────────────────────
check('tests: the bundle suite exists with real coverage', () => {
  const cases = TEST.split('it(').length - 1;
  assert(cases >= 28, `expected >=28 cases, got ${cases}`);
  assert(TEST.includes('0xcbf43926'), 'CRC check value untested');
  assert(TEST.includes('0x02014b50'), 'central dir untested');
  assert(TEST.includes('buildAccountBundle('), 'bundle builder untested');
  assert(TEST.includes("WN.indexOf(\"version: '2.107.0'\")"), 'whats-new lead untested');
});

check('tests: the changelog counter re-anchored for the 2.114.0-fed feed', () => {
  // v2.114.0 chore re-anchor (mechanical): the counter test now rides the
  // 2.114.0-fed feed — these are the lines the committed test carries TODAY.
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(4);"), 'three-behind count missing');
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(5);"), 'four-behind count missing');
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(36);"), '2.77.0 count missing');
});

console.log(`\nverify-v2-107-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
