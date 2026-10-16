// GET /api/hr/reports/leave-utilisation/drill-down?year=&employeeCode=&typeCode=
// v2.36.0: id-resolving drill-down behind one report row. The report DTO
// keeps "no raw ids"; this correction surface resolves the row inside the
// caller's report scope (fail-closed null, never an existence leak).

import { hrGuard } from '@/lib/hr/guard';
import { leaveBalanceDrillDown } from '@/lib/hr/leave-balance-governance';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const yearRaw = url.searchParams.get('year');
    const year = yearRaw ? Number.parseInt(yearRaw, 10) : NaN;
    const employeeCode = url.searchParams.get('employeeCode') ?? '';
    const typeCode = url.searchParams.get('typeCode') ?? '';

    if (!Number.isFinite(year) || !employeeCode.trim() || !typeCode.trim()) {
      return Response.json(
        { success: false, error: 'year, employeeCode and typeCode are required.', code: 'VALIDATION' },
        { status: 400 },
      );
    }
    const clampedYear = Math.min(2100, Math.max(2000, year));

    const data = await leaveBalanceDrillDown(session, clampedYear, employeeCode, typeCode);
    if (!data) {
      return Response.json(
        { success: false, error: 'Balance not found.', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});
