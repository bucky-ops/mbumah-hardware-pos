// GET /api/hr/reports/schedules/[id]/deliveries - per-schedule delivery
// history (v2.25.0).
//
// Returns the last HR_REPORT_DIGEST NotificationLog rows correlated to this
// schedule via metadata.scheduleId — the durable record the central email
// service writes on every send (scheduled sweep + manual "send now").
// Read-only: no stamps, no audit. Scope rules mirror the schedules service:
// BRANCH managers may only read their own branch's schedule; org roles may
// read any schedule of their organization.

import { hrGuard } from '@/lib/hr/guard';
import { listScheduleDeliveries, HrScheduleError } from '@/lib/hr/report-schedule-service';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (request, session, context) => {
    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    try {
      const limitParam = new URL(request.url).searchParams.get('limit');
      const rows = await listScheduleDeliveries(
        session.organizationId,
        { id: session.userId, role: session.role, storeId: session.storeId },
        id,
        limitParam ? Number(limitParam) : 10,
      );
      return Response.json({ success: true, data: rows });
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
