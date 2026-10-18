#!/usr/bin/env node
// v2.106.0 verification — "the picker remembers and browses".
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
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/period-account-picker-browse.test.ts');
const PRIOR = read('src/tests/period-account-picker.test.ts');
const CHANGELOG = read('src/tests/console-changelog.test.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.106.0', () => {
  assert(atLeast(PKG.version, '2.106.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.106.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.106.0'), 'baseVersion');
  assert(PKG.version === PKG.mbumah.releaseVersion, 'slots must move together');
  assert(PKG.mbumah.releaseVersion === PKG.mbumah.baseVersion, 'slots must move together');
});

check('whats-new leads with 2.106.0 and tells the memory-and-browse story', () => {
  const i106 = WN.indexOf("version: '2.106.0'");
  const i105 = WN.indexOf("version: '2.105.0'");
  assert(i106 >= 0, 'no 2.106.0 entry');
  assert(i105 > i106, '2.105.0 must follow 2.106.0 (newest first)');
  const slice = WN.slice(i106, i105);
  assert(slice.includes("title: 'The picker remembers and browses'"), 'missing headline');
  for (const phrase of [
    'violet chips',
    'grouped by type',
    'this browser only',
    'honest by absence',
    'layered Esc',
    'widens nothing',
  ]) {
    assert(slice.includes(phrase), `bullet missing: ${phrase}`);
  }
});

// ── 2. The pure builders ────────────────────────────────────────────────────
check('builder: the memory pair is exported with its client-local contract', () => {
  assert(BUILDER.includes('export function rememberAccountCode('), 'no memory write');
  assert(BUILDER.includes('export function parseRecentAccountCodes('), 'no memory read');
  assert(BUILDER.includes("export const ACCOUNT_PICKER_RECENTS_KEY = 'mbumah.payroll.account-picker.recent';"), 'no storage key');
  assert(BUILDER.includes('export const ACCOUNT_PICKER_RECENTS_CAP = 3;'), 'no cap constant');
});

check('builder: the memory write is capped, deduped, and never throws', () => {
  assert(BUILDER.includes('Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 1'), 'cap clamp missing');
  assert(BUILDER.includes("if (!picked) return base;"), 'blank-code guard missing');
  assert(BUILDER.includes("return [picked, ...base.filter((r) => r.toLowerCase() !== lower)].slice(0, limit);"), 'move-to-front dedupe missing');
});

check('builder: the memory read narrows BEFORE any use and canonicalizes to the chart', () => {
  assert(BUILDER.includes("if (typeof raw !== 'string' || !raw.trim()) return [];"), 'type guard missing');
  assert(BUILDER.includes('if (!Array.isArray(parsed)) return [];'), 'array guard missing');
  assert(BUILDER.includes('const hit = canonical.get(code.toLowerCase());'), 'canonical map missing');
  assert(BUILDER.includes('if (hit && !out.includes(hit)) out.push(hit);'), 'dedupe missing');
});

check('builder: the browse door groups through ONE pure builder', () => {
  assert(BUILDER.includes('export interface AccountTypeGroup {'), 'no group interface');
  assert(BUILDER.includes('export function groupAccountsByType('), 'no group builder');
  assert(BUILDER.includes("if (!e) continue; // a null row is not an account — degrade, never crash"), 'null-row skip missing');
  assert(BUILDER.includes("const type = String(e?.type ?? '').trim() || 'UNCLASSIFIED';"), 'untyped bucket missing');
  assert(BUILDER.includes(".sort((a, b) => a[0].localeCompare(b[0]))"), 'group sort missing');
});

// ── 3. The page ─────────────────────────────────────────────────────────────
check('page: the picker speaks on focus and carries the v2.106.0 anchors', () => {
  for (const tid of [
    'payroll-account-picker-idle',
    'payroll-account-picker-recent',
    'payroll-account-picker-recent-chip',
    'payroll-account-picker-recent-empty',
    'payroll-account-picker-browse-door',
    'payroll-account-picker-browse',
    'payroll-account-picker-browse-head',
    'payroll-account-picker-browse-close',
    'payroll-account-picker-group',
    'payroll-account-picker-browse-hint',
    'payroll-account-picker-idle-absent',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `missing data-testid: ${tid}`);
  }
  assert(PAGE.includes("variant === 'suggestion' ? 'payroll-account-picker-option' : 'payroll-account-picker-browse-option'"), 'row renderer ternary missing');
});

check('page: the memory answers to THIS chart (read) and remembers only known doors (write)', () => {
  assert(PAGE.includes("window.localStorage.getItem(ACCOUNT_PICKER_RECENTS_KEY)"), 'memory read missing');
  assert(PAGE.includes('parseRecentAccountCodes(raw, pickerAccounts.map((a) => a.code))'), 'read validation missing');
  assert(PAGE.includes('const known = pickerAccounts.find('), 'known-code gate missing');
  assert(PAGE.includes('rememberAccountCode(prev, known.code)'), 'memory write missing');
  assert(PAGE.includes('window.localStorage.setItem(ACCOUNT_PICKER_RECENTS_KEY, JSON.stringify(next))'), 'persistence missing');
  const pick = PAGE.split('const pickAccount = (code: string) => {')[1]?.split('void openAccountMovement')[0] ?? '';
  assert(pick.includes('if (known) {'), 'unknown code must not be remembered');
});

check('page: the browse door rides the pure builder; typing never mixes with browse', () => {
  assert(PAGE.includes('groupAccountsByType(pickerAccounts)'), 'builder not on page');
  assert(PAGE.includes('pickerGroups.flatMap((g) => g.accounts)'), 'flattened rows missing');
  assert(PAGE.includes('if (e.target.value.trim()) setPickerBrowseOpen(false);'), 'typing must leave browse');
});

check('page: layered Esc — browse, then box, then drawer (the v2.105.0 veto, re-anchored)', () => {
  assert(PAGE.includes('if (pickerBrowseOpen) setPickerBrowseOpen(false);'), 'browse step-back missing');
  assert(PAGE.includes('else if (pickerOpen) setPickerOpen(false);'), 'box step-back missing');
  assert(PAGE.includes('if (pickerOpen) e.preventDefault();'), 'drawer veto missing');
  assert(!PAGE.includes('if (pickerOpen && pickerQuery.trim().length > 0) e.preventDefault();'), 'stale query-guarded veto must be gone');
});

check('page: the keyboard walks the chart in browse mode', () => {
  const enter = PAGE.split("e.key === 'Enter'")[1]?.split("} else if (e.key === 'Escape')")[0] ?? '';
  assert(enter.includes('const row = pickerBrowseRows[pickerHighlight];'), 'browse Enter missing');
  assert(enter.includes('if (row) pickAccount(row.code);'), 'browse open missing');
  assert(PAGE.includes('if (pickerBrowseOpen && !pickerQuery.trim())'), 'browse-mode keyboard gate missing');
});

check('page: assistive tech hears both voices', () => {
  assert(PAGE.includes('aria-controls="payroll-account-picker-suggestions payroll-account-picker-browse"'), 'aria-controls missing');
  assert(PAGE.includes('aria-expanded={pickerOpen && (pickerQuery.trim().length > 0 || pickerBrowseOpen)}'), 'aria-expanded missing');
  assert(PAGE.includes('payroll-account-picker-browse-opt-${pickerHighlight}'), 'browse activedescendant missing');
});

check('page: stale browse state never greets the next period; failed index honest by absence', () => {
  const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
  assert(effect.includes('setPickerBrowseOpen(false)'), 'browse flag not reset per period');
  assert(PAGE.includes('The chart index did not load'), 'honest-absence note missing');
  assert(PAGE.includes('Pick an account and it will be remembered here — in this browser only.'), 'empty-memory note missing');
});

check('page: prior v2.98–v2.105 anchors survive the restructure', () => {
  for (const tid of [
    'payroll-ledger-line',
    'payroll-ledger-csv',
    'payroll-account-movement',
    'payroll-account-window-month',
    'payroll-account-window-year',
    'payroll-account-year-strip',
    'payroll-account-picker',
    'payroll-account-picker-input',
    'payroll-account-picker-suggestions',
    'payroll-account-picker-empty',
    'payroll-account-picker-activity',
    'payroll-account-picker-quiet',
    'payroll-account-picker-hint',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `prior anchor lost: ${tid}`);
  }
  assert(PAGE.includes("void openAccountMovement(code, 'month');"), 'month-door doctrine lost');
  assert(PAGE.includes('filterAccountSuggestions(pickerAccounts, pickerQuery)'), 'pure rank lost');
});

// ── 4. The tests exist and are house-shaped ─────────────────────────────────
check('tests: the browse suite exists with real coverage', () => {
  const cases = TEST.split('it(').length - 1;
  assert(cases >= 25, `expected >=25 cases, got ${cases}`);
  assert(TEST.includes('rememberAccountCode'), 'memory write untested');
  assert(TEST.includes('parseRecentAccountCodes'), 'memory read untested');
  assert(TEST.includes('groupAccountsByType'), 'group builder untested');
  assert(TEST.includes("WN.indexOf(\"version: '2.106.0'\")"), 'whats-new lead untested');
});

check('tests: the v2.105.0 picker suite re-anchored to the layered veto', () => {
  assert(PRIOR.includes("expect(PAGE.includes('if (pickerOpen) e.preventDefault();')).toBe(true);"), 'prior veto pin not re-anchored');
  assert(!PRIOR.includes('if (pickerOpen && pickerQuery.trim().length > 0) e.preventDefault();'), 'stale veto pin still present');
});

check('tests: the changelog counter re-anchored for the 2.106.0-fed feed', () => {
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.104.0')).toBe(1);"), 'one-behind count missing');
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.103.0')).toBe(2);"), 'two-behind count missing');
  assert(CHANGELOG.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(28);"), '2.77.0 count missing');
});

console.log(`\nverify-v2-106-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
