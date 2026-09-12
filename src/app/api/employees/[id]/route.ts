// GET/PATCH/DELETE /api/employees/[id]
//
// EMPLOYEE-CRUD FIX (2026-09-10): until now /api/employees only exposed list +
// create. The Payroll tab's Edit button opened a form that POSTed a DUPLICATE
// employee (the code comment literally said "editing would use
// PUT /api/employees/[id]" — which did not exist), and there was NO way to
// remove/terminate an employee record at all. This route completes the DML
// surface:
//   GET    — one employee with relations + computed tenure
//   PATCH  — edit identity / employment / compensation / status
//   DELETE — SOFT delete: status → TERMINATED + terminationDate = now.
//            Payroll history (PayrollDetail rows) must keep referencing a real
//            employee row, so hard deletes are never offered.
//
// Security: requireStoreAccess (DB session + ORM tenant scoping). Non-admin
// roles can only touch employees of their own store (defense in depth — the
// ORM interceptor already scopes reads/writes, this route re-checks).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import { toDec } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VALID_STATUSES = ['ACTIVE', 'SUSPENDED', 'TERMINATED', 'ON_LEAVE'];
const VALID_ROLES = ['STAFF', 'SUPERVISOR', 'MANAGER', 'CASHIER', 'ACCOUNTANT'];
const VALID_EMPLOYMENT_TYPES = ['PERMANENT', 'CONTRACT', 'CASUAL', 'PROBATION', 'INTERN'];

async function loadEmployee(id: string) {
  return db.employee.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, name: true, role: true } },
      // NOTE: relation is `leaveRequests` on the Employee model — `leaves`
      // does not exist and made PrismaClientValidationError 500 every
      // GET/UPDATE/TERMINATE of an employee.
      _count: { select: { payrollDetails: true, leaveRequests: true } },
    },
  });
}

/** Tenant guard: SUPER_ADMIN anywhere; everyone else own-store only. */
function tenantCheck(
  employeeStoreId: string,
  session: { role: string; storeId: string | null }
): Response | null {
  if (session.role === 'SUPER_ADMIN') return null;
  if (!session.storeId || employeeStoreId !== session.storeId) {
    return Response.json(
      { success: false, error: 'You can only manage employees of your own store.' },
      { status: 403 }
    );
  }
  return null;
}

function serializeEmployee(e: NonNullable<Awaited<ReturnType<typeof loadEmployee>>>) {
  return {
    id: e.id,
    storeId: e.storeId,
    employeeCode: e.employeeCode,
    userId: e.userId,
    firstName: e.firstName,
    lastName: e.lastName,
    fullName: `${e.firstName} ${e.lastName}`,
    email: e.email,
    phone: e.phone,
    nationalId: e.nationalId,
    kraPin: e.kraPin,
    nssfNumber: e.nssfNumber,
    nhifNumber: e.nhifNumber,
    jobTitle: e.jobTitle,
    role: e.role,
    employmentType: e.employmentType,
    hireDate: e.hireDate,
    terminationDate: e.terminationDate,
    status: e.status,
    basicSalary: e.basicSalary,
    hourlyRate: e.hourlyRate,
    houseAllowance: e.houseAllowance,
    transportAllowance: e.transportAllowance,
    medicalAllowance: e.medicalAllowance,
    otherAllowances: e.otherAllowances,
    payeExempt: e.payeExempt,
    nssfExempt: e.nssfExempt,
    nhifExempt: e.nhifExempt,
    bankName: e.bankName,
    bankAccountName: e.bankAccountName,
    bankAccountNumber: e.bankAccountNumber,
    bankBranchCode: e.bankBranchCode,
    emergencyContactName: e.emergencyContactName,
    emergencyContactPhone: e.emergencyContactPhone,
    emergencyContactRelation: e.emergencyContactRelation,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    user: e.user,
    payrollCount: e._count.payrollDetails,
    leaveCount: e._count.leaveRequests,
  };
}

// ── GET: employee detail ─────────────────────────────────────────────────────
async function getEmployeeHandler(
  request: NextRequest,
  session: AuthSession & { email: string },
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  const employee = await loadEmployee(id);
  if (!employee) {
    return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
  }
  const denied = tenantCheck(employee.storeId, session);
  if (denied) return denied;
  return Response.json({ success: true, data: serializeEmployee(employee) });
}

// ── PATCH: update employee (full edit + status transitions) ─────────────────
async function updateEmployeeHandler(
  request: NextRequest,
  session: AuthSession & { email: string },
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const existing = await loadEmployee(id);
  if (!existing) {
    return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
  }
  const denied = tenantCheck(existing.storeId, session);
  if (denied) return denied;

  const data: Record<string, unknown> = {};

  // ── Identity (trimmed strings, null allowed for optionals) ──
  const strFields = [
    'firstName', 'lastName', 'email', 'phone', 'nationalId', 'kraPin',
    'nssfNumber', 'nhifNumber', 'jobTitle', 'photoUrl',
    'bankName', 'bankAccountName', 'bankAccountNumber', 'bankBranchCode',
    'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'notes',
  ] as const;
  for (const f of strFields) {
    if (body[f] !== undefined) {
      const v = typeof body[f] === 'string' ? (body[f] as string).trim() : '';
      if (f === 'firstName' || f === 'lastName') {
        if (v.length < 1) {
          return Response.json({ success: false, error: `${f} cannot be empty.` }, { status: 400 });
        }
        data[f] = v;
      } else {
        data[f] = v || null;
      }
    }
  }

  // ── Email uniqueness (per store) when changing ──
  if (data.email !== undefined && data.email !== null && data.email !== existing.email) {
    const clash = await db.employee.findUnique({
      where: { storeId_email: { storeId: existing.storeId, email: (data.email as string).toLowerCase() } },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      return Response.json(
        { success: false, error: `An employee with email "${data.email}" already exists for this store.` },
        { status: 409 }
      );
    }
    data.email = (data.email as string).toLowerCase();
  }

  // ── Employee staff number (branch-coded, globally unique) ──
  // Accepts a bare suffix ("E012") or a full staff number ("MBM-JUJ-E012").
  if (body.employeeCode !== undefined) {
    if (body.employeeCode === null || body.employeeCode === '') {
      return Response.json(
        { success: false, error: 'employeeCode cannot be removed. Replace it with a new staff number instead.' },
        { status: 400 }
      );
    }
    const raw = String(body.employeeCode).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!/^[A-Z0-9-]{2,20}$/.test(raw)) {
      return Response.json(
        { success: false, error: 'employeeCode must be 2-20 letters/digits/dashes (e.g. "E012" or "MBM-JUJ-E012").' },
        { status: 400 }
      );
    }
    const store = await db.store.findUnique({ where: { id: existing.storeId }, select: { code: true } });
    const normalized = raw.startsWith('MBM-') ? raw : `MBM-${store?.code || 'GEN'}-${raw}`;
    if (normalized !== existing.employeeCode) {
      const clash = await db.employee.findUnique({ where: { employeeCode: normalized }, select: { id: true } });
      if (clash && clash.id !== id) {
        return Response.json(
          { success: false, error: `Employee code "${normalized}" is already in use.` },
          { status: 409 }
        );
      }
      data.employeeCode = normalized;
    }
  }

  // ── Enums ──
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(String(body.role))) {
      return Response.json({ success: false, error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }
    data.role = body.role;
  }
  if (body.employmentType !== undefined) {
    if (!VALID_EMPLOYMENT_TYPES.includes(String(body.employmentType))) {
      return Response.json({ success: false, error: `employmentType must be one of: ${VALID_EMPLOYMENT_TYPES.join(', ')}` }, { status: 400 });
    }
    data.employmentType = body.employmentType;
  }

  // ── Dates ──
  if (body.hireDate !== undefined) {
    const d = new Date(String(body.hireDate));
    if (isNaN(d.getTime())) {
      return Response.json({ success: false, error: 'Invalid hireDate format. Use ISO 8601.' }, { status: 400 });
    }
    data.hireDate = d;
  }

  // ── Compensation (Decimal-safe via toDec; rejects negatives) ──
  const decFields = [
    'basicSalary', 'hourlyRate', 'houseAllowance',
    'transportAllowance', 'medicalAllowance', 'otherAllowances',
  ] as const;
  for (const f of decFields) {
    if (body[f] !== undefined) {
      const n = Number(body[f]);
      if (!Number.isFinite(n) || n < 0) {
        return Response.json({ success: false, error: `${f} must be a non-negative number.` }, { status: 400 });
      }
      data[f] = f === 'hourlyRate' && n === 0 ? null : toDec(n);
    }
  }

  // ── Statutory exemptions ──
  for (const f of ['payeExempt', 'nssfExempt', 'nhifExempt'] as const) {
    if (body[f] !== undefined) data[f] = Boolean(body[f]);
  }

  // ── Status transition (state machine) ──
  let statusChangedTo: string | null = null;
  if (body.status !== undefined && body.status !== existing.status) {
    const next = String(body.status);
    if (!VALID_STATUSES.includes(next)) {
      return Response.json({ success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    // TERMINATED is terminal — a terminated employee cannot be reactivated by
    // accident; reinstate by creating a new record (or explicit reinstatement
    // via status change is still allowed for data corrections).
    if (existing.status === 'TERMINATED' && next !== 'TERMINATED') {
      return Response.json(
        { success: false, error: 'Employee is TERMINATED. Reinstate by editing status back to ACTIVE (data-correction flow).' },
        { status: 409 }
      );
    }
    data.status = next;
    statusChangedTo = next;
    if (next === 'TERMINATED') {
      data.terminationDate = body.terminationDate ? new Date(String(body.terminationDate)) : new Date();
    } else if (next !== 'TERMINATED' && existing.terminationDate && next !== 'TERMINATED') {
      // Leaving TERMINATED-adjacent state clears the termination marker.
      data.terminationDate = null;
    }
  }
  if (body.terminationDate !== undefined && data.status !== 'TERMINATED') {
    const d = body.terminationDate ? new Date(String(body.terminationDate)) : null;
    if (d && isNaN(d.getTime())) {
      return Response.json({ success: false, error: 'Invalid terminationDate format. Use ISO 8601.' }, { status: 400 });
    }
    data.terminationDate = d;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ success: false, error: 'No editable fields provided.' }, { status: 400 });
  }

  const updated = await db.employee.update({
    where: { id },
    data: data as never,
    include: {
      user: { select: { id: true, email: true, name: true, role: true } },
      _count: { select: { payrollDetails: true, leaveRequests: true } },
    },
  });

  await systemLog({
    action: statusChangedTo ? 'EMPLOYEE_STATUS_CHANGED' : 'EMPLOYEE_UPDATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: statusChangedTo
      ? `Employee ${updated.firstName} ${updated.lastName} status: ${existing.status} → ${statusChangedTo} (by ${session.email})`
      : `Employee ${updated.firstName} ${updated.lastName} updated (fields: ${Object.keys(data).join(', ')}) by ${session.email}`,
    storeId: updated.storeId,
    userId: session.userId,
    metadata: { employeeId: id, fields: Object.keys(data), statusChangedTo },
  }).catch(() => {});

  return Response.json({ success: true, data: serializeEmployee(updated) });
}

// ── DELETE: soft delete — TERMINATED + terminationDate (payroll kept) ───────
async function terminateEmployeeHandler(
  request: NextRequest,
  session: AuthSession & { email: string },
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;

  const existing = await loadEmployee(id);
  if (!existing) {
    return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
  }
  const denied = tenantCheck(existing.storeId, session);
  if (denied) return denied;

  if (existing.status === 'TERMINATED') {
    return Response.json(
      { success: false, error: 'Employee is already terminated.' },
      { status: 409 }
    );
  }

  const updated = await db.employee.update({
    where: { id },
    data: { status: 'TERMINATED', terminationDate: new Date() },
    include: {
      user: { select: { id: true, email: true, name: true, role: true } },
      _count: { select: { payrollDetails: true, leaveRequests: true } },
    },
  });

  await systemLog({
    action: 'EMPLOYEE_TERMINATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.WARN,
    message: `Employee ${updated.firstName} ${updated.lastName} terminated (soft delete) by ${session.email}. Payroll history preserved (${updated._count.payrollDetails} payslip rows).`,
    storeId: updated.storeId,
    userId: session.userId,
    metadata: { employeeId: id, previousStatus: existing.status, payrollRows: updated._count.payrollDetails },
  }).catch(() => {});

  return Response.json({
    success: true,
    data: serializeEmployee(updated),
    message: `Employee ${updated.firstName} ${updated.lastName} terminated. Payroll history preserved.`,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getEmployeeHandler as (...args: unknown[]) => Promise<Response>),
  'EMPLOYEES_DETAIL'
);
export const PATCH = withErrorBoundary(
  requireStoreAccess(updateEmployeeHandler as (...args: unknown[]) => Promise<Response>),
  'EMPLOYEES_UPDATE'
);
export const DELETE = withErrorBoundary(
  requireStoreAccess(terminateEmployeeHandler as (...args: unknown[]) => Promise<Response>),
  'EMPLOYEES_TERMINATE'
);
