// GET    /api/hr/employees/[id] - employee detail (PII masked by default)
// PATCH  /api/hr/employees/[id] - update mutable fields
// DELETE /api/hr/employees/[id] - archive (soft delete)
//
// Unmask: GET accepts ?unmask=1. The parameter is honored ONLY when the
// session role holds hr.employee.unmask.pii; the unmasked read is audit
// logged with the field names exposed, never the values.

import { hrGuard } from '@/lib/hr/guard';
import { archiveEmployee, getEmployeeDetail, updateEmployee } from '@/lib/hr/employee-service';
import { hasHrPermission } from '@/lib/hr/permissions';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

function resolveStore(session: { role: string; storeId: string | null }, explicit?: string | null): string {
  if (session.role === 'SUPER_ADMIN') return explicit || session.storeId || '';
  return session.storeId || '';
}

export const GET = hrGuard('hr.employee.read.own_branch', READ_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const storeId = resolveStore(session, new URL(request.url).searchParams.get('storeId'));
    if (!storeId) {
      return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
    }

    const wantsUnmask = new URL(request.url).searchParams.get('unmask') === '1';
    const mayUnmask = hasHrPermission(session.role, 'hr.employee.unmask.pii');
    const includePii = wantsUnmask && mayUnmask;

    const employee = await getEmployeeDetail(id, storeId, { includePii });
    if (!employee) {
      // Safe 404: no branch-existence leak (docs/EMS_IMPLEMENTATION_GATE.md gate 2).
      return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
    }

    if (includePii) {
      await hrAudit({
        actorId: session.userId,
        actorRole: session.role,
        action: 'READ',
        resourceType: HrEntityType.EMPLOYEE,
        resourceId: id,
        storeId,
        reason: 'PII unmask on employee detail view.',
        metadata: { unmaskedFields: ['nationalId', 'kraPin', 'nssfNumber', 'nhifNumber'] },
      });
    }

    return Response.json({ success: true, data: employee, piiUnmasked: includePii });
  },
);

export const PATCH = hrGuard('hr.employee.update', WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const storeId = resolveStore(session, new URL(request.url).searchParams.get('storeId'));
    if (!storeId) {
      return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const updated = await updateEmployee({
      employeeId: id,
      storeId,
      actorId: session.userId,
      actorRole: session.role,
      data: body,
    });
    if (!updated) {
      return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
    }
    return Response.json({ success: true, data: updated });
  },
);

export const DELETE = hrGuard('hr.employee.archive', WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const storeId = resolveStore(session, new URL(request.url).searchParams.get('storeId'));
    if (!storeId) {
      return Response.json({ success: false, error: 'No store context.' }, { status: 400 });
    }

    const reason =
      new URL(request.url).searchParams.get('reason') || 'Employee archived via HR workspace.';
    const ok = await archiveEmployee(id, storeId, session.userId, session.role, reason);
    if (!ok) {
      return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
    }
    return Response.json({ success: true, data: { id, archived: true } });
  },
);
