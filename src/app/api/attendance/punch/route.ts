// POST /api/attendance/punch - replay-safe punch capture (server time authoritative)

import { hrGuard } from '@/lib/hr/guard';
import { punch } from '@/lib/hr/attendance-service';

export const dynamic = 'force-dynamic';

const ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'SUPER_ADMIN'] as const;

export const POST = hrGuard('hr.attendance.record.own', ROLES)(
  async (request, session) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const kind = body.kind === 'OUT' ? 'OUT' : 'IN';
    const storeId = session.role === 'SUPER_ADMIN'
      ? (typeof body.storeId === 'string' && body.storeId) || session.storeId || ''
      : session.storeId || '';
    if (!storeId) return Response.json({ success: false, error: 'No store context.' }, { status: 400 });

    // Self-service resolves to the acting user's employee record unless an
    // HR role punches on behalf of an employee.
    const employeeId = typeof body.employeeId === 'string' ? body.employeeId : '';
    if (!employeeId) {
      return Response.json({ success: false, error: 'employeeId is required.' }, { status: 400 });
    }

    try {
      const result = await punch({
        employeeId,
        storeId,
        actorId: session.userId,
        actorRole: session.role,
        kind,
        idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
        sourceDevice: typeof body.sourceDevice === 'string' ? body.sourceDevice : undefined,
      });
      return Response.json({ success: true, data: { ...result, checkIn: result.checkIn?.toISOString() ?? null, checkOut: result.checkOut?.toISOString() ?? null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Punch failed.';
      const status = message.includes('not found') ? 404 : message.includes('punch IN') ? 409 : 500;
      return Response.json({ success: false, error: message }, { status });
    }
  },
);
