// GET  /api/hr/assets - list asset assignments (hr.asset.manage) ?employeeId=&status=&storeId=&overdue=1
//      v2.114.0: ?storeId= is honored for org-scope roles whose organization
//      owns the store (fail-closed, else silently session-scoped); ?overdue=1
//      mirrors the People & Payroll panel's assetsOverdue count (ASSIGNED,
//      dueReturnOn in the past) so the panel's door lands on the promised
//      number.
// POST /api/hr/assets - assign an asset to an employee (hr.asset.manage)

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { assignAsset, listAssets } from '@/lib/hr/asset-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.asset.manage')(async (request: NextRequest, session) => {
  try {
    const url = new URL(request.url);
    const data = await listAssets(session, {
      employeeId: url.searchParams.get('employeeId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      storeId: url.searchParams.get('storeId') ?? undefined,
      overdue: url.searchParams.get('overdue') === '1',
    });
    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export const POST = hrGuard('hr.asset.manage')(async (request: NextRequest, session) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await assignAsset(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
