// PATCH /api/hr/goals/[id] - edit title/target/dueDate/status, or currentValue
//         for MANUAL/CUSTOM goals (POS-sourced values reject typed writes).

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { updateGoal } from '@/lib/hr/goal-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const PATCH = hrGuard('hr.performance.manage')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      const { id } = await context!.params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return Response.json({ success: true, data: await updateGoal(id, body, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
