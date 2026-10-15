// GET /api/self-service/me - the signed-in employee's own dashboard payload
//     (profile, latest payslips, leave balances, today's attendance, goals).
//     Every field is resolved from the session-linked Employee row; no client
//     parameter can widen the scope (cross-employee denial by construction).

import { selfServiceGuard, getMyDashboard, selfServiceErrorResponse } from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.payroll.read.own')(async (_request, _session, employee) => {
  try {
    return Response.json({ success: true, data: await getMyDashboard(employee) });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});
