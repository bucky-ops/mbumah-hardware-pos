// MBUMAH HARDWARE POS - EMS payroll engine types (v2.18.8)
//
// HARD RULES (docs/EMS_INFRASTRUCTURE_AUDIT.md, spec rules 16 to 18):
//   1. Money is integer cents. No Float and no Decimal in computation.
//   2. Rates are basis points (Int). 10,000 bps = 100%.
//   3. Pure functions only: no Prisma, no React, no Next.js server imports.
//   4. Every statutory line references the rate table id it was computed from
//      so historical payslips stay reproducible.

export const GUARDRAIL_CODES = [
  'NEGATIVE_NET',
  'DEDUCTION_CAP_EXCEEDED',
  'RATE_TABLE_MISSING',
  'OVERLAPPING_RATE_TABLES',
  'MISSING_CONSENT',
  'UNRESOLVED_DEPENDENCY',
  'PERIOD_MISMATCH',
  'DUPLICATE_IDEMPOTENCY_KEY',
  'IMMUTABLE_STATUS',
  'JOURNAL_IMBALANCE',
  'MISSING_CHART_ACCOUNT',
  'TIMESHEET_NOT_APPROVED',
] as const;

export type GuardrailCode = (typeof GUARDRAIL_CODES)[number];

export class PayrollGuardrailError extends Error {
  readonly code: GuardrailCode;
  constructor(code: GuardrailCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'PayrollGuardrailError';
  }
}

/** A resolved rate table as plain data (rows in ascending lowerBoundCents). */
export interface ResolvedRateTable {
  id: string;
  type: string;
  code: string;
  label: string;
  basis: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  rows: RateTableRowData[];
}

export interface RateTableRowData {
  order: number;
  lowerBoundCents: number;
  upperBoundCents: number | null;
  rateBps: number | null;
  flatAmountCents: number | null;
  reliefCents: number | null;
  employerMatchBps: number | null;
}

export interface PayslipInputEmployee {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  basicSalaryCents: number;
  houseAllowanceCents: number;
  transportAllowanceCents: number;
  medicalAllowanceCents: number;
  otherAllowancesCents: number;
  hourlyRateCents: number | null;
  payeExempt: boolean;
  nssfExempt: boolean;
  nhifExempt: boolean;
  housingExempt: boolean;
}

export interface PayslipInputPeriod {
  periodYear: number;
  periodMonth: number; // 1..12
  workedDays: number; // for proration (calendar working days in the month)
  standardWorkingDays: number;
  overtime: OvertimeLine[];
  casualDays: number;
  casualDayRateCents: number;
  commissionCents: number;
  otherDeductionsCents: number; // union dues, asset recovery, HELB where not statutory
  unpaidLeaveDays: number;
  nightAllowanceCents: number;
}

export interface OvertimeLine {
  kind: 'WEEKDAY' | 'SATURDAY' | 'SUNDAY' | 'PUBLIC_HOLIDAY';
  hours: number; // may be fractional half-steps; multiplied by rate then floored per line
  multiplierBps: number; // from the OVERTIME rate table (e.g. 15000 = 1.5x)
}

export interface PayslipLine {
  code: string;
  label: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
  amountCents: number;
  rateTableId?: string;
}

export interface PayslipResult {
  employeeId: string;
  periodYear: number;
  periodMonth: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
  /** Residual cent placed so the net identity holds exactly. */
  roundingAdjustmentCents: number;
  rateTableIds: string[];
  trace: Array<{ step: string; detail: string }>;
}

export interface PayrollJournalLine {
  accountCode: string;
  debitCents: number;
  creditCents: number;
}

export interface PayrollJournal {
  entryNumber: string;
  idempotencyKey: string;
  lines: PayrollJournalLine[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
}

/** Chart of accounts reserved for payroll (v2.18.4.0 correction). */
export const PAYROLL_ACCOUNTS = {
  SALARIES_EXPENSE: '5200',
  EMPLOYER_NSSF_EXPENSE: '5210',
  EMPLOYER_HOUSING_EXPENSE: '5215',
  PAYE_PAYABLE: '2210',
  NSSF_PAYABLE: '2215',
  SHIF_PAYABLE: '2220',
  HOUSING_PAYABLE: '2225',
  HELB_PAYABLE: '2230',
  NET_PAY_PAYABLE: '2240',
  OTHER_DEDUCTIONS_PAYABLE: '2250',
  PAYROLL_CLEARING: '2260',
} as const;
