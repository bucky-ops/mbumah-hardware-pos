// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.106.0: the picker remembers and browses. The contract:
 *
 *   1. MEMORY FOLLOWS THE CHART — a picked code is remembered only when the
 *      fetched index knows it, canonicalized to the chart's own spelling,
 *      client-local (localStorage), capped at a glance (3), deduped
 *      case-insensitively, newest-first. An unknown code (the honest-no
 *      path) is a question, not a door, and a question is not remembered.
 *   2. THE MEMORY READ IS NARROWED BEFORE ANY USE — a corrupted, foreign
 *      or non-array payload degrades to [] (an empty memory, never a
 *      crash); every surviving code must match the chart case-
 *      insensitively and rides the CANONICAL spelling, so a chip can never
 *      open a door that 404s.
 *   3. THE BROWSE DOOR IS THE SAME TRUTH — the whole chart, grouped by
 *      type through ONE pure builder (groups alphabetical, accounts by
 *      code ascending, missing types in their own UNCLASSIFIED bucket,
 *      never dropped), walked by the SAME keyboard contract, wearing the
 *      SAME activity/quiet badges. Typing leaves browse; the two never mix.
 *   4. LAYERED ESC — the box now opens on focus (idle panel: recents +
 *      browse door), so the drawer's Radix veto is the BOX itself, not the
 *      query; the input's handler steps the layers back (browse → box →
 *      drawer) and the next Esc closes the drawer the Radix way.
 *   5. STALE STATE NEVER GREETS THE NEXT PERIOD — the browse flag resets
 *      with the picker's per-period hygiene; the memory persists (it is a
 *      memory, not a period state) but re-answers to each period's chart.
 *   6. A FAILED INDEX STAYS HONEST BY ABSENCE — no chips, no browse door,
 *      and the idle panel says so plainly while typing still asks the
 *      ledger.
 */

import {
  rememberAccountCode,
  parseRecentAccountCodes,
  groupAccountsByType,
  ACCOUNT_PICKER_RECENTS_KEY,
  ACCOUNT_PICKER_RECENTS_CAP,
  type AccountPickerEntry,
} from '@/lib/hr/payroll/period-journal';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const entry = (over: Partial<AccountPickerEntry>): AccountPickerEntry => ({
  code: '5200',
  name: 'Salaries Expense',
  type: 'EXPENSE',
  normalBalance: 'DEBIT',
  periodLines: 0,
  ...over,
});

const CHART: AccountPickerEntry[] = [
  entry({ code: '1000', name: 'Cash on Hand', type: 'ASSET', normalBalance: 'DEBIT', periodLines: 4 }),
  entry({ code: '1100', name: 'Bank — Equity', type: 'ASSET', normalBalance: 'DEBIT', periodLines: 0 }),
  entry({ code: '2210', name: 'PAYE Payable', type: 'LIABILITY', normalBalance: 'CREDIT', periodLines: 3 }),
  entry({ code: '5200', name: 'Salaries Expense', type: 'EXPENSE', normalBalance: 'DEBIT', periodLines: 2 }),
];

describe('rememberAccountCode — the memory write', () => {
  it('the picked code moves to the front, newest-first', () => {
    expect(rememberAccountCode(['1000', '2210'], '5200')).toEqual(['5200', '1000', '2210']);
  });

  it('duplicates collapse case-insensitively (asked in any case, remembered once)', () => {
    expect(rememberAccountCode(['5200', '1000'], '5200')).toEqual(['5200', '1000']);
    expect(rememberAccountCode(['5200', '1000'], '5200 '.toUpperCase())).toEqual(['5200', '1000']);
  });

  it('the cap is a glance: the default is 3 and the tail yields', () => {
    expect(ACCOUNT_PICKER_RECENTS_CAP).toBe(3);
    expect(rememberAccountCode(['a', 'b', 'c'], 'd')).toEqual(['d', 'a', 'b']);
  });

  it('the cap clamps to at least 1 (zero, negative, NaN, Infinity degrade — never unbounded)', () => {
    expect(rememberAccountCode(['a', 'b'], 'c', 0)).toEqual(['c']);
    expect(rememberAccountCode(['a', 'b'], 'c', -2)).toEqual(['c']);
    expect(rememberAccountCode(['a', 'b'], 'c', Number.NaN)).toEqual(['c']);
    expect(rememberAccountCode(['a', 'b'], 'c', Number.POSITIVE_INFINITY)).toEqual(['c']);
  });

  it('an empty or whitespace code changes nothing (a blank door is not a door)', () => {
    expect(rememberAccountCode(['a', 'b'], '')).toEqual(['a', 'b']);
    expect(rememberAccountCode(['a', 'b'], '   ')).toEqual(['a', 'b']);
    expect(rememberAccountCode(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('junk input degrades to a filtered copy, never throws', () => {
    expect(rememberAccountCode(null as unknown as string[], 'a')).toEqual(['a']);
    expect(rememberAccountCode(undefined as unknown as string[], 'a')).toEqual(['a']);
    // the WRITE keeps string-ish junk ('42'); the READ (parse) is the layer
    // that answers to the chart — so junk can render no chip and open no
    // door. Two layers, one honesty.
    expect(rememberAccountCode([null, 42, '  ', 'b'] as unknown as string[], 'a')).toEqual(['a', '42', 'b']);
  });
});

describe('parseRecentAccountCodes — the memory read', () => {
  it('valid JSON rides in, filtered to the chart and canonicalized', () => {
    // stored lowercase vs the chart's own spelling — the chip carries the
    // CANONICAL code, so the door it opens is the account the ledger knows.
    expect(parseRecentAccountCodes('["5200","1000"]', ['5200', '1000'])).toEqual(['5200', '1000']);
    expect(parseRecentAccountCodes('["5200"]', ['5200'])).toEqual(['5200']);
  });

  it('case-insensitive match rewrites to the chart spelling; unknown codes drop', () => {
    expect(parseRecentAccountCodes('["5200","9999"]', ['5200'])).toEqual(['5200']);
    expect(parseRecentAccountCodes('["x200"]', ['5200'])).toEqual([]);
  });

  it('corrupted memory is an empty memory, never a crash', () => {
    expect(parseRecentAccountCodes('not json', ['5200'])).toEqual([]);
    expect(parseRecentAccountCodes('{"a":1}', ['5200'])).toEqual([]);
    expect(parseRecentAccountCodes('"5200"', ['5200'])).toEqual([]);
    expect(parseRecentAccountCodes('null', ['5200'])).toEqual([]);
  });

  it('non-string payloads degrade to []', () => {
    expect(parseRecentAccountCodes(undefined, ['5200'])).toEqual([]);
    expect(parseRecentAccountCodes(null, ['5200'])).toEqual([]);
    expect(parseRecentAccountCodes(42, ['5200'])).toEqual([]);
    expect(parseRecentAccountCodes(['5200'], ['5200'])).toEqual([]);
  });

  it('empties drop, duplicates collapse on first occurrence, order preserved', () => {
    expect(parseRecentAccountCodes('["5200","","5200","1000"]', ['5200', '1000']))
      .toEqual(['5200', '1000']);
  });

  it('the storage key is the client-local contract the page reads and writes', () => {
    expect(ACCOUNT_PICKER_RECENTS_KEY).toBe('mbumah.payroll.account-picker.recent');
  });
});

describe('groupAccountsByType — the browse door shape', () => {
  it('groups sort alphabetically, accounts within by code ascending', () => {
    const groups = groupAccountsByType([...CHART].reverse());
    expect(groups.map((g) => g.type)).toEqual(['ASSET', 'EXPENSE', 'LIABILITY']);
    const asset = groups[0].accounts.map((a) => a.code);
    expect(asset).toEqual(['1000', '1100']);
  });

  it('a missing or blank type degrades to its own UNCLASSIFIED bucket, never dropped', () => {
    const groups = groupAccountsByType([
      entry({ code: '9000', type: '' }),
      entry({ code: '9100', type: undefined as unknown as string }),
      entry({ code: '1000', type: 'ASSET' }),
    ]);
    const types = groups.map((g) => g.type);
    expect(types).toEqual(['ASSET', 'UNCLASSIFIED']);
    expect(groups[1].accounts.map((a) => a.code)).toEqual(['9000', '9100']);
  });

  it('empty or non-array input groups to []', () => {
    expect(groupAccountsByType([])).toEqual([]);
    expect(groupAccountsByType(null as unknown as AccountPickerEntry[])).toEqual([]);
    expect(groupAccountsByType(undefined as unknown as AccountPickerEntry[])).toEqual([]);
  });

  it('fields ride untouched — the group holds the same entries, not copies', () => {
    const chart = [entry({ code: '5200', periodLines: 2 })];
    const groups = groupAccountsByType(chart);
    expect(groups[0].accounts[0]).toBe(chart[0]);
    expect(groups[0].accounts.length).toBe(1);
  });

  it('sparse entries never throw (null rows degrade, not crash)', () => {
    const groups = groupAccountsByType([
      null as unknown as AccountPickerEntry,
      entry({ code: '1000' }),
    ]);
    // the null row is skipped; the survivor keeps the factory's own type
    expect(groups.map((g) => g.type)).toEqual(['EXPENSE']);
    expect(groups[0].accounts.map((a) => a.code)).toEqual(['1000']);
  });
});

describe('the page — the picker speaks on focus, remembers, and browses', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('carries the v2.106.0 anchors', () => {
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
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
    // the two option voices live in the shared row renderer's ternary —
    // one markup, two namespaces
    expect(PAGE.includes("variant === 'suggestion' ? 'payroll-account-picker-option' : 'payroll-account-picker-browse-option'")).toBe(true);
  });

  it('focus opens the box even with an empty query — an account needs no spelling', () => {
    const focus = PAGE.split('onFocus={() => {')[1]?.split('}}')[0] ?? '';
    expect(focus).toContain('setPickerOpen(true)');
  });

  // v2.108.0: the memory can be let go — one quiet affordance on the
  // Recent row that forgets THIS browser's remembered doors. The chart
  // itself is never touched; the empty note returns; a private-mode
  // denial still leaves the memory alive in state for the visit.
  it('the Clear affordance forgets the browser memory without touching the chart', () => {
    expect(PAGE.includes('data-testid="payroll-account-picker-recent-clear"')).toBe(true);
    // The whole button lives between its testid and its own closing tag —
    // the first `</button>` after the testid is the clear button's own.
    const button = PAGE.split('data-testid="payroll-account-picker-recent-clear"')[1]?.split('</button>')[0] ?? '';
    expect(button).toContain('aria-label="Clear recent accounts"');
    expect(button).toContain('onClick={() => {');
    expect(button).toContain('setPickerRecents([])');
    expect(button).toContain('window.localStorage.removeItem(ACCOUNT_PICKER_RECENTS_KEY)');
    expect(button).toContain('the chart itself is never touched');
  });

  it('typing leaves the browse chart — the two voices never mix', () => {
    expect(PAGE.includes('if (e.target.value.trim()) setPickerBrowseOpen(false);')).toBe(true);
  });

  it('the idle panel: recents render as validated chips with the chart name', () => {
    expect(PAGE.includes('parseRecentAccountCodes(raw, pickerAccounts.map((a) => a.code))')).toBe(true);
    expect(PAGE.includes("window.localStorage.getItem(ACCOUNT_PICKER_RECENTS_KEY)")).toBe(true);
    expect(PAGE.includes("known?.name ?? code")).toBe(true);
  });

  it('the memory write: only a chart-known code is remembered, canonicalized, capped', () => {
    expect(PAGE.includes('const known = pickerAccounts.find(')).toBe(true);
    expect(PAGE.includes('rememberAccountCode(prev, known.code)')).toBe(true);
    expect(PAGE.includes('window.localStorage.setItem(ACCOUNT_PICKER_RECENTS_KEY, JSON.stringify(next))')).toBe(true);
    // the unknown-code path skips the memory (a question is not a door)
    const pick = PAGE.split('const pickAccount = (code: string) => {')[1]?.split('void openAccountMovement')[0] ?? '';
    expect(pick.includes('if (known) {')).toBe(true);
  });

  it('the browse door opens through the pure builder — one truth, no second chart', () => {
    expect(PAGE.includes('groupAccountsByType(pickerAccounts)')).toBe(true);
    expect(PAGE.includes('pickerGroups.flatMap((g) => g.accounts)')).toBe(true);
    expect(PAGE.includes('Browse all {pickerAccounts.length} accounts')).toBe(true);
    expect(PAGE.includes("{String(g.type).replaceAll('_', ' ')}")).toBe(true);
  });

  it('in browse mode the keyboard walks the chart and Enter opens the highlighted row', () => {
    const down = PAGE.split("e.key === 'ArrowDown'")[1]?.split("} else if (e.key === 'ArrowUp')")[0] ?? '';
    expect(down.includes('if (pickerBrowseOpen && !pickerQuery.trim())')).toBe(true);
    expect(down.includes('pickerBrowseRows.length - 1')).toBe(true);
    const enter = PAGE.split("e.key === 'Enter'")[1]?.split("} else if (e.key === 'Escape')")[0] ?? '';
    expect(enter.includes('if (pickerBrowseOpen && !pickerQuery.trim())')).toBe(true);
    expect(enter.includes('const row = pickerBrowseRows[pickerHighlight];')).toBe(true);
    expect(enter.includes('if (row) pickAccount(row.code);')).toBe(true);
  });

  it('layered Esc: browse steps back first, then the box, then the drawer', () => {
    const esc = PAGE.split("e.key === 'Escape'")[1]?.split('}')[0] ?? '';
    expect(esc.includes('if (pickerBrowseOpen) setPickerBrowseOpen(false);')).toBe(true);
    expect(esc.includes('else if (pickerOpen) setPickerOpen(false);')).toBe(true);
    // the Radix veto is the BOX itself now (the idle panel speaks with no
    // query) — re-anchored from the v2.105.0 query-guarded form
    expect(PAGE.includes('if (pickerOpen) e.preventDefault();')).toBe(true);
    expect(PAGE.includes('if (pickerOpen && pickerQuery.trim().length > 0) e.preventDefault();')).toBe(false);
  });

  it('the combobox speaks both voices to assistive tech', () => {
    expect(PAGE.includes('aria-controls="payroll-account-picker-suggestions payroll-account-picker-browse"')).toBe(true);
    expect(PAGE.includes('aria-expanded={pickerOpen && (pickerQuery.trim().length > 0 || pickerBrowseOpen)}')).toBe(true);
    expect(PAGE.includes('payroll-account-picker-browse-opt-${pickerHighlight}')).toBe(true);
    expect(PAGE.includes('role="listbox"')).toBe(true);
  });

  it('stale browse state never greets the next period', () => {
    const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
    expect(effect).toContain('setPickerBrowseOpen(false)');
  });

  it('a failed index stays honest by absence — no chips, no door, typing still works', () => {
    expect(PAGE.includes('The chart index did not load')).toBe(true);
    expect(PAGE.includes('Pick an account and it will be remembered here — in this browser only.')).toBe(true);
  });

  it('prior v2.105.0 picker anchors survive the restructure', () => {
    for (const tid of [
      'payroll-account-picker',
      'payroll-account-picker-input',
      'payroll-account-picker-suggestions',
      'payroll-account-picker-empty',
      'payroll-account-picker-activity',
      'payroll-account-picker-quiet',
      'payroll-account-picker-hint',
    ]) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
    // the suggestion option testid moved into the shared row renderer
    expect(PAGE.includes("'payroll-account-picker-option'")).toBe(true);
    expect(PAGE.includes("void openAccountMovement(code, 'month');")).toBe(true);
    expect(PAGE.includes('filterAccountSuggestions(pickerAccounts, pickerQuery)')).toBe(true);
  });
});

describe('whats-new — the memory-and-browse story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('2.106.0 leads and 2.105.0 follows (newest first)', () => {
    const i106 = WN.indexOf("version: '2.106.0'");
    const i105 = WN.indexOf("version: '2.105.0'");
    expect(i106).toBeGreaterThanOrEqual(0);
    expect(i105).toBeGreaterThan(i106);
  });

  it('the entry tells the memory-and-browse story with its honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.106.0'"), WN.indexOf("version: '2.105.0'"));
    expect(slice.includes("title: 'The picker remembers and browses'")).toBe(true);
    for (const phrase of [
      'violet chips',
      'grouped by type',
      'this browser only',
      'honest by absence',
      'layered Esc',
      'widens nothing',
    ]) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
