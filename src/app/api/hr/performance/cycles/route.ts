// GET  /api/hr/performance/cycles - list review cycles (hr.performance.review)
// POST /api/hr/performance/cycles - create a cycle (hr.performance.manage)

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { createCycle, listCycles } from '@/lib/hr/performance-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(async (_request, session) => {
  try {
    return Response.json({ success: true, data: await listCycles(session) });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export const POST = hrGuard('hr.performance.manage')(async (request: NextRequest, session) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await createCycle(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
