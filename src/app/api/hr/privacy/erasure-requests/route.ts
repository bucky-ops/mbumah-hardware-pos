// GET  /api/hr/privacy/erasure-requests - list (hr.report.branch readers see
//        their branch; decisions reserved to hr.settings.manage)
// POST /api/hr/privacy/erasure-requests - open a request { employeeId, notes? }

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { canDecideErasure, createErasureRequest, listErasureRequests } from '@/lib/hr/data-protection';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const VIEW_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', VIEW_ROLES)(async (request: NextRequest, session) => {
  try {
    const status = new URL(request.url).searchParams.get('status') ?? undefined;
    const requests = await listErasureRequests(session, { status });
    return Response.json({
      success: true,
      data: {
        requests,
        canDecide: canDecideErasure(session.role),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});

export const POST = hrGuard('hr.report.branch', VIEW_ROLES)(async (request: NextRequest, session) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await createErasureRequest(body, session) }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
