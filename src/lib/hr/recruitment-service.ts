// MBUMAH HARDWARE POS - HR recruitment service (v2.18.6)
//
// Stage D of the EMS implementation protocol (Phase 4.3). All mutations go
// through this service (spec rule 15): no route handler writes recruitment
// rows directly. Applicant to employee conversion preserves provenance,
// is idempotent per (storeId, email), captures consent, and creates the
// onboarding plan. Rejection sets a data retention window.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import type { HrEmployeeSummary } from './types';

const REJECTION_RETENTION_DAYS = 90;

export interface CreateJobInput {
  storeId: string | null;
  organizationId: string;
  actorId: string;
  actorRole: string;
  data: { title: string; description?: string; openings?: number; positionId?: string };
}

export async function createJob(input: CreateJobInput) {
  const job = await db.recruitmentJob.create({
    data: {
      storeId: input.storeId,
      organizationId: input.organizationId,
      title: input.data.title,
      description: input.data.description ?? null,
      openings: input.data.openings && input.data.openings > 0 ? input.data.openings : 1,
      positionId: input.data.positionId || null,
      status: 'OPEN',
      openedAt: new Date(),
      createdByUserId: input.actorId,
    },
  });
  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.RECRUITMENT_JOB,
    resourceId: job.id,
    storeId: input.storeId,
    reason: 'Recruitment job opened.',
    metadata: { title: job.title, openings: job.openings },
  });
  return job;
}

export interface CreateApplicantInput {
  jobId: string;
  storeId: string | null;
  actorId: string;
  actorRole: string;
  data: { fullName: string; email: string; phone?: string; coverNote?: string; consentGranted: boolean };
}

export async function createApplicant(input: CreateApplicantInput) {
  if (!input.data.consentGranted) {
    throw new Error('Applicant consent is required before registering personal data (MISSING_CONSENT).');
  }
  const job = await db.recruitmentJob.findFirst({
    where: { id: input.jobId, deletedAt: null, status: { in: ['OPEN', 'DRAFT'] } },
    select: { id: true, title: true, organizationId: true },
  });
  if (!job) throw new Error('Job not found or not open.');

  const applicant = await db.applicant.create({
    data: {
      jobId: input.jobId,
      storeId: input.storeId,
      fullName: input.data.fullName,
      email: input.data.email.toLowerCase(),
      phone: input.data.phone ?? null,
      coverNote: input.data.coverNote ?? null,
      consentGrantedAt: new Date(),
      status: 'NEW',
    },
  });

  await db.consentRecord.create({
    data: {
      applicantId: applicant.id,
      purpose: 'Recruitment screening for employment at Mbumah Hardware.',
      scope: 'Contact details, application documents, interview notes.',
      policyVersion: '2026-01',
      lawfulBasis: 'CONSENT',
    },
  });

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.APPLICANT,
    resourceId: applicant.id,
    storeId: input.storeId,
    reason: 'Applicant registered with consent.',
    metadata: { jobId: input.jobId },
  });
  return applicant;
}

export interface RecordStageInput {
  applicantId: string;
  actorId: string;
  actorRole: string;
  data: { stage: string; outcome: 'PENDING' | 'PASS' | 'FAIL'; notes?: string };
}

const STAGES = ['SCREENING', 'INTERVIEW_ONE', 'INTERVIEW_TWO', 'TASK', 'REFERENCE', 'OFFER'] as const;

export async function recordStage(input: RecordStageInput) {
  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, deletedAt: null },
    select: { id: true, storeId: true, status: true },
  });
  if (!applicant) throw new Error('Applicant not found.');
  if (!(STAGES as readonly string[]).includes(input.data.stage)) {
    throw new Error(`stage must be one of ${STAGES.join(', ')}.`);
  }

  const stage = await db.applicationStage.create({
    data: {
      applicantId: applicant.id,
      stage: input.data.stage,
      outcome: input.data.outcome,
      notes: input.data.notes ?? null,
      recordedByUserId: input.actorId,
    },
  });

  // Applicant status follows the furthest stage reached.
  const statusMap: Record<string, string> = {
    SCREENING: 'SCREENING',
    INTERVIEW_ONE: 'INTERVIEW',
    INTERVIEW_TWO: 'INTERVIEW',
    TASK: 'INTERVIEW',
    REFERENCE: 'INTERVIEW',
    OFFER: 'OFFER',
  };
  await db.applicant.update({
    where: { id: applicant.id },
    data: { status: statusMap[input.data.stage] ?? applicant.status },
  });

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.APPLICATION_STAGE,
    resourceId: stage.id,
    storeId: applicant.storeId,
    reason: `Stage ${input.data.stage} recorded with outcome ${input.data.outcome}.`,
    metadata: { applicantId: applicant.id },
  });
  return stage;
}

export interface CreateOfferInput {
  applicantId: string;
  actorId: string;
  actorRole: string;
  data: { proposedSalaryCents: number; startDate: Date; positionId?: string; payGradeId?: string };
}

export async function createOffer(input: CreateOfferInput) {
  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, deletedAt: null },
    select: { id: true, storeId: true, status: true },
  });
  if (!applicant) throw new Error('Applicant not found.');
  if (!Number.isInteger(input.data.proposedSalaryCents) || input.data.proposedSalaryCents <= 0) {
    throw new Error('proposedSalaryCents must be a positive integer (money is integer cents).');
  }

  const offer = await db.offer.create({
    data: {
      applicantId: applicant.id,
      positionId: input.data.positionId || null,
      payGradeId: input.data.payGradeId || null,
      proposedSalaryCents: input.data.proposedSalaryCents,
      startDate: input.data.startDate,
      createdByUserId: input.actorId,
      status: 'DRAFT',
    },
  });

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.OFFER,
    resourceId: offer.id,
    storeId: applicant.storeId,
    reason: 'Offer drafted (approval required before sending).',
    metadata: { applicantId: applicant.id },
  });
  return offer;
}

/** Approve (owner tier) and send in one audited step. Maker note kept. */
export async function approveAndSendOffer(offerId: string, actorId: string, actorRole: string) {
  const offer = await db.offer.findFirst({
    where: { id: offerId },
    include: { applicant: { select: { id: true, storeId: true, email: true } } },
  });
  if (!offer) throw new Error('Offer not found.');
  if (offer.status !== 'DRAFT') throw new Error(`Offer is ${offer.status}; only DRAFT offers can be sent.`);

  const updated = await db.offer.update({
    where: { id: offer.id },
    data: {
      status: 'SENT',
      approvedByUserId: actorId,
      sentAt: new Date(),
    },
  });

  await db.applicant.update({ where: { id: offer.applicantId }, data: { status: 'OFFER' } });

  await hrAudit({
    actorId,
    actorRole,
    action: 'APPROVE',
    resourceType: HrEntityType.OFFER,
    resourceId: offer.id,
    storeId: offer.applicant.storeId,
    reason: 'Offer approved and marked sent.',
    metadata: { applicantId: offer.applicantId },
  });
  return updated;
}

export interface ConvertApplicantInput {
  applicantId: string;
  storeId: string;
  actorId: string;
  actorRole: string;
  data: {
    jobTitle?: string;
    employmentType?: string;
    basicSalary?: number; // KES units; converted to the employee record's Decimal field
    probationMonths?: number;
    acceptOfferId?: string;
  };
}

/**
 * Convert a hired applicant into an employee.
 * Idempotent per (storeId, applicant email): a repeat call returns the
 * existing employee instead of creating a duplicate. Provenance is preserved
 * via Applicant.convertedEmployeeId. Creates the onboarding plan with the
 * standard template (cash handling tasks block till access).
 */
export async function convertApplicantToEmployee(
  input: ConvertApplicantInput,
): Promise<{ employee: HrEmployeeSummary; created: boolean; onboardingPlanId: string }> {
  const applicant = await db.applicant.findFirst({
    where: { id: input.applicantId, deletedAt: null },
    include: { job: { select: { title: true } } },
  });
  if (!applicant) throw new Error('Applicant not found.');
  if (applicant.status === 'REJECTED' || applicant.status === 'WITHDRAWN') {
    throw new Error('Applicant is not in a convertible state.');
  }

  // Idempotency: already converted.
  if (applicant.convertedEmployeeId) {
    const existing = await db.employee.findUnique({
      where: { id: applicant.convertedEmployeeId },
    });
    if (existing) {
      return {
        employee: existing as unknown as HrEmployeeSummary,
        created: false,
        onboardingPlanId: await ensureOnboardingPlan(existing.id, input.storeId, input.actorId),
      };
    }
  }

  // Duplicate guard: same email already employed in this store.
  const duplicate = await db.employee.findFirst({
    where: { storeId: input.storeId, email: applicant.email, deletedAt: null },
    select: { id: true },
  });
  if (duplicate) {
    // Heal the provenance link and return the existing employee.
    await db.applicant.update({ where: { id: applicant.id }, data: { convertedEmployeeId: duplicate.id, status: 'HIRED' } });
    const existing = await db.employee.findUnique({ where: { id: duplicate.id } });
    return {
      employee: existing as unknown as HrEmployeeSummary,
      created: false,
      onboardingPlanId: await ensureOnboardingPlan(duplicate.id, input.storeId, input.actorId),
    };
  }

  const probationMonths = input.data.probationMonths ?? 3;
  const hireDate = new Date();
  const probationEnds = new Date(hireDate);
  probationEnds.setMonth(probationEnds.getMonth() + probationMonths);

  const count = await db.employee.count({ where: { storeId: input.storeId } });
  const employee = await db.employee.create({
    data: {
      storeId: input.storeId,
      employeeCode: `EMP-${String(count + 1).padStart(4, '0')}`,
      firstName: applicant.fullName.split(' ')[0] || applicant.fullName,
      lastName: applicant.fullName.split(' ').slice(1).join(' ') || '-',
      email: applicant.email,
      phone: applicant.phone,
      jobTitle: input.data.jobTitle || applicant.job?.title || null,
      role: 'STAFF',
      employmentType: input.data.employmentType || 'PROBATION',
      status: 'ACTIVE',
      hireDate,
      basicSalary: input.data.basicSalary
        ? input.data.basicSalary
        : 0,
      notes: `Converted from applicant ${applicant.id} (job: ${applicant.job?.title ?? 'n/a'}).`,
    },
  });

  await db.applicant.update({
    where: { id: applicant.id },
    data: { status: 'HIRED', convertedEmployeeId: employee.id },
  });

  // Mark any accepted offer.
  if (input.data.acceptOfferId) {
    await db.offer.updateMany({
      where: { id: input.data.acceptOfferId, applicantId: applicant.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });
  }

  const planId = await ensureOnboardingPlan(employee.id, input.storeId, input.actorId);

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employee.id,
    storeId: input.storeId,
    reason: 'Applicant converted to employee.',
    metadata: { applicantId: applicant.id, onboardingPlanId: planId, probationEnds: probationEnds.toISOString() },
  });

  // Probation end notification (persistent row; calm and actionable).
  await db.notification.create({
    data: {
      storeId: input.storeId,
      userId: input.actorId,
      title: 'Probation period scheduled',
      message: `${employee.firstName} ${employee.lastName} was hired. Probation ends ${probationEnds.toLocaleDateString()}. Review the onboarding plan before till access is granted.`,
      type: 'INFO',
      category: 'HR_ONBOARDING',
      actionUrl: `/hr/onboarding?plan=${planId}`,
      actionLabel: 'Open onboarding plan',
    },
  }).catch(() => undefined);

  return { employee: employee as unknown as HrEmployeeSummary, created: true, onboardingPlanId: planId };
}

/** Reject with retention window. */
export async function rejectApplicant(
  applicantId: string,
  actorId: string,
  actorRole: string,
  reason: string,
) {
  const applicant = await db.applicant.findFirst({
    where: { id: applicantId, deletedAt: null },
    select: { id: true, storeId: true, status: true },
  });
  if (!applicant) throw new Error('Applicant not found.');
  if (applicant.status === 'HIRED') throw new Error('A hired applicant cannot be rejected.');
  if (applicant.status === 'REJECTED' || applicant.status === 'WITHDRAWN') {
    throw new Error('Applicant has already left the pipeline.');
  }

  const retentionUntil = new Date();
  retentionUntil.setDate(retentionUntil.getDate() + REJECTION_RETENTION_DAYS);

  await db.applicant.update({
    where: { id: applicantId },
    data: { status: 'REJECTED', rejectionReason: reason, dataRetentionUntil: retentionUntil },
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.APPLICANT,
    resourceId: applicantId,
    storeId: applicant.storeId,
    reason: `Applicant rejected. Data retention until ${retentionUntil.toISOString().slice(0, 10)}.`,
    metadata: { retentionDays: REJECTION_RETENTION_DAYS },
  });
  return { retentionUntil };
}

/**
 * Close an OPEN job to new applicants (v2.125.0).
 * Closing is the desk's way of stopping intake without rewriting history:
 * the job stays listed (its pipeline remains visible), createApplicant
 * refuses CLOSED jobs by its own status check, and the closure is audited.
 */
export async function closeJob(input: {
  jobId: string;
  actorId: string;
  actorRole: string;
}) {
  const job = await db.recruitmentJob.findFirst({
    where: { id: input.jobId, deletedAt: null },
    select: { id: true, title: true, status: true, storeId: true },
  });
  if (!job) throw new Error('Job not found.');
  if (job.status !== 'OPEN') throw new Error(`Job is ${job.status}; only OPEN jobs can be closed.`);

  const closed = await db.recruitmentJob.update({
    where: { id: job.id },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.RECRUITMENT_JOB,
    resourceId: job.id,
    storeId: job.storeId,
    reason: 'Job closed to new applicants.',
    metadata: { title: job.title },
  });
  return closed;
}

async function ensureOnboardingPlan(employeeId: string, storeId: string, actorId: string): Promise<string> {
  const existing = await db.onboardingPlan.findFirst({
    where: { employeeId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const plan = await db.onboardingPlan.create({
    data: {
      employeeId,
      storeId,
      templateKey: 'STANDARD',
      status: 'IN_PROGRESS',
      dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      tasks: {
        create: [
          { title: 'Sign employment contract', category: 'DOCUMENTS', blocksTillAccess: true },
          { title: 'ID and KRA PIN copies on file', category: 'DOCUMENTS', blocksTillAccess: false },
          { title: 'Cash handling policy acknowledged', category: 'CASH_HANDLING', blocksTillAccess: true },
          { title: 'Till drawer count training completed', category: 'CASH_HANDLING', blocksTillAccess: true },
          { title: 'POS account created and tested', category: 'SYSTEM_ACCESS', blocksTillAccess: false },
          { title: 'Workplace safety walkthrough', category: 'SAFETY', blocksTillAccess: false },
        ],
      },
    },
    select: { id: true },
  });

  await hrAudit({
    actorId,
    action: 'CREATE',
    actorRole: 'HR_MANAGER',
    resourceType: HrEntityType.ONBOARDING_PLAN,
    resourceId: plan.id,
    storeId,
    reason: 'Standard onboarding plan created (three tasks block till access).',
    metadata: { employeeId },
  });
  return plan.id;
}
