// GET  /api/leave/balances?employeeId=... - balances for one employee
// POST /api/leave/balances - grant allocation (hr.leave.balance.manage)

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { grantBalance, recomputeAllBalancesForYear } from '@/lib/hr/leave-service';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE'] as const;
const GRANT_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const GET = hrGuard('hr.leave.read.own', READ_ROLES)(
  async (request, _session) => {
    const employeeId = new URL(request.url).searchParams.get('employeeId') || '';
    const year = Number(new URL(request.url).searchParams.get('year')) || new Date().getUTCFullYear();
    if (!employeeId) return Response.json({ success: false, error: 'employeeId is required.' }, { status: 400 });
    const balances = await db.employeeLeaveBalance.findMany({
      where: { employeeId, leaveYear: year },
      include: { leaveType: { select: { name: true } } },
    });
    return Response.json({ success: true, data: balances });
  },
);

export const POST = hrGuard('hr.leave.balance.manage', GRANT_ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }
    if (typeof body.employeeId !== 'string' || typeof body.leaveTypeId !== 'string' || typeof body.allocatedDays !== 'number') {
      return Response.json({ success: false, error: 'employeeId, leaveTypeId, and allocatedDays are required.' }, { status: 400 });
    }
    const year = typeof body.year === 'number' ? body.year : new Date().getUTCFullYear();
    await grantBalance(
      body.employeeId,
      session.storeId || '',
      session.userId,
      session.role,
      body.leaveTypeId,
      year,
      body.allocatedDays,
      typeof body.carryForwardDays === 'number' ? body.carryForwardDays : undefined,
    );
    await recomputeAllBalancesForYear(body.employeeId, year);
    return Response.json({ success: true, data: { granted: true, year } });
  },
);
