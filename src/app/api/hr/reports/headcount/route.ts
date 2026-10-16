// GET /api/hr/reports/headcount?from=&to= — headcount report (hr.report.*)

import { hrGuard } from '@/lib/hr/guard';
import { headcountReport, parsePeriod, validateReportStore, resolveReportScope } from '@/lib/hr/reports';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const period = parsePeriod(url.searchParams.get('from'), url.searchParams.get('to'));
    // v2.23.0: optional per-branch drill-down (ORG scope only, fail-closed).
    const scope = resolveReportScope(session);
    const store = await validateReportStore(session, scope, url.searchParams.get('storeId'));
    const data = await headcountReport(session, period, { storeId: store?.id ?? null });
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
