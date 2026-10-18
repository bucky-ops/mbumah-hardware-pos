// GET   /api/hr/performance/cycles/[id] - cycle detail (hr.performance.review)
//       v2.94.0: the cycle opens up — meta, its review list (list-item
//       shape, ratings stay out per spec rule 7), and canEditNotes so the
//       drawer offers the form only when the service would accept it.
// PATCH /api/hr/performance/cycles/[id] - ACTIVATE | CLOSE | CALIBRATION_NOTES
//       (hr.performance.manage). CALIBRATION_NOTES (v2.94.0) writes the
//       cycle's calibration notes while the cycle is DRAFT or ACTIVE — a
//       CLOSED cycle is history and refuses new ink (CYCLE_FROZEN).
//       v2.95.0: the drawer drives ACTIVATE/CLOSE too — the detail DTO
//       carries canManageLifecycle and the EMPTY_CYCLE guard's own
//       explanation (lifecycleBlock) so the console explains the 409
//       before it can happen.

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { getCycleDetail, transitionCycle, updateCycleCalibration } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      // [id] routes always receive params — the `as` narrow is honest and
      // warning-free (the non-null assertion pattern costs a lint warning
      // per handler).
      const { id } = await (context as HrRouteContext).params;
      return Response.json({ success: true, data: await getCycleDetail(id, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);

export const PATCH = hrGuard('hr.performance.manage')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      const { id } = await (context as HrRouteContext).params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      const action = String(body.action ?? '').toUpperCase();
      if (action === 'CALIBRATION_NOTES') {
        return Response.json(
          { success: true, data: await updateCycleCalibration(id, body, session) },
        );
      }
      if (action !== 'ACTIVATE' && action !== 'CLOSE') {
        return Response.json(
          { success: false, error: 'action must be ACTIVATE, CLOSE or CALIBRATION_NOTES.', code: 'UNKNOWN_ACTION' },
          { status: 400 },
        );
      }
      return Response.json({ success: true, data: await transitionCycle(id, action, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
