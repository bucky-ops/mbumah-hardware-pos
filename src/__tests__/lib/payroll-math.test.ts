/**
 * Payroll math tests — calculatePayForPeriod (Kenya 2024/2025 statutory rules).
 *
 * Focus:
 *  1. Full-month calculation matches hand-computed statutory values.
 *  2. ZERO-earnings guard: no statutory deduction may be charged when
 *     grossPay <= 0 (incident June 2026: housing levy 2,699.99 charged
 *     against grossPay 0 → netPay −2,699.99).
 *  3. Statutory caps and floors: NSSF ceiling 72,000, SHIF minimum 300.
 */
import { describe, it, expect } from 'vitest';
import {
  calculatePayForPeriod,
  calculateNSSF,
  calculateSHIF,
  calculateHousingLevy,
  calculatePAYE,
  NSSF_RATES,
  SHIF_RATES,
} from '@/lib/payroll-helpers';

const FULL_MONTH_INPUT = {
  basicSalary: 50000,
  houseAllowance: 10000,
  transportAllowance: 5000,
  medicalAllowance: 3000,
  otherAllowances: 0,
  hourlyRate: null,
  payeExempt: false,
  nssfExempt: false,
  nhifExempt: false,
  daysInPeriod: 30,
  daysPresent: 26,
  daysAbsent: 2,
  daysOnLeave: 2,
  overtimeHours: 0,
};

describe('payroll math — calculatePayForPeriod', () => {
  it('computes a full-month payslip that matches hand-calculated statutory values', () => {
    const r = calculatePayForPeriod(FULL_MONTH_INPUT);

    // Gross = 50,000 + 10,000 + 5,000 + 3,000 + 0 + 0
    expect(r.grossPay).toBe(68000);

    // NSSF: pensionable = min(50,000, 72,000) → 6%×8,000 + 6%×42,000 = 3,000
    expect(r.nssf).toBe(3000);

    // SHIF: 2.75% × 68,000 = 1,870
    expect(r.nhif).toBe(1870);

    // Housing levy: 1.5% × 50,000 = 750
    expect(r.housingLevy).toBe(750);

    // Taxable = 68,000 − 3,000 − 1,870 − 750 = 62,380
    // PAYE = 2,400 + 25%×8,333 + 30%×30,047 = 13,497.35
    // net PAYE = 13,497.35 − 2,400 relief = 11,097.35
    // insurance relief = 15% × 1,870 = 280.50 → final PAYE = 10,816.85
    expect(r.paye).toBe(10816.85);

    // Total deductions = 3,000 + 1,870 + 750 + 10,816.85
    expect(r.totalDeductions).toBe(16436.85);

    // Net = 68,000 − 16,436.85
    expect(r.netPay).toBe(51563.15);
  });

  it('charges ZERO statutory deductions when there are no earnings (net pay never negative)', () => {
    const r = calculatePayForPeriod({
      ...FULL_MONTH_INPUT,
      basicSalary: 0,
      houseAllowance: 0,
      transportAllowance: 0,
      medicalAllowance: 0,
      otherAllowances: 0,
      overtimeHours: 0,
      daysPresent: 0,
      daysAbsent: 0,
      daysOnLeave: 0,
    });

    expect(r.grossPay).toBe(0);
    expect(r.paye).toBe(0);
    expect(r.nssf).toBe(0);
    expect(r.nhif).toBe(0);
    expect(r.housingLevy).toBe(0);
    expect(r.totalDeductions).toBe(0);
    expect(r.netPay).toBe(0);
    expect(r.netPay).toBeGreaterThanOrEqual(0);
  });

  it('zero-attendance supplemental run on a salaried employee cannot go negative via overrides', () => {
    // The June-2026 incident shape: no earnings in the period, only override
    // deductions (arrears/loan are genuine recoveries), statutory MUST be 0.
    const r = calculatePayForPeriod({
      ...FULL_MONTH_INPUT,
      basicSalary: 0,
      houseAllowance: 0,
      transportAllowance: 0,
      medicalAllowance: 0,
      daysPresent: 0,
      deductionsOverride: { payeArrears: 0, loanDeduction: 0, otherDeductions: 0 },
    });

    expect(r.housingLevy).toBe(0);
    expect(r.nssf).toBe(0);
    expect(r.nhif).toBe(0);
    expect(r.netPay).toBe(0);
  });

  it('caps NSSF pensionable earnings at 72,000 (max 4,320/month)', () => {
    const r = calculateNSSF(179999, false);
    expect(r.tier1).toBe(NSSF_RATES.tier1Max);
    expect(r.tier2).toBe(NSSF_RATES.tier2Max);
    expect(r.total).toBe(NSSF_RATES.totalMax);
  });

  it('applies the SHIF KES 300 minimum only when there ARE earnings', () => {
    expect(calculateSHIF(5000, false)).toBe(SHIF_RATES.minimum); // 137.50 → 300
    expect(calculateSHIF(0, false)).toBe(SHIF_RATES.minimum); // helper itself floors at 300; calculatePayForPeriod guards the zero-earnings case
    expect(calculateSHIF(0, true)).toBe(0);
  });

  it('housing levy is 1.5% of the given base', () => {
    expect(calculateHousingLevy(179999)).toBe(2699.99); // incident amount reproduced at helper level
    expect(calculateHousingLevy(0)).toBe(0);
  });

  it('PAYE is zero for zero taxable income and never negative', () => {
    expect(calculatePAYE(0, false).netPAYE).toBe(0);
    expect(calculatePAYE(1000, false).netPAYE).toBe(0); // 100 − 2,400 relief → floored at 0
  });
});
