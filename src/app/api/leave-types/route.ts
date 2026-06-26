// GET/POST /api/leave-types
//
// Organisation-wide leave type management.
//   GET  — list all leave types (optionally only active)
//   POST — create a new leave type (SUPER_ADMIN / STORE_OWNER only)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth, requireRole } from '@/lib/auth';
import { seedDefaultLeaveTypes } from '@/lib/payroll-helpers';

export const dynamic = 'force-dynamic';

// ── GET: List leave types ────────────────────────────────────────────────────
async function listLeaveTypesHandler(
  request: NextRequest,
  _session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const activeOnly = searchParams.get('active') !== 'false'; // default true

  // Auto-seed defaults if none exist yet (idempotent)
  const count = await db.leaveType.count();
  if (count === 0) {
    await seedDefaultLeaveTypes();
  }

  const where = activeOnly ? { isActive: true } : {};

  const leaveTypes = await db.leaveType.findMany({
    where,
    orderBy: { name: 'asc' },
  });

  const data = leaveTypes.map((lt) => ({
    id: lt.id,
    name: lt.name,
    code: lt.code,
    description: lt.description,
    defaultDaysPerYear: lt.defaultDaysPerYear,
    isPaid: lt.isPaid,
    isStatutory: lt.isStatutory,
    carryForwardAllowed: lt.carryForwardAllowed,
    maxCarryForwardDays: lt.maxCarryForwardDays,
    isActive: lt.isActive,
    createdAt: lt.createdAt.toISOString(),
    updatedAt: lt.updatedAt.toISOString(),
  }));

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  requireAuth(listLeaveTypesHandler),
  'LEAVE_TYPES_LIST'
);

// ── POST: Create a new leave type ────────────────────────────────────────────
async function createLeaveTypeHandler(
  request: NextRequest,
  session: { userId: string; role: string; email: string }
): Promise<Response> {
  // Only admins can create leave types (organisation-wide policy)
  const roleError = requireRole('SUPER_ADMIN', 'STORE_OWNER')(session);
  if (roleError) return roleError;

  const body = await request.json();

  const {
    name, code, description, defaultDaysPerYear, isPaid, isStatutory,
    carryForwardAllowed, maxCarryForwardDays,
  } = body;

  if (!name || !code) {
    return Response.json(
      { success: false, error: 'name and code are required.' },
      { status: 400 }
    );
  }

  // Check unique name + code
  const existing = await db.leaveType.findFirst({
    where: {
      OR: [
        { name: name.trim() },
        { code: code.trim().toUpperCase() },
      ],
    },
    select: { id: true, name: true, code: true },
  });
  if (existing) {
    return Response.json(
      {
        success: false,
        error: `A leave type with ${existing.name === name.trim() ? 'name' : 'code'} "${name.trim()}" already exists.`,
      },
      { status: 409 }
    );
  }

  const leaveType = await db.leaveType.create({
    data: {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description || null,
      defaultDaysPerYear: defaultDaysPerYear || 0,
      isPaid: isPaid !== false,
      isStatutory: isStatutory || false,
      carryForwardAllowed: carryForwardAllowed !== false,
      maxCarryForwardDays: maxCarryForwardDays || 0,
      isActive: true,
    },
  });

  await systemLog({
    action: 'LEAVE_TYPE_CREATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Leave type created: ${leaveType.name} (${leaveType.code}) — ${leaveType.defaultDaysPerYear} days/year`,
    userId: session.userId,
    metadata: { leaveTypeId: leaveType.id, code: leaveType.code },
  });

  return Response.json({ success: true, data: leaveType }, { status: 201 });
}

export const POST = withErrorBoundary(
  requireAuth(createLeaveTypeHandler),
  'LEAVE_TYPES_CREATE'
);
