// GET /api/hr/reports/schedules/[id]/preview - dry-run digest preview
// (v2.25.0).
//
// Computes exactly what the schedule's next digest email would contain —
// through the same governed report functions and fail-closed scope as a
// real send — WITHOUT sending email, writing any log/notification, or
// touching lastRunAt/lastStatus. Pure read: safe to call repeatedly.
// Scope rules mirror the schedules service: BRANCH managers may only
// preview their own branch's schedule; org roles may preview any schedule
// of their organization.

import { hrGuard } from '@/lib/hr/guard';
import { previewScheduleDigest, HrScheduleError } from '@/lib/hr/report-schedule-service';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (_request, session, context) => {
    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    try {
      const preview = await previewScheduleDigest(
        session.organizationId,
        { id: session.userId, role: session.role, storeId: session.storeId },
        id,
      );
      return Response.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof HrScheduleError) {
        return Response.json(
          { success: false, error: error.message, code: error.code },
          { status: error.status },
        );
      }
      throw error;
    }
  },
);
