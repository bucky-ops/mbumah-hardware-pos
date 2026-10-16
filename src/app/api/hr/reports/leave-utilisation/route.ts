// GET /api/hr/reports/leave-utilisation?year=&storeId=&format=csv
// v2.35.0: per-employee leave entitlement utilisation & liability report.
// Exports (?format=csv) are audit logged (DATA_EXPORT) per the EMS spec.

import { hrGuard } from '@/lib/hr/guard';
import {
  auditLeaveUtilisationExport,
  leaveUtilisationReport,
  leaveUtilisationToCSV,
  validateReportStore,
  resolveReportScope,
} from '@/lib/hr/reports';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

function parseYear(raw: string | null): number {
  const now = new Date().getUTCFullYear();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  // Fail-safe: NaN/absent -> current leave year; absurd values clamp to the
  // plausible range instead of erroring (balances are year-keyed integers).
  if (!Number.isFinite(parsed)) return now;
  return Math.min(2100, Math.max(2000, parsed));
}

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const year = parseYear(url.searchParams.get('year'));
    // v2.23.0: optional per-branch drill-down (ORG scope only, fail-closed).
    const scope = resolveReportScope(session);
    const store = await validateReportStore(session, scope, url.searchParams.get('storeId'));
    const data = await leaveUtilisationReport(session, year, { storeId: store?.id ?? null });
    if (!data) {
      return Response.json(
        { success: false, error: 'You do not have permission to view reports.', code: 'PERMISSION_DENIED' },
        { status: 403 },
      );
    }

    if (url.searchParams.get('format') === 'csv') {
      await auditLeaveUtilisationExport(session, year, 'csv');
      return new Response(leaveUtilisationToCSV(data), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="leave-utilisation-${year}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return Response.json({ success: true, data });
  } catch (error) {
    return toErrorResponse(error);
  }
});
