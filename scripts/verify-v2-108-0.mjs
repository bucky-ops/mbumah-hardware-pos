#!/usr/bin/env node
// v2.108.0 verification — "the chart files its year".
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
check('version slots are at least 2.108.0', () => {
  assert(atLeast(PKG.version, '2.108.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.108.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.108.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.108.0 and tells the year story', () => {
  const i108 = WN.indexOf("version: '2.108.0'");
  const i107 = WN.indexOf("version: '2.107.0'");
  assert(i108 >= 0, '2.108.0 entry missing');
  assert(i107 > i108, '2.107.0 must follow 2.108.0');
  const slice = WN.slice(i108, i107);
  assert(slice.includes("title: 'The chart files its year'"), 'title missing');
  for (const phrase of ['File the year', 'no count on purpose', 'Year totals', 'Clear button', 'widens nothing']) {
    assert(slice.includes(phrase), `phrase missing: ${phrase}`);
  }
});

// ── 2. The route — window=year, the account route's exact discipline ────────
check('route: guard, roles and tenant scoping unchanged', () => {
  assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'guard changed');
  assert(ROUTE.includes("'HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'"), 'roles changed');
  assert(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'tenant scoping changed');
});

check('route: the layered window — month default, year choice, unknown 400', () => {
  assert(ROUTE.includes("searchParams.get('window')"), 'window param missing');
  assert(ROUTE.includes("windowParam !== 'month' && windowParam !== 'year'"), 'validation missing');
  assert(ROUTE.includes('window must be "month" or "year".'), '400 message missing');
  assert(ROUTE.includes("const window: 'month' | 'year' = windowParam === 'year' ? 'year' : 'month';"), 'default form changed');
});

check('route: year arithmetic — the calendar year the period starts in', () => {
  assert(ROUTE.includes('const year = period.startDate.getUTCFullYear();'), 'year derivation missing');
  assert(ROUTE.includes("window === 'year' ? new Date(Date.UTC(year, 0, 1)) : period.startDate"), 'windowStart wrong');
  assert(ROUTE.includes("window === 'year' ? new Date(Date.UTC(year + 1, 0, 1)) : monthEnd"), 'windowEnd wrong');
  assert(ROUTE.includes('`${year}-01-01 → ${year}-12-31`'), 'year label wrong');
  assert(ROUTE.includes("const displayName = window === 'year' ? String(year) : period.name;"), 'displayName wrong');
});

check('route: the bounds are inclusive and honest (posted, never voided)', () => {
  assert(ROUTE.includes('monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);'), 'month inclusive end lost');
  assert(ROUTE.includes('entryDate: { lt: windowStart },'), 'prior bound not windowed');
  assert(ROUTE.includes('entryDate: { gte: windowStart, lt: windowEnd },'), 'window bound wrong');
  assert(ROUTE.includes('isPosted: true,'), 'isPosted lost');
  assert(ROUTE.includes('isVoided: false,'), 'isVoided lost');
});

check('route: member CSVs say the window word through the SAME builders', () => {
  assert(ROUTE.includes('buildAccountMovement('), 'movement builder missing');
  assert(ROUTE.includes('accountMovementToCsv('), 'csv builder missing');
  assert(ROUTE.includes('buildAccountBundle('), 'bundle builder missing');
  assert(ROUTE.includes('windowNoun: window,'), 'windowNoun not riding the choice');
  assert(ROUTE.includes('periodName: displayName,'), 'periodName not the display form');
  assert(!ROUTE.includes("windowNoun: 'month',"), 'hardcoded month noun survived');
});

check('route: quiet is a fact, not a file', () => {
  assert(ROUTE.includes('quiet is a fact, not a file'), 'quiet doctrine comment lost');
  assert(ROUTE.includes('quietCount: accounts.length - accountFiles.length,'), 'quiet count lost');
  assert(ROUTE.includes('NO_MOVEMENT_DATA'), 'empty-window 404 lost');
});

check('route: audit counts only, names the window kind', () => {
  assert(ROUTE.includes("'PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED'"), 'audit action lost');
  const meta = ROUTE.split('metadata: {')[1]?.split('}).catch')[0] ?? '';
  assert(meta.includes('files: bundle.fileCount'), 'files count missing');
  assert(meta.includes('postedLines: bundle.totalLines'), 'posted lines missing');
  assert(meta.includes('quietAccounts:'), 'quiet accounts missing');
  assert(meta.includes('windowKind: window,'), 'window kind missing');
  assert(meta.includes('period: displayName,'), 'period word missing');
  assert(!meta.includes('accountCode'), 'employee/account codes ride the row — forbidden');
});

check('route: zip attachment discipline', () => {
  assert(ROUTE.includes("'Content-Type': 'application/zip',"), 'content type lost');
  assert(ROUTE.includes('attachment; filename='), 'disposition lost');
  assert(ROUTE.includes("'Cache-Control': 'no-store',"), 'no-store lost');
});

// ── 3. The builder — same shape, year arrives as words ─────────────────────
check('builder: the year story is told and the manifest shape stands', () => {
  assert(BUNDLE.includes('v2.108.0: …and its year'), 'year story missing from the builder');
  assert(BUNDLE.includes("row(['Report', 'Payroll account movements bundle']);"), 'manifest header lost');
  assert(BUNDLE.includes("row(['Period', meta.periodName]);"), 'Period row lost');
  assert(BUNDLE.includes("row(['Window', meta.windowLabel]);"), 'Window row lost');
  assert(BUNDLE.includes("row(['Files', files.length]);"), 'Files row lost');
  assert(BUNDLE.includes("'Quiet accounts (no posted lines in the window — not filed)',"), 'quiet row lost');
  assert(BUNDLE.includes('MANIFEST.txt'), 'manifest-first lost');
  assert(BUNDLE.includes('periodSlug(meta.periodName'), 'governed slug lost');
  assert(BUNDLE.includes('ArrayBuffer.isView(entry.bytes)'), 'cross-realm narrowing lost');
});

// ── 4. The page — two doors, one grid, and the clear affordance ─────────────
check('page: the v2.108.0 pair with its own heading', () => {
  assert(PAGE.includes('data-testid="payroll-account-bundle-year-door"'), 'year door missing');
  assert(PAGE.includes('File the chart'), 'micro-heading missing');
  assert(PAGE.includes('grid grid-cols-2 gap-1.5'), 'the pair is not a grid');
  assert(PAGE.includes("{bundleBusy ? 'Building…' : 'File the year'}"), 'year door label wrong');
  assert(PAGE.includes("{bundleYear ? `${bundleYear} window` : 'year window'}"), 'year window label wrong');
  assert(PAGE.includes('bundleYear = payload?.period?.startDate ? payload.period.startDate.slice(0, 4) : null'), 'year derivation missing');
});

check('page: the month door keeps its v2.107.0 count honesty', () => {
  assert(PAGE.includes('pickerAccounts.filter((a) => a.periodLines > 0).length'), 'badge truth lost');
  assert(PAGE.includes('bundleActiveCount > 0 && ('), 'active gate lost');
  assert(PAGE.includes("{bundleBusy ? 'Building…' : `File all ${bundleActiveCount} accounts`}"), 'month label changed');
  assert(PAGE.includes('one zip · month window'), 'month window label lost');
});

check('page: both doors ask the SAME governed route, one word apart', () => {
  assert(PAGE.includes("void exportAccountBundle('month')"), 'month ask missing');
  assert(PAGE.includes("void exportAccountBundle('year')"), 'year ask missing');
  assert(PAGE.includes('&window=${bundleWindow}'), 'window querystring missing');
  assert(PAGE.includes('/api/payroll/period-journal/accounts/export-bundle?periodId='), 'route path wrong');
});

check('page: the clear affordance forgets the browser only', () => {
  assert(PAGE.includes('data-testid="payroll-account-picker-recent-clear"'), 'clear testid missing');
  assert(PAGE.includes('aria-label="Clear recent accounts"'), 'aria missing');
  assert(PAGE.includes('window.localStorage.removeItem(ACCOUNT_PICKER_RECENTS_KEY)'), 'storage wipe missing');
  assert(PAGE.includes('the chart itself is never touched'), 'honesty title missing');
});

check('page: download discipline and stale hygiene', () => {
  assert(PAGE.includes('URL.createObjectURL(blob)'), 'blob discipline missing');
  assert(PAGE.includes('URL.revokeObjectURL(objUrl)'), 'revoke missing');
  const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
  assert(effect.includes('setBundleNote(null)'), 'note not reset per period');
  assert(effect.includes('setBundleBusy(false)'), 'busy not reset per period');
});

check('page: prior anchors survive the restructure', () => {
  for (const tid of [
    'payroll-ledger-line',
    'payroll-account-picker',
    'payroll-account-picker-idle',
    'payroll-account-picker-recent-chip',
    'payroll-account-picker-recent-clear',
    'payroll-account-picker-browse-door',
    'payroll-account-picker-browse',
    'payroll-account-movement',
    'payroll-account-year-strip',
    'payroll-account-bundle-row',
    'payroll-account-bundle-door',
    'payroll-account-bundle-note',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `anchor lost: ${tid}`);
  }
  assert(PAGE.includes('if (pickerOpen) e.preventDefault();'), 'layered veto lost');
  assert(PAGE.includes("void openAccountMovement(code, 'month');"), 'month-door doctrine lost');
});

// ── 5. Tests exist and pin the year ────────────────────────────────────────
check('tests: the bundle test pins the layered window and the pair', () => {
  const cases = (TEST.match(/\bit\(/g) ?? []).length;
  assert(cases >= 37, `expected >=37 cases, got ${cases}`);
  assert(TEST.includes("WN.indexOf(\"version: '2.108.0'\")"), 'whats-new lead untested');
  assert(TEST.includes('data-testid="payroll-account-bundle-year-door"'), 'year door untested');
  assert(TEST.includes('grows the layered window'), 'window validation untested');
  assert(TEST.includes("searchParams.get('window')"), 'window param untested');
  assert(TEST.includes('payroll-account-picker-recent-clear'), 'clear affordance untested');
});

check('tests: the changelog counter re-anchored for the 2.108.0-fed feed', () => {
  // v2.108.0 leads the feed, so one-behind is 2.107.0 (not 2.106.0) and the
  // deep count moved 30 → 31. The pin mirrors the committed test exactly.
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.107.0')).toBe(1);"), 'one-behind count missing');
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.106.0')).toBe(2);"), 'two-behind count missing');
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(31);"), '2.77.0 count missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
