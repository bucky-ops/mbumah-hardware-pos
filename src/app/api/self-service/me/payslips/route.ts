// GET /api/self-service/me/payslips - own payslips (?year=YYYY optional)

import type { NextRequest } from 'next/server';
import {
  selfServiceGuard,
  listMyPayslips,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.payroll.read.own')(async (request: NextRequest, _session, employee) => {
  try {
    const yearRaw = new URL(request.url).searchParams.get('year');
    const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined;
    return Response.json({ success: true, data: await listMyPayslips(employee, year) });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});
