// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.104.0: the account opens its year — the window switch (This month /
 * Full year) on the movement dialog, the year at a glance (twelve calendar
 * cells computed from THE SAME replay, no second truth), and the governed
 * CSV saying the window's own word.
 *
 *   1. THE ROLLUP IS A VIEW OF THE REPLAY — yearMonthRollups feeds on the
 *      same rows the table shows, seeded by the same opening balance. No
 *      second fetch, no second truth. Quiet months CARRY THE BALANCE
 *      FORWARD (a still account still has a balance) and say 'no activity'.
 *   2. IMPOSSIBLE INPUTS THROW, NEVER LIE — a movement dated outside the
 *      requested year, an unreadable date, or a non-chronological replay
 *      is impossible by construction (the route's window and order); the
 *      builder throws rather than bucket into the nearest month or close a
 *      month against the wrong running balance.
 *   3. MONEY IS MONEY2 EVERYWHERE — month sums round once, the running
 *      re-rounds at every step; float drift never compounds down the strip.
 *   4. THE COMPACT GLANCE DIALECT — movementSideCellCompact reads '516.0K
 *      Dr', '70.4K Cr', '0 —' — a glance, not a filing; the exact values
 *      ride the replay table and the cell title.
 *   5. THE FILE SAYS THE WINDOW'S WORD — windowNoun: 'year' files "starts
 *      the year at zero" and "Year totals"; the month path keeps its exact
 *      v2.103 bytes (the default noun changes nothing).
 *   6. THE ROUTES WIDEN NOTHING — window=year validates (unknown → 400,
 *      never a silent month), mirrors the account route's exact arithmetic
 *      and guard; the response echoes window and names a year '2026',
 *      never a fake period name.
 *   7. THE SCREEN CANNOT DESYNC — the payload carries the served window;
 *      the UI reads it, the toggle rides it, and a fresh door opens on the
 *      month (the year is a choice, never a leftover).
 */

import {
  buildAccountMovement,
  accountMovementToCsv,
  yearMonthRollups,
  movementSideCellCompact,
  type AccountMovementSource,
} from '@/lib/hr/payroll/period-journal';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SRC = (over: Partial<AccountMovementSource>): AccountMovementSource => ({
  entryNumber: 'JE-20261004-A1',
  entryDate: '2026-10-04T04:58:00.000Z',
  entryDescription: 'Payroll October 2026 (off cycle) - 1 payslip(s)',
  source: 'OFF_CYCLE',
  debit: 258000,
  credit: 0,
  lineDescription: null,
  ...over,
});

const DEBIT_META = {
  accountCode: '5200',
  accountName: 'Salaries Expense',
  accountType: 'EXPENSE',
  normalBalance: 'DEBIT',
};

describe('yearMonthRollups — the year at a glance', () => {
  it('always returns twelve fixed calendar cells, Jan through Dec', () => {
    const cells = yearMonthRollups(0, [], 'DEBIT', 2026);
    expect(cells).toHaveLength(12);
    expect(cells.map((c) => c.label)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
    expect(cells.map((c) => c.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('an all-quiet year carries the opening balance through every cell, honestly quiet', () => {
    const cells = yearMonthRollups(70414.8, [], 'DEBIT', 2026);
    for (const c of cells) {
      expect(c.activity).toBe(false);
      expect(c.lines).toBe(0);
      expect(c.debit).toBe(0);
      expect(c.credit).toBe(0);
      expect(c.closing).toBe(70414.8);
    }
  });

  it('activity months carry their sums, line count and the running balance at their end', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [
        SRC({ entryNumber: 'JE-A', entryDate: '2026-03-04T04:58:00.000Z', debit: 100 }),
        SRC({ entryNumber: 'JE-B', entryDate: '2026-03-17T05:33:00.000Z', debit: 50 }),
        SRC({ entryNumber: 'JE-C', entryDate: '2026-10-17T05:33:00.000Z', debit: 258000 }),
      ],
    );
    const cells = yearMonthRollups(movement.opening.balance, movement.movements, 'DEBIT', 2026);
    // Jan/Feb quiet at zero (no prior lines)
    expect(cells[0].closing).toBe(0);
    expect(cells[1].closing).toBe(0);
    // March: two lines, 150 debited, closing 150 Dr
    expect(cells[2].activity).toBe(true);
    expect(cells[2].lines).toBe(2);
    expect(cells[2].debit).toBe(150);
    expect(cells[2].credit).toBe(0);
    expect(cells[2].closing).toBe(150);
    // Apr–Sep quiet: the balance carried forward
    for (const i of [3, 4, 5, 6, 7, 8]) {
      expect(cells[i].activity).toBe(false);
      expect(cells[i].closing).toBe(150);
    }
    // October: one line, closing 258150 Dr — and Nov/Dec carry it
    expect(cells[9].activity).toBe(true);
    expect(cells[9].lines).toBe(1);
    expect(cells[9].debit).toBe(258000);
    expect(cells[9].closing).toBe(258150);
    expect(cells[11].closing).toBe(258150);
  });

  it('the strip agrees with the replay: every activity month\'s closing equals the last running inside it', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [
        SRC({ entryNumber: 'JE-A', entryDate: '2026-01-05T04:58:00.000Z', debit: 1000.005 }),
        SRC({ entryNumber: 'JE-B', entryDate: '2026-01-20T05:33:00.000Z', debit: 0.005 }),
        SRC({ entryNumber: 'JE-C', entryDate: '2026-07-11T05:33:00.000Z', credit: 300 }),
      ],
    );
    const cells = yearMonthRollups(movement.opening.balance, movement.movements, 'DEBIT', 2026);
    const janLastRunning = movement.movements[1].running;
    expect(cells[0].closing).toBe(janLastRunning);
    expect(cells[0].debit).toBe(1000.02); // money2: every row rounds first (1000.005 → 1000.01 in float64), the month's sum rounds once more — drift never compounds
    expect(cells[0].lines).toBe(2);
    expect(cells[6].credit).toBe(300);
    expect(cells[6].closing).toBe(movement.movements[2].running);
    expect(cells[11].closing).toBe(movement.closing.balance);
  });

  it('a credit-normal account rolls up Cr-positive the whole way down', () => {
    const movement = buildAccountMovement(
      { accountCode: '2210', accountName: 'Wages Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({ entryNumber: 'JE-A', entryDate: '2026-10-17T05:33:00.000Z', debit: 0, credit: 35207.4 })],
    );
    const cells = yearMonthRollups(movement.opening.balance, movement.movements, 'CREDIT', 2026);
    expect(cells[9].closing).toBe(35207.4);
    const compact = movementSideCellCompact(cells[9].closing, 'CREDIT');
    expect(compact.includes('Cr')).toBe(true);
  });

  it('a closing on the OTHER side goes negative — the strip feeds it to the amber eyebrow', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({ entryNumber: 'JE-A', entryDate: '2026-10-17T05:33:00.000Z', debit: 0, credit: 70414.8 })],
    );
    const cells = yearMonthRollups(movement.opening.balance, movement.movements, 'DEBIT', 2026);
    expect(cells[9].closing).toBe(-70414.8);
    expect(cells[10].closing).toBe(-70414.8); // carried forward, still other-side
  });

  it('a movement dated outside the requested year throws — the strip never buckets into the nearest month', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({ entryDate: '2026-10-17T05:33:00.000Z' })],
    );
    expect(() => yearMonthRollups(0, movement.movements, 'DEBIT', 2027)).toThrow(
      /dated outside 2027 — the year window and the replay disagree/,
    );
  });

  it('an unreadable date throws — the rollup refuses to guess', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({ entryNumber: 'JE-BROKEN', entryDate: 'not-a-date' })],
    );
    expect(() => yearMonthRollups(0, movement.movements, 'DEBIT', 2026)).toThrow(
      /JE-BROKEN carries an unreadable date/,
    );
  });

  it('a non-chronological replay throws — months would close against the wrong balance', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [
        SRC({ entryNumber: 'JE-LATE', entryDate: '2026-10-17T05:33:00.000Z' }),
        SRC({ entryNumber: 'JE-EARLY', entryDate: '2026-03-04T04:58:00.000Z' }),
      ],
    );
    expect(() => yearMonthRollups(0, movement.movements, 'DEBIT', 2026)).toThrow(
      /JE-EARLY arrives out of order/,
    );
  });
});

describe('movementSideCellCompact — the glance dialect', () => {
  it('reads thousands compactly, side letter attached', () => {
    expect(movementSideCellCompact(516000, 'DEBIT')).toBe('516.0K Dr');
    expect(movementSideCellCompact(70414.8, 'DEBIT')).toBe('70.4K Dr');
    expect(movementSideCellCompact(-70414.8, 'DEBIT')).toBe('70.4K Cr'); // other side
    expect(movementSideCellCompact(35207.4, 'CREDIT')).toBe('35.2K Cr');
    expect(movementSideCellCompact(-10, 'CREDIT')).toBe('10.00 Dr');
  });

  it('zero reads the em-dash, never "-0.00"', () => {
    expect(movementSideCellCompact(0, 'DEBIT')).toBe('0 —');
    expect(movementSideCellCompact(-0.004, 'DEBIT')).toBe('0 —');
  });

  it('sub-thousand magnitudes keep their cents', () => {
    expect(movementSideCellCompact(999.99, 'DEBIT')).toBe('999.99 Dr');
    expect(movementSideCellCompact(1000, 'DEBIT')).toBe('1.0K Dr');
    expect(movementSideCellCompact(999996, 'DEBIT')).toBe('1000.0K Dr');
  });
});

describe('accountMovementToCsv — the file says the window\u2019s own word', () => {
  const META = {
    organizationName: 'Mbumah Hardware',
    scopeLabel: 'Juja Main',
    periodName: 'October 2026',
    windowLabel: '2026-10-01 → 2026-10-31',
  };

  it('windowNoun year: the opening basis and the totals label say YEAR', () => {
    const movement = buildAccountMovement(DEBIT_META, { debit: 0, credit: 0, priorLines: 0 }, [SRC({})]);
    const f = accountMovementToCsv(
      movement,
      { ...META, periodName: '2026', windowLabel: '2026-01-01 → 2026-12-31', windowNoun: 'year' },
    );
    if (!f) throw new Error('nothing filed');
    expect(f.csv.includes('Opening Basis,No posted lines before the window — the account starts the year at zero')).toBe(true);
    expect(f.csv.includes('Year totals,,,,,,258000.00,0.00,')).toBe(true);
    expect(f.csv.includes('Month totals')).toBe(false);
    expect(f.filename).toBe('mbumah-account-movement-5200-salaries-expense-2026.csv');
  });

  it('windowNoun year with an aggregate opening: the basis story stays window-generic, honest', () => {
    const movement = buildAccountMovement(DEBIT_META, { debit: 500, credit: 0, priorLines: 3 }, [SRC({})]);
    const f = accountMovementToCsv(movement, { ...META, periodName: '2026', windowNoun: 'year' });
    if (!f) throw new Error('nothing filed');
    expect(f.csv.includes('Opening Basis,"Summed from 3 posted lines before the window — every source, not just payroll"')).toBe(true);
  });

  it('the month path keeps its exact v2.103 bytes — the default noun changes nothing', () => {
    const movement = buildAccountMovement(DEBIT_META, { debit: 0, credit: 0, priorLines: 0 }, [SRC({})]);
    // v2.109.0.1 FIX (the CI flake): the CSV embeds 'Generated (UTC)' from a
    // per-call `new Date()` default (the THIRD positional parameter) — two
    // bare calls compare byte-equal ONLY when they land in the same
    // millisecond, so this test raced the clock and failed ~once per burst
    // (locally AND in CI on PR #232). A fixed stamp pins determinism: the
    // ONLY difference between the two CSVs is the windowNoun's own words,
    // which is what this test means.
    const STAMP = new Date('2026-10-18T12:00:00.000Z');
    const withoutNoun = accountMovementToCsv(movement, META, STAMP);
    const explicitMonth = accountMovementToCsv(movement, { ...META, windowNoun: 'month' }, STAMP);
    expect(withoutNoun?.csv).toBe(explicitMonth?.csv);
    expect(withoutNoun?.csv.includes('Opening Basis,No posted lines before the window — the account starts the month at zero')).toBe(true);
    expect(withoutNoun?.csv.includes('Month totals,,,,,,258000.00,0.00,')).toBe(true);
    expect(withoutNoun?.csv.includes('Generated (UTC),2026-10-18T12:00:00.000Z')).toBe(true);
  });

  it('the year file still closes its own loop: Closing equals the last replay row, byte for byte', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [
        SRC({ entryNumber: 'JE-A', entryDate: '2026-10-04T04:58:00.000Z', debit: 259500 }),
        SRC({ entryNumber: 'JE-B', entryDate: '2026-10-17T05:33:00.000Z', debit: 700 }),
      ],
    );
    const f = accountMovementToCsv(movement, { ...META, periodName: '2026', windowNoun: 'year' });
    if (!f) throw new Error('nothing filed');
    const rows = f.csv.split('\r\n');
    const lastRunning = rows.find((r) => r.includes(',JE-B,'))?.split(',').pop();
    const closing = rows.find((r) => r.startsWith('Closing,,,,'))?.split(',').pop();
    expect(closing).toBe(lastRunning);
    expect(closing).toBe('260200.00 Dr');
  });
});

describe('routes — the year window widens nothing', () => {
  const ACCOUNT_ROUTE = readRepo('src/app/api/payroll/period-journal/account/route.ts');
  const EXPORT_ROUTE = readRepo('src/app/api/payroll/period-journal/account/export/route.ts');
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('window validates: unknown values are a 400, never a silent month', () => {
    for (const ROUTE of [ACCOUNT_ROUTE, EXPORT_ROUTE]) {
      expect(ROUTE.includes(`error: 'window must be "month" or "year".'`)).toBe(true);
      expect(ROUTE.includes(`windowParam !== null && windowParam !== 'month' && windowParam !== 'year'`)).toBe(true);
    }
  });

  it('the year window is the calendar year of the period\u2019s first day, UTC — inclusive of its days', () => {
    for (const ROUTE of [ACCOUNT_ROUTE, EXPORT_ROUTE]) {
      expect(ROUTE.includes('const year = period.startDate.getUTCFullYear();')).toBe(true);
      expect(ROUTE.includes("new Date(Date.UTC(year, 0, 1))")).toBe(true);
      expect(ROUTE.includes('new Date(Date.UTC(year + 1, 0, 1))')).toBe(true);
      expect(ROUTE.includes('entryDate: { lt: windowStart },')).toBe(true);
      expect(ROUTE.includes('entryDate: { gte: windowStart, lt: windowEnd },')).toBe(true);
      expect(ROUTE.includes('`${year}-01-01 → ${year}-12-31`')).toBe(true);
    }
  });

  it('a year is not a period — the response names it honestly and echoes the window', () => {
    expect(ACCOUNT_ROUTE.includes("const displayName = window === 'year' ? String(year) : period.name;")).toBe(true);
    expect(ACCOUNT_ROUTE.includes('window,')).toBe(true);
    expect(EXPORT_ROUTE.includes('windowNoun: window,')).toBe(true);
    expect(EXPORT_ROUTE.includes('windowKind: window,')).toBe(true);
    expect(EXPORT_ROUTE.includes('period: displayName,')).toBe(true);
  });

  it('the same guard, the same roles, the same honesty as the month', () => {
    for (const ROUTE of [ACCOUNT_ROUTE, EXPORT_ROUTE]) {
      expect(ROUTE.includes("hrGuard('hr.payroll.read.all'")).toBe(true);
      expect(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']")).toBe(true);
      expect(ROUTE.includes('isPosted: true,')).toBe(true);
      expect(ROUTE.includes('isVoided: false,')).toBe(true);
      expect(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }")).toBe(true);
    }
  });

  it('the screen reads the served window — the payload carries it and the UI narrows it', () => {
    expect(PAGE.includes("window: 'month' | 'year';")).toBe(true);
    expect(PAGE.includes("const servedWindow = body.data?.window;")).toBe(true);
    expect(PAGE.includes("(servedWindow !== 'month' && servedWindow !== 'year')")).toBe(true);
    expect(PAGE.includes('&window=${window}')).toBe(true);
    expect(PAGE.includes("async (code: string, window: 'month' | 'year' = 'month')")).toBe(true);
  });

  it('the toggle and the strip exist, with the family\u2019s testids', () => {
    for (const tid of [
      'payroll-account-window',
      'payroll-account-window-month',
      'payroll-account-window-year',
      'payroll-account-year',
      'payroll-account-year-strip',
      'payroll-account-year-cell',
    ]) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
    expect(PAGE.includes('aria-pressed={drillWindow === \'month\'}')).toBe(true);
    expect(PAGE.includes('aria-pressed={drillWindow === \'year\'}')).toBe(true);
    expect(PAGE.includes('data-month={mo.label}')).toBe(true);
  });

  it('the year strip is computed from THE SAME replay — the pure builder rides the page', () => {
    expect(PAGE.includes('yearMonthRollups(drill.opening.balance, drill.movements, drill.account.normalBalance, y)')).toBe(true);
    expect(PAGE.includes("Number(drill.period.windowLabel.slice(0, 4))")).toBe(true);
    expect(PAGE.includes("movementSideCellCompact(mo.closing, drill.account.normalBalance)")).toBe(true);
    expect(PAGE.includes("import { yearMonthRollups, movementSideCellCompact, filterAccountSuggestions, rememberAccountCode, parseRecentAccountCodes, groupAccountsByType, ACCOUNT_PICKER_RECENTS_KEY, type AccountPickerEntry } from '@/lib/hr/payroll/period-journal';")).toBe(true);
  });

  it('window-aware honesty on screen: the year says year, the month says month', () => {
    expect(PAGE.includes("the account's ${drill.window === 'year' ? 'year' : 'month'}, replayed line by line.")).toBe(true);
    expect(PAGE.includes("the account starts the ${drill.window === 'year' ? 'year' : 'month'} at zero.")).toBe(true);
    expect(PAGE.includes("{drill.window === 'year' ? 'Year totals' : 'Month totals'}")).toBe(true);
    expect(PAGE.includes("exactly the ${drillWindow === 'year' ? 'year' : 'month'} on this dialog.")).toBe(true);
    expect(PAGE.includes('no activity, balance carried forward')).toBe(true);
  });

  it('stale-window hygiene: a fresh door opens on its month', () => {
    expect(PAGE.includes("const [drillWindow, setDrillWindow] = useState<'month' | 'year'>('month');")).toBe(true);
    expect(PAGE.includes("setDrillWindow('month');")).toBe(true);
    // Retry rides the window the drill ASKED for, not a hardcoded month.
    expect(PAGE.includes('openAccountMovement(drillCode, drillWindow)')).toBe(true);
  });

  it('the CSV exit rides the served window — the file cannot disagree with the screen (E2E-found)', () => {
    expect(PAGE.includes('/api/payroll/period-journal/account/export?periodId=')).toBe(true);
    expect(PAGE.includes('accountCode=${encodeURIComponent(drillCode)}&window=${drillWindow}')).toBe(true);
  });

  it('the what\u2019s-new feed leads 2.104.0 with the year story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    const slice = WN.slice(WN.indexOf("version: '2.104.0'"), WN.indexOf("version: '2.103.0'"));
    expect(slice.includes("title: 'The account opens its year'")).toBe(true);
    for (const phrase of ['Full year', 'at a glance', 'carried forward', 'Year totals', 'widens nothing']) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
