// GET /api/hr/reports/p10?year=YYYY&format=csv|json
//
// KRA P10 register built FROM STORED POSTED PAYROLL LINES (spec: "P10
// reproduces from stored lines" — nothing is recomputed). CSV responses
// follow the repo export conventions and are audit logged (DATA_EXPORT).

import { hrGuard } from '@/lib/hr/guard';
import { auditP10Export, buildP10, p10ToCSV } from '@/lib/hr/reports';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const yearRaw = url.searchParams.get('year') ?? String(new Date().getUTCFullYear());
    if (!/^\d{4}$/.test(yearRaw)) {
      return Response.json(
        { success: false, error: 'year must be a four-digit year.', code: 'INVALID_YEAR' },
        { status: 400 },
      );
    }
    const year = Number(yearRaw);
    const format = (url.searchParams.get('format') ?? 'json').toLowerCase();

    const p10 = await buildP10(session, year);
    if (!p10) {
      return Response.json(
        { success: false, error: 'You do not have permission to view reports.', code: 'PERMISSION_DENIED' },
        { status: 403 },
      );
    }

    if (format === 'csv') {
      await auditP10Export(session, year, 'csv');
      return new Response(p10ToCSV(p10), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="p10-${year}.csv"`,
        },
      });
    }

    await auditP10Export(session, year, 'json');
    return Response.json({ success: true, data: p10 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
