// GET /api/hr/goals/deleted - the bench (v2.93.0): soft-deleted goals in
// scope, newest deletion first. Static segment (Next.js prefers it over
// [id], which has no GET) so the two never collide. Manage-guarded: the
// bench is a manager's surface — reviewers read the live board only.

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { listDeletedGoals } from '@/lib/hr/goal-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.manage')(async (_request: NextRequest, session) => {
  try {
    const data = await listDeletedGoals(session);
    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});
