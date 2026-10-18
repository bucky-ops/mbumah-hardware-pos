// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.100.0: the period opens its ledger — the payroll period header's
 * settled-net arithmetic becomes checkable to the account. The drill-down:
 *
 *   1. THE LEDGER IS PROVEN, NOT TRUSTED — line sums are recomputed from
 *      the lines and balance is checked at 2dp money precision on BOTH the
 *      recomputed sums and the entry's own header totals. A float drift of
 *      0.0000001 can never shout "unbalanced" at a teller.
 *   2. THE HONESTY CONTRACT INHERITS RUN-GROUPS — in-motion runs stay
 *      counts (unsettled, never priced), VOIDED runs appear nowhere (a
 *      closed door), and a settled run with NO journal is surfaced as
 *      missing, not silently skipped (the header counts its money, so the
 *      drawer must say where the entry went).
 *   3. THE ORDER IS HONEST — entries newest entryDate first, stable (equal
 *      stamps never reorder), matching the runs table's newest-first read.
 *   4. THE ROUTE WIDENS NOTHING — hr.payroll.read.all, the runs list's
 *      exact read contract and roles; tenant-scoped (storeId) period and
 *      runs; 400 without periodId, 404 for a foreign period.
 */

import {
  buildPeriodLedger,
  isLedgerBalanced,
  sumLedgerLines,
  type LedgerEntrySource,
  type LedgerRunSource,
} from '@/lib/hr/payroll/period-journal';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const entry = (over: Partial<LedgerEntrySource>): LedgerEntrySource => ({
  runId: 'run-1',
  runType: 'REGULAR',
  entryNumber: 'JE-2026-0101',
  entryDate: '2026-11-02T03:00:00.000Z',
  description: 'Payroll journal — October 2026 REGULAR',
  totalDebit: 100,
  totalCredit: 100,
  lines: [
    { accountCode: '5100', accountName: 'Salaries expense', accountType: 'EXPENSE', debit: 100, credit: 0, description: 'net pay' },
    { accountCode: '2200', accountName: 'PAYE payable', accountType: 'LIABILITY', debit: 0, credit: 100, description: null },
  ],
  ...over,
});

/** v2.110.0: runs carry their payable truth — default net 100 keeps the alarm tests alarming. */
const run = (id: string, runType: string, status: string, totalNet = 100): LedgerRunSource => ({ id, runType, status, totalNet });

describe('builder — the ledger is proven, not trusted', () => {
  it('recomputes line sums and marks a balanced entry', () => {
    const ledger = buildPeriodLedger([entry({})], [run('run-1', 'REGULAR', 'POSTED')]);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]?.debitSum).toBe(100);
    expect(ledger.entries[0]?.creditSum).toBe(100);
    expect(ledger.entries[0]?.balanced).toBe(true);
    expect(ledger.unsettled).toHaveLength(0);
    expect(ledger.missingJournal).toHaveLength(0);
  });

  it('flags unbalanced arithmetic — sums disagree with the header totals', () => {
    const ledger = buildPeriodLedger(
      [entry({ totalDebit: 100, totalCredit: 90, lines: [
        { accountCode: '5100', accountName: 'Salaries', accountType: 'EXPENSE', debit: 100, credit: 0, description: null },
        { accountCode: '2200', accountName: 'PAYE', accountType: 'LIABILITY', debit: 0, credit: 90, description: null },
      ] })],
      [run('run-1', 'REGULAR', 'POSTED')],
    );
    expect(ledger.entries[0]?.balanced).toBe(false);
  });

  it('balance checks at 2dp money precision — float drift cannot shout unbalanced', () => {
    expect(isLedgerBalanced(100.005, 100.01)).toBe(true); // both round to 100.01
    expect(isLedgerBalanced(100.004, 100)).toBe(true); // 100.00 vs 100.00
    expect(isLedgerBalanced(100.02, 100.01)).toBe(false);
    const sums = sumLedgerLines([
      { debit: 0.1, credit: 0 },
      { debit: 0.2, credit: 0 },
    ]);
    expect(sums.debit).toBe(0.3); // not 0.30000000000000004
  });

  it('orders entries newest entryDate first, stable on equal stamps', () => {
    const ledger = buildPeriodLedger(
      [
        entry({ runId: 'a', entryNumber: 'JE-A', entryDate: '2026-11-02T03:00:00.000Z' }),
        entry({ runId: 'b', entryNumber: 'JE-B', entryDate: '2026-11-01T03:00:00.000Z' }),
        entry({ runId: 'c', entryNumber: 'JE-C', entryDate: '2026-11-02T03:00:00.000Z' }),
      ],
      [run('a', 'REGULAR', 'POSTED'), run('b', 'OFF_CYCLE', 'POSTED'), run('c', 'BONUS', 'POSTED')],
    );
    expect(ledger.entries.map((e) => e.entryNumber)).toEqual(['JE-A', 'JE-C', 'JE-B']);
  });
});

describe('builder — the honesty contract inherits run-groups', () => {
  it('in-motion runs stay counts; voided runs appear nowhere', () => {
    const ledger = buildPeriodLedger(
      [entry({ runId: 'posted-1' })],
      [
        run('posted-1', 'REGULAR', 'POSTED'),
        run('draft-1', 'REGULAR', 'DRAFT'),
        run('wait-1', 'SUPPLEMENTARY', 'PENDING_APPROVAL'),
        run('appr-1', 'BONUS', 'APPROVED'),
        run('void-1', 'REGULAR', 'VOIDED'),
      ],
    );
    expect(ledger.unsettled.map((r) => r.runId)).toEqual(['draft-1', 'wait-1', 'appr-1']);
    expect(ledger.unsettled.every((r) => r.status !== 'VOIDED')).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain('void-1');
  });

  it('a settled run with no journal is surfaced as missing, not skipped', () => {
    const ledger = buildPeriodLedger(
      [entry({ runId: 'posted-1' })],
      [run('posted-1', 'REGULAR', 'POSTED'), run('ghost-1', 'REGULAR', 'LOCKED')],
    );
    expect(ledger.missingJournal).toEqual([{ runId: 'ghost-1', runType: 'REGULAR', status: 'LOCKED' }]);
    expect(ledger.unsettled).toHaveLength(0);
  });

  it('empty period: nothing posted, nothing waiting, nothing missing', () => {
    const ledger = buildPeriodLedger([], [run('void-1', 'REGULAR', 'VOIDED')]);
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.unsettled).toHaveLength(0);
    expect(ledger.missingJournal).toHaveLength(0);
    expect(ledger.zeroRuns).toHaveLength(0);
  });
});

describe('builder — v2.110.0: the drawer knows a zero when it sees one', () => {
  it('a settled zero-value run rides zeroRuns, never the alarm', () => {
    const ledger = buildPeriodLedger(
      [entry({ runId: 'posted-1' })],
      [run('posted-1', 'REGULAR', 'POSTED', 197772.6), run('zero-1', 'REGULAR', 'LOCKED', 0)],
    );
    expect(ledger.zeroRuns).toEqual([{ runId: 'zero-1', runType: 'REGULAR', status: 'LOCKED' }]);
    expect(ledger.missingJournal).toHaveLength(0);
  });

  it('the alarm keeps its teeth: money owed with no journal still fires', () => {
    const ledger = buildPeriodLedger(
      [],
      [run('ghost-1', 'REGULAR', 'LOCKED', 197772.6)],
    );
    expect(ledger.missingJournal).toEqual([{ runId: 'ghost-1', runType: 'REGULAR', status: 'LOCKED' }]);
    expect(ledger.zeroRuns).toHaveLength(0);
  });

  it('the zero split rounds at 2dp — a float hair (0.004) is still a zero run', () => {
    const ledger = buildPeriodLedger([], [run('dust-1', 'BONUS', 'LOCKED', 0.004)]);
    expect(ledger.zeroRuns).toHaveLength(1);
    expect(ledger.missingJournal).toHaveLength(0);
  });

  it('a VOIDED zero run stays nowhere (a closed door is a closed door)', () => {
    const ledger = buildPeriodLedger([], [run('void-1', 'REGULAR', 'VOIDED', 0)]);
    expect(JSON.stringify(ledger)).not.toContain('void-1');
    expect(ledger.zeroRuns).toHaveLength(0);
  });

  it('mixed period: every bucket tells its own truth at once', () => {
    const ledger = buildPeriodLedger(
      [entry({ runId: 'posted-1' })],
      [
        run('posted-1', 'SUPPLEMENTARY', 'POSTED', 197772.6),
        run('ghost-1', 'OFF_CYCLE', 'LOCKED', 258000),
        run('zero-1', 'REGULAR', 'LOCKED', 0),
        run('wait-1', 'BONUS', 'PENDING_APPROVAL', 258000),
      ],
    );
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.missingJournal.map((r) => r.runId)).toEqual(['ghost-1']);
    expect(ledger.zeroRuns.map((r) => r.runId)).toEqual(['zero-1']);
    expect(ledger.unsettled.map((r) => r.runId)).toEqual(['wait-1']);
  });

  it('the route feeds the payable truth (totalNet rides the select and the builder call)', () => {
    const ROUTE = readRepo('src/app/api/payroll/period-journal/route.ts');
    expect(ROUTE.includes('totalNet: true')).toBe(true);
    expect(ROUTE.includes('totalNet: Number(r.totalNet)')).toBe(true);
  });

  it('the drawer renders the quiet zero block and keeps the alarm separate', () => {
    const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');
    expect(PAGE.includes('data-testid="payroll-ledger-zero-runs"')).toBe(true);
    expect(PAGE.includes('Correct by design')).toBe(true);
    // The quiet block is NOT an alert — the red alarm keeps role="alert".
    const zeroBlock = PAGE.split('data-testid="payroll-ledger-zero-runs"')[0].slice(-200);
    expect(zeroBlock).not.toContain('role="alert"');
    expect(PAGE.includes('data-testid="payroll-ledger-missing"')).toBe(true);
  });
});

describe('route — the ledger widens nothing', () => {
  const ROUTE = readRepo('src/app/api/payroll/period-journal/route.ts');

  it('guards exactly like the runs list', () => {
    expect(ROUTE.includes("hrGuard('hr.payroll.read.all'")).toBe(true);
    expect(ROUTE.includes("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']")).toBe(true);
  });

  it('is tenant-scoped and honest about absence', () => {
    expect(ROUTE.includes("storeId: session.storeId || ''")).toBe(true); // period + runs both scoped
    expect(ROUTE.includes("success: false, error: 'periodId is required.'")).toBe(true);
    expect(ROUTE.includes("success: false, error: 'Payroll period not found.'")).toBe(true);
  });

  it('resolves accounts into the lines and rides the pure builder', () => {
    expect(ROUTE.includes("account: { select: { code: true, name: true, type: true } }")).toBe(true);
    expect(ROUTE.includes('buildPeriodLedger')).toBe(true);
    expect(ROUTE.includes("export const dynamic = 'force-dynamic'")).toBe(true);
  });
});

describe('page — the period header grew its ledger door', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('the rail button is a real button BESIDE the fold, never nested in it', () => {
    expect(PAGE.includes('data-testid="payroll-period-journal"')).toBe(true);
    // The fold keeps its door and gains min-w-0 so a long month cannot push the rail out.
    expect(PAGE.includes('flex min-w-0 flex-1 flex-wrap items-center')).toBe(true);
    expect(PAGE.includes('border-l border-border/70')).toBe(true);
    expect(PAGE.includes('Open the ${group.periodName} journal ledger')).toBe(true);
  });

  it('the drawer tells the whole story with its own doors', () => {
    for (const tid of [
      'payroll-ledger-entry',
      'payroll-ledger-line',
      'payroll-ledger-balanced',
      'payroll-ledger-unsettled',
      'payroll-ledger-missing',
      'payroll-ledger-retry',
      'payroll-ledger-empty',
    ]) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
    expect(PAGE.includes('no journal yet')).toBe(true);
    expect(PAGE.includes('this must never happen')).toBe(true);
    expect(PAGE.includes('print:hidden max-h-[85vh]')).toBe(true);
  });

  it('prior v2.98 anchors survive the restructure', () => {
    expect(PAGE.includes('data-testid="payroll-period-toggle"')).toBe(true);
    expect(PAGE.includes('data-testid="payroll-period-rollup"')).toBe(true);
    expect(PAGE.includes('data-testid="payroll-period-net"')).toBe(true);
    expect(PAGE.includes('data-testid="payroll-periods-toggle-all"')).toBe(true);
    expect(PAGE.includes('data-testid="payroll-run-waiting-since"')).toBe(true);
  });

  it('fetches per open with the period id the runs list already carries', () => {
    expect(PAGE.includes('payrollPeriodId: string;')).toBe(true);
    expect(PAGE.includes('/api/payroll/period-journal?periodId=')).toBe(true);
    expect(PAGE.includes('encodeURIComponent(periodId)')).toBe(true);
  });
});

describe('whats-new — the ledger story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');
  const PKG = JSON.parse(readRepo('package.json')) as { version: string; mbumah: { releaseVersion: string; baseVersion: string } };

  it('2.100.0 leads and the slots moved together', () => {
    const i100 = WN.indexOf("version: '2.100.0'");
    const i99 = WN.indexOf("version: '2.99.0'");
    expect(i100).toBeGreaterThan(-1);
    expect(i99).toBeGreaterThan(i100);
    // atLeast, not exact: this file outlives its own release — the version
    // slots keep moving every round, and an exact pin would go stale the
    // moment the next feature ships (the v2.98 stale-pin lesson).
    const atLeast = (actual: string, floor: string) => {
      const a = actual.split('.').map(Number);
      const f = floor.split('.').map(Number);
      return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
    };
    expect(atLeast(PKG.version, '2.100.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.100.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.100.0')).toBe(true);
    expect(PKG.version).toBe(PKG.mbumah.releaseVersion);
    expect(PKG.mbumah.releaseVersion).toBe(PKG.mbumah.baseVersion);
  });

  it('the bullets carry the honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.100.0'"), WN.indexOf("version: '2.99.0'"));
    expect(slice.includes("title: 'The period opens its ledger'")).toBe(true);
    for (const phrase of [
      'Ledger button',
      'Balanced chip',
      'counted as waiting, never priced',
      'widens nothing',
      'printable',
    ]) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
