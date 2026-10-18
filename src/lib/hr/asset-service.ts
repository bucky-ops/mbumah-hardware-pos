// MBUMAH HARDWARE POS - HR asset service (v2.19.0, spec Phase 4.7)
//
// Asset assignments with authorization-gated recovery: marking an asset LOST
// or DAMAGED requires a named authorizer (a second, active holder of
// hr.asset.manage) who must be different from the acting user — no
// self-authorization. Ordinary RETURN flows record the condition back in.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { StageGError, employeeScopeWhere, employeeInScope, toDate } from './stage-g-shared';
import { storeInOrganization } from './employee-service';
import { hasHrPermission } from './permissions';
import type { AuthSession } from '@/lib/auth';

export const ASSET_STATUSES = ['ASSIGNED', 'RETURNED', 'LOST', 'DAMAGED'] as const;

type Session = AuthSession;

export interface AssetDto {
  id: string;
  employeeId: string;
  employeeName: string | null;
  storeId: string | null;
  assetName: string;
  assetTag: string | null;
  serialNumber: string | null;
  assignedOn: string;
  dueReturnOn: string | null;
  returnedOn: string | null;
  conditionOut: string | null;
  conditionIn: string | null;
  recoveryAuthorizedByUserId: string | null;
  status: string;
  notes: string | null;
  overdue: boolean;
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toDto(
  a: {
    id: string;
    employeeId: string;
    storeId: string | null;
    assetName: string;
    assetTag: string | null;
    serialNumber: string | null;
    assignedOn: Date;
    dueReturnOn: Date | null;
    returnedOn: Date | null;
    conditionOut: string | null;
    conditionIn: string | null;
    recoveryAuthorizedByUserId: string | null;
    status: string;
    notes: string | null;
  },
  employeeName: string | null,
): AssetDto {
  return {
    id: a.id,
    employeeId: a.employeeId,
    employeeName,
    storeId: a.storeId,
    assetName: a.assetName,
    assetTag: a.assetTag,
    serialNumber: a.serialNumber,
    assignedOn: a.assignedOn.toISOString(),
    dueReturnOn: toIso(a.dueReturnOn),
    returnedOn: toIso(a.returnedOn),
    conditionOut: a.conditionOut,
    conditionIn: a.conditionIn,
    recoveryAuthorizedByUserId: a.recoveryAuthorizedByUserId,
    status: a.status,
    notes: a.notes,
    overdue:
      a.status === 'ASSIGNED' && a.dueReturnOn !== null && a.dueReturnOn.getTime() < Date.now(),
  };
}

async function employeeNameFor(employeeId: string): Promise<string | null> {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { firstName: true, lastName: true },
  });
  return e ? `${e.firstName} ${e.lastName}` : null;
}

async function loadAsset(assetId: string, session: Session) {
  const asset = await db.assetAssignment.findFirst({
    where: { id: assetId, deletedAt: null },
    include: {
      employee: { select: { id: true, storeId: true, firstName: true, lastName: true } },
    },
  });
  if (!asset || !employeeInScope(asset.employee, session)) {
    throw new StageGError('ASSET_NOT_FOUND', 'Asset assignment not found in your scope.', 404);
  }
  return asset;
}

export async function listAssets(
  session: Session,
  filters: { employeeId?: string; status?: string; storeId?: string; overdue?: boolean } = {},
): Promise<AssetDto[]> {
  // v2.114.0: an explicit storeId narrows the list only when the caller is an
  // org-scope actor (no session store) whose organization owns the store, or
  // the store IS the session's own — fail-closed; any other request silently
  // keeps the session scope (the page's mismatch notice says so, mirroring
  // the employees list's honesty).
  let storeFilter: string | null = null;
  if (filters.storeId) {
    if (session.storeId) {
      if (session.storeId === filters.storeId) storeFilter = filters.storeId;
    } else if (await storeInOrganization(filters.storeId, session.organizationId)) {
      storeFilter = filters.storeId;
    }
  }
  const scope = employeeScopeWhere(session);
  const assets = await db.assetAssignment.findMany({
    where: {
      deletedAt: null,
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      // v2.114.0: the overdue window mirrors the panel's assetsOverdue count
      // exactly (ASSIGNED with dueReturnOn in the past) so the door lands on
      // the number the alert promised; when overdue is asked, it wins over
      // any conflicting status filter.
      ...(filters.overdue
        ? { status: 'ASSIGNED', dueReturnOn: { lt: new Date() } }
        : filters.status
          ? { status: filters.status }
          : {}),
      employee: storeFilter ? { ...scope, storeId: storeFilter } : scope,
    },
    orderBy: { assignedOn: 'desc' },
    take: 200,
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  return assets.map((a) =>
    toDto(a, `${a.employee.firstName} ${a.employee.lastName}`),
  );
}

export async function assignAsset(
  input: {
    employeeId?: unknown;
    assetName?: unknown;
    assetTag?: unknown;
    serialNumber?: unknown;
    assignedOn?: unknown;
    dueReturnOn?: unknown;
    conditionOut?: unknown;
    notes?: unknown;
  },
  session: Session,
): Promise<AssetDto> {
  const assetName = String(input.assetName ?? '').trim();
  if (assetName.length < 2 || assetName.length > 160) {
    throw new StageGError('INVALID_ASSET_NAME', 'Asset name must be between 2 and 160 characters.', 400);
  }

  const employee = await db.employee.findFirst({
    where: { id: String(input.employeeId ?? ''), deletedAt: null, AND: [employeeScopeWhere(session)] },
    select: { id: true, storeId: true },
  });
  if (!employee || !employeeInScope(employee, session)) {
    throw new StageGError('EMPLOYEE_NOT_FOUND', 'Employee not found in your scope.', 404);
  }

  const assignedOn = toDate(input.assignedOn ?? new Date(), 'assignedOn');
  const dueReturnOn = input.dueReturnOn ? toDate(input.dueReturnOn, 'dueReturnOn') : null;
  if (dueReturnOn && dueReturnOn.getTime() < assignedOn.getTime()) {
    throw new StageGError('INVALID_RETURN_DATE', 'dueReturnOn cannot be before assignedOn.', 400);
  }

  const asset = await db.assetAssignment.create({
    data: {
      employeeId: employee.id,
      storeId: employee.storeId,
      assetName,
      assetTag: input.assetTag ? String(input.assetTag).trim() || null : null,
      serialNumber: input.serialNumber ? String(input.serialNumber).trim() || null : null,
      assignedOn,
      dueReturnOn,
      conditionOut: input.conditionOut ? String(input.conditionOut).trim() || null : null,
      notes: input.notes ? String(input.notes).trim() || null : null,
      status: 'ASSIGNED',
    },
  });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'ASSET_ASSIGNED',
    resourceType: HrEntityType.ASSET_ASSIGNMENT,
    resourceId: asset.id,
    storeId: session.storeId,
    metadata: { employeeId: employee.id, assetTag: asset.assetTag ? 'present' : 'absent' },
  });

  return toDto(asset, await employeeNameFor(employee.id));
}

/**
 * Validate a recovery authorizer for LOST/DAMAGED dispositions:
 * - must name an existing ACTIVE user;
 * - that user must hold hr.asset.manage;
 * - must differ from the acting user (no self-authorization).
 */
export async function resolveRecoveryAuthorizer(
  authorizerUserId: unknown,
  session: Session,
): Promise<string> {
  const id = String(authorizerUserId ?? '').trim();
  if (!id) {
    throw new StageGError(
      'RECOVERY_NOT_AUTHORIZED',
      'Marking an asset LOST or DAMAGED requires a named recovery authorizer.',
      403,
    );
  }
  if (id === session.userId) {
    throw new StageGError(
      'RECOVERY_SELF_AUTHORIZATION',
      'Recovery authorization cannot come from the same user recording the outcome.',
      403,
    );
  }
  const authorizer = await db.user.findUnique({
    where: { id },
    select: { id: true, isActive: true, role: true },
  });
  if (!authorizer || !authorizer.isActive || !hasHrPermission(authorizer.role, 'hr.asset.manage')) {
    throw new StageGError(
      'RECOVERY_AUTHORIZER_INVALID',
      'The recovery authorizer must be an active HR manager or store owner.',
      403,
    );
  }
  return authorizer.id;
}

export interface AssetUpdateInput {
  status?: unknown; // RETURNED | LOST | DAMAGED
  conditionIn?: unknown;
  recoveryAuthorizedByUserId?: unknown;
  notes?: unknown;
  dueReturnOn?: unknown;
}

export async function updateAsset(
  assetId: string,
  input: AssetUpdateInput,
  session: Session,
): Promise<AssetDto> {
  const asset = await loadAsset(assetId, session);
  const target = String(input.status ?? '').toUpperCase();

  if (!target) {
    // Metadata-only edit (notes / extend return date) while still assigned.
    const data: { notes?: string | null; dueReturnOn?: Date } = {};
    if (input.notes !== undefined) data.notes = input.notes === null ? null : String(input.notes).trim() || null;
    if (input.dueReturnOn !== undefined && input.dueReturnOn !== null && input.dueReturnOn !== '') {
      data.dueReturnOn = toDate(input.dueReturnOn, 'dueReturnOn');
    }
    if (Object.keys(data).length === 0) {
      throw new StageGError('NOTHING_TO_UPDATE', 'Provide a status or metadata field to update.', 400);
    }
    const updated = await db.assetAssignment.update({ where: { id: assetId }, data });
    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'ASSET_UPDATED',
      resourceType: HrEntityType.ASSET_ASSIGNMENT,
      resourceId: assetId,
      storeId: session.storeId,
      metadata: { fields: Object.keys(data) },
    });
    return toDto(updated, await employeeNameFor(asset.employeeId));
  }

  if (asset.status !== 'ASSIGNED') {
    throw new StageGError(
      'ILLEGAL_TRANSITION',
      `An asset in status ${asset.status} cannot move to ${target}.`,
      409,
    );
  }
  if (target !== 'RETURNED' && target !== 'LOST' && target !== 'DAMAGED') {
    throw new StageGError('INVALID_STATUS', 'status must be RETURNED, LOST or DAMAGED.', 400);
  }

  const data: {
    status: string;
    returnedOn: Date;
    conditionIn?: string | null;
    recoveryAuthorizedByUserId?: string | null;
    notes?: string | null;
  } = { status: target, returnedOn: new Date() };

  if (target === 'RETURNED') {
    if (!input.conditionIn || !String(input.conditionIn).trim()) {
      throw new StageGError('CONDITION_REQUIRED', 'Record the return condition (conditionIn).', 400);
    }
    data.conditionIn = String(input.conditionIn).trim();
    data.recoveryAuthorizedByUserId = null;
  } else {
    // Spec acceptance rule 3: asset recovery requires authorization.
    const authorizerId = await resolveRecoveryAuthorizer(
      input.recoveryAuthorizedByUserId,
      session,
    );
    data.recoveryAuthorizedByUserId = authorizerId;
    if (input.conditionIn) data.conditionIn = String(input.conditionIn).trim();
    if (!input.notes || !String(input.notes).trim()) {
      throw new StageGError(
        'NOTES_REQUIRED',
        `Describe the circumstances when marking an asset ${target}.`,
        400,
      );
    }
    data.notes = String(input.notes).trim();
  }

  const updated = await db.assetAssignment.update({ where: { id: assetId }, data });

  await hrAudit({
    actorId: session.userId,
    actorRole: session.role,
    action: 'ASSET_RECOVERY_RECORDED',
    resourceType: HrEntityType.ASSET_ASSIGNMENT,
    resourceId: assetId,
    storeId: session.storeId,
    metadata: {
      from: asset.status,
      to: target,
      authorizerNamed: data.recoveryAuthorizedByUserId ? true : false,
    },
  });

  return toDto(updated, await employeeNameFor(asset.employeeId));
}
