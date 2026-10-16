// POST /api/hr/reports/schedules/[id]/send-now - manual on-demand digest
// (v2.24.0).
//
// Sends the schedule's aggregate-only digest immediately WITHOUT touching
// the schedule's cadence (lastRunAt untouched - a manual send is not a
// schedule fire). Scope rules mirror the schedules service: BRANCH managers
// may only send their own branch's schedule; org roles may send any
// schedule of their organization. The actor always receives an in-app
// notification-center copy with the digest headline + delivery status, so
// the flow is usable even where email delivery is not configured.

import { hrGuard } from '@/lib/hr/guard';
import { sendScheduleNow, HrScheduleError } from '@/lib/hr/report-schedule-service';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const POST = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (_request, session, context) => {
    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    try {
      const result = await sendScheduleNow(
        session.organizationId,
        { id: session.userId, role: session.role, storeId: session.storeId },
        id,
      );
      return Response.json({ success: true, data: result });
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
