// POST /api/hr/goals/recompute-all - recompute every POS-sourced goal in
//        the session's scope in one call (v2.89.0). Values fold from
//        SalesTransaction; statuses flip by the same rule as the single
//        recompute; CLOSED goals keep their status.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { recomputeAllGoals } from '@/lib/hr/goal-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.performance.manage')(async (_request: NextRequest, session) => {
  try {
    return Response.json({ success: true, data: await recomputeAllGoals(session) });
  } catch (error) {
    return toErrorResponse(error);
  }
});
