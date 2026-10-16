// POST/DELETE /api/employees/[id]/portal-link
//
// v2.39.0: the governed surface for binding a portal User account to an
// Employee record. Before this route the employee→user link (which routes
// every personal leave/payroll bell notification — v2.32.0 decision fan-out,
// v2.36.0 decision bells, v2.38.0 on-behalf employee bells) could only be
// created by direct database writes.
//
//   POST   { userId }  — link (or re-link) a portal account
//   DELETE            — unlink (Employee.userId → null)
//
// Security: requireStoreAccess (DB session + tenant scoping) plus an explicit
// role gate mirroring the hr.employee.update permission map — SUPER_ADMIN,
// STORE_OWNER and HR_MANAGER only. Validation and audit live in the service
// (spec rule 15: route handlers never write Employee rows directly); the
// service raises PortalLinkError which this route maps to HTTP responses.

import { type NextRequest } from 'next/server';
import { requireStoreAccess } from '@/lib/auth';
import { linkPortalAccount, unlinkPortalAccount, PortalLinkError } from '@/lib/hr/employee-service';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Same privilege set as hr.employee.update / hr.employee.archive. */
const PORTAL_LINK_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER'] as const;

function roleGate(role: string): Response | null {
  if ((PORTAL_LINK_ROLES as readonly string[]).includes(role)) return null;
  return Response.json(
    {
      success: false,
      error: 'Only store owners, HR managers and super admins can manage portal account links.',
    },
    { status: 403 },
  );
}

function toErrorResponse(e: unknown): Response {
  if (e instanceof PortalLinkError) {
    return Response.json({ success: false, error: e.message, code: e.code }, { status: e.status });
  }
  throw e;
}

async function linkHandler(
  request: NextRequest,
  session: { userId: string; role: string; email: string },
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  const denied = roleGate(session.role);
  if (denied) return denied;

  let body: { userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) {
    return Response.json({ success: false, error: 'userId is required.' }, { status: 400 });
  }

  try {
    const result = await linkPortalAccount({
      employeeId: id,
      userId,
      actorId: session.userId,
      actorRole: session.role,
    });
    await systemLog({
      action: 'EMPLOYEE_PORTAL_LINK',
      component: LogComponent.AUDIT,
      severity: LogSeverity.INFO,
      message: `Portal account ${result.alreadyInPlace ? 'already linked' : 'linked'} for employee ${id}`,
      metadata: { endpoint: '/api/employees/[id]/portal-link', method: 'POST', linkedUserId: userId, alreadyInPlace: result.alreadyInPlace },
      userId: session.userId,
    });
    return Response.json({ success: true, message: result.message, data: result });
  } catch (e) {
    return toErrorResponse(e);
  }
}

async function unlinkHandler(
  _request: NextRequest,
  session: { userId: string; role: string; email: string },
  context: RouteContext
): Promise<Response> {
  const { id } = await context.params;
  const denied = roleGate(session.role);
  if (denied) return denied;

  try {
    const result = await unlinkPortalAccount({
      employeeId: id,
      actorId: session.userId,
      actorRole: session.role,
    });
    await systemLog({
      action: 'EMPLOYEE_PORTAL_UNLINK',
      component: LogComponent.AUDIT,
      severity: LogSeverity.INFO,
      message: `Portal account ${result.alreadyInPlace ? 'already unlinked' : 'unlinked'} for employee ${id}`,
      metadata: { endpoint: '/api/employees/[id]/portal-link', method: 'DELETE' },
      userId: session.userId,
    });
    return Response.json({ success: true, message: result.message, data: result });
  } catch (e) {
    return toErrorResponse(e);
  }
}

export const POST = withErrorBoundary(
  requireStoreAccess(linkHandler as (...args: unknown[]) => Promise<Response>),
  'EMPLOYEES_PORTAL_LINK'
);
export const DELETE = withErrorBoundary(
  requireStoreAccess(unlinkHandler as (...args: unknown[]) => Promise<Response>),
  'EMPLOYEES_PORTAL_UNLINK'
);
