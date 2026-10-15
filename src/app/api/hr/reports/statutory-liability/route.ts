// GET /api/hr/reports/statutory-liability?from=&to= — statutory debt report

import { hrGuard } from '@/lib/hr/guard';
import { parsePeriod, statutoryLiabilityReport } from '@/lib/hr/reports';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get('from'), url.searchParams.get('to'));
    const data = await statutoryLiabilityReport(session, period);
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
