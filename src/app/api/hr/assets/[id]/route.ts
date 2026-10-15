// PATCH /api/hr/assets/[id] - RETURN (condition required) or LOST/DAMAGED
//         (requires a named recovery authorizer distinct from the actor).

import type { NextRequest } from 'next/server';
import { hrGuard, type HrRouteContext } from '@/lib/hr/guard';
import { updateAsset } from '@/lib/hr/asset-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const PATCH = hrGuard('hr.asset.manage')(
  async (request: NextRequest, session, context?: HrRouteContext) => {
    try {
      const { id } = await context!.params;
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return Response.json({ success: true, data: await updateAsset(id, body, session) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
