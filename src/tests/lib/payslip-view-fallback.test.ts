// PAYSLIP VIEW STORED-COLUMNS FALLBACK TESTS - v2.21.0
//
// The payslip view renders the stored computationTrace when it parses, and
// must degrade to the authoritative PayrollDetail columns when the trace is
// missing or unparseable (spec: stored lines are the source of truth - the
// same lines the P10 register reads). Guards against the "0.00 payslip"
// failure mode observed in QA when a trace stub did not match the schema.

import { describe, it, expect } from 'vitest';
import { buildPayslipView, parseTrace } from '@/lib/hr/payroll/payslip-view';

const EMPLOYEE = {
  id: 'emp-1',
  employeeCode: 'MBM-JUJ-E001',
  firstName: 'Mary',
  lastName: 'Wanjiku',
  nationalId: '12345678',
};

function detailFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'detail-1',
    payslipNumber: 'PS-20260930-0001',
    payslipIssuedAt: new Date('2026-09-30T10:00:00Z'),
    computationTrace: null as string | null,
    daysWorked: 22,
    daysAbsent: 0,
    daysOnLeave: 0,
    overtimeHours: 0,
    paymentStatus: 'PENDING',
    paymentRef: null,
    paymentDate: null,
    // Stored money columns (KES decimals)
    basicSalary: '81650',
    houseAllowance: '23300',
    transportAllowance: '11650',
    medicalAllowance: '0',
    otherAllowances: '0',
    overtimePay: '0',
    grossPay: '116600',
    paye: '22400.6',
    nssf: '4320',
    nhif: '1700',
    housingLevy: '1749',
    payeArrears: '0',
    loanDeduction: '0',
    otherDeductions: '0',
    totalDeductions: '30169.6',
    netPay: '86430.4',
    ...overrides,
  };
}

const RUN = {
  runType: 'STANDARD',
  status: 'POSTED',
  payrollPeriod: {
    name: 'September 2026',
    payDate: new Date('2026-09-30T00:00:00Z'),
  },
};

describe('parseTrace shape gate', () => {
  it('rejects trace stubs without grossCents + earnings', () => {
    expect(parseTrace('{"source":"qa-seed","note":"stub"}')).toBeNull();
    expect(parseTrace(null)).toBeNull();
    expect(parseTrace('not-json')).toBeNull();
  });

  it('accepts a full-shaped trace', () => {
    const trace = JSON.stringify({
      grossCents: 11660000,
      totalDeductionsCents: 3016960,
      netCents: 8643040,
      earnings: [{ code: 'BASIC', label: 'Basic salary', amountCents: 8165000 }],
      deductions: [],
      employerContributions: [],
    });
    const parsed = parseTrace(trace);
    expect(parsed?.grossCents).toBe(11660000);
  });
});

describe('buildPayslipView stored-columns fallback (v2.21.0)', () => {
  it('renders real amounts from stored columns when the trace is NULL', () => {
    const view = buildPayslipView({
      detail: detailFixture(),
      run: RUN,
      employee: EMPLOYEE,
      viewerCanUnmask: false,
    });

    expect(view.totals).toEqual({ gross: 116600, deductions: 30169.6, net: 86430.4 });
    // Non-zero lines only, engine-stable codes
    const earningCodes = view.earnings.map((l) => l.code);
    expect(earningCodes).toEqual(['BASIC', 'HOUSE', 'TRANSPORT']);
    const deductionCodes = view.deductions.map((l) => l.code);
    expect(deductionCodes).toEqual(['PAYE', 'NSSF_T1', 'SHIF', 'AHL']);
    // Identity holds
    expect(view.totals.gross - view.totals.deductions).toBeCloseTo(view.totals.net, 2);
  });

  it('falls back when the trace exists but does not match the schema', () => {
    const view = buildPayslipView({
      detail: detailFixture({ computationTrace: '{"source":"qa-seed","note":"stub"}' }),
      run: RUN,
      employee: EMPLOYEE,
      viewerCanUnmask: false,
    });
    expect(view.totals.net).toBe(86430.4);
  });

  it('prefers the parsed trace when it is valid', () => {
    const trace = JSON.stringify({
      grossCents: 10000000,
      totalDeductionsCents: 1000000,
      netCents: 9000000,
      earnings: [{ code: 'BASIC', label: 'Basic salary', amountCents: 10000000 }],
      deductions: [{ code: 'PAYE', label: 'PAYE income tax', amountCents: 1000000 }],
      employerContributions: [],
    });
    const view = buildPayslipView({
      detail: detailFixture({ computationTrace: trace }),
      run: RUN,
      employee: EMPLOYEE,
      viewerCanUnmask: false,
    });
    expect(view.totals).toEqual({ gross: 100000, deductions: 10000, net: 90000 });
    expect(view.earnings).toHaveLength(1);
  });

  it('still masks statutory identifiers in the fallback path', () => {
    const view = buildPayslipView({
      detail: detailFixture(),
      run: RUN,
      employee: EMPLOYEE,
      viewerCanUnmask: false,
    });
    expect(view.employee.statutory.nationalId).toBe('[REDACTED]');
  });
});
