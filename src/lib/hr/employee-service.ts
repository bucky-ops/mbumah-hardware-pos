// MBUMAH HARDWARE POS - HR employee service (v2.18.5)
//
// Every employee mutation goes through this service (spec rule 15): no route
// handler writes Employee rows directly. The service enforces soft deletes,
// writes hash-chained audit events via hrAudit, and returns shaped payloads
// that never contain unmasked PII unless the caller explicitly (and
// auditably) requests it.

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { shapeEmployeeDetail, stripEmployeePii } from './pii';
import type { HrEmployeeDetail, HrEmployeeSummary } from './types';

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  if (typeof value === 'object' && 'toNumber' in (value as Record<string, unknown>)) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value) || 0;
}

function toIso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : value ? String(value) : null;
}

function summarize(e: {
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
  hireDate: Date;
  terminationDate: Date | null;
  storeId: string;
  reportingToId?: string | null;
  store?: { name: string } | null;
}): HrEmployeeSummary {
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    jobTitle: e.jobTitle,
    role: e.role,
    employmentType: e.employmentType,
    status: e.status,
    hireDate: toIso(e.hireDate) as string,
    terminationDate: toIso(e.terminationDate),
    storeId: e.storeId,
    reportingToId: e.reportingToId ?? null,
    storeName: e.store?.name,
  };
}

export interface ListEmployeesParams {
  storeId: string;
  includeArchived?: boolean;
  status?: string;
  search?: string;
}

export async function listEmployees(params: ListEmployeesParams): Promise<HrEmployeeSummary[]> {
  const where: Record<string, unknown> = {
    storeId: params.storeId,
    ...(params.includeArchived ? {} : { deletedAt: null }),
    ...(params.status ? { status: params.status } : {}),
  };
  if (params.search) {
    where.OR = [
      { firstName: { contains: params.search } },
      { lastName: { contains: params.search } },
      { employeeCode: { contains: params.search } },
      { jobTitle: { contains: params.search } },
    ];
  }
  const rows = await db.employee.findMany({
    where,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    include: { store: { select: { name: true } } },
  });
  return rows.map(summarize); // summaries never carry PII fields
}

export async function getEmployeeDetail(
  employeeId: string,
  storeId: string,
  options: { includePii: boolean },
): Promise<HrEmployeeDetail | null> {
  const employee = await db.employee.findFirst({
    where: { id: employeeId, storeId, deletedAt: null },
  });
  if (!employee) return null;

  const raw = {
    ...summarize({ ...employee, store: null }),
    basicSalary: toNumber(employee.basicSalary),
    houseAllowance: toNumber(employee.houseAllowance),
    transportAllowance: toNumber(employee.transportAllowance),
    medicalAllowance: toNumber(employee.medicalAllowance),
    otherAllowances: toNumber(employee.otherAllowances),
    hourlyRate: employee.hourlyRate == null ? null : toNumber(employee.hourlyRate),
    bankName: employee.bankName,
    bankAccountName: employee.bankAccountName,
    nationalId: employee.nationalId ?? undefined,
    kraPin: employee.kraPin ?? undefined,
    nssfNumber: employee.nssfNumber ?? undefined,
    nhifNumber: employee.nhifNumber ?? undefined,
    payeExempt: employee.payeExempt,
    nssfExempt: employee.nssfExempt,
    nhifExempt: employee.nhifExempt,
    notes: employee.notes,
  };
  return shapeEmployeeDetail(raw, options.includePii);
}

export interface CreateEmployeeInput {
  storeId: string;
  actorId: string;
  actorRole: string;
  data: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    nationalId?: string;
    kraPin?: string;
    nssfNumber?: string;
    nhifNumber?: string;
    jobTitle?: string;
    role?: string;
    employmentType?: string;
    hireDate?: Date;
    basicSalary?: number;
    hourlyRate?: number;
    houseAllowance?: number;
    transportAllowance?: number;
    medicalAllowance?: number;
    otherAllowances?: number;
    bankName?: string;
    bankAccountName?: string;
    reportingToId?: string;
    notes?: string;
  };
}

export async function createEmployee(input: CreateEmployeeInput): Promise<{ employee: HrEmployeeSummary; id: string }> {
  const { storeId, actorId, actorRole, data } = input;

  const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) throw new Error('Store not found.');

  // employeeCode: EMP-<seq> derived from count within the store; stable and unique.
  const count = await db.employee.count({ where: { storeId } });
  const employeeCode = data.nationalId
    ? undefined
    : `EMP-${String(count + 1).padStart(4, '0')}`;

  const created = await db.employee.create({
    data: {
      storeId,
      employeeCode,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email || null,
      phone: data.phone || null,
      nationalId: data.nationalId || null,
      kraPin: data.kraPin || null,
      nssfNumber: data.nssfNumber || null,
      nhifNumber: data.nhifNumber || null,
      jobTitle: data.jobTitle || null,
      role: data.role || 'STAFF',
      employmentType: data.employmentType || 'PERMANENT',
      hireDate: data.hireDate ?? new Date(),
      basicSalary: data.basicSalary ?? 0,
      hourlyRate: data.hourlyRate ?? null,
      houseAllowance: data.houseAllowance ?? 0,
      transportAllowance: data.transportAllowance ?? 0,
      medicalAllowance: data.medicalAllowance ?? 0,
      otherAllowances: data.otherAllowances ?? 0,
      bankName: data.bankName || null,
      bankAccountName: data.bankAccountName || null,
      reportingToId: data.reportingToId || null,
      notes: data.notes || null,
    },
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: created.id,
    storeId,
    reason: 'Employee record created via HR workspace.',
    metadata: { employeeCode: created.employeeCode, employmentType: created.employmentType },
  });

  return { employee: summarize({ ...created, store: null }), id: created.id };
}

export interface UpdateEmployeeInput {
  employeeId: string;
  storeId: string;
  actorId: string;
  actorRole: string;
  data: Record<string, unknown>;
}

const UPDATABLE_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'nationalId',
  'kraPin',
  'nssfNumber',
  'nhifNumber',
  'jobTitle',
  'role',
  'employmentType',
  'status',
  'basicSalary',
  'hourlyRate',
  'houseAllowance',
  'transportAllowance',
  'medicalAllowance',
  'otherAllowances',
  'bankName',
  'bankAccountName',
  'reportingToId',
  'notes',
  'terminationDate',
  'hireDate',
] as const;

export async function updateEmployee(input: UpdateEmployeeInput): Promise<HrEmployeeSummary | null> {
  const { employeeId, storeId, actorId, actorRole, data } = input;

  const existing = await db.employee.findFirst({
    where: { id: employeeId, storeId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!existing) return null;

  const patch: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (field in data && data[field] !== undefined) {
      patch[field] = field === 'hireDate' || field === 'terminationDate'
        ? data[field] ? new Date(String(data[field])) : null
        : data[field];
    }
  }

  // Terminating an employee sets the termination date.
  if (patch.status === 'TERMINATED' && !patch.terminationDate) {
    patch.terminationDate = new Date();
  }

  const updated = await db.employee.update({
    where: { id: employeeId },
    data: patch,
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employeeId,
    storeId,
    reason: 'Employee record updated via HR workspace.',
    metadata: { fields: Object.keys(patch) }, // field names only, never values
  });

  return summarize({ ...updated, store: null });
}

export async function archiveEmployee(
  employeeId: string,
  storeId: string,
  actorId: string,
  actorRole: string,
  reason: string,
): Promise<boolean> {
  const existing = await db.employee.findFirst({
    where: { id: employeeId, storeId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return false;

  await db.employee.update({
    where: { id: employeeId },
    data: { deletedAt: new Date(), status: 'TERMINATED', terminationDate: new Date() },
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'DELETE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employeeId,
    storeId,
    reason: reason || 'Employee archived (soft delete) via HR workspace.',
  });

  return true;
}

export async function listUnmaskedSummariesForExport(storeId: string): Promise<ReturnType<typeof stripEmployeePii>[]> {
  const rows = await db.employee.findMany({ where: { storeId, deletedAt: null } });
  return rows.map(stripEmployeePii);
}

// ─── v2.39.0: governed portal-account linking ────────────────────────────────
//
// The leave lifecycle notifications (v2.32.0 decision fan-out, v2.36.0
// decision bells, v2.38.0 on-behalf employee bells) all resolve the
// EMPLOYEE → USER link at fire time. Until now that link could only be
// created by direct database writes (seed/QA scripts) — there was no
// governed surface for it. These service functions close the gap:
//
//   linkPortalAccount   — bind an active User to an Employee (1:1, same store)
//   unlinkPortalAccount — release the binding (Employee.userId → null)
//
// Every call writes a hash-chained hrAudit row. PII discipline: metadata
// carries ids and role labels only — never the user's email or the
// employee's name (docs/EMS_SECURITY_PRIVACY_NOTES.md).

export class PortalLinkError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PortalLinkError';
    this.status = status;
    this.code = code;
  }
}

export interface PortalLinkResult {
  employeeId: string;
  userId: string | null;
  linked: boolean;
  /** True when the request was a no-op because the binding already existed. */
  alreadyInPlace: boolean;
  message: string;
}

async function loadEmployeeForPortalLink(employeeId: string) {
  return db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      storeId: true,
      status: true,
      userId: true,
      user: { select: { id: true, email: true, name: true, role: true, isActive: true, storeId: true } },
    },
  });
}

export async function linkPortalAccount(input: {
  employeeId: string;
  userId: string;
  actorId: string;
  actorRole?: string | null;
}): Promise<PortalLinkResult> {
  const employee = await loadEmployeeForPortalLink(input.employeeId);
  if (!employee) {
    throw new PortalLinkError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }
  if (employee.status === 'TERMINATED') {
    throw new PortalLinkError(
      400,
      'EMPLOYEE_TERMINATED',
      'Portal access cannot be linked to a terminated employee. Restore the employment record first.',
    );
  }

  if (employee.userId === input.userId) {
    return {
      employeeId: employee.id,
      userId: employee.userId,
      linked: true,
      alreadyInPlace: true,
      message: 'This portal account is already linked to the employee.',
    };
  }

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, role: true, isActive: true, storeId: true },
  });
  if (!user) {
    throw new PortalLinkError(404, 'USER_NOT_FOUND', 'Portal user not found.');
  }
  if (!user.isActive) {
    throw new PortalLinkError(400, 'USER_INACTIVE', 'That portal account is deactivated. Reactivate it before linking.');
  }
  // Governed scope rule: the user must belong to the employee's store. A
  // cross-store SUPER_ADMIN sees every store already — linking their account
  // to a store employee would blur personal-employment notifications into an
  // administrative account, so it is refused.
  if (user.storeId !== employee.storeId) {
    throw new PortalLinkError(
      400,
      'STORE_MISMATCH',
      'That portal account belongs to a different store. Pick an account from the employee\'s own store.',
    );
  }

  // 1:1 by schema (Employee.userId @unique) — pre-check so the caller gets a
  // friendly 409 naming the other employee instead of a raw Prisma P2002.
  const clash = await db.employee.findFirst({
    where: { userId: input.userId, id: { not: employee.id }, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, storeId: true },
  });
  if (clash) {
    const otherEmployee = clash.firstName
      ? `${clash.firstName} ${clash.lastName}`
      : 'another employee';
    if (clash.storeId !== employee.storeId) {
      throw new PortalLinkError(
        409,
        'USER_LINKED_ELSEWHERE',
        `That portal account is already linked to ${otherEmployee} in another store.`,
      );
    }
    throw new PortalLinkError(
      409,
      'USER_LINKED_ELSEWHERE',
      `That portal account is already linked to ${otherEmployee}. Unlink it there first.`,
    );
  }

  // Defensive double-check: the employee being re-linked away from an
  // EXISTING different user is allowed (re-link), audited as such.
  const previousUserId = employee.userId;

  await db.employee.update({
    where: { id: employee.id },
    data: { userId: input.userId },
  });

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employee.id,
    storeId: employee.storeId,
    reason: previousUserId ? 'Portal account re-linked.' : 'Portal account linked.',
    metadata: {
      portalLink: 'LINK',
      linkedUserId: input.userId,
      linkedUserRole: user.role,
      previousUserId: previousUserId ?? undefined,
    },
  });

  return {
    employeeId: employee.id,
    userId: input.userId,
    linked: true,
    alreadyInPlace: false,
    message: previousUserId
      ? 'Portal account re-linked. Leave and payroll notifications now reach the new account.'
      : 'Portal account linked. Leave and payroll notifications now reach this employee in the app.',
  };
}

export async function unlinkPortalAccount(input: {
  employeeId: string;
  actorId: string;
  actorRole?: string | null;
}): Promise<PortalLinkResult> {
  const employee = await loadEmployeeForPortalLink(input.employeeId);
  if (!employee) {
    throw new PortalLinkError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found.');
  }
  if (!employee.userId) {
    return {
      employeeId: employee.id,
      userId: null,
      linked: false,
      alreadyInPlace: true,
      message: 'This employee has no linked portal account.',
    };
  }

  await db.employee.update({
    where: { id: employee.id },
    data: { userId: null },
  });

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employee.id,
    storeId: employee.storeId,
    reason: 'Portal account unlinked.',
    metadata: {
      portalLink: 'UNLINK',
      previousUserId: employee.userId,
    },
  });

  return {
    employeeId: employee.id,
    userId: null,
    linked: false,
    alreadyInPlace: false,
    message:
      'Portal account unlinked. The employee will no longer receive in-app leave or payroll notifications.',
  };
}
