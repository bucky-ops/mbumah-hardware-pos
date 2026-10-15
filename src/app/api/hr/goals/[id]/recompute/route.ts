// POST /api/hr/goals/[id]/recompute - recompute a POS-sourced goal
//        (SALES_TOTAL / SALES_COUNT aggregate over the goal window).

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { recomputeGoal } from '@/lib/hr/goal-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.performance.manage')(
  async (_request: NextRequest, session, context?: HrRouteContext) => {
    try {
      const { id } = await context!.params;
      return Response.json({ success: true, data: await recomputeGoal(id, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
