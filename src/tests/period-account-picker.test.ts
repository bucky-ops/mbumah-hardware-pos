// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.105.0: the ledger answers for any account — the picker. The contract:
 *
 *   1. RANKING IS MATCH QUALITY, NOT POPULARITY — exact code hit first,
 *      then code prefix, then name substring, case-insensitive, trimmed,
 *      stable on equal rank by code ascending. A quiet account that
 *      matches better outranks an active one that matches worse; the
 *      activity badge says the rest. The picker is a finder.
 *   2. AN EMPTY QUERY ASKS FOR NOTHING — no 40-account wall of noise on
 *      focus; suggestions exist only while the box speaks. The cap clamps
 *      to at least 1 (a cap of zero would make typing pointless).
 *   3. THE INDEX WIDENS NOTHING — the accounts route rides the drill's
 *      exact read contract (hr.payroll.read.all, same roles), tenant-scoped
 *      end to end: the period resolves store-scoped first (404 for a
 *      foreign one), accounts resolve through the store's organization,
 *      and the in-period activity count groups posted, never-voided lines
 *      inside the EXACT window the drill serves ([startDate, endDate + 1
 *      day)) — so "in this month" on a suggestion means the same window
 *      the drill will replay. A READ endpoint: no audit row.
 *   4. HONESTY BY ABSENCE — a failed or foreign index leaves the
 *      suggestions empty (never a fake list), typing still works, and an
 *      unknown code pressed into Enter goes to the ledger and gets the
 *      drill's honest 404. Quiet is a fact (periodLines 0, badge "quiet"),
 *      not an error and not a hidden row.
 *   5. STALE STATE NEVER GREETS THE NEXT PERIOD — the picker's query,
 *      open flag and highlight reset with the drawer's per-period effect;
 *      a fresh picker door opens on the MONTH (the year stays one click
 *      away on the dialog's window switch).
 */

import {
  filterAccountSuggestions,
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
  entry({ code: '2240', name: 'Net Pay Payable', type: 'LIABILITY', normalBalance: 'CREDIT', periodLines: 3 }),
  entry({ code: '5200', name: 'Salaries Expense', type: 'EXPENSE', normalBalance: 'DEBIT', periodLines: 2 }),
  entry({ code: '5210', name: 'Director Salaries Expense', type: 'EXPENSE', normalBalance: 'DEBIT', periodLines: 0 }),
];

describe('filterAccountSuggestions — the pure rank', () => {
  it('an empty (or whitespace-only) query asks for nothing', () => {
    expect(filterAccountSuggestions(CHART, '')).toEqual([]);
    expect(filterAccountSuggestions(CHART, '   ')).toEqual([]);
  });

  it('an exact code hit ranks first, whatever the array order', () => {
    const picks = filterAccountSuggestions(CHART, '5200');
    // Only '5200' matches its own code exactly ('5210' does not start with
    // '5200') — the exact hit stands alone.
    expect(picks.map((p) => p.code)).toEqual(['5200']);
  });

  it('code prefix outranks name substring', () => {
    // 'ba' matches "Bank — Equity" by name AND nothing by code; 'paye' only
    // by name; but '2' matches every code by prefix. Prefix rows must all
    // precede name-only rows.
    const picks = filterAccountSuggestions(CHART, '22');
    expect(picks.map((p) => p.code)).toEqual(['2210', '2240']);
  });

  it('matches by name substring, case-insensitively', () => {
    const picks = filterAccountSuggestions(CHART, 'salaries');
    expect(picks.map((p) => p.code)).toEqual(['5200', '5210']);
    expect(filterAccountSuggestions(CHART, 'SALARIES').map((p) => p.code)).toEqual(['5200', '5210']);
  });

  it('equal rank breaks ties by code ascending — stable, deterministic', () => {
    const picks = filterAccountSuggestions(CHART, '221');
    expect(picks.map((p) => p.code)).toEqual(['2210']);
    const net = filterAccountSuggestions(CHART, 'net');
    expect(net.map((p) => p.code)).toEqual(['2240']);
  });

  it('ranks by match quality only — quiet outranks active when it matches better', () => {
    // '5210' is quiet (0 lines) yet the exact hit for its own code must
    // beat '5200' (2 lines, prefix match).
    const picks = filterAccountSuggestions(CHART, '5210');
    expect(picks[0].code).toBe('5210');
    expect(picks[0].periodLines).toBe(0);
  });

  it('the cap clamps to at least 1 and truncates deterministically', () => {
    // '2' prefix-matches 2210 and 2240 only.
    expect(filterAccountSuggestions(CHART, '2', 0).map((p) => p.code)).toEqual(['2210']);
    expect(filterAccountSuggestions(CHART, '2', 2).map((p) => p.code)).toEqual(['2210', '2240']);
    const all = filterAccountSuggestions(CHART, '2', 100);
    expect(all.length).toBe(2);
    // '5' prefix-matches 5200 and 5210 — code-ascending tie-break decides.
    expect(filterAccountSuggestions(CHART, '5', 1).map((p) => p.code)).toEqual(['5200']);
  });

  it('a NaN or infinite limit degrades to 1 — never unbounded, never empty-for-typo', () => {
    expect(filterAccountSuggestions(CHART, '2', Number.NaN).length).toBe(1);
    expect(filterAccountSuggestions(CHART, '2', Number.POSITIVE_INFINITY).length).toBe(1);
  });

  it('missing name/type degrade to rank-by-code alone — never throw', () => {
    const sparse: AccountPickerEntry[] = [
      { code: '9000', name: '', type: '', normalBalance: 'DEBIT', periodLines: 0 },
    ];
    expect(filterAccountSuggestions(sparse, '90')[0].code).toBe('9000');
    expect(filterAccountSuggestions(sparse, undefined as unknown as string)).toEqual([]);
  });

  it('carries every display field through untouched — the picker never re-invents the chart', () => {
    const [cash] = filterAccountSuggestions(CHART, '1000');
    expect(cash).toEqual(CHART[0]);
  });
});

describe('accounts route — the index widens nothing', () => {
  const ROUTE = readRepo('src/app/api/payroll/period-journal/accounts/route.ts');

  it('guards exactly like the drill route (same permission, same roles)', () => {
    expect(ROUTE.includes("hrGuard('hr.payroll.read.all'")).toBe(true);
    expect(ROUTE.includes("'HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'")).toBe(true);
  });

  it('requires periodId (400) and 404s a foreign period', () => {
    expect(ROUTE.includes("error: 'periodId is required.'")).toBe(true);
    expect(ROUTE.includes("{ status: 400 }")).toBe(true);
    expect(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }")).toBe(true);
    expect(ROUTE.includes("{ status: 404 }")).toBe(true);
  });

  it('scopes accounts to the store\u2019s organization', () => {
    expect(ROUTE.includes("where: { organizationId: store.organizationId }")).toBe(true);
  });

  it('counts only posted, never-voided entries — closed doors stay closed', () => {
    expect(ROUTE.includes('isPosted: true,')).toBe(true);
    expect(ROUTE.includes('isVoided: false,')).toBe(true);
  });

  it('the activity window is the EXACT window the drill serves ([start, end + 1 day))', () => {
    expect(ROUTE.includes('monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);')).toBe(true);
    expect(ROUTE.includes('entryDate: { gte: period.startDate, lt: monthEnd },')).toBe(true);
  });

  it('carries the quiet truth: an account with no lines still lists with periodLines 0', () => {
    expect(ROUTE.includes('periodLines: counts.get(a.id) ?? 0,')).toBe(true);
  });

  it('a read endpoint lands no audit row (only exports do)', () => {
    expect(ROUTE.includes('auditLog')).toBe(false);
    expect(ROUTE.includes('createAudit')).toBe(false);
  });
});

describe('page — the picker, the keyboard, the honesty', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the picker carries its anchors', () => {
    // v2.106.0: the suggestion/browse option testids moved into the shared
    // row renderer's ternary — one markup, two namespaces.
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
    expect(PAGE.includes("'payroll-account-picker-option'")).toBe(true);
  });

  it('the index fetch rides the period anchor and narrows the envelope before any cast', () => {
    expect(PAGE.includes('/api/payroll/period-journal/accounts?periodId=')).toBe(true);
    expect(PAGE.includes('!Array.isArray(body.data.accounts)')).toBe(true);
    expect(PAGE.includes('let cancelled = false;')).toBe(true);
  });

  it('a picker door opens on the MONTH — the year stays one click away', () => {
    expect(PAGE.includes("void openAccountMovement(code, 'month');")).toBe(true);
  });

  it('the keyboard contract: ↑↓ move, Enter opens (top match or honest query), Esc dismisses', () => {
    expect(PAGE.includes("e.key === 'ArrowDown'")).toBe(true);
    expect(PAGE.includes("e.key === 'ArrowUp'")).toBe(true);
    expect(PAGE.includes("e.key === 'Enter'")).toBe(true);
    expect(PAGE.includes("pickAccount(pickerQuery.trim())")).toBe(true);
    // E2E-caught: the first Esc belongs to the SUGGESTIONS — the drawer's
    // own onEscapeKeyDown veto (Radix's sanctioned hook; a synthetic
    // stopPropagation was proven NOT to stop the dismiss live) keeps the
    // ledger drawer open while the box speaks; the second Esc (box closed)
    // closes the drawer the Radix way.
    expect(PAGE.includes("e.key === 'Escape'")).toBe(true);
    expect(PAGE.includes('onEscapeKeyDown=')).toBe(true);
    // v2.106.0: the box opens on focus (idle panel, recents, browse door) —
    // the veto is the BOX itself, not the query; the input's handler steps
    // the layers back (browse → box → drawer) and the next Esc closes the
    // drawer the Radix way.
    expect(PAGE.includes('if (pickerOpen) e.preventDefault();')).toBe(true);
    expect(PAGE.includes('else if (pickerOpen) setPickerOpen(false);')).toBe(true);
  });

  it('the listbox is wired for assistive tech (role, aria-selected, aria-activedescendant)', () => {
    expect(PAGE.includes('role="listbox"')).toBe(true);
    expect(PAGE.includes('role="option"')).toBe(true);
    expect(PAGE.includes('aria-selected={i === pickerHighlight}')).toBe(true);
    expect(PAGE.includes('aria-activedescendant=')).toBe(true);
  });

  it('stale picker state never greets the next period', () => {
    const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
    expect(effect).toContain("setPickerQuery('')");
    expect(effect).toContain('setPickerOpen(false)');
    expect(effect).toContain('setPickerHighlight(0)');
  });

  it('the pure rank is imported, not reimplemented', () => {
    expect(PAGE.includes('filterAccountSuggestions(pickerAccounts, pickerQuery)')).toBe(true);
  });

  it('prior v2.98–v2.104 anchors survive the restructure', () => {
    for (const tid of [
      'payroll-ledger-line',
      'payroll-ledger-csv',
      'payroll-account-movement',
      'payroll-account-window-month',
      'payroll-account-window-year',
      'payroll-account-year-strip',
    ]) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
  });
});

describe('whats-new — the picker story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('2.105.0 leads and 2.104.0 follows (newest first)', () => {
    const i105 = WN.indexOf("version: '2.105.0'");
    const i104 = WN.indexOf("version: '2.104.0'");
    expect(i105).toBeGreaterThanOrEqual(0);
    expect(i104).toBeGreaterThan(i105);
  });

  it('the entry tells the picker story with its honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.105.0'"), WN.indexOf("version: '2.104.0'"));
    expect(slice.includes("title: 'The ledger answers for any account'")).toBe(true);
    for (const phrase of ['account picker', 'in this month', 'quiet', 'honest no', 'widens nothing']) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
