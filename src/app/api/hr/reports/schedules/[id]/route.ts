// /api/hr/reports/schedules/[id] - manage one HR report schedule (v2.22.0)
//
// PATCH  → edit fields or flip `active` (pause/resume).
// DELETE → soft-delete (audit trail intact; lists exclude the row).
// v2.26.0: both writes carry the actor's role/store so the service can
// enforce the fail-closed schedule scope (BRANCH managers may only manage
// their own branch's schedule — org-wide is out of their scope).

import { hrGuard } from '@/lib/hr/guard';
import {
  deleteSchedule,
  toScheduleView,
  updateSchedule,
  HrScheduleError,
} from '@/lib/hr/report-schedule-service';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const PATCH = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const body = (await request.json().catch(() => ({}))) as {
      reportKey?: string;
      frequency?: string;
      recipients?: unknown;
      weekday?: number | null;
      dayOfMonth?: number | null;
      hourUtc?: number;
      active?: boolean;
      storeId?: string | null;
    };
    try {
      const row = await updateSchedule(
        session.organizationId,
        { id: session.userId, role: session.role, storeId: session.storeId },
        id,
        {
          ...(body.reportKey !== undefined ? { reportKey: String(body.reportKey) } : {}),
          ...(body.frequency !== undefined ? { frequency: String(body.frequency) } : {}),
          ...(Array.isArray(body.recipients) ? { recipients: body.recipients.map(String) } : {}),
          ...(body.weekday !== undefined ? { weekday: body.weekday } : {}),
          ...(body.dayOfMonth !== undefined ? { dayOfMonth: body.dayOfMonth } : {}),
          ...(body.hourUtc !== undefined ? { hourUtc: body.hourUtc } : {}),
          ...(body.storeId !== undefined ? { storeId: body.storeId } : {}),
          ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
        },
      );
      return Response.json({ success: true, data: toScheduleView(row) });
    } catch (error) {
      if (error instanceof HrScheduleError) {
        return Response.json({ success: false, error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  },
);

export const DELETE = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    try {
      await deleteSchedule(
        session.organizationId,
        { id: session.userId, role: session.role, storeId: session.storeId },
        id,
      );
      return Response.json({ success: true, data: { deleted: true } });
    } catch (error) {
      if (error instanceof HrScheduleError) {
        return Response.json({ success: false, error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  },
);
