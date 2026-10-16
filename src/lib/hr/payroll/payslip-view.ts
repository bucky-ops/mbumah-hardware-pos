// MBUMAH HARDWARE POS - Payslip view shaping (v2.18.9)
//
// Server-side shaping for payslip reads (JSON, trace, PDF source). The payslip
// amounts themselves are payroll data (not statutory identifiers), but the
// EMPLOYEE identifiers printed on the slip are PII: national ID, KRA PIN,
// NSSF/SHIF numbers, bank account and M-Pesa numbers are masked with
// [REDACTED] unless the caller passed includePii=true (routes only do that
// for hr.employee.unmask.pii holders or the employee's own session, and the
// unmask read is audit-logged by the caller - same contract as pii.ts).

import { PayrollGuardrailError } from './types';

const PII_MASK = '[REDACTED]';

/** Payslip-level PII: masked unless the viewer may unmask employee PII. */
const PAYSLIP_PII_FIELDS = [
  'nationalId',
  'kraPin',
  'nssfNumber',
  'nhifNumber',
  'bankAccountNumber',
  'phone', // M-Pesa contact line
] as const;

export interface PayslipSourceEmployee {
  id: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  nationalId?: string | null;
  kraPin?: string | null;
  nssfNumber?: string | null;
  nhifNumber?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  phone?: string | null;
}

export interface PayslipViewLine {
  code: string;
  label: string;
  amount: number; // KES
  rateTableId?: string;
}

export interface PayslipView {
  id: string;
  payslipNumber: string | null;
  issuedAt: string | null;
  periodName: string;
  payDate: string | null;
  runType: string;
  runStatus: string;
  employee: {
    id: string;
    employeeCode: string;
    name: string;
    statutory: Record<string, string>;
  };
  earnings: PayslipViewLine[];
  deductions: PayslipViewLine[];
  employerContributions: PayslipViewLine[];
  totals: { gross: number; deductions: number; net: number };
  workingStats: {
    daysWorked: number;
    daysAbsent: number;
    daysOnLeave: number;
    overtimeHours: number;
  };
  payment: { status: string; reference: string | null; date: string | null };
}

const KES = (cents: number): number => Math.round(cents) / 100;

function maskValue(_value: string | null | undefined): string {
  // Full mask (never partial): partial masks leak length + prefix structure.
  return PII_MASK;
}

// ── v2.21.0 stored-columns fallback ─────────────────────────────────────────
//
// The payslip view normally renders the stored computationTrace (the exact
// engine result). When the trace is missing or unparseable (rows written by
// external triggers, QA fixtures, or any future legacy import) the view must
// degrade to the AUTHORITATIVE PayrollDetail columns instead of showing
// zeros - those columns are the same stored lines the P10 register reads.
// Line detail is reconstructed with the engine's stable codes; the identity
// gross - deductions = net holds by construction from the stored columns.

interface StoredTraceLine {
  code: string;
  label: string;
  amountCents: number;
  rateTableId?: string;
}

interface StoredLines {
  earnings: StoredTraceLine[];
  deductions: StoredTraceLine[];
  employerContributions: StoredTraceLine[];
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
}

function storedLinesFromDetail(detail: Record<string, unknown>): StoredLines {
  const cents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);
  const line = (code: string, label: string, v: unknown): StoredTraceLine | null =>
    cents(v) !== 0 ? { code, label, amountCents: cents(v) } : null;

  const earnings = [
    line('BASIC', 'Basic salary', detail.basicSalary),
    line('HOUSE', 'House allowance', detail.houseAllowance),
    line('TRANSPORT', 'Transport allowance', detail.transportAllowance),
    line('MEDICAL', 'Medical allowance', detail.medicalAllowance),
    line('OTHER_ALLOW', 'Other allowances', detail.otherAllowances),
    line('OVERTIME', 'Overtime', detail.overtimePay),
  ].filter((l): l is StoredTraceLine => l !== null);

  const deductions = [
    line('PAYE', 'PAYE income tax', detail.paye),
    line('NSSF_T1', 'NSSF (employee)', detail.nssf),
    line('SHIF', 'Social Health Insurance Fund', detail.nhif),
    line('AHL', 'Affordable Housing Levy', detail.housingLevy),
    line('PAYE_ARREARS', 'PAYE arrears', detail.payeArrears),
    line('LOAN', 'Staff loan recovery', detail.loanDeduction),
    line('OTHER_DED', 'Other deductions', detail.otherDeductions),
  ].filter((l): l is StoredTraceLine => l !== null);

  return {
    earnings,
    deductions,
    employerContributions: [],
    grossCents: cents(detail.grossPay),
    totalDeductionsCents: cents(detail.totalDeductions),
    netCents: cents(detail.netPay),
  };
}

/**
 * Shape a payslip for a viewer. `viewerCanUnmask` must be computed server-side
 * (hr.employee.unmask.pii permission or own-payslip session) - never from a
 * client-supplied query parameter.
 */
export function buildPayslipView(input: {
  detail: {
    id: string;
    payslipNumber: string | null;
    payslipIssuedAt: Date | null;
    computationTrace: string | null;
    daysWorked: number;
    daysAbsent: number;
    daysOnLeave: number;
    overtimeHours: unknown;
    paymentStatus: string;
    paymentRef: string | null;
    paymentDate: Date | null;
  };
  run: { runType: string; status: string; payrollPeriod: { name: string; payDate: Date | null } };
  employee: PayslipSourceEmployee;
  viewerCanUnmask: boolean;
}): PayslipView {
  const result = parseTrace(input.detail.computationTrace) ?? storedLinesFromDetail(input.detail as unknown as Record<string, unknown>);
  const statutory: Record<string, string> = {};
  for (const field of PAYSLIP_PII_FIELDS) {
    const raw = (input.employee as unknown as Record<string, unknown>)[field];
    statutory[field] = input.viewerCanUnmask ? ((raw as string) ?? '') : maskValue(raw as string);
  }

  return {
    id: input.detail.id,
    payslipNumber: input.detail.payslipNumber,
    issuedAt: input.detail.payslipIssuedAt ? input.detail.payslipIssuedAt.toISOString() : null,
    periodName: input.run.payrollPeriod.name,
    payDate: input.run.payrollPeriod.payDate ? input.run.payrollPeriod.payDate.toISOString() : null,
    runType: input.run.runType,
    runStatus: input.run.status,
    employee: {
      id: input.employee.id,
      employeeCode: input.employee.employeeCode ?? '',
      name: `${input.employee.firstName} ${input.employee.lastName}`.trim(),
      statutory,
    },
    earnings: (result?.earnings ?? []).map((l) => ({
      code: l.code,
      label: l.label,
      amount: KES(l.amountCents),
      rateTableId: l.rateTableId,
    })),
    deductions: (result?.deductions ?? []).map((l) => ({
      code: l.code,
      label: l.label,
      amount: KES(l.amountCents),
      rateTableId: l.rateTableId,
    })),
    employerContributions: (result?.employerContributions ?? []).map((l) => ({
      code: l.code,
      label: l.label,
      amount: KES(l.amountCents),
      rateTableId: l.rateTableId,
    })),
    totals: {
      gross: KES(result?.grossCents ?? 0),
      deductions: KES(result?.totalDeductionsCents ?? 0),
      net: KES(result?.netCents ?? 0),
    },
    workingStats: {
      daysWorked: input.detail.daysWorked,
      daysAbsent: input.detail.daysAbsent,
      daysOnLeave: input.detail.daysOnLeave,
      overtimeHours: Number(input.detail.overtimeHours ?? 0),
    },
    payment: {
      status: input.detail.paymentStatus,
      reference: input.detail.paymentRef,
      date: input.detail.paymentDate ? input.detail.paymentDate.toISOString() : null,
    },
  };
}

interface StoredPayslipResult {
  earnings: Array<{ code: string; label: string; amountCents: number; rateTableId?: string }>;
  deductions: Array<{ code: string; label: string; amountCents: number; rateTableId?: string }>;
  employerContributions: Array<{ code: string; label: string; amountCents: number; rateTableId?: string }>;
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
  trace: Array<{ step: string; detail: string }>;
  rateTableIds: string[];
}

/**
 * Parse a stored computationTrace into the engine result shape.
 *
 * v2.22.0 hardening: traces written before every field existed (early engine
 * versions, external triggers, QA fixtures) may omit optional arrays or spell
 * the engine-step log `engineSteps` instead of `trace`. Every consumer of this
 * parser indexes those arrays unconditionally (describePayslip, the trace
 * route, the run dialog), so a missing array must never reach them — missing
 * optional fields are normalised to safe defaults instead of a 500. Only the
 * identity-bearing fields (grossCents, earnings) remain mandatory.
 */
export function parseTrace(raw: string | null): StoredPayslipResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPayslipResult> & { engineSteps?: StoredPayslipResult['trace'] } | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.grossCents !== 'number' || !Array.isArray(parsed.earnings)) {
      return null;
    }
    const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const totalDeductionsCents = num(parsed.totalDeductionsCents) ?? 0;
    // Legacy fixtures recorded the step log as plain strings — lift them to
    // the {step, detail} shape the trace route and dialog expect.
    const trace = arr<StoredPayslipResult['trace'][number] | string>(parsed.trace ?? parsed.engineSteps).map((s) =>
      typeof s === 'string' ? { step: s, detail: '' } : s,
    );
    return {
      earnings: parsed.earnings,
      deductions: arr(parsed.deductions),
      employerContributions: arr(parsed.employerContributions),
      grossCents: parsed.grossCents,
      totalDeductionsCents,
      netCents: num(parsed.netCents) ?? parsed.grossCents - totalDeductionsCents,
      trace,
      rateTableIds: arr(parsed.rateTableIds),
    };
  } catch {
    return null;
  }
}

// ── Plain-language trace (self-service acceptance #7) ───────────────────────

const STATUTORY_NOTES: Record<string, string> = {
  BASIC: 'Your basic salary for the period (prorated when unpaid leave applies).',
  HOUSE: 'House allowance.',
  TRANSPORT: 'Transport allowance.',
  MEDICAL: 'Medical allowance.',
  OTHER_ALLOW: 'Other taxable allowances.',
  OVERTIME: 'Overtime hours at the approved multiplier, rounded down per line.',
  CASUAL: 'Casual day rates for casual engagements in the period.',
  NIGHT_ALLOW: 'Night-shift allowance.',
  COMMISSION: 'Commission on posted, non-voided sales.',
  NSSF_T1: 'NSSF Tier I: 6% of pensionable basic pay up to the Tier I ceiling.',
  NSSF_T2: 'NSSF Tier II: 6% of pensionable basic pay between the Tier I ceiling and the Tier II ceiling.',
  SHIF: 'Social Health Insurance Fund: 2.5% of gross pay, with the statutory minimum contribution.',
  AHL: 'Affordable Housing Levy: 1.5% of gross pay (your share).',
  PAYE: 'PAYE income tax: progressive KRA bands on (gross − NSSF), minus personal relief.',
  OTHER_DED: 'Other agreed deductions (union dues, asset recovery, HELB).',
  NSSF_T1_ER: 'Employer NSSF Tier I contribution (paid for you, not deducted from you).',
  NSSF_T2_ER: 'Employer NSSF Tier II contribution (paid for you, not deducted from you).',
  AHL_ER: 'Employer Affordable Housing Levy match (paid for you, not deducted from you).',
};

export function describePayslip(result: StoredPayslipResult): string[] {
  const sentences: string[] = [];
  sentences.push(
    `Gross pay for the period is KES ${KES(result.grossCents).toLocaleString('en-KE', { minimumFractionDigits: 2 })}, made up of ${result.earnings.length} earning line(s).`,
  );
  for (const line of result.earnings) {
    sentences.push(
      `${line.label}: KES ${KES(line.amountCents).toLocaleString('en-KE', { minimumFractionDigits: 2 })}. ${STATUTORY_NOTES[line.code] ?? ''}`.trim(),
    );
  }
  const nssfTotal = result.deductions
    .filter((l) => l.code.startsWith('NSSF'))
    .reduce((s, l) => s + l.amountCents, 0);
  if (nssfTotal > 0) {
    sentences.push('NSSF is deducted first; PAYE is computed on gross pay minus NSSF.');
  }
  for (const line of result.deductions) {
    sentences.push(
      `${line.label}: KES ${KES(line.amountCents).toLocaleString('en-KE', { minimumFractionDigits: 2 })}. ${STATUTORY_NOTES[line.code] ?? ''}`.trim(),
    );
  }
  for (const line of result.employerContributions) {
    sentences.push(
      `${line.label}: KES ${KES(line.amountCents).toLocaleString('en-KE', { minimumFractionDigits: 2 })}. ${STATUTORY_NOTES[line.code] ?? ''}`.trim(),
    );
  }
  sentences.push(
    `Total deductions are KES ${KES(result.totalDeductionsCents).toLocaleString('en-KE', { minimumFractionDigits: 2 })}, so net pay is KES ${KES(result.netCents).toLocaleString('en-KE', { minimumFractionDigits: 2 })} (gross − deductions, exact to the cent).`,
  );
  if (result.rateTableIds.length > 0) {
    sentences.push(
      `Every statutory line was computed from ${result.rateTableIds.length} versioned rate table(s) recorded on this payslip, so the figures remain reproducible even when rates change later.`,
    );
  }
  return sentences;
}

/** Guard so the view builder fails loudly if a caller passes raw cents as KES. */
export function assertKesIdentity(view: PayslipView): void {
  if (
    Math.abs(view.totals.gross - view.totals.deductions - view.totals.net) > 0.005 &&
    view.totals.gross > 0
  ) {
    throw new PayrollGuardrailError(
      'JOURNAL_IMBALANCE',
      'Payslip view identity gross − deductions = net does not hold.',
    );
  }
}
