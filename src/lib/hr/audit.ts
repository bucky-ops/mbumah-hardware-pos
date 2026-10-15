// MBUMAH HARDWARE POS - EMS audit service (v2.18.5)
//
// Every HR and payroll mutation goes through a service function that writes an
// audit log (spec rule 15). This module is that service. Route handlers never
// call Prisma directly for HR mutations; they call the service functions,
// which call hrAudit.
//
// Wraps the hash-chained auditTrail (src/lib/audit-trail.ts) with HR entity
// types and calm, field-name-only payloads: PII values never enter audit
// metadata (docs/EMS_SECURITY_PRIVACY_NOTES.md).

import { auditTrail } from '@/lib/audit-trail';
import { systemLog } from '@/lib/logger';

/** HR entity type strings used as AuditLog.resourceType. */
export const HrEntityType = {
  EMPLOYEE: 'Employee',
  EMPLOYEE_DOCUMENT: 'EmployeeDocument',
  POSITION: 'Position',
  PAY_GRADE: 'PayGrade',
  SALARY_STRUCTURE: 'SalaryStructure',
  RATE_TABLE: 'RateTable',
  CONSENT_RECORD: 'ConsentRecord',
  HR_SETTING: 'HrSetting',
  RECRUITMENT_JOB: 'RecruitmentJob',
  APPLICANT: 'Applicant',
  APPLICATION_STAGE: 'ApplicationStage',
  OFFER: 'Offer',
  ONBOARDING_PLAN: 'OnboardingPlan',
  ONBOARDING_TASK: 'OnboardingTask',
  REVIEW_CYCLE: 'ReviewCycle',
  PERFORMANCE_REVIEW: 'PerformanceReview',
  GOAL: 'Goal',
  DISCIPLINARY_CASE: 'DisciplinaryCase',
  ASSET_ASSIGNMENT: 'AssetAssignment',
  PAYROLL_RUN: 'PayrollRun',
  PAYSLIP: 'PayrollDetail',
  PAYROLL_CORRECTION: 'PayrollCorrection',
  DATA_EXPORT: 'DataExport',
} as const;

export type HrEntityTypeValue = (typeof HrEntityType)[keyof typeof HrEntityType];

export interface HrAuditInput {
  actorId: string;
  actorRole?: string | null;
  action: string;
  resourceType: HrEntityTypeValue;
  resourceId: string;
  storeId?: string | null;
  reason?: string;
  /** Field names and counts only. Never include PII values here. */
  metadata?: Record<string, unknown>;
}

/**
 * Write an HR audit event. Fire-and-tolerate: an audit failure must never
 * corrupt the primary mutation response, but it must be loud in systemLog.
 */
export async function hrAudit(input: HrAuditInput): Promise<string | null> {
  try {
    return await auditTrail.log({
      actorId: input.actorId,
      actorRole: input.actorRole ?? undefined,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      storeId: input.storeId ?? undefined,
      reason: input.reason,
      metadata: input.metadata,
    });
  } catch (error) {
    await systemLog({
      component: 'HR',
      action: 'HR_AUDIT_WRITE_FAILED',
      severity: 'ERROR',
      message: `HR audit write failed for ${input.resourceType} ${input.resourceId}: ${error instanceof Error ? error.message : 'unknown'}`,
      metadata: { resourceType: input.resourceType, resourceId: input.resourceId, action: input.action },
    }).catch(() => undefined);
    return null;
  }
}
