// POST /api/hr/leave-balances/adjust
// v2.36.0: governed leave entitlement correction (the OVERDRAWN fix path).
// Body: { balanceId, deltaDays (signed, 0.5d steps), reason (>= 8 chars) }.
// Guarded by hr.leave.balance.manage (HR_MANAGER/STORE_OWNER; SUPER_ADMIN
// bypasses known keys); the service re-checks scope + role fail-closed and
// writes the hash-chained audit event + employee notification.

import { hrGuard } from '@/lib/hr/guard';
import { adjustLeaveBalance } from '@/lib/hr/leave-balance-governance';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const ADJUST_ROUTE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

export const POST = hrGuard('hr.leave.balance.manage', ADJUST_ROUTE_ROLES)(async (request, session) => {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { success: false, error: 'A JSON body is required.', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const rec = (body ?? {}) as Record<string, unknown>;
    const balanceId = typeof rec.balanceId === 'string' ? rec.balanceId : '';
    const deltaDays = typeof rec.deltaDays === 'number' ? rec.deltaDays : Number(rec.deltaDays);
    const reason = typeof rec.reason === 'string' ? rec.reason : '';

    if (!balanceId) {
      return Response.json(
        { success: false, error: 'balanceId is required.', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const outcome = await adjustLeaveBalance(session, { balanceId, deltaDays, reason });
    if (!outcome.ok) {
      const status = outcome.code === 'VALIDATION' ? 400 : outcome.code === 'NOT_FOUND' ? 404 : 403;
      return Response.json({ success: false, error: outcome.error, code: outcome.code }, { status });
    }

    return Response.json({ success: true, data: outcome });
  } catch (error) {
    return toErrorResponse(error);
  }
});
