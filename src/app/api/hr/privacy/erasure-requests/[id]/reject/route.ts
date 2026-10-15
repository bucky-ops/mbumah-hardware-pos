// POST /api/hr/privacy/erasure-requests/[id]/reject - reject the erasure with
//        a recorded decision reason and legal basis (both mandatory).

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { canDecideErasure, rejectErasureRequest } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const POST = hrGuard('hr.report.branch')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      if (!canDecideErasure(session.role)) {
        return Response.json(
          {
            success: false,
            error: 'Only settings managers (SUPER_ADMIN) can decide erasure requests.',
            code: 'DECISION_FORBIDDEN',
          },
          { status: 403 },
        );
      }
      const { id } = await context!.params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return Response.json({
        success: true,
        data: await rejectErasureRequest(id, session, String(body.notes ?? ''), String(body.legalBasis ?? '')),
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
