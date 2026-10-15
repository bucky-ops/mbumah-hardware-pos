// GET  /api/self-service/me/leave - own balances + requests
// POST /api/self-service/me/leave - submit a leave request (employeeId forced
//      to the session-linked employee; client-supplied ids are ignored).

import type { NextRequest } from 'next/server';
import {
  selfServiceGuard,
  listMyLeave,
  requestMyLeave,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.leave.read.own')(async (_request, _session, employee) => {
  try {
    return Response.json({ success: true, data: await listMyLeave(employee) });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});

export const POST = selfServiceGuard('hr.leave.request')(async (request: NextRequest, session, employee) => {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ success: true, data: await requestMyLeave(employee, session, body) }, { status: 201 });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});
