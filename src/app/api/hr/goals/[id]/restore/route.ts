// POST /api/hr/goals/[id]/restore - undo a soft delete (v2.93.0): clears
// deletedAt so the goal rejoins every list with the values it left with.
// Manage-guarded like the delete itself; the service refuses goals that
// were never deleted (GOAL_NOT_DELETED) and audits GOAL_RESTORED.

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { restoreGoal } from '@/lib/hr/goal-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.performance.manage')(
  async (_request: NextRequest, session, context?: HrRouteContext) => {
    try {
      // [id] routes always receive params — an `as` keeps the type narrow
      // without the non-null-assertion lint warning (v2.92 convention).
      const { id } = await (context as HrRouteContext).params;
      return Response.json({ success: true, data: await restoreGoal(id, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
