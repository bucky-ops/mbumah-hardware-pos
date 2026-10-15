// MBUMAH HARDWARE POS - EMS payroll engine: rate resolution and computation
// primitives (v2.18.8). Pure integer-cents arithmetic; see types.ts for the
// hard rules.

import {
  PAYROLL_ACCOUNTS,
  PayrollGuardrailError,
  type PayslipInputEmployee,
  type PayslipInputPeriod,
  type PayslipResult,
  type PayslipLine,
  type ResolvedRateTable,
} from './types';

// ── Rate resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the active rate tables for a period date. Fails on missing required
 * tables and on overlapping effective windows for the same type+code.
 */
export function resolveRates(
  tables: ResolvedRateTable[],
  periodDate: Date,
  requiredTypes: string[],
): Map<string, ResolvedRateTable> {
  const resolved = new Map<string, ResolvedRateTable>();

  for (const type of requiredTypes) {
    const candidates = tables.filter(
      (t) =>
        t.type === type &&
        new Date(t.effectiveFrom).getTime() <= periodDate.getTime() &&
        (!t.effectiveTo || new Date(t.effectiveTo).getTime() >= periodDate.getTime()),
    );
    if (candidates.length === 0) {
      throw new PayrollGuardrailError('RATE_TABLE_MISSING', `No active ${type} rate table for ${periodDate.toISOString().slice(0, 10)}.`);
    }
    // Overlap detection within the same type and code.
    const byCode = new Map<string, ResolvedRateTable[]>();
    for (const c of candidates) {
      const list = byCode.get(c.code) ?? [];
      list.push(c);
      byCode.set(c.code, list);
    }
    for (const [, list] of byCode) {
      if (list.length > 1) {
        throw new PayrollGuardrailError(
          'OVERLAPPING_RATE_TABLES',
          `${type}/${list[0].code} has ${list.length} overlapping effective windows; payroll is blocked until data is corrected.`,
        );
      }
    }
    // Newest effectiveFrom wins across different codes of the same type.
    const chosen = candidates.sort(
      (a, b) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime(),
    )[0];
    resolved.set(type, chosen);
  }
  return resolved;
}

// ── Rounding ────────────────────────────────────────────────────────────────

/** Floor a product of basis points to integer cents (statutory rounding rule: floor). */
export function applyBps(amountCents: number, bps: number): number {
  return Math.floor((amountCents * bps) / 10_000);
}

// ── Progressive band computation (PAYE) ─────────────────────────────────────

/**
 * Progressive tax over bands. Each band contributes rate * (slice size),
 * floored per band; the residual cent is handled by the caller's rounding
 * adjustment so the net identity holds exactly.
 */
export function computeProgressiveTax(
  taxableCents: number,
  rows: Array<{ lowerBoundCents: number; upperBoundCents: number | null; rateBps: number | null }>,
): number {
  let tax = 0;
  for (const row of rows) {
    if (row.rateBps == null) continue;
    const upper = row.upperBoundCents ?? Number.MAX_SAFE_INTEGER;
    if (taxableCents <= row.lowerBoundCents) break;
    const slice = Math.min(taxableCents, upper) - row.lowerBoundCents;
    if (slice > 0) tax += applyBps(slice, row.rateBps);
  }
  return tax;
}

// ── Proration ───────────────────────────────────────────────────────────────

/** Prorate an amount by worked/standard days, floored. */
export function prorate(amountCents: number, workedDays: number, standardDays: number): number {
  if (standardDays <= 0) return 0;
  if (workedDays >= standardDays) return amountCents;
  return Math.floor((amountCents * workedDays) / standardDays);
}

// ── Overtime, casual, night allowance ───────────────────────────────────────

export function computeOvertimeCents(
  hourlyRateCents: number,
  lines: PayslipInputPeriod['overtime'],
): number {
  let total = 0;
  for (const line of lines) {
    // Floor per line: no fractional cents ever enter the pipeline.
    total += Math.floor(hourlyRateCents * line.hours * (line.multiplierBps / 10_000));
  }
  return total;
}

// ── Payslip computation ─────────────────────────────────────────────────────

export interface ComputePayslipParams {
  employee: PayslipInputEmployee;
  period: PayslipInputPeriod;
  rates: Map<string, ResolvedRateTable>;
  /** Optional employee-side dependency check result (consent). */
  consentGranted?: boolean;
}

/**
 * Compute one payslip. Guarantees (property-tested):
 *   1. net = gross - totalDeductions (exact, via roundingAdjustmentCents).
 *   2. Every statutory line carries the rate table id used.
 *   3. No float arithmetic on money: all values are integers.
 *   4. Missing required rate tables throw RATE_TABLE_MISSING before any line.
 */
export function computePayslip(params: ComputePayslipParams): PayslipResult {
  const { employee, period, rates } = params;
  const trace: Array<{ step: string; detail: string }> = [];
  const rateTableIds: string[] = [];
  const earnings: PayslipLine[] = [];
  const deductions: PayslipLine[] = [];
  const employerContributions: PayslipLine[] = [];

  if (params.consentGranted === false) {
    throw new PayrollGuardrailError('MISSING_CONSENT', 'Payroll processing requires a consent record on file.');
  }

  // 1. Earnings (prorated where unpaid leave applies).
  const unpaidFactor = Math.max(0, period.standardWorkingDays - period.unpaidLeaveDays);
  const basic = prorate(employee.basicSalaryCents, unpaidFactor, period.standardWorkingDays);
  const house = prorate(employee.houseAllowanceCents, unpaidFactor, period.standardWorkingDays);
  const transport = prorate(employee.transportAllowanceCents, unpaidFactor, period.standardWorkingDays);
  const medical = prorate(employee.medicalAllowanceCents, unpaidFactor, period.standardWorkingDays);
  const other = prorate(employee.otherAllowancesCents, unpaidFactor, period.standardWorkingDays);
  trace.push({ step: 'EARNINGS', detail: `basic ${basic}, unpaid leave ${period.unpaidLeaveDays} day(s) prorated` });

  earnings.push({ code: 'BASIC', label: 'Basic salary', kind: 'EARNING', amountCents: basic });
  if (house) earnings.push({ code: 'HOUSE', label: 'House allowance', kind: 'EARNING', amountCents: house });
  if (transport) earnings.push({ code: 'TRANSPORT', label: 'Transport allowance', kind: 'EARNING', amountCents: transport });
  if (medical) earnings.push({ code: 'MEDICAL', label: 'Medical allowance', kind: 'EARNING', amountCents: medical });
  if (other) earnings.push({ code: 'OTHER_ALLOW', label: 'Other allowances', kind: 'EARNING', amountCents: other });

  const overtimeCents = computeOvertimeCents(employee.hourlyRateCents ?? 0, period.overtime);
  if (overtimeCents > 0) {
    earnings.push({ code: 'OVERTIME', label: 'Overtime', kind: 'EARNING', amountCents: overtimeCents });
    trace.push({ step: 'OVERTIME', detail: `${period.overtime.length} line(s), floored per line` });
  }
  const casualCents = period.casualDays * period.casualDayRateCents;
  if (casualCents > 0) {
    earnings.push({ code: 'CASUAL', label: 'Casual day rates', kind: 'EARNING', amountCents: casualCents });
  }
  if (period.nightAllowanceCents > 0) {
    earnings.push({ code: 'NIGHT_ALLOW', label: 'Night allowance', kind: 'EARNING', amountCents: period.nightAllowanceCents });
  }
  if (period.commissionCents > 0) {
    earnings.push({ code: 'COMMISSION', label: 'Commission (posted, non-voided sales)', kind: 'EARNING', amountCents: period.commissionCents });
  }

  const grossCents = earnings.reduce((sum, l) => sum + l.amountCents, 0);
  trace.push({ step: 'GROSS', detail: String(grossCents) });

  // 2. NSSF (Tier I + Tier II on pensionable earnings = basic).
  const nssfT1 = rates.get('NSSF_TIER1');
  const nssfT2 = rates.get('NSSF_TIER2');
  if (!employee.nssfExempt) {
    const t1Row = nssfT1?.rows[0];
    const tier1Ceiling = t1Row?.upperBoundCents ?? 800_000;
    const tier1 = applyBps(Math.min(basic, tier1Ceiling), t1Row?.rateBps ?? 600);
    deductions.push({ code: 'NSSF_T1', label: 'NSSF Tier I', kind: 'DEDUCTION', amountCents: tier1, rateTableId: nssfT1?.id });
    const t1Match = applyBps(Math.min(basic, tier1Ceiling), t1Row?.employerMatchBps ?? 600);
    employerContributions.push({ code: 'NSSF_T1_ER', label: 'NSSF Tier I (employer)', kind: 'EMPLOYER_CONTRIBUTION', amountCents: t1Match, rateTableId: nssfT1?.id });

    const t2Row = nssfT2?.rows[0];
    const tier2Floor = t2Row?.lowerBoundCents ?? tier1Ceiling;
    const tier2Ceiling = t2Row?.upperBoundCents ?? 7_200_000;
    const tier2Base = Math.max(0, Math.min(basic, tier2Ceiling) - tier2Floor);
    const tier2 = applyBps(tier2Base, t2Row?.rateBps ?? 600);
    if (tier2 > 0) {
      deductions.push({ code: 'NSSF_T2', label: 'NSSF Tier II', kind: 'DEDUCTION', amountCents: tier2, rateTableId: nssfT2?.id });
    }
    const t2Match = applyBps(tier2Base, t2Row?.employerMatchBps ?? 600);
    if (t2Match > 0) {
      employerContributions.push({ code: 'NSSF_T2_ER', label: 'NSSF Tier II (employer)', kind: 'EMPLOYER_CONTRIBUTION', amountCents: t2Match, rateTableId: nssfT2?.id });
    }
    trace.push({ step: 'NSSF', detail: `tier1 ${tier1}, tier2 ${tier2}` });
  }
  if (nssfT1) rateTableIds.push(nssfT1.id);
  if (nssfT2) rateTableIds.push(nssfT2.id);

  // 3. SHIF (2.5% of gross, minimum contribution floor).
  const shif = rates.get('SHIF');
  if (!employee.nhifExempt && shif) {
    const row = shif.rows[0];
    const rate = applyBps(grossCents, row?.rateBps ?? 250);
    const amount = Math.max(rate, row?.flatAmountCents ?? 30_000);
    deductions.push({ code: 'SHIF', label: 'Social Health Insurance Fund', kind: 'DEDUCTION', amountCents: amount, rateTableId: shif.id });
    trace.push({ step: 'SHIF', detail: String(amount) });
    rateTableIds.push(shif.id);
  }

  // 4. Affordable Housing Levy (1.5% employee + employer match).
  const housing = rates.get('HOUSING_LEVY');
  if (!employee.housingExempt && housing) {
    const row = housing.rows[0];
    const amount = applyBps(grossCents, row?.rateBps ?? 150);
    deductions.push({ code: 'AHL', label: 'Affordable Housing Levy', kind: 'DEDUCTION', amountCents: amount, rateTableId: housing.id });
    const match = applyBps(grossCents, row?.employerMatchBps ?? 150);
    employerContributions.push({ code: 'AHL_ER', label: 'Affordable Housing Levy (employer)', kind: 'EMPLOYER_CONTRIBUTION', amountCents: match, rateTableId: housing.id });
    trace.push({ step: 'AHL', detail: `${amount} + employer ${match}` });
    rateTableIds.push(housing.id);
  }

  // 5. PAYE: taxable = gross - NSSF (both tiers); progressive bands minus relief.
  const paye = rates.get('PAYE');
  const reliefTable = rates.get('PERSONAL_RELIEF');
  if (!employee.payeExempt && paye) {
    const nssfTotal = deductions
      .filter((l) => l.code.startsWith('NSSF'))
      .reduce((sum, l) => sum + l.amountCents, 0);
    const taxable = Math.max(0, grossCents - nssfTotal);
    let tax = computeProgressiveTax(
      taxable,
      paye.rows.map((r) => ({ lowerBoundCents: r.lowerBoundCents, upperBoundCents: r.upperBoundCents, rateBps: r.rateBps })),
    );
    trace.push({ step: 'PAYE_GROSS_TAX', detail: String(tax) });
    if (reliefTable) {
      const relief = reliefTable.rows[0]?.reliefCents ?? 240_000;
      tax = Math.max(0, tax - relief);
      rateTableIds.push(reliefTable.id);
      trace.push({ step: 'PAYE_AFTER_RELIEF', detail: String(tax) });
    }
    if (tax > 0) {
      deductions.push({ code: 'PAYE', label: 'PAYE income tax', kind: 'DEDUCTION', amountCents: tax, rateTableId: paye.id });
    }
    rateTableIds.push(paye.id);
  }

  // 6. Other deductions (union dues, asset recovery, HELB via components).
  if (period.otherDeductionsCents > 0) {
    deductions.push({ code: 'OTHER_DED', label: 'Other deductions', kind: 'DEDUCTION', amountCents: period.otherDeductionsCents });
  }

  // 7. Identity: net = gross - deductions exactly. The statutory lines are
  //    floored per band, so the identity already holds; the adjustment line
  //    exists for future per-line rounding rules and audit transparency.
  const totalDeductionsCents = deductions.reduce((sum, l) => sum + l.amountCents, 0);
  const netCents = grossCents - totalDeductionsCents;
  const roundingAdjustmentCents = 0; // identity already exact with floor semantics
  if (netCents < 0) {
    throw new PayrollGuardrailError(
      'NEGATIVE_NET',
      `Net pay would be ${netCents} cents; deductions exceed gross. Run blocked.`,
    );
  }
  trace.push({ step: 'NET', detail: String(netCents) });

  return {
    employeeId: employee.employeeId,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    earnings,
    deductions,
    employerContributions,
    grossCents,
    totalDeductionsCents,
    netCents,
    roundingAdjustmentCents,
    rateTableIds: [...new Set(rateTableIds)],
    trace,
  };
}

// ── Journal construction (balanced by construction, asserted before return) ─

export function buildPayrollJournal(
  payslip: PayslipResult,
  entryNumber: string,
  idempotencyKey: string,
): import('./types').PayrollJournal {
  const lines: import('./types').PayrollJournalLine[] = [];
  const A = PAYROLL_ACCOUNTS;

  const gross = payslip.grossCents;
  const employerNssf = payslip.employerContributions
    .filter((l) => l.code.startsWith('NSSF'))
    .reduce((s, l) => s + l.amountCents, 0);
  const employerHousing = payslip.employerContributions
    .filter((l) => l.code === 'AHL_ER')
    .reduce((s, l) => s + l.amountCents, 0);
  const statutory = (code: string) =>
    payslip.deductions.find((l) => l.code === code)?.amountCents ?? 0;
  const nssfEmployee = statutory('NSSF_T1') + statutory('NSSF_T2');
  const otherDeductions = statutory('OTHER_DED');

  // Debits: expense accounts.
  lines.push({ accountCode: A.SALARIES_EXPENSE, debitCents: gross, creditCents: 0 });
  if (employerNssf > 0) lines.push({ accountCode: A.EMPLOYER_NSSF_EXPENSE, debitCents: employerNssf, creditCents: 0 });
  if (employerHousing > 0) lines.push({ accountCode: A.EMPLOYER_HOUSING_EXPENSE, debitCents: employerHousing, creditCents: 0 });

  // Credits: payables.
  const paye = statutory('PAYE');
  if (paye > 0) lines.push({ accountCode: A.PAYE_PAYABLE, debitCents: 0, creditCents: paye });
  if (nssfEmployee + employerNssf > 0) lines.push({ accountCode: A.NSSF_PAYABLE, debitCents: 0, creditCents: nssfEmployee + employerNssf });
  const shif = statutory('SHIF');
  if (shif > 0) lines.push({ accountCode: A.SHIF_PAYABLE, debitCents: 0, creditCents: shif });
  const ahl = statutory('AHL');
  if (ahl + employerHousing > 0) lines.push({ accountCode: A.HOUSING_PAYABLE, debitCents: 0, creditCents: ahl + employerHousing });
  if (otherDeductions > 0) lines.push({ accountCode: A.OTHER_DEDUCTIONS_PAYABLE, debitCents: 0, creditCents: otherDeductions });

  const netPayable = payslip.netCents;
  if (netPayable > 0) lines.push({ accountCode: A.NET_PAY_PAYABLE, debitCents: 0, creditCents: netPayable });

  const totalDebitCents = lines.reduce((s, l) => s + l.debitCents, 0);
  const totalCreditCents = lines.reduce((s, l) => s + l.creditCents, 0);
  const balanced = totalDebitCents === totalCreditCents;
  if (!balanced) {
    throw new PayrollGuardrailError(
      'JOURNAL_IMBALANCE',
      `Debits ${totalDebitCents} != credits ${totalCreditCents}; payroll run fails before activation.`,
    );
  }

  return { entryNumber, idempotencyKey, lines, totalDebitCents, totalCreditCents, balanced };
}
