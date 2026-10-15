// GET /api/self-service/me/reviews - the signed-in employee's own reviews
//     (status and cycle names; the subject sees their own detail separately).

import {
  selfServiceGuard,
  listMyPerformanceReviews,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.performance.read.own')(async (_request, _session, employee) => {
  try {
    return Response.json({ success: true, data: await listMyPerformanceReviews(employee) });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});
