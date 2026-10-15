// POST /api/attendance/timesheets/approve - approve a day range (gates payroll)

import { hrGuard } from '@/lib/hr/guard';
import { approveTimesheet } from '@/lib/hr/attendance-service';

export const dynamic = 'force-dynamic';

const ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard('hr.attendance.approve.branch', ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }
    if (typeof body.employeeId !== 'string' || typeof body.from !== 'string' || typeof body.to !== 'string') {
      return Response.json({ success: false, error: 'employeeId, from, and to are required.' }, { status: 400 });
    }
    const storeId = session.role === 'SUPER_ADMIN'
      ? (typeof body.storeId === 'string' && body.storeId) || session.storeId || ''
      : session.storeId || '';
    if (!storeId) return Response.json({ success: false, error: 'No store context.' }, { status: 400 });

    const result = await approveTimesheet(
      body.employeeId,
      storeId,
      new Date(body.from),
      new Date(body.to),
      session.userId,
      session.role,
    );
    return Response.json({ success: true, data: result });
  },
);
