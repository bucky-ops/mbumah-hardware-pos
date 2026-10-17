// GET /api/self-service/me/reviews/[id] - the subject's OWN review detail
//     (v2.87.0). The acknowledgement loop used to be blind: the "My
//     reviews" rows carried only cycle name, status and dates, so an
//     employee acknowledged a review they had never read. This route lets
//     the subject read the rating and narratives on demand (lists still
//     never carry them — the sensitive-data rule holds), and ONLY the
//     subject: the underlying detail service also admits same-store
//     reviewers, so the isSelf check here is the self-service boundary —
//     a manager reads through /api/hr/performance/reviews/[id], never
//     through the employee's portal.

import type { NextRequest } from 'next/server';
import type { AuthSession } from '@/lib/auth';
import type { SelfEmployee } from '@/lib/hr/self-service';
import { selfServiceGuard } from '@/lib/hr/self-service';
import { getReviewDetail } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = selfServiceGuard('hr.performance.read.own')(
  async (_request: NextRequest, session: AuthSession, _employee: SelfEmployee, context?: Ctx) => {
    try {
      // (await context?.params)?.id — no non-null assertion (the lint
      // baseline stays exact); an absent id resolves to '' and the
      // service answers the honest 404.
      const id = (await context?.params)?.id ?? '';
      const data = await getReviewDetail(id, session);
      if (!data.isSelf) {
        return Response.json(
          {
            success: false,
            error: 'Only the reviewed employee reads a review through self-service.',
            code: 'NOT_THE_SUBJECT',
          },
          { status: 403 },
        );
      }
      return Response.json({ success: true, data });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
