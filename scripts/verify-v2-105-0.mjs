#!/usr/bin/env node
// v2.105.0 verification — "the ledger answers for any account".
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
const INDEX_ROUTE = read('src/app/api/payroll/period-journal/accounts/route.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-account-picker.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.105.0', () => {
  assert(atLeast(PKG.version, '2.105.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.105.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.105.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.105.0 and tells the picker story', () => {
  const i105 = WN.indexOf("version: '2.105.0'");
  const i104 = WN.indexOf("version: '2.104.0'");
  assert(i105 >= 0, 'no 2.105.0 entry');
  assert(i104 > i105, '2.104.0 must follow 2.105.0 (newest first)');
  const slice = WN.slice(i105, i104);
  assert(slice.includes("title: 'The ledger answers for any account'"), 'missing headline');
  for (const phrase of [
    'account picker',
    'in this month',
    'quiet',
    'honest no',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `bullet missing: ${phrase}`);
  }
});

// ── 2. The pure rank ────────────────────────────────────────────────────────
check('builder: filterAccountSuggestions + AccountPickerEntry are exported', () => {
  assert(BUILDER.includes('export interface AccountPickerEntry {'), 'no entry interface');
  assert(BUILDER.includes('export function filterAccountSuggestions('), 'no rank function');
});

check('builder: the rank is match quality — exact code, then prefix, then name', () => {
  assert(BUILDER.includes('if (code === q) return 0;'), 'exact-code rank missing');
  assert(BUILDER.includes('if (code.startsWith(q)) return 1;'), 'prefix rank missing');
  assert(BUILDER.includes('if (name.includes(q)) return 2;'), 'name rank missing');
  assert(BUILDER.includes("a.r - b.r || String(a.e.code).localeCompare(String(b.e.code))"), 'stable tie-break missing');
});

check('builder: empty query returns nothing; cap clamps to at least 1', () => {
  assert(BUILDER.includes("const q = String(query ?? '').trim().toLowerCase();"), 'trim+lower missing');
  assert(BUILDER.includes('if (!q) return [];'), 'empty-query guard missing');
  assert(BUILDER.includes('Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1'), 'cap clamp missing');
});

// ── 3. The index route ──────────────────────────────────────────────────────
check('route: the drill\u2019s exact read contract (permission + roles)', () => {
  assert(INDEX_ROUTE.includes("hrGuard('hr.payroll.read.all'"), 'wrong permission');
  assert(INDEX_ROUTE.includes("'HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'"), 'wrong roles');
});

check('route: tenant scope and honest failures (400 periodId, 404 foreign period / store)', () => {
  assert(INDEX_ROUTE.includes("error: 'periodId is required.'"), 'missing 400');
  assert(INDEX_ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }"), 'period not store-scoped');
  assert(INDEX_ROUTE.includes("where: { organizationId: store.organizationId }"), 'accounts not org-scoped');
  const count404 = INDEX_ROUTE.split('{ status: 404 }').length - 1;
  assert(count404 >= 2, `expected >=2 404s, got ${count404}`);
});

check('route: the activity window is the EXACT drill window, posted + never voided', () => {
  assert(INDEX_ROUTE.includes('monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);'), 'window not end+1day');
  assert(INDEX_ROUTE.includes('isPosted: true,'), 'posted filter missing');
  assert(INDEX_ROUTE.includes('isVoided: false,'), 'voided filter missing');
  assert(INDEX_ROUTE.includes('entryDate: { gte: period.startDate, lt: monthEnd },'), 'window bounds missing');
  assert(INDEX_ROUTE.includes("by: ['accountId'],"), 'groupBy missing');
});

check('route: quiet is a fact (periodLines 0) and no audit row lands', () => {
  assert(INDEX_ROUTE.includes('periodLines: counts.get(a.id) ?? 0,'), 'quiet truth missing');
  assert(!INDEX_ROUTE.includes('auditLog'), 'a read endpoint must not audit');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('page: the picker carries its anchors', () => {
  for (const tid of [
    'payroll-account-picker',
    'payroll-account-picker-input',
    'payroll-account-picker-suggestions',
    'payroll-account-picker-option',
    'payroll-account-picker-empty',
    'payroll-account-picker-activity',
    'payroll-account-picker-quiet',
    'payroll-account-picker-hint',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `missing data-testid: ${tid}`);
  }
});

check('page: the index fetch rides the period anchor, narrowed before any cast', () => {
  assert(PAGE.includes('/api/payroll/period-journal/accounts?periodId='), 'fetch URL missing');
  assert(PAGE.includes('encodeURIComponent(pickerPeriodId)'), 'anchor not encoded');
  assert(PAGE.includes('!Array.isArray(body.data.accounts)'), 'envelope narrowing missing');
  assert(PAGE.includes('let cancelled = false;'), 'cancellation flag missing');
});

check('page: a picker door opens on the MONTH; keyboard contract wired', () => {
  assert(PAGE.includes("void openAccountMovement(code, 'month');"), 'picker door must open on the month');
  for (const key of ["e.key === 'ArrowDown'", "e.key === 'ArrowUp'", "e.key === 'Enter'", "e.key === 'Escape'"]) {
    assert(PAGE.includes(key), `keyboard missing: ${key}`);
  }
  assert(PAGE.includes('pickAccount(pickerQuery.trim())'), 'honest unknown-code path missing');
  // E2E-caught: the first Esc belongs to the suggestions — the drawer's
  // own onEscapeKeyDown veto (Radix's sanctioned hook; a synthetic
  // stopPropagation was proven NOT to stop the dismiss live) keeps the
  // ledger drawer open while the box speaks.
  assert(PAGE.includes('onEscapeKeyDown='), 'Esc veto hook missing');
  assert(PAGE.includes('if (pickerOpen && pickerQuery.trim().length > 0) e.preventDefault();'), 'Esc veto missing');
  assert(PAGE.includes('if (pickerOpen) setPickerOpen(false);'), 'local box dismiss missing');
});

check('page: the listbox speaks assistive tech', () => {
  assert(PAGE.includes('role="listbox"'), 'no listbox role');
  assert(PAGE.includes('role="option"'), 'no option role');
  assert(PAGE.includes('aria-selected={i === pickerHighlight}'), 'no aria-selected');
  assert(PAGE.includes('aria-activedescendant='), 'no aria-activedescendant');
});

check('page: stale picker state never greets the next period', () => {
  const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
  assert(effect.includes("setPickerQuery('')"), 'query not reset per period');
  assert(effect.includes('setPickerOpen(false)'), 'open flag not reset per period');
  assert(effect.includes('setPickerHighlight(0)'), 'highlight not reset per period');
});

check('page: prior v2.98–v2.104 anchors survive the restructure', () => {
  for (const tid of [
    'payroll-ledger-line',
    'payroll-ledger-csv',
    'payroll-account-movement',
    'payroll-account-window-month',
    'payroll-account-window-year',
    'payroll-account-year-strip',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `prior anchor lost: ${tid}`);
  }
});

// ── 5. The tests exist and are house-shaped ─────────────────────────────────
check('tests: the picker suite exists with real coverage', () => {
  const cases = TEST.split('it(').length - 1;
  assert(cases >= 25, `expected >=25 cases, got ${cases}`);
  assert(TEST.includes('filterAccountSuggestions'), 'pure rank untested');
  assert(TEST.includes("WN.indexOf(\"version: '2.105.0'\")"), 'whats-new lead untested');
});

console.log(`\nverify-v2-105-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
