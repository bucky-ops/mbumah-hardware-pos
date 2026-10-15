// GET   /api/hr/performance/reviews/[id] - full review incl. rating (hr.performance.review)
// PATCH /api/hr/performance/reviews/[id] - UPDATE | SUBMIT | CALIBRATE
//         (ACKNOWLEDGE for the subject runs through /api/self-service/me/reviews/[id]/acknowledge)

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { getReviewDetail, updateReview } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(
  async (_request, session, context?: HrRouteContext) => {
    try {
      const { id } = await context!.params;
      return Response.json({ success: true, data: await getReviewDetail(id, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);

export const PATCH = hrGuard('hr.performance.review')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      const { id } = await context!.params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      if (String(body.action ?? '').toUpperCase() === 'ACKNOWLEDGE') {
        return Response.json(
          {
            success: false,
            error: 'Acknowledgement is the employee\u2019s own action; use the self-service endpoint.',
            code: 'USE_SELF_SERVICE',
          },
          { status: 400 },
        );
      }
      return Response.json({ success: true, data: await updateReview(id, body, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
