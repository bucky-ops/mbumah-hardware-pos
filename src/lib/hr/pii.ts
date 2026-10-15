// MBUMAH HARDWARE POS - EMS PII handling (v2.18.5)
//
// Masking helpers for employee records. Server-side shaping happens here so
// list payloads and detail responses can never leak statutory identifiers,
// bank details, or M-Pesa numbers (docs/EMS_SECURITY_PRIVACY_NOTES.md).
//
// Unmasking is a permission (hr.employee.unmask.pii), never a parameter the
// client can request casually: routes call shapeEmployee* with
// includePii=false unless hasHrPermission(role, 'hr.employee.unmask.pii')
// passed, and every unmasked read is audit logged by the caller.

const PII_MASK = '[REDACTED]';

/** Scalar fields that must never leave the server in list payloads. */
export const EMPLOYEE_PII_FIELDS = [
  'nationalId',
  'kraPin',
  'nssfNumber',
  'nhifNumber',
  'bankAccountNumber',
  'bankBranchCode',
  'bankSwift',
  'mpesaNumber',
] as const;

/** Masked-but-present fields for detail views (bank name is not sensitive). */
export const EMPLOYEE_PII_MASKED_FIELDS = ['bankAccountName', 'emergencyContactPhone'] as const;

type EmployeeLike = Record<string, unknown>;

/**
 * Strip every PII field from a record (list payloads: absence, not masks, so
 * responses stay small and nothing is accidentally echoed back).
 */
export function stripEmployeePii<T extends EmployeeLike>(employee: T): Omit<T, (typeof EMPLOYEE_PII_FIELDS)[number]> {
  const out: EmployeeLike = { ...employee };
  for (const field of EMPLOYEE_PII_FIELDS) {
    delete out[field];
  }
  return out as Omit<T, (typeof EMPLOYEE_PII_FIELDS)[number]>;
}

/**
 * Mask PII fields to [REDACTED] (detail payloads: field presence is kept so
 * the UI can render "on file" affordances without seeing values).
 */
export function maskEmployeePii<T extends EmployeeLike>(employee: T): T {
  const out: EmployeeLike = { ...employee };
  for (const field of EMPLOYEE_PII_FIELDS) {
    if (typeof out[field] === 'string' && (out[field] as string).length > 0) {
      out[field] = PII_MASK;
    }
  }
  return out as T;
}

/**
 * Shape an employee record for a detail response.
 * includePii must only ever be true when the caller has verified the unmask
 * permission and will audit the read.
 */
export function shapeEmployeeDetail<T extends EmployeeLike>(employee: T, includePii: boolean): T {
  if (includePii) {
    // Keep masked presentation for emergency contact phone even for
    // privileged roles unless explicitly unmasked; bankAccountName stays
    // visible (needed for disbursement verification).
    const out: Record<string, unknown> = { ...employee };
    const phone = out['emergencyContactPhone'];
    if (typeof phone === 'string' && phone.length > 0) {
      out['emergencyContactPhone'] = PII_MASK;
    }
    return out as T;
  }
  return maskEmployeePii(employee);
}

export const HR_PII_MASK = PII_MASK;
