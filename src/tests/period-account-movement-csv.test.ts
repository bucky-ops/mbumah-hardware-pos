// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.103.0: the account files its month — the governed CSV of the account
 * movement replay (v2.102), riding the same filing family as the period
 * ledger (v2.101), the report tabs (v2.58), the desk report (v2.70), the
 * run digest (v2.53) and the performance exports (v2.96–v2.99).
 *
 *   1. THE FILE IS THE DIALOG — the exact replay the movement dialog shows,
 *      one row per posted line, chronological (dialog order). The file
 *      cannot disagree with the screen.
 *   2. THE FILE CLOSES ITS OWN LOOP — an Opening / Month totals / Closing
 *      footer whose Closing balance cell IS the last replay row's running
 *      cell, byte for byte. A teller can prove the file without opening
 *      the console.
 *   3. THE SIDE LETTER FILES TOO — running balances read the T-account
 *      way ('258000.00 Dr', '70414.80 Cr'), never a bare negative; an
 *      assumed normal side is FILED ('DEBIT (assumed)'), never smoothed.
 *   4. THE FAMILY CONTRACT — header block, the shared csvCell escaper
 *      (one OWASP guard family-wide), RFC-4180 CRLF, an honest filename
 *      that names its account and period, null-on-empty mapped to an
 *      honest 404 NO_MOVEMENT_DATA.
 *   5. THE ROUTE WIDENS NOTHING — hr.payroll.read.all, the account route's
 *      exact read contract and roles; audit PAYROLL_ACCOUNT_MOVEMENT_EXPORTED
 *      carries counts, sizes and the account code — never employee names.
 */

import {
  buildAccountMovement,
  accountMovementToCsv,
  movementSideCell,
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

const META = {
  organizationName: 'Mbumah Hardware',
  scopeLabel: 'Juja Main',
  periodName: 'October 2026',
  windowLabel: '2026-10-01 → 2026-10-31',
};

const DEBIT_META = {
  accountCode: '5200',
  accountName: 'Salaries Expense',
  accountType: 'EXPENSE',
  normalBalance: 'DEBIT',
};

/** Guarded unwrap — the house style prefers guards to `!` (ZERO new lint
 *  warnings; the file must add none to the 421 baseline). */
function mustFile(f: ReturnType<typeof accountMovementToCsv>) {
  if (!f) throw new Error('nothing filed — builder returned null');
  return f;
}

describe('movementSideCell — the side letter in the file dialect', () => {
  it('prints the normal side positively, the other side as the opposite letter', () => {
    expect(movementSideCell(516000, 'DEBIT')).toBe('516000.00 Dr');
    expect(movementSideCell(-70414.8, 'DEBIT')).toBe('70414.80 Cr'); // never a bare negative
    expect(movementSideCell(35207.4, 'CREDIT')).toBe('35207.40 Cr');
    expect(movementSideCell(-10, 'CREDIT')).toBe('10.00 Dr');
  });

  it('zero reads the em-dash the screen taught — never "-0.00"', () => {
    expect(movementSideCell(0, 'DEBIT')).toBe('0.00 —');
    expect(movementSideCell(-0, 'CREDIT')).toBe('0.00 —');
    expect(movementSideCell(0.001, 'DEBIT')).toBe('0.00 —'); // sub-cent rounds away
  });

  it('money2 everywhere: float drift cannot bend the side or the magnitude', () => {
    expect(movementSideCell(0.1 + 0.2, 'DEBIT')).toBe('0.30 Dr');
    expect(movementSideCell(-100.005, 'DEBIT')).toBe('100.01 Cr'); // 2dp rounding, banker-honest
  });
});

describe('builder — the file is the dialog, closing its own loop', () => {
  it('writes the header block with the account identity and the assumed-side flag', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({})],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    const lines = f.csv.split('\r\n');
    expect(lines[0]).toBe('Report,Payroll account movement');
    expect(lines[1]).toBe('Organization,Mbumah Hardware');
    expect(lines[2]).toBe('Scope,Juja Main');
    expect(lines[3]).toBe('Period,October 2026');
    expect(lines[4]).toBe('Window,2026-10-01 → 2026-10-31');
    expect(lines[5]).toMatch(/^Generated \(UTC\),\d{4}-\d{2}-\d{2}T/);
    expect(lines[6]).toBe('Account Code,5200');
    expect(lines[7]).toBe('Account Name,Salaries Expense');
    expect(lines[8]).toBe('Account Type,EXPENSE');
    expect(lines[9]).toBe('Normal Balance,DEBIT');
    expect(lines[10]).toBe('Opening Basis,No posted lines before the window — the account starts the month at zero');
  });

  it('files an assumed normal side honestly — never silently picked', () => {
    const movement = buildAccountMovement(
      { ...DEBIT_META, normalBalance: 'WHATEVER' },
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({})],
    );
    expect(movement.normalBalanceAssumed).toBe(true);
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.csv.includes('Normal Balance,DEBIT (assumed — no known normal side)')).toBe(true);
  });

  it('states the opening basis when prior lines exist — every source, not just payroll', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 1200, credit: 0, priorLines: 3 },
      [SRC({})],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(
      f.csv.includes('Opening Basis,"Summed from 3 posted lines before the window — every source, not just payroll"'),
    ).toBe(true); // the comma-bearing cell rides the family's quoting
    const singular = accountMovementToCsv(
      buildAccountMovement(DEBIT_META, { debit: 1, credit: 0, priorLines: 1 }, [SRC({})]),
      META,
    );
    expect(singular && singular.csv.includes('Summed from 1 posted line before the window')).toBe(true);
  });

  it('files one row per replay line with dayKey dates, bare 2dp money and side-lettered running', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [
        SRC({}),
        SRC({
          entryNumber: 'JE-20261017-B2',
          entryDate: '2026-10-17T05:33:00.000Z',
          source: 'SUPPLEMENTARY',
          entryDescription: 'Payroll October 2026 (supplementary) - 2 payslip(s)',
          lineDescription: 'net pay, housing',
        }),
      ],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    const rows = f.csv.split('\r\n');
    const header = rows.indexOf('Movement') + 1;
    expect(rows[header]).toBe(
      'Day,Entry Number,Source,Entry Description,Line Description,Debit,Credit,Running (Dr/Cr)',
    );
    expect(rows[header + 1]).toBe(
      '2026-10-04,JE-20261004-A1,OFF_CYCLE,Payroll October 2026 (off cycle) - 1 payslip(s),,258000.00,0.00,258000.00 Dr',
    );
    expect(rows[header + 2]).toBe(
      '2026-10-17,JE-20261017-B2,SUPPLEMENTARY,Payroll October 2026 (supplementary) - 2 payslip(s),"net pay, housing",258000.00,0.00,516000.00 Dr',
    );
  });

  it('closes its own loop: the Closing balance cell IS the last replay row, byte for byte', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 1000, credit: 0, priorLines: 2 },
      [SRC({}), SRC({ entryNumber: 'JE-2', debit: 500, credit: 700 })],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    const rows = f.csv.split('\r\n').filter(Boolean);
    const closing = rows.find((r) => r.startsWith('Closing')) ?? '';
    // the last REPLAY row sits just above the footer block (Opening/Month totals/Closing)
    const openingFooter = rows.find((r) => r.startsWith('Opening,,,,')) ?? '';
    const lastDataRow = rows[rows.indexOf(openingFooter) - 1] ?? '';
    const lastRunningCell = lastDataRow.split(',').pop() ?? '';
    const closingCell = closing.split(',').pop() ?? '';
    expect(closingCell).toBe(lastRunningCell);
    // and the footer arithmetic is the screen's: opening (1000 Dr) + month
    // (258000 Dr, then −200 net on the mixed line) → closing 258800.00 Dr,
    // byte-equal to the last replay row.
    expect(closing).toBe('Closing,,,,,,259500.00,700.00,258800.00 Dr');
  });

  it('the footer carries the opening aggregate and the month totals, sides resolved on the normal side', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 1000, credit: 250, priorLines: 4 },
      [SRC({ debit: 100, credit: 0 })],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    const rows = f.csv.split('\r\n');
    expect(rows.find((r) => r.startsWith('Opening,,,,'))).toBe('Opening,,,,,,1000.00,250.00,750.00 Dr');
    expect(f.csv.includes('Month totals,,,,,,100.00,0.00,')).toBe(true);
    expect(f.csv.includes('Closing,,,,,,1100.00,250.00,850.00 Dr')).toBe(true);
  });

  it('a cross-side month files the OTHER letter — the file never shows a bare negative', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 900, priorLines: 0 },
      [SRC({ debit: 100, credit: 0 })],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.csv.includes('100.00,0.00,800.00 Cr')).toBe(true); // the row files the OTHER letter
    expect(f.csv.includes('Closing,,,,,,100.00,900.00,800.00 Cr')).toBe(true);
    expect(/,[-]\d/.test(f.csv)).toBe(false); // never a bare negative anywhere in the file
  });

  it('credit-normal accounts file Cr-positive all the way down', () => {
    const movement = buildAccountMovement(
      { ...DEBIT_META, normalBalance: 'CREDIT' },
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({ debit: 0, credit: 35207.4 })],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.csv.includes('35207.40 Cr')).toBe(true);
    expect(f.csv.includes('Closing,,,,,,0.00,35207.40,35207.40 Cr')).toBe(true);
  });

  it('rides the shared escaper: OWASP guard and comma quoting (one guard family-wide)', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [SRC({ entryDescription: '=SUM(A1) gross; housing', lineDescription: 'net, pay' })],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.csv.includes("'=SUM(A1) gross; housing")).toBe(true); // OWASP prefix
    expect(f.csv.includes('"net, pay"')).toBe(true); // comma-bearing → quoted
  });

  it('names its account and period honestly; all-punctuation falls back, never anonymous', () => {
    const movement = buildAccountMovement(DEBIT_META, { debit: 0, credit: 0, priorLines: 0 }, [SRC({})]);
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.filename).toBe('mbumah-account-movement-5200-salaries-expense-october-2026.csv');
    const anon = accountMovementToCsv(
      buildAccountMovement(
        { ...DEBIT_META, accountCode: '///', accountName: '===' },
        { debit: 0, credit: 0, priorLines: 0 },
        [SRC({})],
      ),
      { ...META, periodName: '///' },
    );
    expect(anon && anon.filename).toBe('mbumah-account-movement-account-period.csv');
  });

  it('null on empty — the honest 404 never becomes an empty sheet', () => {
    const movement = buildAccountMovement(DEBIT_META, { debit: 0, credit: 0, priorLines: 0 }, []);
    expect(movement.movements).toHaveLength(0);
    expect(accountMovementToCsv(movement, META)).toBeNull();
  });

  it('CRLF line endings, family-wide', () => {
    const movement = buildAccountMovement(DEBIT_META, { debit: 0, credit: 0, priorLines: 0 }, [SRC({})]);
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.csv.includes('\r\n')).toBe(true);
    expect(f.csv.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('the replay keeps the dialog order (chronological) — the file cannot disagree with the screen', () => {
    const movement = buildAccountMovement(
      DEBIT_META,
      { debit: 0, credit: 0, priorLines: 0 },
      [
        SRC({ entryNumber: 'JE-EARLY', entryDate: '2026-10-04T04:58:00.000Z' }),
        SRC({ entryNumber: 'JE-LATE', entryDate: '2026-10-17T05:33:00.000Z' }),
      ],
    );
    const f = mustFile(accountMovementToCsv(movement, META));
    expect(f.csv.indexOf('JE-EARLY')).toBeGreaterThan(-1);
    expect(f.csv.indexOf('JE-EARLY')).toBeLessThan(f.csv.indexOf('JE-LATE'));
  });
});

describe('route — the export widens nothing', () => {
  const ROUTE = readRepo('src/app/api/payroll/period-journal/account/export/route.ts');
  const ACCOUNT_ROUTE = readRepo('src/app/api/payroll/period-journal/account/route.ts');

  it('guards exactly like the ledger, the drawer and the account route', () => {
    expect(ROUTE.includes("hrGuard('hr.payroll.read.all'")).toBe(true);
    expect(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']")).toBe(true);
    expect(ROUTE.includes("export const dynamic = 'force-dynamic'")).toBe(true);
  });

  it('mirrors the account route honesty: posted, never-voided, inclusive window, org-scoped account', () => {
    expect(ROUTE.includes('isPosted: true,')).toBe(true);
    expect(ROUTE.includes('isVoided: false,')).toBe(true);
    expect(ROUTE.includes("entryDate: { lt: period.startDate }")).toBe(true);
    expect(ROUTE.includes("entryDate: { gte: period.startDate, lt: windowEnd }")).toBe(true);
    expect(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }")).toBe(true);
    expect(ROUTE.includes("where: { code: accountCode, organizationId: store.organizationId }")).toBe(true);
    expect(ACCOUNT_ROUTE.includes('isPosted: true,')).toBe(true);
  });

  it('is honest about absence and pins the family response shape', () => {
    expect(ROUTE.includes("code: 'NO_MOVEMENT_DATA'")).toBe(true);
    expect(ROUTE.includes('Nothing posted on this account inside the window — nothing to file.')).toBe(true);
    expect(ROUTE.includes("error: 'periodId and accountCode are required.'")).toBe(true);
  });

  it('audits the filing with field-name-only metadata', () => {
    expect(ROUTE.includes("action: 'PAYROLL_ACCOUNT_MOVEMENT_EXPORTED'")).toBe(true);
    expect(ROUTE.includes('HrEntityType.DATA_EXPORT')).toBe(true);
    expect(ROUTE.includes('resourceId: file.filename')).toBe(true);
    expect(ROUTE.includes("channel: 'ad_hoc_download'")).toBe(true);
    expect(ROUTE.includes('accountCode: account.code')).toBe(true);
    expect(ROUTE.includes('byteSize: file.byteSize')).toBe(true);
  });

  it('rides the shared builder and the family headers', () => {
    expect(ROUTE.includes('buildAccountMovement')).toBe(true);
    expect(ROUTE.includes('accountMovementToCsv')).toBe(true);
    expect(ROUTE.includes('digestOrgAndScope')).toBe(true);
    expect(ROUTE.includes("'Content-Type': 'text/csv; charset=utf-8'")).toBe(true);
  });
});

describe('page — the drill grew its filing door', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the Movement CSV door exists with its own reasons', () => {
    expect(PAGE.includes('data-testid="payroll-account-csv"')).toBe(true);
    expect(PAGE.includes('data-testid="payroll-account-csv-note"')).toBe(true);
    expect(PAGE.includes('Nothing to file — nothing posted on this account inside the window.')).toBe(true);
    expect(PAGE.includes("Download the account movement CSV")).toBe(true);
    expect(PAGE.includes('Movement CSV')).toBe(true);
    expect(PAGE.includes('Building…')).toBe(true);
  });

  it('busy state and stale-note hygiene: the note resets per open and per period', () => {
    expect(PAGE.includes('const [movementCsvBusy, setMovementCsvBusy] = useState(false);')).toBe(true);
    expect(PAGE.includes('/api/payroll/period-journal/account/export?periodId=')).toBe(true);
    expect(PAGE.includes("encodeURIComponent(drillCode)")).toBe(true);
  });

  it('the closing note tells the loop story', () => {
    expect(PAGE.includes('the file closes its own loop')).toBe(true);
  });

  it('prior v2.102 anchors survive the footer rework', () => {
    for (const tid of ['payroll-account-movement', 'payroll-account-opening', 'payroll-account-row', 'payroll-account-running', 'payroll-account-closing', 'payroll-account-back']) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
  });

  it('prior v2.100/v2.101 ledger anchors survive', () => {
    for (const tid of ['payroll-period-journal', 'payroll-ledger-entry', 'payroll-ledger-balanced', 'payroll-ledger-unsettled', 'payroll-ledger-missing', 'payroll-ledger-csv']) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
  });
});

describe('whats-new — the filing story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');
  const PKG = JSON.parse(readRepo('package.json')) as { version: string; mbumah: { releaseVersion: string; baseVersion: string } };

  it('2.103.0 leads and the slots moved together', () => {
    const i103 = WN.indexOf("version: '2.103.0'");
    const i102 = WN.indexOf("version: '2.102.0'");
    expect(i103).toBeGreaterThan(-1);
    expect(i102).toBeGreaterThan(i103);
    // atLeast, not exact — an exact version pin goes stale the moment the
    // next feature ships (the twice-burned lesson).
    const atLeast = (actual: string, floor: string) => {
      const a = actual.split('.').map(Number);
      const f = floor.split('.').map(Number);
      return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
    };
    expect(atLeast(PKG.version, '2.103.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.103.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.103.0')).toBe(true);
    expect(PKG.version).toBe(PKG.mbumah.releaseVersion);
    expect(PKG.mbumah.releaseVersion).toBe(PKG.mbumah.baseVersion);
  });

  it('the bullets carry the honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.103.0'"), WN.indexOf("version: '2.102.0'"));
    expect(slice.includes("title: 'The account files its month'")).toBe(true);
    for (const phrase of [
      'Movement CSV',
      'closes its own loop',
      'mbumah-account-movement-5200-salaries-expense-october-2026.csv',
      'never a bare negative',
      'Nothing posted inside the window means nothing to file',
      'widens nothing',
    ]) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
