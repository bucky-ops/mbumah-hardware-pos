// GET /api/self-service/me/attendance - own attendance records + month summary

import type { NextRequest } from 'next/server';
import {
  selfServiceGuard,
  listMyAttendance,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.attendance.record.own')(
  async (request: NextRequest, _session, employee) => {
    try {
      const url = new URL(request.url);
      const data = await listMyAttendance(employee, {
        limit: Number(url.searchParams.get('limit') ?? 30) || 30,
        from: url.searchParams.get('from') ?? undefined,
      });
      return Response.json({ success: true, data });
    } catch (error) {
      return selfServiceErrorResponse(error);
    }
  },
);
