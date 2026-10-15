// GET /api/hr/reports/employment-cost?from=&to= — employment cost report

import { hrGuard } from '@/lib/hr/guard';
import { employmentCostReport, parsePeriod } from '@/lib/hr/reports';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get('from'), url.searchParams.get('to'));
    const data = await employmentCostReport(session, period);
    if (!data) {
      return Response.json(
        { success: false, error: 'You do not have permission to view reports.', code: 'PERMISSION_DENIED' },
        { status: 403 },
      );
    }
    return Response.json({ success: true, data: { ...data, period: { from: period.from.toISOString(), to: period.to.toISOString() } } });
  } catch (error) {
    return toErrorResponse(error);
  }
});
