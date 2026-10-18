// MBUMAH HARDWARE POS - HR disciplinary service (v2.19.0, spec Phase 4.7)
//
// Acceptance rules 4 and 5: "Disciplinary warnings expire" and "Grievance
// confidentiality enforced". Warnings (type WARNING) auto-expire via a lazy
// sweep (OPEN + expiresOn in the past -> EXPIRED). Grievances default to
// RESTRICTED confidentiality; descriptions are sensitive and never appear in
// list payloads - only the permission-gated single-fetch detail returns them,
// and RESTRICTED cases require an explicit confidentiality allowance.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { StageGError, employeeScopeWhere, employeeInScope, toDate } from './stage-g-shared';
import type { AuthSession } from '@/lib/auth';

export const CASE_TYPES = ['WARNING', 'GRIEVANCE', 'INVESTIGATION'] as const;
export const CASE_STATUSES = ['OPEN', 'RESOLVED', 'DISMISSED', 'EXPIRED'] as const;
export const CONFIDENTIALITY_LEVELS = ['STANDARD', 'RESTRICTED'] as const;

type Session = AuthSession;

export interface CaseListItemDto {
  id: string;
  employeeId: string;
  employeeName: string | null;
  type: string;
  severity: number | null;
  status: string;
  issuedOn: string;
  expiresOn: string | null;
  confidentiality: string;
  // NOTE: description deliberately absent (spec rule 7 - sensitive data).
  createdAt: string;
}

export interface CaseDetailDto extends CaseListItemDto {
  description: string;
  resolutionNotes: string | null;
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toListItem(
  c: {
    id: string;
    employeeId: string;
    type: string;
    severity: number | null;
    status: string;
    issuedOn: Date;
    expiresOn: Date | null;
    confidentiality: string;
    createdAt: Date;
  },
  employeeName: string | null,
): CaseListItemDto {
  return {
    id: c.id,
    employeeId: c.employeeId,
    employeeName,
    type: c.type,
    severity: c.severity ?? null,
    status: c.status,
    issuedOn: c.issuedOn.toISOString(),
    expiresOn: toIso(c.expiresOn),
    confidentiality: c.confidentiality,
    createdAt: c.createdAt.toISOString(),
  };
}

async function employeeNameFor(employeeId: string): Promise<string | null> {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true },
  });
  return e ? `${e.firstName} ${e.lastName}` : null;
}

// ── Expiry sweep (spec acceptance rule 4) ───────────────────────────────────

/**
 * Expire OPEN warnings whose expiresOn has passed. Returns the number of
 * cases expired. Called lazily by list/detail reads so no scheduler is
 * required for correctness, and one batch audit event is written per sweep.
 */
export async function sweepExpiredCases(session: Session): Promise<number> {
  const result = await db.disciplinaryCase.updateMany({
    where: {
      deletedAt: null,
      status: 'OPEN',
      type: 'WARNING',
      expiresOn: { lt: new Date() },
      employee: employeeScopeWhere(session),
    },
    data: { status: 'EXPIRED' },
  });
  if (result.count > 0) {
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'DISCIPLINARY_WARNINGS_EXPIRED',
      resourceType: HrEntityType.DISCIPLINARY_CASE,
      resourceId: 'batch',
      storeId: session.storeId,
      metadata: { count: result.count, fieldNames: ['status'] },
    });
  }
  return result.count;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function listCases(
  session: Session,
  filters: { employeeId?: string; status?: string; type?: string } = {},
): Promise<CaseListItemDto[]> {
  await sweepExpiredCases(session);
  const cases = await db.disciplinaryCase.findMany({
    where: {
      deletedAt: null,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      employee: employeeScopeWhere(session),
    },
    orderBy: { issuedOn: 'desc' },
    take: 200,
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  // Sensitive-data rule: descriptions never enter list payloads, regardless
  // of confidentiality level.
  return cases.map((c) => toListItem(c, `${c.employee.firstName} ${c.employee.lastName}`));
}

async function loadCase(caseId: string, session: Session) {
  const record = await db.disciplinaryCase.findFirst({
    where: { id: caseId, deletedAt: null },
    include: {
      employee: { select: { id: true, storeId: true, firstName: true, lastName: true } },
    },
  });
  if (!record || !employeeInScope(record.employee, session)) {
    throw new StageGError('CASE_NOT_FOUND', 'Disciplinary case not found in your scope.', 404);
  }
  return record;
}

export async function getCaseDetail(caseId: string, session: Session): Promise<CaseDetailDto> {
  await sweepExpiredCases(session);
  const record = await loadCase(caseId, session);
  // Grievance confidentiality: RESTRICTED descriptions are reserved for
  // explicit confidentiality allow-list roles (HR_MANAGER, STORE_OWNER,
  // SUPER_ADMIN). The route guard already requires hr.discipline.manage for
  // every /api/hr/discipline route; this second check is defence in depth.
  if (
    record.confidentiality === 'RESTRICTED' &&
    !['HR_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'].includes(session.role)
  ) {
    // v2.115.0: the denied attempt is traceable too (spec 4.7 acceptance 5 —
    // "enforced" means the block leaves a record, not just a 403). Metadata
    // carries the confidentiality flag only — never the description text.
    // Today the guard admits exactly the allow-listed roles, so this path is
    // defence-in-depth (same as the 403 it rides); if the guard's key ever
    // widens, the trace exists the day the gap opens.
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'DISCIPLINARY_RESTRICTED_DENIED',
      resourceType: HrEntityType.DISCIPLINARY_CASE,
      resourceId: caseId,
      storeId: session.storeId,
      metadata: { confidentiality: 'RESTRICTED', fieldNames: [] },
    });
    throw new StageGError(
      'CONFIDENTIALITY_RESTRICTED',
      'This grievance is restricted; the record description is confidential.',
      403,
    );
  }
  if (record.confidentiality === 'RESTRICTED') {
    // v2.115.0: a granted restricted read leaves a trace as well — who
    // opened which record, when, from which store. The metadata names the
    // confidentiality level and no case content: the audit trail proves the
    // access happened without itself becoming a copy of the sensitive data.
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'DISCIPLINARY_RESTRICTED_VIEWED',
      resourceType: HrEntityType.DISCIPLINARY_CASE,
      resourceId: caseId,
      storeId: session.storeId,
      metadata: { confidentiality: 'RESTRICTED', fieldNames: [] },
    });
  }
  return {
    ...toListItem(record, await employeeNameFor(record.employeeId)),
    description: record.description,
    resolutionNotes: record.resolutionNotes ?? null,
  };
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function openCase(
  input: {
    employeeId?: unknown;
    type?: unknown;
    severity?: unknown;
    description?: unknown;
    issuedOn?: unknown;
    expiresOn?: unknown;
    confidentiality?: unknown;
  },
  session: Session,
): Promise<CaseListItemDto> {
  const type = String(input.type ?? '').toUpperCase();
  if (!(CASE_TYPES as readonly string[]).includes(type)) {
    throw new StageGError('INVALID_TYPE', `type must be one of ${CASE_TYPES.join(', ')}.`, 400);
  }
  const description = String(input.description ?? '').trim();
  if (description.length < 10 || description.length > 5000) {
    throw new StageGError(
      'DESCRIPTION_REQUIRED',
      'Describe the case in at least 10 characters (max 5000).',
      400,
    );
  }

  const employee = await db.employee.findFirst({
    where: { id: String(input.employeeId ?? ''), deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: { id: true, storeId: true },
  });
  if (!employee || !employeeInScope(employee, session)) {
    throw new StageGError('EMPLOYEE_NOT_FOUND', 'Employee not found in your scope.', 404);
  }

  let confidentiality = String(input.confidentiality ?? '').toUpperCase();
  if (!confidentiality) {
    // Grievances default to RESTRICTED (acceptance rule 5).
    confidentiality = type === 'GRIEVANCE' ? 'RESTRICTED' : 'STANDARD';
  }
  if (!(CONFIDENTIALITY_LEVELS as readonly string[]).includes(confidentiality)) {
    throw new StageGError(
      'INVALID_CONFIDENTIALITY',
      `confidentiality must be one of ${CONFIDENTIALITY_LEVELS.join(', ')}.`,
      400,
    );
  }

  const issuedOn = toDate(input.issuedOn ?? new Date(), 'issuedOn');
  let expiresOn: Date | null = null;
  if (input.expiresOn !== undefined && input.expiresOn !== null && input.expiresOn !== '') {
    expiresOn = toDate(input.expiresOn, 'expiresOn');
    if (expiresOn.getTime() <= issuedOn.getTime()) {
      throw new StageGError('INVALID_EXPIRY', 'expiresOn must be after issuedOn.', 400);
    }
  }

  let severity: number | null = null;
  if (input.severity !== undefined && input.severity !== null && input.severity !== '') {
    severity = Number(input.severity);
    if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
      throw new StageGError('INVALID_SEVERITY', 'Severity must be an integer between 1 and 5.', 400);
    }
  }

  const record = await db.disciplinaryCase.create({
    data: {
      employeeId: employee.id,
      storeId: employee.storeId,
      type,
      severity,
      description,
      status: 'OPEN',
      issuedOn,
      expiresOn,
      confidentiality,
      createdByUserId: session.userId,
    },
  });

  // Audit metadata carries field names only - never the description text.
  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'DISCIPLINARY_CASE_OPENED',
    resourceType: HrEntityType.DISCIPLINARY_CASE,
    resourceId: record.id,
    storeId: session.storeId,
    metadata: { type, confidentiality, fields: ['description', 'issuedOn'] },
  });

  return toListItem(record, await employeeNameFor(employee.id));
}

export interface CaseUpdateInput {
  action?: unknown; // RESOLVE | DISMISS
  resolutionNotes?: unknown;
}

export async function updateCase(
  caseId: string,
  input: CaseUpdateInput,
  session: Session,
): Promise<CaseListItemDto> {
  const record = await loadCase(caseId, session);
  if (record.status !== 'OPEN') {
    throw new StageGError(
      'ILLEGAL_TRANSITION',
      `A ${record.status} case cannot be closed again.`,
      409,
    );
  }
  const action = String(input.action ?? '').toUpperCase();
  if (action !== 'RESOLVE' && action !== 'DISMISS') {
    throw new StageGError('UNKNOWN_ACTION', 'action must be RESOLVE or DISMISS.', 400);
  }
  const resolutionNotes = String(input.resolutionNotes ?? '').trim();
  if (action === 'RESOLVE' && resolutionNotes.length < 5) {
    throw new StageGError(
      'RESOLUTION_REQUIRED',
      'Record how the case was resolved (at least 5 characters).',
      400,
    );
  }

  const status = action === 'RESOLVE' ? 'RESOLVED' : 'DISMISSED';
  const updated = await db.disciplinaryCase.update({
    where: { id: caseId },
    data: { status, resolutionNotes: resolutionNotes || null },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'DISCIPLINARY_CASE_CLOSED',
    resourceType: HrEntityType.DISCIPLINARY_CASE,
    resourceId: caseId,
    storeId: session.storeId,
    metadata: { from: 'OPEN', to: status },
  });

  return toListItem(updated, await employeeNameFor(record.employeeId));
}
