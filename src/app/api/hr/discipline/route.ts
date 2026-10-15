// GET  /api/hr/discipline - list cases (hr.discipline.manage) ?employeeId=&status=&type=
//      List payloads never contain the case description (sensitive data rule).
//      Running the list also lazily expires due warnings.
// POST /api/hr/discipline - open a case (hr.discipline.manage)

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { listCases, openCase } from '@/lib/hr/discipline-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.discipline.manage')(async (request: NextRequest, session) => {
  try {
    const url = new URL(request.url);
    const data = await listCases(session, {
      employeeId: url.searchParams.get('employeeId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
    });
    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export const POST = hrGuard('hr.discipline.manage')(async (request: NextRequest, session) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await openCase(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
