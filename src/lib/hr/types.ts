// MBUMAH HARDWARE POS - EMS shared types (v2.18.5)
//
// Pure types shared between HR services, routes, and UI. No server imports.

import type { PlatformRole } from './roles';

/** Masked PII presentation used by every HR response. */
export const HR_PII_MASK = '[REDACTED]';

export interface HrEmployeeSummary {
  id: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: string;
  employmentType: string;
  status: string;
  hireDate: string;
  terminationDate: string | null;
  storeId: string;
  storeName?: string;
  reportingToId?: string | null;
  /** v2.113.0: present only when the list was queried with expiringWithinDays —
   * a count + a date, never document contents (spec: PII minimized). */
  expiringDocuments?: number;
  nearestExpiry?: string | null;
}

export interface HrEmployeeDetail extends HrEmployeeSummary {
  basicSalary?: number;
  houseAllowance?: number;
  transportAllowance?: number;
  medicalAllowance?: number;
  otherAllowances?: number;
  hourlyRate?: number | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  /** Present only when the caller holds hr.employee.unmask.pii. */
  nationalId?: string;
  kraPin?: string;
  nssfNumber?: string;
  nhifNumber?: string;
  payeExempt?: boolean;
  nssfExempt?: boolean;
  nhifExempt?: boolean;
  notes?: string | null;
}

export interface HrDocumentDto {
  id: string;
  employeeId: string;
  type: string;
  fileName: string;
  fileUrl?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  verificationStatus: string;
  notes?: string | null;
}

export interface HrApiError {
  success: false;
  error: string;
  code?: string;
}

export interface HrApiSuccess<T> {
  success: true;
  data: T;
}

export type HrApiResponse<T> = HrApiSuccess<T> | HrApiError;

export interface HrSessionContext {
  userId: string;
  role: PlatformRole | string;
  storeId: string | null;
  organizationId: string;
}
