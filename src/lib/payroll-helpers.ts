// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Payroll Calculation Engine (Kenyan Statutory Compliance)
// ─────────────────────────────────────────────────────────────────────────────
//
// This module implements the full Kenyan payroll calculation pipeline:
//
//   1. Gross pay = basicSalary + allowances + overtimePay
//   2. Statutory deductions:
//      • NSSF        — National Social Security Fund (Tier I + Tier II, 2024 rates)
//      • NHIF/SHIF    — National Hospital Insurance Fund / Social Health Insurance Fund
//      • PAYE        — Pay As You Earn income tax (monthly bands, 2024)
//      • Housing Levy — Affordable Housing Act 2024 (1.5% employee + 1.5% employer)
//   3. Other deductions: loans, arrears, other
//   4. Net pay = grossPay - totalDeductions
//
// ── LEGAL REFERENCES (Kenya, 2024/2025) ──
//
//   • NSSF Act 2013 (effective Feb 2024):
//       Tier I:  6% of pensionable earnings up to KES 8,000  → max KES 480
//       Tier II: 6% of pensionable earnings from 8,001–72,000 → max KES 3,840
//       Total max employee contribution: KES 4,320/month
//
//   • SHIF (replaces NHIF, effective Oct 2024):
//       2.75% of gross pay, minimum KES 300/month.
//       (For backward compat we still call the field `nhif` in the DB.)
//
//   • PAYE (effective July 2024):
//       Monthly taxable income bands:
//         0 – 24,000           → 10%
//         24,001 – 32,333      → 25%
//         32,334 – 500,000     → 30%
//         500,001 – 800,000    → 32.5%
//         800,001+             → 35%
//       Personal relief: KES 2,400/month (KES 28,800/year)
//       Housing Levy + SHIF are deductible from taxable income BEFORE PAYE.
//       NSSF is also deductible from taxable income.
//
//   • Affordable Housing Act 2024:
//       1.5% of gross basic salary (employee) + 1.5% (employer).
//       Capped at gross pay (no upper limit in the Act, but practically
//       follows the NSSF ceiling of KES 72,000 pensionable earnings).
//
// ── IMPORTANT ──
//
//   Tax laws change. The rates below are parametrised as constants at the top
//   of this file so they can be updated in ONE place when KRA / KENHA revises
//   them. The `deductionsBreakdown` JSON stored on each PayrollDetail records
//   the exact rates used for that run, providing an audit trail even after
//   rates change.
//
//   All monetary values are in KES (Kenyan Shillings). Float is used for
//   consistency with the rest of the schema; rounding to 2 decimal places is
//   applied at the end of each calculation to avoid floating-point drift.
// ─────────────────────────────────────────────────────────────────────────────

import { db, withImmutabilityBypass, runWithoutTenant } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// ── 1. Statutory deduction rate constants (Kenya 2024/2025) ──────────────────

export const NSSF_RATES = {
  tier1Rate: 0.06,            // 6%
  tier1Ceiling: 8000,         // KES 8,000
  tier2Rate: 0.06,            // 6%
  tier2Ceiling: 72000,        // KES 72,000 (upper limit of pensionable earnings)
  tier1Max: 480,              // 6% of 8,000
  tier2Max: 3840,             // 6% of (72,000 - 8,000) = 6% of 64,000
  totalMax: 4320,             // tier1Max + tier2Max
} as const;

export const SHIF_RATES = {
  rate: 0.0275,               // 2.75% of gross pay
  minimum: 300,               // KES 300/month minimum
} as const;

export const HOUSING_LEVY_RATES = {
  employeeRate: 0.015,        // 1.5% employee
  employerRate: 0.015,        // 1.5% employer (informational; not deducted from net)
} as const;

export const PAYE_RELIEF = {
  personalReliefMonthly: 2400,  // KES 2,400/month
  insuranceReliefMaxMonthly: 5000, // 15% of NHIF contribution, max KES 5,000
} as const;

// PAYE monthly bands (2024): [lowerBound, upperBound (Infinity for top), rate]
export const PAYE_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 24000, 0.10],           // 10% on first 24,000
  [24000, 32333, 0.25],       // 25% on 24,001 – 32,333
  [32333, 500000, 0.30],      // 30% on 32,334 – 500,000
  [500000, 800000, 0.325],    // 32.5% on 500,001 – 800,000
  [800000, Infinity, 0.35],   // 35% on 800,001+
] as const;

// ── 2. Types ─────────────────────────────────────────────────────────────────

export interface PayrollCalculationInput {
  // Employee's compensation config
  basicSalary: number;
  houseAllowance: number;
  transportAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  hourlyRate: number | null;
  // Statutory exemption flags
  payeExempt: boolean;
  nssfExempt: boolean;
  nhifExempt: boolean;
  // Working stats for the period
  daysInPeriod: number;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  overtimeHours: number;
  // Optional overrides for this run
  allowancesOverride?: Partial<{
    houseAllowance: number;
    transportAllowance: number;
    medicalAllowance: number;
    otherAllowances: number;
  }>;
  deductionsOverride?: Partial<{
    loanDeduction: number;
    payeArrears: number;
    otherDeductions: number;
  }>;
}

export interface PayrollCalculationResult {
  // Earnings
  basicSalary: number;
  houseAllowance: number;
  transportAllowance: number;
  medicalAllowance: number;
  otherAllowances: number;
  overtimePay: number;
  grossPay: number;

  // Statutory deductions
  paye: number;
  nssf: number;
  nhif: number;       // SHIF
  housingLevy: number;

  // Other deductions
  payeArrears: number;
  loanDeduction: number;
  otherDeductions: number;
  totalDeductions: number;

  // Net
  netPay: number;

  // Working stats
  daysWorked: number;
  daysPresent: number;
  daysAbsent: number;
  daysOnLeave: number;
  overtimeHours: number;

  // Full audit trail
  breakdown: {
    nssfTier1: number;
    nssfTier2: number;
    nssfTotal: number;
    shifRate: number;
    shifBase: number;
    housingLevyRate: number;
    housingLevyBase: number;
    payeBands: Array<{ lower: number; upper: number; rate: number; taxInBand: number }>;
    payeGrossTax: number;
    payePersonalRelief: number;
    payeTaxableIncome: number;
    insuranceRelief: number;
    ratesUsed: {
      nssf: typeof NSSF_RATES;
      shif: typeof SHIF_RATES;
      housingLevy: typeof HOUSING_LEVY_RATES;
      payeRelief: typeof PAYE_RELIEF;
      payeBands: typeof PAYE_BANDS;
    };
  };
}

// ── 3. Utility: round to 2 decimal places ────────────────────────────────────

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ── 4. NSSF calculation (Tier I + Tier II) ───────────────────────────────────

export interface NSSFResult {
  tier1: number;
  tier2: number;
  total: number;
}

export function calculateNSSF(pensionableEarnings: number, exempt: boolean): NSSFResult {
  if (exempt) {
    return { tier1: 0, tier2: 0, total: 0 };
  }

  // Pensionable earnings is typically the basic salary. The NSSF Act 2013
  // defines pensionable earnings as the lower of actual basic salary and
  // the upper earnings limit (KES 72,000).
  const pensionable = Math.max(0, Math.min(pensionableEarnings, NSSF_RATES.tier2Ceiling));

  // Tier I: 6% of earnings up to KES 8,000
  const tier1Base = Math.min(pensionable, NSSF_RATES.tier1Ceiling);
  const tier1 = round2(tier1Base * NSSF_RATES.tier1Rate);

  // Tier II: 6% of earnings from 8,001 to 72,000
  const tier2Base = Math.max(0, pensionable - NSSF_RATES.tier1Ceiling);
  const tier2 = round2(tier2Base * NSSF_RATES.tier2Rate);

  return {
    tier1,
    tier2,
    total: round2(tier1 + tier2),
  };
}

// ── 5. SHIF (formerly NHIF) calculation ──────────────────────────────────────

export function calculateSHIF(grossPay: number, exempt: boolean): number {
  if (exempt) return 0;

  // SHIF is 2.75% of gross pay, with a minimum of KES 300/month.
  const calculated = round2(grossPay * SHIF_RATES.rate);
  return Math.max(calculated, SHIF_RATES.minimum);
}

// ── 6. Housing Levy calculation ──────────────────────────────────────────────

export function calculateHousingLevy(basicSalary: number): number {
  // 1.5% of basic salary (employee portion). The employer also contributes
  // 1.5% but that is a cost to the business, not a deduction from the
  // employee's net pay.
  return round2(basicSalary * HOUSING_LEVY_RATES.employeeRate);
}

// ── 7. PAYE calculation (progressive bands, post-deduction taxable income) ───

export interface PAYEResult {
  grossTax: number;
  personalRelief: number;
  netPAYE: number;
  bands: Array<{ lower: number; upper: number; rate: number; taxInBand: number }>;
  taxableIncome: number;
}

export function calculatePAYE(
  taxableIncome: number,
  exempt: boolean,
  personalRelief: number = PAYE_RELIEF.personalReliefMonthly
): PAYEResult {
  if (exempt || taxableIncome <= 0) {
    return {
      grossTax: 0,
      personalRelief: 0,
      netPAYE: 0,
      bands: PAYE_BANDS.map(([lower, upper, rate]) => ({
        lower,
        upper,
        rate,
        taxInBand: 0,
      })),
      taxableIncome: 0,
    };
  }

  const bands: PAYEResult['bands'] = [];
  let grossTax = 0;
  let remaining = taxableIncome;

  for (const [lower, upper, rate] of PAYE_BANDS) {
    if (remaining <= 0) {
      bands.push({ lower, upper, rate, taxInBand: 0 });
      continue;
    }

    // The amount of income that falls in THIS band
    const bandWidth = upper - lower;
    const amountInBand = Math.min(remaining, bandWidth);
    const taxInBand = round2(amountInBand * rate);
    bands.push({ lower, upper, rate, taxInBand });
    grossTax += taxInBand;
    remaining -= amountInBand;
  }

  grossTax = round2(grossTax);
  const netPAYE = Math.max(0, round2(grossTax - personalRelief));

  return {
    grossTax,
    personalRelief,
    netPAYE,
    bands,
    taxableIncome,
  };
}

// ── 8. Overtime calculation ──────────────────────────────────────────────────

export function calculateOvertimePay(
  overtimeHours: number,
  hourlyRate: number | null,
  basicSalary: number,
  daysInPeriod: number
): number {
  if (overtimeHours <= 0) return 0;

  // If an explicit hourly rate is set, use it with a 1.5x overtime multiplier
  // (Kenyan labour law minimum for overtime on weekdays).
  if (hourlyRate && hourlyRate > 0) {
    return round2(overtimeHours * hourlyRate * 1.5);
  }

  // Otherwise derive the hourly rate from the basic salary:
  //   hourlyRate = basicSalary / (daysInPeriod * 8 hours)
  // (Standard 8-hour workday assumption.)
  if (basicSalary <= 0 || daysInPeriod <= 0) return 0;

  const derivedHourlyRate = basicSalary / (daysInPeriod * 8);
  return round2(overtimeHours * derivedHourlyRate * 1.5);
}

// ── 9. Main calculation function ─────────────────────────────────────────────

/**
 * Calculate the full payroll breakdown for a single employee for one period.
 *
 * This is a PURE function — it does NOT touch the database. It takes the
 * employee's compensation config + working stats and returns the complete
 * earnings/deductions/netPay breakdown with a full audit trail.
 *
 * @example
 *   const result = calculatePayForPeriod({
 *     basicSalary: 50000,
 *     houseAllowance: 10000,
 *     transportAllowance: 5000,
 *     medicalAllowance: 3000,
 *     otherAllowances: 0,
 *     hourlyRate: null,
 *     payeExempt: false,
 *     nssfExempt: false,
 *     nhifExempt: false,
 *     daysInPeriod: 30,
 *     daysPresent: 22,
 *     daysAbsent: 0,
 *     daysOnLeave: 0,
 *     overtimeHours: 10,
 *   });
 *   // result.netPay → the employee's net pay for the period
 */
export function calculatePayForPeriod(input: PayrollCalculationInput): PayrollCalculationResult {
  // Apply overrides
  const houseAllowance = input.allowancesOverride?.houseAllowance ?? input.houseAllowance;
  const transportAllowance = input.allowancesOverride?.transportAllowance ?? input.transportAllowance;
  const medicalAllowance = input.allowancesOverride?.medicalAllowance ?? input.medicalAllowance;
  const otherAllowances = input.allowancesOverride?.otherAllowances ?? input.otherAllowances;

  const loanDeduction = input.deductionsOverride?.loanDeduction ?? 0;
  const payeArrears = input.deductionsOverride?.payeArrears ?? 0;
  const otherDeductions = input.deductionsOverride?.otherDeductions ?? 0;

  // ── Earnings ──
  const overtimePay = calculateOvertimePay(
    input.overtimeHours,
    input.hourlyRate,
    input.basicSalary,
    input.daysInPeriod
  );

  const grossPay = round2(
    input.basicSalary +
    houseAllowance +
    transportAllowance +
    medicalAllowance +
    otherAllowances +
    overtimePay
  );

  // ── Statutory deductions ──

  // NSSF: based on pensionable earnings (= basic salary, capped at 72,000)
  const nssfResult = calculateNSSF(input.basicSalary, input.nssfExempt);

  // SHIF: 2.75% of gross pay, min 300
  const nhif = calculateSHIF(grossPay, input.nhifExempt);

  // Housing Levy: 1.5% of basic salary
  const housingLevy = calculateHousingLevy(input.basicSalary);

  // PAYE: taxable income = grossPay - NSSF - SHIF - Housing Levy
  // (NSSF, SHIF, and Housing Levy are all deductible before PAYE per 2024 law)
  const taxableIncome = Math.max(0, round2(grossPay - nssfResult.total - nhif - housingLevy));
  const payeResult = calculatePAYE(taxableIncome, input.payeExempt);

  // Insurance relief: 15% of SHIF, max KES 5,000 (reduces PAYE further)
  const insuranceRelief = Math.min(
    round2(nhif * 0.15),
    PAYE_RELIEF.insuranceReliefMaxMonthly
  );
  const finalPAYE = Math.max(0, round2(payeResult.netPAYE - insuranceRelief));

  // ── Total deductions ──
  const totalDeductions = round2(
    finalPAYE +
    nssfResult.total +
    nhif +
    housingLevy +
    payeArrears +
    loanDeduction +
    otherDeductions
  );

  // ── Net pay ──
  const netPay = round2(grossPay - totalDeductions);

  // ── Working stats ──
  const daysWorked = input.daysPresent + input.overtimeHours > 0
    ? input.daysPresent
    : 0;

  return {
    basicSalary: input.basicSalary,
    houseAllowance,
    transportAllowance,
    medicalAllowance,
    otherAllowances,
    overtimePay,
    grossPay,

    paye: finalPAYE,
    nssf: nssfResult.total,
    nhif,
    housingLevy,

    payeArrears,
    loanDeduction,
    otherDeductions,
    totalDeductions,

    netPay,

    daysWorked,
    daysPresent: input.daysPresent,
    daysAbsent: input.daysAbsent,
    daysOnLeave: input.daysOnLeave,
    overtimeHours: input.overtimeHours,

    breakdown: {
      nssfTier1: nssfResult.tier1,
      nssfTier2: nssfResult.tier2,
      nssfTotal: nssfResult.total,
      shifRate: SHIF_RATES.rate,
      shifBase: grossPay,
      housingLevyRate: HOUSING_LEVY_RATES.employeeRate,
      housingLevyBase: input.basicSalary,
      payeBands: payeResult.bands,
      payeGrossTax: payeResult.grossTax,
      payePersonalRelief: payeResult.personalRelief,
      payeTaxableIncome: payeResult.taxableIncome,
      insuranceRelief,
      ratesUsed: {
        nssf: NSSF_RATES,
        shif: SHIF_RATES,
        housingLevy: HOUSING_LEVY_RATES,
        payeRelief: PAYE_RELIEF,
        payeBands: PAYE_BANDS,
      },
    },
  };
}

// ── 10. Process a full payroll run ───────────────────────────────────────────

export interface ProcessPayrollRunResult {
  payrollRunId: string;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  errors: Array<{ employeeId: string; employeeName: string; error: string }>;
}

/**
 * Process a payroll run: fetch all active employees for the run's store,
 * calculate pay for each using attendance + leave data for the period,
 * create PayrollDetail records (immutable), and update the run's aggregate
 * totals.
 *
 * This function is idempotent within a run: if PayrollDetail records already
 * exist for this run (e.g. from a partial prior attempt), they are skipped
 * to avoid duplicates. To re-process, void the run first and create a new one.
 *
 * The entire operation runs in a Prisma transaction so that a failure midway
 * does not leave partial payslip records. PayrollDetail creation uses
 * withImmutabilityBypass() since these are the INITIAL creation (not a
 * mutation of existing financial records).
 *
 * @param payrollRunId  The ID of the PayrollRun to process
 * @param initiatedByUserId  The user ID of the manager initiating the run
 */
export async function processPayrollRun(
  payrollRunId: string,
  initiatedByUserId: string
): Promise<ProcessPayrollRunResult> {
  // Fetch the run + period + store context (outside tenant scope so we can
  // read the run even if the caller is a SUPER_ADMIN without a store).
  const run = await runWithoutTenant(async () => {
    return db.payrollRun.findUnique({
      where: { id: payrollRunId },
      include: {
        payrollPeriod: true,
        store: { select: { id: true, name: true } },
      },
    });
  });

  if (!run) {
    throw new Error(`Payroll run not found: ${payrollRunId}`);
  }

  if (run.status === 'COMPLETED' || run.status === 'PAID') {
    throw new Error(`Payroll run ${payrollRunId} is already ${run.status}. Void it first to reprocess.`);
  }

  // Mark as PROCESSING
  await runWithoutTenant(async () => {
    return db.payrollRun.update({
      where: { id: payrollRunId },
      data: { status: 'PROCESSING' },
    });
  });

  const period = run.payrollPeriod;
  const storeId = run.storeId;

  // Calculate the number of days in the period for pro-rating
  const periodStart = new Date(period.startDate);
  const periodEnd = new Date(period.endDate);
  const daysInPeriod = Math.ceil(
    (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  // Fetch all active employees for this store
  const employees = await runWithoutTenant(async () => {
    return db.employee.findMany({
      where: {
        storeId,
        status: 'ACTIVE',
        // Only include employees hired on or before the period end date
        hireDate: { lte: periodEnd },
        OR: [
          { terminationDate: null },
          { terminationDate: { gte: periodStart } },
        ],
      },
    });
  });

  const errors: ProcessPayrollRunResult['errors'] = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let employeeCount = 0;

  // Process each employee in a transaction so a failure doesn't leave
  // partial payslip records.
  await runWithoutTenant(async () => {
    return db.$transaction(async (tx) => {
      // Check if details already exist (idempotency)
      const existingDetails = await tx.payrollDetail.findMany({
        where: { payrollRunId },
        select: { employeeId: true },
      });
      const processedEmployeeIds = new Set(existingDetails.map(d => d.employeeId));

      for (const employee of employees) {
        // Skip if already processed (idempotency)
        if (processedEmployeeIds.has(employee.id)) {
          continue;
        }

        try {
          // Fetch attendance for this employee during the period
          const attendanceRecords = await tx.attendanceRecord.findMany({
            where: {
              employeeId: employee.id,
              date: { gte: periodStart, lte: periodEnd },
            },
          });

          // Fetch approved leave requests overlapping the period
          const leaveRequests = await tx.leaveRequest.findMany({
            where: {
              employeeId: employee.id,
              status: { in: ['APPROVED', 'TAKEN'] },
              startDate: { lte: periodEnd },
              endDate: { gte: periodStart },
            },
          });

          // Compute working stats
          const daysPresent = attendanceRecords.filter(
            r => r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'REMOTE'
          ).length;
          const daysAbsent = attendanceRecords.filter(
            r => r.status === 'ABSENT'
          ).length;
          const daysOnLeave = leaveRequests.reduce((sum, lr) => {
            // Count only the leave days that fall within this period
            const leaveStart = new Date(Math.max(lr.startDate.getTime(), periodStart.getTime()));
            const leaveEnd = new Date(Math.min(lr.endDate.getTime(), periodEnd.getTime()));
            const leaveDays = Math.ceil(
              (leaveEnd.getTime() - leaveStart.getTime()) / (1000 * 60 * 60 * 24)
            ) + 1;
            return sum + Math.max(0, leaveDays);
          }, 0);
          const overtimeHours = attendanceRecords.reduce(
            (sum, r) => sum + (r.overtimeHours || 0), 0
          );

          // Calculate pay
          const calcResult = calculatePayForPeriod({
            basicSalary: employee.basicSalary,
            houseAllowance: employee.houseAllowance,
            transportAllowance: employee.transportAllowance,
            medicalAllowance: employee.medicalAllowance,
            otherAllowances: employee.otherAllowances,
            hourlyRate: employee.hourlyRate,
            payeExempt: employee.payeExempt,
            nssfExempt: employee.nssfExempt,
            nhifExempt: employee.nhifExempt,
            daysInPeriod,
            daysPresent,
            daysAbsent,
            daysOnLeave,
            overtimeHours,
          });

          // Create the PayrollDetail (immutable record) — use bypass since
          // this is the initial creation, not a mutation of existing records.
          await withImmutabilityBypass(async () => {
            return tx.payrollDetail.create({
              data: {
                payrollRunId,
                employeeId: employee.id,
                storeId,
                basicSalary: calcResult.basicSalary,
                houseAllowance: calcResult.houseAllowance,
                transportAllowance: calcResult.transportAllowance,
                medicalAllowance: calcResult.medicalAllowance,
                otherAllowances: calcResult.otherAllowances,
                overtimePay: calcResult.overtimePay,
                grossPay: calcResult.grossPay,
                paye: calcResult.paye,
                nssf: calcResult.nssf,
                nhif: calcResult.nhif,
                housingLevy: calcResult.housingLevy,
                payeArrears: calcResult.payeArrears,
                loanDeduction: calcResult.loanDeduction,
                otherDeductions: calcResult.otherDeductions,
                totalDeductions: calcResult.totalDeductions,
                netPay: calcResult.netPay,
                daysWorked: calcResult.daysWorked,
                daysPresent: calcResult.daysPresent,
                daysAbsent: calcResult.daysAbsent,
                daysOnLeave: calcResult.daysOnLeave,
                overtimeHours: calcResult.overtimeHours,
                deductionsBreakdown: JSON.stringify(calcResult.breakdown),
                paymentStatus: 'PENDING',
              },
            });
          });

          totalGross += calcResult.grossPay;
          totalDeductions += calcResult.totalDeductions;
          totalNet += calcResult.netPay;
          employeeCount++;
        } catch (err) {
          errors.push({
            employeeId: employee.id,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      // Update the run with aggregate totals + COMPLETED status
      await tx.payrollRun.update({
        where: { id: payrollRunId },
        data: {
          status: errors.length === employees.length ? 'FAILED' : 'COMPLETED',
          processedAt: new Date(),
          initiatedBy: initiatedByUserId,
          totalGross: round2(totalGross),
          totalDeductions: round2(totalDeductions),
          totalNet: round2(totalNet),
          employeeCount,
          errorMessage: errors.length > 0
            ? `${errors.length} employee(s) failed: ${errors.map(e => e.employeeName).join(', ')}`
            : null,
        },
      });

      // Update the period's aggregate totals
      await tx.payrollPeriod.update({
        where: { id: period.id },
        data: {
          status: 'PROCESSING',
          totalGross: round2(totalGross),
          totalDeductions: round2(totalDeductions),
          totalNet: round2(totalNet),
          employeeCount,
        },
      });
    });
  });

  // Log the payroll run completion
  try {
    await systemLog({
      action: 'PAYROLL_RUN_PROCESSED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.INFO,
      message: `Payroll run processed for ${run.store.name}: ${employeeCount} employees, gross KES ${totalGross.toLocaleString()}, net KES ${totalNet.toLocaleString()}`,
      storeId,
      userId: initiatedByUserId,
      metadata: {
        payrollRunId,
        payrollPeriodId: period.id,
        employeeCount,
        totalGross: round2(totalGross),
        totalDeductions: round2(totalDeductions),
        totalNet: round2(totalNet),
        errorCount: errors.length,
      },
    });
  } catch {
    /* ignore logging errors */
  }

  return {
    payrollRunId,
    employeeCount,
    totalGross: round2(totalGross),
    totalDeductions: round2(totalDeductions),
    totalNet: round2(totalNet),
    errors,
  };
}

// ── 11. Leave balance management ─────────────────────────────────────────────

/**
 * Get or create the leave balance for an employee + leave type + year.
 * The `available` days are computed at read time:
 *   available = allocated + carryForward - used - pending
 */
export async function getOrCreateLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  leaveYear: number
) {
  const existing = await runWithoutTenant(async () => {
    return db.employeeLeaveBalance.findUnique({
      where: {
        employeeId_leaveTypeId_leaveYear: {
          employeeId,
          leaveTypeId,
          leaveYear,
        },
      },
    });
  });

  if (existing) {
    return {
      ...existing,
      available: round2(existing.allocatedDays + existing.carryForwardDays - existing.usedDays - existing.pendingDays),
    };
  }

  // Create with default allocation from the LeaveType
  const leaveType = await runWithoutTenant(async () => {
    return db.leaveType.findUnique({ where: { id: leaveTypeId } });
  });

  const allocated = leaveType?.defaultDaysPerYear ?? 0;

  const created = await runWithoutTenant(async () => {
    return db.employeeLeaveBalance.create({
      data: {
        employeeId,
        leaveTypeId,
        leaveYear,
        allocatedDays: allocated,
        usedDays: 0,
        pendingDays: 0,
        carryForwardDays: 0,
        encashedDays: 0,
      },
    });
  });

  return {
    ...created,
    available: round2(allocated),
  };
}

/**
 * Update leave balances when a leave request status changes.
 *
 *   • On PENDING → adds `workingDays` to `pendingDays`
 *   • On APPROVED → moves `workingDays` from `pendingDays` to `usedDays`
 *   • On REJECTED/CANCELLED → subtracts `workingDays` from `pendingDays`
 *
 * This keeps the balance accurate at every stage of the approval workflow.
 */
export async function updateLeaveBalanceOnStatusChange(
  leaveRequestId: string,
  newStatus: string,
  oldStatus: string
): Promise<void> {
  const request = await runWithoutTenant(async () => {
    return db.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      include: { employee: true },
    });
  });

  if (!request) {
    throw new Error(`Leave request not found: ${leaveRequestId}`);
  }

  const leaveYear = new Date(request.startDate).getFullYear();
  const balance = await getOrCreateLeaveBalance(
    request.employeeId,
    request.leaveTypeId,
    leaveYear
  );

  const days = request.workingDays;

  // Transition logic
  if (oldStatus === 'PENDING' && newStatus === 'APPROVED') {
    // Move from pending to used
    await runWithoutTenant(async () => {
      return db.employeeLeaveBalance.update({
        where: { id: balance.id },
        data: {
          pendingDays: Math.max(0, round2(balance.pendingDays - days)),
          usedDays: round2(balance.usedDays + days),
        },
      });
    });
  } else if (oldStatus === 'PENDING' && (newStatus === 'REJECTED' || newStatus === 'CANCELLED')) {
    // Remove from pending
    await runWithoutTenant(async () => {
      return db.employeeLeaveBalance.update({
        where: { id: balance.id },
        data: {
          pendingDays: Math.max(0, round2(balance.pendingDays - days)),
        },
      });
    });
  } else if (oldStatus === 'APPROVED' && newStatus === 'CANCELLED') {
    // Remove from used (leave was approved but then cancelled before being taken)
    await runWithoutTenant(async () => {
      return db.employeeLeaveBalance.update({
        where: { id: balance.id },
        data: {
          usedDays: Math.max(0, round2(balance.usedDays - days)),
        },
      });
    });
  }
  // Other transitions (e.g. APPROVED → TAKEN) don't change the balance
  // because the days were already counted as used on approval.
}

/**
 * Calculate the number of working days between two dates (inclusive),
 * excluding weekends (Saturday + Sunday). Kenyan public holidays are
 * NOT subtracted here — that's a future enhancement (a Holidays table).
 */
export function calculateWorkingDays(startDate: Date, endDate: Date): number {
  if (startDate > endDate) return 0;

  let workingDays = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    // 0 = Sunday, 6 = Saturday
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      workingDays++;
    }
    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}

// ── 12. Seed default leave types (organisation-wide) ─────────────────────────

/**
 * Seed the organisation-wide leave types required by Kenyan labour law.
 * Idempotent — safe to call multiple times.
 */
export async function seedDefaultLeaveTypes(): Promise<void> {
  const defaultTypes = [
    { name: 'Annual Leave', code: 'ANNUAL', description: 'Paid annual vacation leave', defaultDaysPerYear: 21, isPaid: true, isStatutory: true, carryForwardAllowed: true, maxCarryForwardDays: 5 },
    { name: 'Sick Leave', code: 'SICK', description: 'Paid sick leave (requires medical certificate for 3+ days)', defaultDaysPerYear: 7, isPaid: true, isStatutory: true, carryForwardAllowed: false, maxCarryForwardDays: 0 },
    { name: 'Maternity Leave', code: 'MATERNITY', description: 'Maternity leave (90 days per Kenyan law)', defaultDaysPerYear: 90, isPaid: true, isStatutory: true, carryForwardAllowed: false, maxCarryForwardDays: 0 },
    { name: 'Paternity Leave', code: 'PATERNITY', description: 'Paternity leave (14 days per Kenyan law)', defaultDaysPerYear: 14, isPaid: true, isStatutory: true, carryForwardAllowed: false, maxCarryForwardDays: 0 },
    { name: 'Compassionate Leave', code: 'COMPASSIONATE', description: 'Bereavement / compassionate leave', defaultDaysPerYear: 0, isPaid: true, isStatutory: false, carryForwardAllowed: false, maxCarryForwardDays: 0 },
    { name: 'Study Leave', code: 'STUDY', description: 'Approved study / exam leave', defaultDaysPerYear: 0, isPaid: true, isStatutory: false, carryForwardAllowed: false, maxCarryForwardDays: 0 },
    { name: 'Unpaid Leave', code: 'UNPAID', description: 'Leave without pay', defaultDaysPerYear: 0, isPaid: false, isStatutory: false, carryForwardAllowed: false, maxCarryForwardDays: 0 },
  ];

  for (const lt of defaultTypes) {
    await runWithoutTenant(async () => {
      return db.leaveType.upsert({
        where: { code: lt.code },
        update: {}, // Don't overwrite existing settings
        create: lt,
      });
    });
  }
}
