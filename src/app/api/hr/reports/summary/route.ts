// GET /api/hr/reports/summary — org-console HR tiles payload (one call)

import { hrGuard } from '@/lib/hr/guard';
import { hrSummaryForOrgConsole } from '@/lib/hr/reports';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (_request, session) => {
  try {
    const data = await hrSummaryForOrgConsole(session);
    if (!data) {
      return Response.json(
        { success: false, error: 'You do not have permission to view reports.', code: 'PERMISSION_DENIED' },
        { status: 403 },
      );
    }
    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});
