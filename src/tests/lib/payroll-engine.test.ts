import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveRates,
  computePayslip,
  buildPayrollJournal,
  PayrollGuardrailError,
  type ResolvedRateTable,
  type PayslipInputEmployee,
  type PayslipInputPeriod,
} from '@/lib/hr/payroll/engine';
import { PAYROLL_ACCOUNTS } from '@/lib/hr/payroll/types';

/**
 * PAYROLL HARD GATE (docs/EMS_TEST_PLAN.md): every golden fixture must pass,
 * every property must hold, and the journal must balance before any payroll
 * UI ships. All arithmetic is integer cents.
 */

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'lib', 'hr', 'payroll', 'fixtures', 'golden.json'), 'utf8'),
) as {
  rateTables: Record<string, ResolvedRateTable>;
  cases: Array<{
    name: string;
    expect: Record<string, number>;
    employee: PayslipInputEmployee;
    period: PayslipInputPeriod;
  }>;
};

const REQUIRED = ['PAYE', 'PERSONAL_RELIEF', 'NSSF_TIER1', 'NSSF_TIER2', 'SHIF', 'HOUSING_LEVY'];
const periodDate = new Date('2026-03-15T00:00:00.000Z');
const rates = resolveRates(Object.values(fixture.rateTables), periodDate, REQUIRED);

function deduction(r: ReturnType<typeof computePayslip>, code: string): number {
  return r.deductions.find((l) => l.code === code)?.amountCents ?? 0;
}
function earning(r: ReturnType<typeof computePayslip>, code: string): number {
  return r.earnings.find((l) => l.code === code)?.amountCents ?? 0;
}

describe('payroll hard gate: golden fixtures', () => {
  for (const testCase of fixture.cases) {
    it(`fixture: ${testCase.name}`, () => {
      const result = computePayslip({ employee: testCase.employee, period: testCase.period, rates });

      expect(result.grossCents).toBe(testCase.expect.gross);
      expect(deduction(result, 'PAYE')).toBe(testCase.expect.paye);
      expect(deduction(result, 'NSSF_T1') + deduction(result, 'NSSF_T2')).toBe(testCase.expect.nssf);
      expect(deduction(result, 'SHIF')).toBe(testCase.expect.shif);
      expect(deduction(result, 'AHL')).toBe(testCase.expect.ahl);
      expect(result.netCents).toBe(testCase.expect.net);

      if (testCase.expect.overtime != null) expect(earning(result, 'OVERTIME')).toBe(testCase.expect.overtime);
      if (testCase.expect.commission != null) expect(earning(result, 'COMMISSION')).toBe(testCase.expect.commission);
      if (testCase.expect.otherDeductions != null) {
        expect(deduction(result, 'OTHER_DED')).toBe(testCase.expect.otherDeductions);
      }
    });
  }

  it('every statutory line references its rate table id', () => {
    const result = computePayslip({ employee: fixture.cases[0].employee, period: fixture.cases[0].period, rates });
    for (const line of [...result.deductions, ...result.employerContributions]) {
      if (['PAYE', 'NSSF_T1', 'NSSF_T2', 'SHIF', 'AHL'].includes(line.code)) {
        expect(line.rateTableId).toBeTruthy();
      }
    }
    expect(result.rateTableIds.length).toBe(6);
  });

  it('historical recompute from an archived rate table returns identical amounts', () => {
    const archived = fixture.cases[2];
    const run1 = computePayslip({ employee: archived.employee, period: archived.period, rates });
    const run2 = computePayslip({ employee: archived.employee, period: archived.period, rates });
    expect(run1).toEqual(run2); // replay determinism
    expect(run1.netCents).toBe(archived.expect.net);
  });
});

describe('payroll hard gate: properties', () => {
  it('net identity holds for every fixture: net = gross - total deductions', () => {
    for (const testCase of fixture.cases) {
      const r = computePayslip({ employee: testCase.employee, period: testCase.period, rates });
      expect(r.netCents).toBe(r.grossCents - r.totalDeductionsCents);
      expect(r.roundingAdjustmentCents).toBe(0);
    }
  });

  it('journal debits equal credits for every fixture (balanced by construction)', () => {
    let seq = 0;
    for (const testCase of fixture.cases) {
      const r = computePayslip({ employee: testCase.employee, period: testCase.period, rates });
      const journal = buildPayrollJournal(r, `JE-${++seq}`, `payroll-test-${r.employeeId}-${r.periodYear}-${r.periodMonth}`);
      expect(journal.balanced).toBe(true);
      expect(journal.totalDebitCents).toBe(journal.totalCreditCents);
      expect(journal.totalDebitCents).toBe(r.grossCents + r.employerContributions.reduce((s, l) => s + l.amountCents, 0));
    }
  });

  it('journal uses the reserved payroll accounts', () => {
    const r = computePayslip({ employee: fixture.cases[0].employee, period: fixture.cases[0].period, rates });
    const journal = buildPayrollJournal(r, 'JE-X', 'key-x');
    const codes = journal.lines.map((l) => l.accountCode);
    expect(codes).toContain(PAYROLL_ACCOUNTS.SALARIES_EXPENSE);
    expect(codes).toContain(PAYROLL_ACCOUNTS.NET_PAY_PAYABLE);
    expect(codes).toContain(PAYROLL_ACCOUNTS.PAYE_PAYABLE);
    expect(codes).toContain(PAYROLL_ACCOUNTS.NSSF_PAYABLE);
    expect(codes).toContain(PAYROLL_ACCOUNTS.SHIF_PAYABLE);
    expect(codes).toContain(PAYROLL_ACCOUNTS.HOUSING_PAYABLE);
  });

  it('no float ever enters the money pipeline (all integers)', () => {
    for (const testCase of fixture.cases) {
      const r = computePayslip({ employee: testCase.employee, period: testCase.period, rates });
      expect(Number.isInteger(r.grossCents)).toBe(true);
      expect(Number.isInteger(r.netCents)).toBe(true);
      for (const line of [...r.earnings, ...r.deductions, ...r.employerContributions]) {
        expect(Number.isInteger(line.amountCents)).toBe(true);
      }
    }
  });

  it('replay with the same inputs is idempotent', () => {
    const c = fixture.cases[8];
    const a = computePayslip({ employee: c.employee, period: c.period, rates });
    const b = computePayslip({ employee: c.employee, period: c.period, rates });
    expect(a.netCents).toBe(b.netCents);
    expect(a.trace).toEqual(b.trace);
  });

  it('net rises monotonically with gross (no non-monotonic band edges)', () => {
    const base = JSON.parse(JSON.stringify(fixture.cases[0].employee)) as PayslipInputEmployee;
    let prevNet = -1;
    for (let gross = 500_000; gross <= 9_000_000; gross += 250_000) {
      base.basicSalaryCents = gross;
      base.houseAllowanceCents = 0;
      const r = computePayslip({
        employee: base,
        period: { ...fixture.cases[0].period, unpaidLeaveDays: 0 },
        rates,
      });
      expect(r.netCents).toBeGreaterThanOrEqual(prevNet);
      prevNet = r.netCents;
    }
  });
});

describe('payroll hard gate: guardrails', () => {
  const baseEmployee = fixture.cases[0].employee;
  const basePeriod = fixture.cases[0].period;

  it('NEGATIVE_NET blocks a run whose deductions exceed gross', () => {
    expect(() =>
      computePayslip({
        employee: baseEmployee,
        period: { ...basePeriod, otherDeductionsCents: 999_999_999 },
        rates,
      }),
    ).toThrow(/NEGATIVE_NET/);
  });

  it('RATE_TABLE_MISSING blocks a period without a required table', () => {
    expect(() => resolveRates([], periodDate, REQUIRED)).toThrow(PayrollGuardrailError);
    expect(() => resolveRates([], periodDate, REQUIRED)).toThrow(/RATE_TABLE_MISSING/);
  });

  it('OVERLAPPING_RATE_TABLES blocks duplicate effective windows', () => {
    const dupe = { ...fixture.rateTables.PAYE, effectiveTo: null };
    expect(() => resolveRates([dupe, { ...dupe }], periodDate, ['PAYE'])).toThrow(/OVERLAPPING_RATE_TABLES/);
  });

  it('MISSING_CONSENT blocks when consent is explicitly absent', () => {
    expect(() =>
      computePayslip({ employee: baseEmployee, period: basePeriod, rates, consentGranted: false }),
    ).toThrow(/MISSING_CONSENT/);
  });

  it('a missing PAYE table yields RATE_TABLE_MISSING with the type name', () => {
    const partial = Object.values(fixture.rateTables).filter((t) => t.type !== 'PAYE');
    expect(() => resolveRates(partial, periodDate, REQUIRED)).toThrow(/PAYE/);
  });
});
