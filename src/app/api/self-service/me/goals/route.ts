// GET /api/self-service/me/goals - own goals with progress; POS-sourced goals
//     (SALES_TOTAL / SALES_COUNT) are computed from SalesTransaction on the
//     fly, never typed (spec acceptance rule 2).

import {
  selfServiceGuard,
  listMyGoalProgress,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.performance.read.own')(async (_request, _session, employee) => {
  try {
    return Response.json({ success: true, data: await listMyGoalProgress(employee) });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});
