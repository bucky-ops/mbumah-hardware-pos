// GET /api/hr/discipline/restricted-access — the cross-case restricted-access
// ledger (v2.117.0): who opened (or was denied) restricted records inside a
// clamped window, newest first. Content-free by contract: who, when, which
// case's employee — never the description. Static segment wins over the
// [id] dynamic route, which never saw this path as a case id anyway (a
// restricted-access "case id" would have 404'd CASE_NOT_FOUND before).

import type { NextRequest } from 'next/server';
import { hrGuard } from '@/lib/hr/guard';
import { listRestrictedAccess } from '@/lib/hr/discipline-service';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.discipline.manage')(
  async (request: NextRequest, session) => {
    try {
      const days = request.nextUrl.searchParams.get('days') ?? undefined;
      return Response.json({ success: true, data: await listRestrictedAccess(session, { days }) });
    } catch (error) {
      return toErrorResponse(error);
    }
  },
);
