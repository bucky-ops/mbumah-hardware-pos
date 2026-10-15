// POST /api/self-service/me/reviews/[id]/acknowledge - the reviewed employee
//      acknowledges their own SUBMITTED review. The service enforces that the
//      session's linked employee is the review subject (403 otherwise).

import type { NextRequest } from 'next/server';
import type { AuthSession } from '@/lib/auth';
import type { SelfEmployee } from '@/lib/hr/self-service';
import { selfServiceGuard } from '@/lib/hr/self-service';
import { updateReview } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const POST = selfServiceGuard('hr.performance.read.own')(
  async (_request: NextRequest, session: AuthSession, _employee: SelfEmployee, context?: Ctx) => {
    try {
      const { id } = await context!.params;
      const data = await updateReview(id, { action: 'ACKNOWLEDGE' }, session);
      return Response.json({ success: true, data });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
