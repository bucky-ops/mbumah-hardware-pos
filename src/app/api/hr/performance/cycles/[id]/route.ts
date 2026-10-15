// PATCH /api/hr/performance/cycles/[id] - ACTIVATE | CLOSE (hr.performance.manage)

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { transitionCycle } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const PATCH = hrGuard('hr.performance.manage')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      const { id } = await context!.params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const action = String(body.action ?? '').toUpperCase();
      if (action !== 'ACTIVATE' && action !== 'CLOSE') {
        return Response.json(
          { success: false, error: 'action must be ACTIVATE or CLOSE.', code: 'UNKNOWN_ACTION' },
          { status: 400 },
        );
      }
      return Response.json({ success: true, data: await transitionCycle(id, action, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
