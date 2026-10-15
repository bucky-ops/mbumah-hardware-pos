// GET  /api/hr/goals - list goals (hr.performance.review)  ?employeeId=&cycleId=&status=
// POST /api/hr/goals - create a goal (hr.performance.manage)

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { createGoal, listGoals } from '@/lib/hr/goal-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(async (request: NextRequest, session) => {
  try {
    const url = new URL(request.url);
    const data = await listGoals(session, {
      employeeId: url.searchParams.get('employeeId') ?? undefined,
      cycleId: url.searchParams.get('cycleId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export const POST = hrGuard('hr.performance.manage')(async (request: NextRequest, session) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await createGoal(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
