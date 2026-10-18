// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.101.0: the ledger files itself — the governed CSV of the period's
 * journal entries, riding the same filing family as the report tabs
 * (v2.58), the desk report (v2.70), the run digest (v2.53) and the
 * performance exports (v2.96–v2.99).
 *
 *   1. THE FILE IS THE DRAWER — the exact entries the v2.100 drawer shows,
 *      one row per journal line, entries newest first (drawer order). The
 *      file cannot disagree with the screen.
 *   2. THE FILE BALANCES BY ITSELF — a Totals line closes the sheet with
 *      the recomputed debit/credit sums; a teller can prove the file
 *      without opening the console.
 *   3. THE FAMILY CONTRACT — header block (Report/Organization/Scope/
 *      Period/Window/Generated), the shared csvCell escaper (one OWASP
 *      guard family-wide), RFC-4180 CRLF, honest filename that names its
 *      period, null-on-empty mapped to an honest 404 NO_LEDGER_DATA.
 *   4. THE ROUTE WIDENS NOTHING — hr.payroll.read.all, the ledger route's
 *      exact read contract and roles; audit PAYROLL_PERIOD_LEDGER_EXPORTED
 *      carries counts and sizes, never employee names.
 */

import {
  buildPeriodLedger,
  periodLedgerToCsv,
  periodSlug,
  type PeriodLedgerEntry,
} from '@/lib/hr/payroll/period-journal';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const mkEntry = (over: Partial<PeriodLedgerEntry>): PeriodLedgerEntry => ({
  runId: 'run-1',
  runType: 'REGULAR',
  entryNumber: 'JE-20261017-EA6EC',
  entryDate: '2026-10-17T05:33:00.000Z',
  description: 'Payroll October 2026 (regular) - 5 payslip(s)',
  totalDebit: 276570,
  totalCredit: 276570,
  debitSum: 276570,
  creditSum: 276570,
  balanced: true,
  lines: [
    { accountCode: '5200', accountName: 'Salaries Expense', accountType: 'EXPENSE', debit: 258000, credit: 0, description: 'net pay + statutory' },
    { accountCode: '2210', accountName: 'PAYE Payable', accountType: 'LIABILITY', debit: 0, credit: 258000, description: null },
  ],
  ...over,
});

const META = {
  organizationName: 'Mbumah Hardware',
  scopeLabel: 'Juja Main',
  periodName: 'October 2026',
  windowLabel: '2026-10-01 → 2026-10-31',
};

/** Guarded unwrap — the house style prefers guards to `!` (keeps the lint
 *  baseline exactly where it was; the file must add ZERO new warnings). */
function mustFile(f: ReturnType<typeof periodLedgerToCsv>) {
  if (!f) throw new Error('nothing filed — builder returned null');
  return f;
}

describe('builder — the file is the drawer, balancing by itself', () => {
  it('writes the header block: Report, Organization, Scope, Period, Window, Generated', () => {
    const f = mustFile(periodLedgerToCsv([mkEntry({})], META));
    const lines = f.csv.split('\r\n');
    expect(lines[0]).toBe('Report,Payroll period ledger');
    expect(lines[1]).toBe('Organization,Mbumah Hardware');
    expect(lines[2]).toBe('Scope,Juja Main');
    expect(lines[3]).toBe('Period,October 2026');
    expect(lines[4]).toBe('Window,2026-10-01 → 2026-10-31');
    expect(lines[5]).toMatch(/^Generated \(UTC\),\d{4}-\d{2}-\d{2}T/);
  });

  it('files one row per journal line with dayKey dates and bare 2dp money', () => {
    const f = mustFile(periodLedgerToCsv([mkEntry({})], META));
    const rows = f.csv.split('\r\n');
    const header = rows.indexOf('Ledger') + 1;
    expect(rows[header]).toBe(
      'Entry Number,Entry Day,Run Type,Run ID,Entry Description,Account Code,Account Name,Account Type,Debit,Credit,Line Description',
    );
    expect(rows[header + 1]).toBe(
      'JE-20261017-EA6EC,2026-10-17,REGULAR,run-1,Payroll October 2026 (regular) - 5 payslip(s),5200,Salaries Expense,EXPENSE,258000.00,0.00,net pay + statutory',
    );
    expect(rows[header + 2]).toBe(
      'JE-20261017-EA6EC,2026-10-17,REGULAR,run-1,Payroll October 2026 (regular) - 5 payslip(s),2210,PAYE Payable,LIABILITY,0.00,258000.00,',
    );
  });

  it('closes with a Totals line that proves the file balances by itself', () => {
    const f = mustFile(periodLedgerToCsv([mkEntry({}), mkEntry({ runId: 'run-2', entryNumber: 'JE-2' })], META));
    const totals = f.csv.split('\r\n').filter((l) => l.startsWith('Totals'));
    expect(totals).toHaveLength(1);
    expect(totals[0]).toBe('Totals,,,,,,,,516000.00,516000.00,2 entries');
  });

  it('rides the shared escaper: OWASP guard and quoting (one guard family-wide)', () => {
    const f = mustFile(periodLedgerToCsv(
      [mkEntry({ lines: [
        { accountCode: '5200', accountName: '=SUM(A1) Office', accountType: 'EXPENSE', debit: 258000, credit: 0, description: 'gross, housing' },
      ] })],
      META,
    ));
    expect(f.csv.includes("'=SUM(A1) Office")).toBe(true); // OWASP prefix
    expect(f.csv.includes('"gross, housing"')).toBe(true); // comma-bearing → quoted
  });

  it('names its period honestly; all-punctuation falls back, never anonymous', () => {
    const f = mustFile(periodLedgerToCsv([mkEntry({})], META));
    expect(f.filename).toBe('mbumah-period-ledger-october-2026.csv');
    expect(periodSlug('2026-W05', 'period')).toBe('2026-w05');
    expect(periodSlug('///', 'period')).toBe('period');
  });

  it('null on empty — the honest 404 never becomes an empty sheet', () => {
    expect(periodLedgerToCsv([], META)).toBeNull();
  });

  it('entries keep the drawer order (newest first) — the file cannot disagree with the screen', () => {
    const ledger = buildPeriodLedger(
      [
        {
          runId: 'a', runType: 'REGULAR', entryNumber: 'JE-NEW', entryDate: '2026-10-17T05:33:00.000Z',
          description: 'new', totalDebit: 10, totalCredit: 10,
          lines: [{ accountCode: '5200', accountName: 'S', accountType: 'EXPENSE', debit: 10, credit: 0, description: null }],
        },
        {
          runId: 'b', runType: 'BONUS', entryNumber: 'JE-OLD', entryDate: '2026-10-16T05:33:00.000Z',
          description: 'old', totalDebit: 5, totalCredit: 5,
          lines: [{ accountCode: '5200', accountName: 'S', accountType: 'EXPENSE', debit: 5, credit: 0, description: null }],
        },
      ],
      [],
    );
    const f = mustFile(periodLedgerToCsv(ledger.entries, META));
    expect(f.csv.indexOf('JE-NEW')).toBeGreaterThan(-1);
    expect(f.csv.indexOf('JE-NEW')).toBeLessThan(f.csv.indexOf('JE-OLD'));
  });

  it('CRLF line endings, family-wide', () => {
    const f = mustFile(periodLedgerToCsv([mkEntry({})], META));
    expect(f.csv.includes('\r\n')).toBe(true);
    expect(f.csv.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });
});

describe('route — the export widens nothing', () => {
  const ROUTE = readRepo('src/app/api/payroll/period-journal/export/route.ts');

  it('guards exactly like the ledger and runs list', () => {
    expect(ROUTE.includes("hrGuard('hr.payroll.read.all'")).toBe(true);
    expect(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']")).toBe(true);
    expect(ROUTE.includes("export const dynamic = 'force-dynamic'")).toBe(true);
  });

  it('is tenant-scoped and honest about absence', () => {
    expect(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }")).toBe(true);
    expect(ROUTE.includes("where: { payrollPeriodId: periodId, storeId: session.storeId || '' }")).toBe(true);
    expect(ROUTE.includes("code: 'NO_LEDGER_DATA'")).toBe(true);
    expect(ROUTE.includes('Nothing has posted in this period — nothing to file.')).toBe(true);
  });

  it('audits the filing with field-name-only metadata', () => {
    expect(ROUTE.includes("action: 'PAYROLL_PERIOD_LEDGER_EXPORTED'")).toBe(true);
    expect(ROUTE.includes('HrEntityType.DATA_EXPORT')).toBe(true);
    expect(ROUTE.includes('resourceId: file.filename')).toBe(true);
    expect(ROUTE.includes("channel: 'ad_hoc_download'")).toBe(true);
    expect(ROUTE.includes('lineCount')).toBe(true);
  });

  it('files the period window and rides the shared builder', () => {
    expect(ROUTE.includes('periodLedgerToCsv')).toBe(true);
    expect(ROUTE.includes('digestOrgAndScope')).toBe(true);
    expect(ROUTE.includes("'Content-Type': 'text/csv; charset=utf-8'")).toBe(true);
  });
});

describe('page — the drawer footer grew the filing door', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the CSV door exists with its own reasons', () => {
    expect(PAGE.includes('data-testid="payroll-ledger-csv"')).toBe(true);
    expect(PAGE.includes('data-testid="payroll-ledger-csv-note"')).toBe(true);
    expect(PAGE.includes('Nothing to file — nothing has posted in this period.')).toBe(true);
    expect(PAGE.includes('Download the period ledger CSV')).toBe(true);
    expect(PAGE.includes('Building…')).toBe(true);
  });

  it('busy state and stale-note hygiene: the note resets per open', () => {
    expect(PAGE.includes('const [csvBusy, setCsvBusy] = useState(false);')).toBe(true);
    expect(PAGE.includes('}, [periodName]);')).toBe(true);
    expect(PAGE.includes('/api/payroll/period-journal/export?periodId=')).toBe(true);
  });

  it('prior v2.100 anchors survive', () => {
    for (const tid of ['payroll-period-journal', 'payroll-ledger-entry', 'payroll-ledger-balanced', 'payroll-ledger-unsettled', 'payroll-ledger-missing']) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
  });
});

describe('whats-new — the filing story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');
  const PKG = JSON.parse(readRepo('package.json')) as { version: string; mbumah: { releaseVersion: string; baseVersion: string } };

  it('2.101.0 leads and the slots moved together', () => {
    const i101 = WN.indexOf("version: '2.101.0'");
    const i100 = WN.indexOf("version: '2.100.0'");
    expect(i101).toBeGreaterThan(-1);
    expect(i100).toBeGreaterThan(i101);
    // atLeast, not exact — an exact version pin goes stale the moment the
    // next feature ships (the v2.100 lesson, learned the hard way).
    const atLeast = (actual: string, floor: string) => {
      const a = actual.split('.').map(Number);
      const f = floor.split('.').map(Number);
      return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
    };
    expect(atLeast(PKG.version, '2.101.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.101.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.101.0')).toBe(true);
    expect(PKG.version).toBe(PKG.mbumah.releaseVersion);
    expect(PKG.mbumah.releaseVersion).toBe(PKG.mbumah.baseVersion);
  });

  it('the bullets carry the honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.101.0'"), WN.indexOf("version: '2.100.0'"));
    expect(slice.includes("title: 'The ledger files itself'")).toBe(true);
    for (const phrase of [
      'governed CSV exit',
      'balances by itself',
      'mbumah-period-ledger-october-2026.csv',
      'Nothing posted means nothing to file',
      'widens nothing',
    ]) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
