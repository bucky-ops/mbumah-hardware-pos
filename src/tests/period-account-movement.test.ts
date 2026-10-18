// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.102.0: the account opens its month — the ledger line becomes a door
 * and the account's month movement opens beside the drawer. The contract:
 *
 *   1. THE REPLAY IS PROVEN, NOT TRUSTED — running balances are recomputed
 *      line by line at 2dp money precision (money2 every step, so float
 *      drift can never compound down the column), totals are recomputed
 *      from the lines, and closing = last running step (or the opening
 *      when the month posted nothing).
 *   2. BALANCES READ LIKE A T-ACCOUNT — signedBalance expresses the balance
 *      on the account's NORMAL side: Dr-positive for DEBIT-normal,
 *      Cr-positive for CREDIT-normal; a negative value sits on the other
 *      side and the UI renders the side letter, never a bare negative.
 *      An unknown normalBalance is assumed DEBIT and FLAGGED
 *      (normalBalanceAssumed) — never silently picked.
 *   3. THE HONESTY CONTRACT INHERITS THE LEDGER — the route feeds only
 *      POSTED, never-voided lines (a voided entry is a closed door, an
 *      in-motion entry does not exist yet); the opening is the route's
 *      honest aggregate over every prior source, with priorLines carried
 *      so the UI can say what it summed.
 *   4. THE ROUTE WIDENS NOTHING — hr.payroll.read.all, the ledger's exact
 *      read contract and roles; tenant-scoped (storeId) everywhere; the
 *      account resolved org-scoped (accounts are unique per org+code);
 *      400 without periodId/accountCode, 404 for a foreign period, 404
 *      for an unknown account. A READ endpoint: no audit row (only
 *      exports land those).
 */

import {
  buildAccountMovement,
  signedBalance,
  type AccountMovementMeta,
  type AccountMovementSource,
} from '@/lib/hr/payroll/period-journal';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const META: AccountMovementMeta = {
  accountCode: '5200',
  accountName: 'Salaries Expense',
  accountType: 'EXPENSE',
  normalBalance: 'DEBIT',
};

const META_CR: AccountMovementMeta = {
  accountCode: '2210',
  accountName: 'PAYE Payable',
  accountType: 'LIABILITY',
  normalBalance: 'CREDIT',
};

const line = (over: Partial<AccountMovementSource>): AccountMovementSource => ({
  entryNumber: 'JE-20261017-EA6EC',
  entryDate: '2026-10-17T05:33:00.000Z',
  entryDescription: 'Payroll journal — October 2026 OFF_CYCLE',
  source: 'OFF_CYCLE',
  debit: 0,
  credit: 0,
  lineDescription: null,
  ...over,
});

const OPEN_ZERO = { debit: 0, credit: 0, priorLines: 0 };

describe('signedBalance — the T-account convention', () => {
  it('expresses the balance on the NORMAL side', () => {
    // Debit-normal: debits grow the balance.
    expect(signedBalance(258000, 0, 'DEBIT')).toBe(258000);
    expect(signedBalance(0, 500, 'DEBIT')).toBe(-500); // sits on the credit side
    // Credit-normal: credits grow the balance.
    expect(signedBalance(0, 35207.4, 'CREDIT')).toBe(35207.4);
    expect(signedBalance(100, 35207.4, 'CREDIT')).toBe(35107.4); // debit pays it down
  });

  it('rounds at money precision — float drift cannot leak into a balance', () => {
    expect(signedBalance(0.1, 0.2, 'DEBIT')).toBeCloseTo(-0.1, 10);
    expect(signedBalance(100.005, 0, 'DEBIT')).toBe(100.01);
    expect(signedBalance(0, 100.004, 'CREDIT')).toBe(100.0);
  });

  it('treats an unknown normalBalance as DEBIT (the schema default)', () => {
    expect(signedBalance(300, 100, 'DEBIT')).toBe(signedBalance(300, 100, 'SOMETHING_ELSE'));
  });
});

describe('buildAccountMovement — the replay is proven, not trusted', () => {
  it('replays chronologically with a running balance line by line', () => {
    const movement = buildAccountMovement(
      META,
      OPEN_ZERO,
      [
        line({ entryNumber: 'JE-A', entryDate: '2026-10-10T00:00:00.000Z', debit: 100 }),
        line({ entryNumber: 'JE-B', entryDate: '2026-10-15T00:00:00.000Z', debit: 50, credit: 20 }),
        line({ entryNumber: 'JE-C', entryDate: '2026-10-20T00:00:00.000Z', credit: 30 }),
      ],
    );
    expect(movement.movements.map((m) => m.entryNumber)).toEqual(['JE-A', 'JE-B', 'JE-C']);
    expect(movement.movements[0]?.running).toBe(100);
    expect(movement.movements[1]?.running).toBe(130);
    expect(movement.movements[2]?.running).toBe(100);
    expect(movement.closing.balance).toBe(100);
  });

  it('carries an honest opening forward and closes at opening + replay', () => {
    const movement = buildAccountMovement(
      META,
      { debit: 1000, credit: 200, priorLines: 7 },
      [line({ debit: 300 })],
    );
    expect(movement.opening.balance).toBe(800);
    expect(movement.opening.priorLines).toBe(7);
    expect(movement.movements[0]?.running).toBe(1100);
    expect(movement.closing.balance).toBe(1100);
    expect(movement.totals).toEqual({ debit: 300, credit: 0 });
  });

  it('an empty month closes at the opening and says so', () => {
    const movement = buildAccountMovement(META, { debit: 500, credit: 0, priorLines: 2 }, []);
    expect(movement.movements).toHaveLength(0);
    expect(movement.closing.balance).toBe(500);
    expect(movement.totals).toEqual({ debit: 0, credit: 0 });
  });

  it('credit-normal accounts read Cr-positive the whole way down', () => {
    const movement = buildAccountMovement(
      META_CR,
      OPEN_ZERO,
      [
        line({ entryNumber: 'JE-A', credit: 35207.4 }),
        line({ entryNumber: 'JE-B', credit: 35207.4 }),
      ],
    );
    expect(movement.movements[0]?.running).toBe(35207.4);
    expect(movement.movements[1]?.running).toBe(70414.8);
    expect(movement.closing.balance).toBe(70414.8);
    expect(movement.account.normalBalance).toBe('CREDIT');
  });

  it('money2 every step — the 0.1 + 0.2 float trap never compounds', () => {
    const movement = buildAccountMovement(
      META,
      OPEN_ZERO,
      [
        line({ debit: 0.1 }),
        line({ debit: 0.2 }),
        line({ credit: 0.3 }),
      ],
    );
    expect(movement.movements[2]?.running).toBe(0);
    expect(movement.closing.balance).toBe(0);
  });

  it('recomputes totals from the lines and normalizes the money', () => {
    const movement = buildAccountMovement(
      META,
      OPEN_ZERO,
      [line({ debit: 100.004, credit: 0 }), line({ debit: '50' as unknown as number, credit: 0 })],
    );
    expect(movement.totals.debit).toBe(150.0);
    expect(movement.totals.credit).toBe(0);
  });

  it('flags an unknown normal side instead of silently picking one', () => {
    const movement = buildAccountMovement(
      { ...META, normalBalance: 'WEIRD' },
      OPEN_ZERO,
      [line({ debit: 10 })],
    );
    expect(movement.normalBalanceAssumed).toBe(true);
    expect(movement.account.normalBalance).toBe('DEBIT'); // assumed, not invented
    // Known sides never flag.
    expect(buildAccountMovement(META, OPEN_ZERO, []).normalBalanceAssumed).toBe(false);
    expect(buildAccountMovement(META_CR, OPEN_ZERO, []).normalBalanceAssumed).toBe(false);
  });

  it('a balance that crosses sides reads negative on the normal side', () => {
    const movement = buildAccountMovement(
      META_CR,
      OPEN_ZERO,
      [line({ debit: 500, credit: 100 })],
    );
    // Credit-normal account over-paid: 400 sits on the DEBIT side.
    expect(movement.closing.balance).toBe(-400);
  });
});

describe('route — the read contract widens nothing', () => {
  const ROUTE = readRepo('src/app/api/payroll/period-journal/account/route.ts');

  it('guards exactly like the ledger route', () => {
    expect(ROUTE).toContain("hrGuard('hr.payroll.read.all'");
    expect(ROUTE).toContain("['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']");
    expect(ROUTE).toContain("export const dynamic = 'force-dynamic'");
  });

  it('validates params and scopes everything to the tenant', () => {
    expect(ROUTE).toContain("if (!periodId || !accountCode)");
    expect(ROUTE).toContain("{ status: 400 }");
    expect(ROUTE).toContain("where: { id: periodId, storeId: session.storeId || '' }");
    expect(ROUTE).toContain("storeId: session.storeId || ''");
    // Accounts are unique per org+code — resolved through the store's organizationId.
    expect(ROUTE).toContain('organizationId: store.organizationId');
  });

  it('404s honestly: foreign period, unknown account', () => {
    expect(ROUTE).toContain("error: 'Payroll period not found.'");
    expect(ROUTE).toContain('No account ${accountCode} in this organization.');
  });

  it('counts only posted, never-voided entries — closed doors stay closed', () => {
    expect(ROUTE.match(/isPosted: true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(ROUTE.match(/isVoided: false/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('the window is the period\u2019s own days inclusive (gte start, lt end + 1 day)', () => {
    expect(ROUTE).toContain('windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);');
    expect(ROUTE).toContain('entryDate: { lt: period.startDate }');
    expect(ROUTE).toContain('entryDate: { gte: period.startDate, lt: windowEnd }');
  });

  it('rides the pure builder and resolves the source honestly', () => {
    expect(ROUTE).toContain('buildAccountMovement(');
    expect(ROUTE).toContain("l.journalEntry.payrollRuns[0]?.runType ?? l.journalEntry.referenceType ?? 'JOURNAL'");
    expect(ROUTE).toContain('orderBy: [{ journalEntry: { entryDate: \'asc\' } }, { createdAt: \'asc\' }]');
  });

  it('a read endpoint lands no audit row (only exports do)', () => {
    expect(ROUTE).not.toContain('auditLog.create');
    expect(ROUTE).not.toContain('createAuditLog');
  });
});

describe('page — the door, the drill, the anchors', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('every ledger line is a door with an honest aria label', () => {
    expect(PAGE).toContain('data-testid="payroll-ledger-line-door"');
    expect(PAGE).toContain("Open ${line.accountCode} ${line.accountName} — the account's month movement across this period's ledger");
    // The row opens too, but never double-fires behind the door.
    expect(PAGE).toContain("closest('[data-testid=payroll-ledger-line-door]')");
    expect(PAGE).toContain('void openAccountMovement(line.accountCode)');
  });

  it('the movement dialog carries its anchors', () => {
    for (const tid of [
      'payroll-account-movement',
      'payroll-account-loading',
      'payroll-account-error',
      'payroll-account-retry',
      'payroll-account-opening',
      'payroll-account-empty',
      'payroll-account-row',
      'payroll-account-running',
      'payroll-account-closing',
      'payroll-account-back',
    ]) {
      expect(PAGE).toContain(`data-testid="${tid}"`);
    }
  });

  it('the drill fetch is shaped and narrowed honestly', () => {
    expect(PAGE).toContain('/api/payroll/period-journal/account?periodId=');
    expect(PAGE).toContain('&accountCode=${encodeURIComponent(code)}');
    expect(PAGE).toContain('Movement API unreachable');
    expect(PAGE).toContain('typeof body.data.account?.code !== \'string\'');
    expect(PAGE).toContain('Array.isArray(body.data.movements)');
  });

  it('stale drill state never greets the next period', () => {
    const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
    expect(effect).toContain('setDrillCode(null);');
    expect(effect).toContain('setDrill(null);');
  });

  it('side letters instead of bare negatives', () => {
    expect(PAGE).toContain("const normal = normalBalance === 'CREDIT' ? 'Cr' : 'Dr';");
    expect(PAGE).toContain("return `${kes(Math.abs(balance))} ${balance >= 0 ? normal : opposite}`;");
  });

  it('prior v2.98 / v2.100 / v2.101 anchors survive the restructure', () => {
    for (const tid of [
      'payroll-period-group',
      'payroll-period-journal',
      'payroll-ledger-entry',
      'payroll-ledger-line',
      'payroll-ledger-balanced',
      'payroll-ledger-unsettled',
      'payroll-ledger-missing',
      'payroll-ledger-csv',
      'payroll-ledger-csv-note',
    ]) {
      expect(PAGE).toContain(`data-testid="${tid}"`);
    }
  });
});

describe('whats-new — the movement story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');
  const PKG = JSON.parse(readRepo('package.json')) as { version: string; mbumah: { releaseVersion: string; baseVersion: string } };

  it('2.102.0 leads and the slots moved together', () => {
    const i102 = WN.indexOf("version: '2.102.0'");
    const i101 = WN.indexOf("version: '2.101.0'");
    expect(i102).toBeGreaterThan(-1);
    expect(i101).toBeGreaterThan(i102);
    // atLeast, not exact — an exact version pin goes stale the moment the
    // next feature ships (the v2.100 lesson, learned the hard way).
    const atLeast = (actual: string, floor: string) => {
      const a = actual.split('.').map(Number);
      const f = floor.split('.').map(Number);
      return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
    };
    expect(atLeast(PKG.version, '2.102.0')).toBe(true);
    expect(atLeast(PKG.mbumah.releaseVersion, '2.102.0')).toBe(true);
    expect(atLeast(PKG.mbumah.baseVersion, '2.102.0')).toBe(true);
    expect(PKG.version).toBe(PKG.mbumah.releaseVersion);
    expect(PKG.mbumah.releaseVersion).toBe(PKG.mbumah.baseVersion);
  });

  it('the bullets carry the honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.102.0'"), WN.indexOf("version: '2.101.0'"));
    expect(slice.includes("title: 'The account opens its month'")).toBe(true);
    for (const phrase of [
      'chronological replay',
      'starts the month at zero',
      'the side letter instead of a bare negative',
      'closed doors',
      'widens nothing',
    ]) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
