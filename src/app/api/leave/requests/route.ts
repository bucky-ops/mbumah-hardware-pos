// GET  /api/leave/requests - list leave requests for the session store
// POST /api/leave/requests - submit a request (balance-checked)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { requestLeave } from '@/lib/hr/leave-service';

export const dynamic = 'force-dynamic';

const ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'SUPER_ADMIN'] as const;

export const GET = hrGuard('hr.leave.read.branch', ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'])(
  async (_request, session) => {
    const requests = await db.leaveRequest.findMany({
      where: { storeId: session.storeId || '' },
      orderBy: { startDate: 'desc' },
      include: {
        employee: { select: { firstName: true, lastName: true } },
        leaveType: { select: { name: true } },
      },
    });
    return Response.json({ success: true, data: requests });
  },
);

export const POST = hrGuard('hr.leave.request', ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }
    const storeId = session.role === 'SUPER_ADMIN'
      ? (typeof body.storeId === 'string' && body.storeId) || session.storeId || ''
      : session.storeId || '';
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    if (!storeId || !employeeId || typeof body.leaveTypeId !== 'string' || typeof body.startDate !== 'string' || typeof body.endDate !== 'string') {
      return Response.json(
        { success: false, error: 'employeeId, leaveTypeId, startDate, and endDate are required.' },
        { status: 400 },
      );
    }
    try {
      const created = await requestLeave({
        employeeId,
        storeId,
        actorId: session.userId,
        actorRole: session.role,
        leaveTypeId: body.leaveTypeId,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        halfDay: body.halfDay === true,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
        submitterEmail: session.email, // v2.32.0: manager notification footer
      });
      return Response.json({ success: true, data: { id: created.id, workingDays: Number(created.workingDays) } }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit leave request.';
      const status = message.includes('not found') ? 404 : message.includes('PERIOD_MISMATCH') || message.includes('BALANCE') ? 400 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
