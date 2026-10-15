// GET  /api/hr/performance/reviews - list reviews (hr.performance.review)
//      Query: ?cycleId=&employeeId=&status=
//      List payloads NEVER contain overallRating / strengths / improvements
//      (EMS spec rule 7 - ratings are sensitive).
// POST /api/hr/performance/reviews - create a draft review (hr.performance.manage)

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { createReview, listReviews } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(async (request: NextRequest, session) => {
  try {
    const url = new URL(request.url);
    const data = await listReviews(session, {
      cycleId: url.searchParams.get('cycleId') ?? undefined,
      employeeId: url.searchParams.get('employeeId') ?? undefined,
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
    return Response.json({ success: true, data: await createReview(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
