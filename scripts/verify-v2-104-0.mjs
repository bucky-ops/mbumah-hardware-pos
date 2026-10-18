#!/usr/bin/env node
// v2.104.0 verification — "the account opens its year".
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
const ACCOUNT_ROUTE = read('src/app/api/payroll/period-journal/account/route.ts');
const EXPORT_ROUTE = read('src/app/api/payroll/period-journal/account/export/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-account-year.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.104.0', () => {
  assert(atLeast(PKG.version, '2.104.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.104.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.104.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.104.0 and tells the year story', () => {
  const i104 = WN.indexOf("version: '2.104.0'");
  const i103 = WN.indexOf("version: '2.103.0'");
  assert(i104 >= 0, 'no 2.104.0 entry');
  assert(i103 > i104, '2.103.0 must follow 2.104.0 (newest first)');
  const slice = WN.slice(i104, i103);
  assert(slice.includes("title: 'The account opens its year'"), 'missing headline');
  for (const phrase of [
    'Full year',
    'at a glance',
    'carried forward',
    'Year totals',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `missing bullet phrase: ${phrase}`);
  }
});

// ── 2. The pure builders (source-of-record pins) ────────────────────────────
check('yearMonthRollups exists with its honesty contract (throws, never lies)', () => {
  assert(BUILDER.includes('export function yearMonthRollups('), 'builder missing');
  assert(BUILDER.includes('dated outside ${year} — the year window and the replay disagree.'), 'outside-year throw');
  assert(BUILDER.includes('arrives out of order — the year rollup would close months against the wrong balance.'), 'order throw');
  assert(BUILDER.includes('carries an unreadable date — the year rollup refuses to guess.'), 'date throw');
  assert(BUILDER.includes('rollups[cursor].closing = running; // quiet months: carried forward'), 'carry-forward');
});

check('the compact glance dialect exists: K magnitudes, side letters, em-dash zero', () => {
  assert(BUILDER.includes('export function movementSideCellCompact('), 'missing');
  assert(BUILDER.includes("if (magnitude === 0) return '0 —';"), 'zero em-dash');
  assert(BUILDER.includes('magnitude >= 1000'), 'K threshold');
});

check('the CSV says the window\u2019s own word — windowNoun, never a hardcoded month', () => {
  assert(BUILDER.includes("windowNoun?: 'month' | 'year';"), 'meta field missing');
  assert(BUILDER.includes("const noun = meta.windowNoun === 'year' ? 'year' : 'month';"), 'noun resolution');
  assert(BUILDER.includes('the account starts the ${noun} at zero'), 'opening basis noun');
  assert(BUILDER.includes("noun === 'year' ? 'Year totals' : 'Month totals'"), 'totals label noun');
});

// ── 3. The routes — the year window widens nothing ──────────────────────────
check('both routes validate the window: unknown values are a 400, never a silent month', () => {
  for (const [name, ROUTE] of [['account', ACCOUNT_ROUTE], ['export', EXPORT_ROUTE]]) {
    assert(ROUTE.includes(`error: 'window must be "month" or "year".'`), `${name}: 400 missing`);
    assert(ROUTE.includes("windowParam !== null && windowParam !== 'month' && windowParam !== 'year'"), `${name}: validation missing`);
  }
});

check('the year window is the period\u2019s calendar year in UTC, prior aggregate reaches before January', () => {
  for (const [name, ROUTE] of [['account', ACCOUNT_ROUTE], ['export', EXPORT_ROUTE]]) {
    assert(ROUTE.includes('const year = period.startDate.getUTCFullYear();'), `${name}: year derivation`);
    assert(ROUTE.includes('const windowStart = window === \'year\' ? new Date(Date.UTC(year, 0, 1)) : period.startDate;'), `${name}: windowStart`);
    assert(ROUTE.includes('entryDate: { lt: windowStart },'), `${name}: prior before windowStart`);
    assert(ROUTE.includes('entryDate: { gte: windowStart, lt: windowEnd },'), `${name}: lines inside window`);
    assert(ROUTE.includes('`${year}-01-01 → ${year}-12-31`'), `${name}: window label`);
  }
});

check('a year is named a year: displayName, window echo, windowNoun, windowKind audit', () => {
  assert(ACCOUNT_ROUTE.includes("const displayName = window === 'year' ? String(year) : period.name;"), 'displayName');
  assert(ACCOUNT_ROUTE.includes('window,'), 'window echo missing');
  assert(EXPORT_ROUTE.includes('windowNoun: window,'), 'windowNoun missing');
  assert(EXPORT_ROUTE.includes('windowKind: window,'), 'audit windowKind missing');
  assert(EXPORT_ROUTE.includes('period: displayName,'), 'audit period missing');
});

check('guards and honesty unchanged: same permission, same roles, posted and never-voided', () => {
  for (const [name, ROUTE] of [['account', ACCOUNT_ROUTE], ['export', EXPORT_ROUTE]]) {
    assert(ROUTE.includes("hrGuard('hr.payroll.read.all'"), `${name}: guard`);
    assert(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']"), `${name}: roles`);
    assert(ROUTE.includes('isPosted: true,'), `${name}: isPosted`);
    assert(ROUTE.includes('isVoided: false,'), `${name}: isVoided`);
  }
  assert(EXPORT_ROUTE.includes("action: 'PAYROLL_ACCOUNT_MOVEMENT_EXPORTED'"), 'audit action');
  assert(EXPORT_ROUTE.includes("code: 'NO_MOVEMENT_DATA'"), 'honest 404');
});

// ── 4. The page — the screen cannot desync ──────────────────────────────────
check('the payload carries the served window and the fetch narrows it', () => {
  assert(PAGE.includes("window: 'month' | 'year';"), 'payload field');
  assert(PAGE.includes('const servedWindow = body.data?.window;'), 'narrowing');
  assert(PAGE.includes("(servedWindow !== 'month' && servedWindow !== 'year')"), 'window guard');
  assert(PAGE.includes('&window=${window}'), 'fetch param');
});

check('the window toggle exists with its family styling and aria states', () => {
  assert(PAGE.includes('data-testid="payroll-account-window"'), 'window row');
  assert(PAGE.includes('data-testid="payroll-account-window-month"'), 'month chip');
  assert(PAGE.includes('data-testid="payroll-account-window-year"'), 'year chip');
  assert(PAGE.includes('aria-pressed={drillWindow === \'month\'}'), 'month pressed');
  assert(PAGE.includes('aria-pressed={drillWindow === \'year\'}'), 'year pressed');
  assert(PAGE.includes("aria-label=\"Show the account's full year — every posted line from January to December, any source, with the year at a glance\""), 'year aria');
});

check('the year strip rides the pure builder — no second truth on the page', () => {
  assert(PAGE.includes("import { yearMonthRollups, movementSideCellCompact } from '@/lib/hr/payroll/period-journal';"), 'import');
  assert(PAGE.includes('yearMonthRollups(drill.opening.balance, drill.movements, drill.account.normalBalance, y)'), 'builder call');
  assert(PAGE.includes('data-testid="payroll-account-year-strip"'), 'strip');
  assert(PAGE.includes('data-testid="payroll-account-year-cell"'), 'cell');
  assert(PAGE.includes('data-month={mo.label}'), 'month attr');
  assert(PAGE.includes('movementSideCellCompact(mo.closing, drill.account.normalBalance)'), 'compact cell');
  assert(PAGE.includes('no activity, balance carried forward'), 'quiet title');
});

check('window-aware honesty everywhere: description, opening, totals, CSV note', () => {
  assert(PAGE.includes("the account's ${drill.window === 'year' ? 'year' : 'month'}, replayed line by line."), 'description noun');
  assert(PAGE.includes("the account starts the ${drill.window === 'year' ? 'year' : 'month'} at zero."), 'opening noun');
  assert(PAGE.includes("{drill.window === 'year' ? 'Year totals' : 'Month totals'}"), 'totals label');
  assert(PAGE.includes("exactly the ${drillWindow === 'year' ? 'year' : 'month'} on this dialog."), 'csv note noun');
});

check('stale-window hygiene: fresh doors open on the month, retry rides the asked window', () => {
  assert(PAGE.includes("const [drillWindow, setDrillWindow] = useState<'month' | 'year'>('month');"), 'state init');
  assert(PAGE.includes('openAccountMovement(drillCode, drillWindow)'), 'retry');
  const closeDrillSlice = PAGE.slice(PAGE.indexOf('const closeDrill = () => {'), PAGE.indexOf('const closeDrill = () => {') + 400);
  assert(closeDrillSlice.includes("setDrillWindow('month');"), 'closeDrill resets window');
});

check('the CSV exit rides the served window — the file cannot disagree with the screen', () => {
  assert(PAGE.includes('accountCode=${encodeURIComponent(drillCode)}&window=${drillWindow}'), 'export fetch window param');
});

// ── 5. The tests exist and cover the family ────────────────────────────────
check('the year test file exists and pins the honest paths', () => {
  assert(TEST.includes("yearMonthRollups(0, movement.movements, 'DEBIT', 2027)"), 'outside-year pin');
  assert(TEST.includes('arrives out of order'), 'order pin');
  assert(TEST.includes('the month path keeps its exact v2.103 bytes'), 'month-bytes pin');
  assert(TEST.includes("movementSideCellCompact(516000, 'DEBIT')).toBe('516.0K Dr')"), 'compact pin');
});

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
