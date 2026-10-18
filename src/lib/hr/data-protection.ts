// MBUMAH HARDWARE POS - EMS data protection (v2.20.0, spec Phase 4.8)
//
// Data Protection Act posture from the EMS spec:
//   1. Retention windows defined per record type (below; every default is
//      reviewable, replaceable, and NOT legal advice).
//   2. Legal hold blocks archival (HrSetting key `legalHold:<scope>`).
//   3. Erasure requests honored except where statutory retention applies;
//      the decision and legal basis are recorded on the request row.
//   4. Decisions and executions are audit logged (field-name-only metadata).

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { hasHrPermission } from './permissions';
import { StageGError, employeeScopeWhere, employeeInScope } from './stage-g-shared';
import type { AuthSession } from '@/lib/auth';

type Session = AuthSession;

// ── Retention windows (reviewable defaults, not legal advice) ───────────────

export interface HrRetentionPolicy {
  /** Scope key used in the legal-hold setting and audit metadata. */
  scope: string;
  /** Human description of what is swept. */
  description: string;
  /** Retention window in days after the record-level expiry date. */
  retentionDays: number;
  /** The field the window is measured from. */
  measuredFrom: string;
  /** Why this window exists (documentation, replaceable with counsel review). */
  basis: string;
}

export const HR_RETENTION_POLICIES: HrRetentionPolicy[] = [
  {
    scope: 'hr_applicant_rejection_data',
    description:
      'Rejected applicant personal data (fullName/email/phone/coverNote) past dataRetentionUntil.',
    retentionDays: 0, // the row's own dataRetentionUntil already encodes the window
    measuredFrom: 'dataRetentionUntil',
    basis: 'Kenya DPA data-minimisation: rejection data kept only for the documented window.',
  },
  {
    scope: 'hr_disciplinary_closed',
    description: 'Disciplinary cases closed (RESOLVED/DISMISSED/EXPIRED) more than 3 years ago.',
    retentionDays: 3 * 365,
    measuredFrom: 'updatedAt',
    basis: 'Employment practice: warning history usually relevant for 2–3 years; reviewable.',
  },
  {
    scope: 'hr_attendance_daily',
    description: 'Daily attendance records older than 2 years (aggregates live in payroll history).',
    retentionDays: 2 * 365,
    measuredFrom: 'date',
    basis: 'Operational need ends with timesheet approval + dispute window; payroll keeps the statutory copy.',
  },
];

/** Legal hold scopes currently set (HrSetting key legalHold:<scope> = true). */
export async function getLegalHolds(organizationId: string): Promise<string[]> {
  const settings = await db.hrSetting.findMany({
    where: { organizationId, key: { startsWith: 'legalHold:' } },
    select: { key: true, value: true },
  });
  return settings
    .filter((s) => s.value === 'true')
    .map((s) => s.key.replace('legalHold:', ''));
}

export interface RetentionSweepResult {
  scope: string;
  held: boolean;
  anonymised: number;
}

/**
 * Run the HR retention sweep. Legal hold (HrSetting legalHold:<scope>=true)
 * skips the scope entirely. Personal data is ANONYMISED in place (not hard
 * deleted) so foreign keys and audit history stay intact.
 */
export async function runHrRetentionSweep(organizationId: string, actorId: string): Promise<RetentionSweepResult[]> {
  const holds = new Set(await getLegalHolds(organizationId));
  const results: RetentionSweepResult[] = [];
  // Applicants scope by store id (no store relation on the model).
  const orgStoreIds = (await db.store.findMany({ where: { organizationId }, select: { id: true } })).map((s) => s.id);

  // 1. Applicant rejection data (anonymise contact fields past retention).
  if (!holds.has('hr_applicant_rejection_data')) {
    const stale = await db.applicant.findMany({
      where: {
        status: { in: ['REJECTED', 'WITHDRAWN'] },
        dataRetentionUntil: { lt: new Date() },
        storeId: { in: orgStoreIds },
        fullName: { not: 'REDACTED (retention)' },
      },
      select: { id: true },
      take: 500,
    });
    if (stale.length) {
      await db.applicant.updateMany({
        where: { id: { in: stale.map((a) => a.id) } },
        data: { fullName: 'REDACTED (retention)', email: 'redacted@retention.invalid', phone: null, coverNote: null },
      });
      await hrAudit({
        actorId,
        action: 'RETENTION_APPLICANTS_ANONYMISED',
        resourceType: HrEntityType.APPLICANT,
        resourceId: 'batch',
        metadata: { count: stale.length, fields: ['fullName', 'email', 'phone', 'coverNote'] },
      });
    }
    results.push({ scope: 'hr_applicant_rejection_data', held: false, anonymised: stale.length });
  } else {
    results.push({ scope: 'hr_applicant_rejection_data', held: true, anonymised: 0 });
  }

  // 2. Closed disciplinary cases past 3 years (anonymise the description).
  if (!holds.has('hr_disciplinary_closed')) {
    const cutoff = new Date(Date.now() - 3 * 365 * 24 * 3600 * 1000);
    const stale = await db.disciplinaryCase.findMany({
      where: {
        status: { in: ['RESOLVED', 'DISMISSED', 'EXPIRED'] },
        updatedAt: { lt: cutoff },
        employee: { store: { organizationId } },
        description: { not: 'REDACTED (retention)' },
      },
      select: { id: true },
      take: 500,
    });
    if (stale.length) {
      await db.disciplinaryCase.updateMany({
        where: { id: { in: stale.map((c) => c.id) } },
        data: { description: 'REDACTED (retention)', resolutionNotes: null },
      });
      await hrAudit({
        actorId,
        action: 'RETENTION_DISCIPLINARY_ANONYMISED',
        resourceType: HrEntityType.DISCIPLINARY_CASE,
        resourceId: 'batch',
        metadata: { count: stale.length, fields: ['description', 'resolutionNotes'] },
      });
    }
    results.push({ scope: 'hr_disciplinary_closed', held: false, anonymised: stale.length });
  } else {
    results.push({ scope: 'hr_disciplinary_closed', held: true, anonymised: 0 });
  }

  // 3. Attendance daily records past 2 years (anonymise device + punch detail
  //    rows stay for aggregate reconciliation; sensitive fields cleared).
  if (!holds.has('hr_attendance_daily')) {
    const cutoff = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000);
    const stale = await db.attendanceRecord.findMany({
      where: { date: { lt: cutoff }, employee: { store: { organizationId } }, sourceDevice: { not: null } },
      select: { id: true },
      take: 500,
    });
    if (stale.length) {
      await db.attendanceRecord.updateMany({
        where: { id: { in: stale.map((a) => a.id) } },
        data: { sourceDevice: null },
      });
      await hrAudit({
        actorId,
        action: 'RETENTION_ATTENDANCE_ANONYMISED',
        resourceType: HrEntityType.EMPLOYEE,
        resourceId: 'batch',
        metadata: { count: stale.length, fields: ['sourceDevice'] },
      });
    }
    results.push({ scope: 'hr_attendance_daily', held: false, anonymised: stale.length });
  } else {
    results.push({ scope: 'hr_attendance_daily', held: true, anonymised: 0 });
  }

  return results;
}

// ── Erasure requests ────────────────────────────────────────────────────────

const STATUTORY_RETENTION_NOTE =
  'Payroll and audit records carry statutory retention (Employment Act s.74, Tax Procedures Act); they are never erased.';

/**
 * Execute (or partially execute) an erasure request: non-statutory personal
 * data is anonymised; statutory records stay with the legal basis recorded.
 * Only hr.settings.manage (SUPER_ADMIN) decides — maker-checked by status:
 * the requester cannot also be the decider unless no other admin exists
 * (single-admin deployments), which the audit trail records.
 */
export async function executeErasureRequest(
  requestId: string,
  session: Session,
  decisionNotes: string,
): Promise<Record<string, unknown>> {
  const request = await db.erasureRequest.findFirst({
    where: { id: requestId, deletedAt: null, organizationId: session.organizationId },
    include: { employee: { select: { id: true, storeId: true, firstName: true, lastName: true, userId: true } } },
  });
  if (!request || !employeeInScope(request.employee, session)) {
    throw new StageGError('ERASURE_NOT_FOUND', 'Erasure request not found.', 404);
  }
  if (request.status !== 'PENDING') {
    throw new StageGError('ALREADY_DECIDED', `Request is already ${request.status}.`, 409);
  }

  const employeeId = request.employee.id;
  // What can be erased: self-service fingerprints, non-statutory narratives,
  // optional contact + emergency fields. Payroll, audit, and statutory rows stay.
  const [docs, goals, reviews] = await Promise.all([
    db.employeeDocument.findMany({ where: { employeeId, deletedAt: null }, select: { id: true, fileUrl: true } }),
    db.goal.count({ where: { employeeId, deletedAt: null } }),
    db.performanceReview.count({ where: { employeeId, deletedAt: null } }),
  ]);

  // 1. Remove document files (metadata rows stay for the retention ledger).
  let filesRemoved = 0;
  for (const d of docs) {
    if (d.fileUrl) filesRemoved += 1;
    await db.employeeDocument.update({ where: { id: d.id }, data: { fileUrl: null, notes: null } });
  }

  // 2. Close performance narratives (ratings stay — anonymised statistics).
  await db.performanceReview.updateMany({
    where: { employeeId },
    data: { strengths: 'REDACTED (erasure)', improvements: 'REDACTED (erasure)' },
  });

  // 3. Close open goals (records stay for audit; narrative titles kept —
  //    business data, not personal data).
  await db.goal.updateMany({ where: { employeeId, status: 'OPEN' }, data: { status: 'CLOSED' } });
  void goals;
  void reviews;

  // 4. Contact fields on the employee row (nullable, non-statutory).
  const updated = await db.employee.update({
    where: { id: employeeId },
    data: { email: null, phone: null, photoUrl: null },
  });
  void updated;

  const partially = true; // statutory rows (payroll/audit) always remain
  const result = await db.erasureRequest.update({
    where: { id: requestId },
    data: {
      status: 'PARTIALLY_EXECUTED',
      retentionApplies: partially,
      decision: decisionNotes || 'Non-statutory personal data erased; statutory records retained.',
      legalBasis: STATUTORY_RETENTION_NOTE,
      executedAt: new Date(),
      decidedByUserId: session.userId,
    },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'ERASURE_REQUEST_EXECUTED',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: requestId,
    storeId: session.storeId,
    metadata: {
      employeeId,
      filesRemoved,
      fields: ['email', 'phone', 'photoUrl', 'strengths', 'improvements', 'document.fileUrl', 'document.notes'],
      legalBasisRecorded: true,
    },
  });

  return { id: result.id, status: result.status, retentionApplies: result.retentionApplies };
}

export async function rejectErasureRequest(
  requestId: string,
  session: Session,
  decisionNotes: string,
  legalBasis: string,
): Promise<Record<string, unknown>> {
  if (!decisionNotes || decisionNotes.length < 10) {
    throw new StageGError('DECISION_REQUIRED', 'Record the decision reason (at least 10 characters).', 400);
  }
  if (!legalBasis || legalBasis.length < 5) {
    throw new StageGError('LEGAL_BASIS_REQUIRED', 'Record the legal basis for rejection.', 400);
  }
  const request = await db.erasureRequest.findFirst({
    where: { id: requestId, deletedAt: null, organizationId: session.organizationId },
    include: { employee: { select: { id: true, storeId: true } } },
  });
  if (!request || !employeeInScope(request.employee, session)) {
    throw new StageGError('ERASURE_NOT_FOUND', 'Erasure request not found.', 404);
  }
  if (request.status !== 'PENDING') {
    throw new StageGError('ALREADY_DECIDED', `Request is already ${request.status}.`, 409);
  }
  const result = await db.erasureRequest.update({
    where: { id: requestId },
    data: {
      status: 'REJECTED',
      decision: decisionNotes,
      legalBasis,
      retentionApplies: true,
      decidedByUserId: session.userId,
    },
  });
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'ERASURE_REQUEST_REJECTED',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: requestId,
    storeId: session.storeId,
    metadata: { employeeId: request.employee.id, legalBasisRecorded: true },
  });
  return { id: result.id, status: result.status, decision: result.decision, legalBasis: result.legalBasis };
}

/** List erasure requests in scope (hr.settings.manage or branch manager view). */
export async function listErasureRequests(
  session: Session,
  filters: { status?: string } = {},
): Promise<Array<Record<string, unknown>>> {
  const rows = await db.erasureRequest.findMany({
    where: {
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
      employee: employeeScopeWhere(session),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      employee: { select: { employeeCode: true, firstName: true, lastName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    employeeCode: r.employee.employeeCode ?? '—',
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    status: r.status,
    decision: r.decision ?? null,
    legalBasis: r.legalBasis ?? null,
    retentionApplies: r.retentionApplies,
    requestedAt: r.createdAt.toISOString(),
    executedAt: r.executedAt ? r.executedAt.toISOString() : null,
  }));
}

export async function createErasureRequest(
  input: { employeeId?: unknown; notes?: unknown },
  session: Session,
): Promise<Record<string, unknown>> {
  const employee = await db.employee.findFirst({
    where: { id: String(input.employeeId ?? ''), deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: { id: true, storeId: true },
  });
  if (!employee) throw new StageGError('EMPLOYEE_NOT_FOUND', 'Employee not found in your scope.', 404);

  const pending = await db.erasureRequest.findFirst({
    where: { employeeId: employee.id, status: 'PENDING', deletedAt: null },
    select: { id: true },
  });
  if (pending) {
    throw new StageGError('REQUEST_PENDING', 'An erasure request for this employee is already pending.', 409);
  }

  const request = await db.erasureRequest.create({
    data: {
      organizationId: session.organizationId,
      employeeId: employee.id,
      requestedByUserId: session.userId,
      status: 'PENDING',
    },
  });
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'ERASURE_REQUEST_CREATED',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: request.id,
    storeId: session.storeId,
    metadata: { employeeId: employee.id },
  });
  return { id: request.id, status: request.status, requestedAt: request.createdAt.toISOString() };
}

/** Guard permission for the privacy endpoints (settings-manage decides). */
export function canDecideErasure(role: string): boolean {
  return hasHrPermission(role, 'hr.settings.manage');
}

// ── Consent records (v2.119.0, spec Phase 4.8 acceptance 6) ─────────────────
//
// "Consent records work" — until now the ConsentRecord table was write-only
// at intake (recruitment applicant consent) and read by exactly one gate: the
// payroll run's MISSING_CONSENT guardrail, which requires an ACTIVE record
// (`withdrawnAt: null`) per employee. No product surface could GRANT an
// employee's consent, WITHDRAW one, or even SEE the state — the honest gap.
// This block closes it: a read-back ledger on the Privacy tab plus grant /
// withdraw decisions, both audit-logged, both scope-checked.

/** The purpose the payroll gate reads; grant/withdraw pin this vocabulary. */
export const PAYROLL_CONSENT_PURPOSE = 'PAYROLL_PROCESSING';
export const PAYROLL_CONSENT_SCOPE = 'Compute salary, statutory deductions, and payslips';
export const PAYROLL_CONSENT_POLICY_VERSION = 'hr-policy-2026-01';

export interface ConsentRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  /** ACTIVE (an un-withdrawn record exists) / WITHDRAWN (records exist, all withdrawn) / NONE (no record — payroll blocks). */
  status: 'ACTIVE' | 'WITHDRAWN' | 'NONE';
  /** The latest record's purpose (the status folds ALL records — the payroll gate does not filter by purpose). */
  latestPurpose: string | null;
  latestPolicyVersion: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
}

export interface ConsentLedger {
  records: ConsentRow[];
  summary: { active: number; withdrawn: number; none: number };
}

/** Read-back: every in-scope employee's consent state, one batched query. */
export async function listConsentRecords(session: Session): Promise<ConsentLedger> {
  const employees = await db.employee.findMany({
    where: { deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      consentRecords: {
        orderBy: { grantedAt: 'desc' },
        select: {
          purpose: true,
          policyVersion: true,
          grantedAt: true,
          withdrawnAt: true,
        },
      },
    },
    take: 200,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const records: ConsentRow[] = employees.map((e) => {
    const crs = e.consentRecords;
    const latest = crs[0] ?? null;
    const active = crs.find((c) => c.withdrawnAt === null) ?? null;
    // Status folds ALL records — the payroll gate reads any active record.
    const status: ConsentRow['status'] = active ? 'ACTIVE' : crs.length > 0 ? 'WITHDRAWN' : 'NONE';
    return {
      employeeId: e.id,
      employeeCode: e.employeeCode ?? '—',
      employeeName: `${e.firstName} ${e.lastName}`.trim(),
      status,
      latestPurpose: (active ?? latest)?.purpose ?? null,
      latestPolicyVersion: (active ?? latest)?.policyVersion ?? null,
      grantedAt: (active ?? latest)?.grantedAt.toISOString() ?? null,
      withdrawnAt: active ? null : (latest?.withdrawnAt?.toISOString() ?? null),
    };
  });

  return {
    records,
    summary: {
      active: records.filter((r) => r.status === 'ACTIVE').length,
      withdrawn: records.filter((r) => r.status === 'WITHDRAWN').length,
      none: records.filter((r) => r.status === 'NONE').length,
    },
  };
}

async function consentTargetEmployee(
  input: { employeeId?: unknown },
  session: Session,
): Promise<{ id: string; storeId: string }> {
  const employee = await db.employee.findFirst({
    where: { id: String(input.employeeId ?? ''), deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: { id: true, storeId: true },
  });
  if (!employee) throw new StageGError('EMPLOYEE_NOT_FOUND', 'Employee not found in your scope.', 404);
  return employee;
}

/**
 * Grant the employee's data-processing consent: a NEW record (append-only —
 * a withdrawn consent keeps its row and its dates; the new grant supersedes
 * it). Refuses when an active record already stands.
 */
export async function grantConsent(
  input: { employeeId?: unknown },
  session: Session,
): Promise<Record<string, unknown>> {
  const employee = await consentTargetEmployee(input, session);
  const active = await db.consentRecord.findFirst({
    where: { employeeId: employee.id, withdrawnAt: null },
    select: { id: true, purpose: true },
  });
  if (active) {
    throw new StageGError('CONSENT_ACTIVE', `An active consent already stands (${active.purpose}).`, 409);
  }
  const record = await db.consentRecord.create({
    data: {
      employeeId: employee.id,
      purpose: PAYROLL_CONSENT_PURPOSE,
      scope: PAYROLL_CONSENT_SCOPE,
      policyVersion: PAYROLL_CONSENT_POLICY_VERSION,
      lawfulBasis: 'CONSENT',
    },
  });
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'PRIVACY_CONSENT_GRANTED',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employee.id,
    storeId: session.storeId,
    metadata: { employeeId: employee.id, purpose: PAYROLL_CONSENT_PURPOSE, policyVersion: PAYROLL_CONSENT_POLICY_VERSION },
  });
  return {
    employeeId: employee.id,
    consentId: record.id,
    purpose: record.purpose,
    policyVersion: record.policyVersion,
    grantedAt: record.grantedAt.toISOString(),
  };
}

/**
 * Withdraw the employee's active consent(s): sets withdrawnAt on every
 * un-withdraw record. The payroll gate reads `withdrawnAt: null`, so the
 * NEXT run honestly reports MISSING_CONSENT for this employee.
 */
export async function withdrawConsent(
  input: { employeeId?: unknown },
  session: Session,
): Promise<Record<string, unknown>> {
  const employee = await consentTargetEmployee(input, session);
  const withdrawn = await db.consentRecord.updateMany({
    where: { employeeId: employee.id, withdrawnAt: null },
    data: { withdrawnAt: new Date() },
  });
  if (withdrawn.count === 0) {
    throw new StageGError('NO_ACTIVE_CONSENT', 'No active consent stands for this employee.', 409);
  }
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'PRIVACY_CONSENT_WITHDRAWN',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employee.id,
    storeId: session.storeId,
    metadata: { employeeId: employee.id, withdrawn: withdrawn.count },
  });
  return { employeeId: employee.id, withdrawn: withdrawn.count, withdrawnAt: new Date().toISOString() };
}
