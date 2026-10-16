// /api/hr/reports/schedules/[id] - manage one HR report schedule (v2.22.0)
//
// PATCH  → edit fields or flip `active` (pause/resume).
// DELETE → soft-delete (audit trail intact; lists exclude the row).

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
  async (request, _session, context?: { params: Promise<{ id: string }> }) => {
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
      const row = await updateSchedule(_session.organizationId, _session.userId, id, {
        ...(body.reportKey !== undefined ? { reportKey: String(body.reportKey) } : {}),
        ...(body.frequency !== undefined ? { frequency: String(body.frequency) } : {}),
        ...(Array.isArray(body.recipients) ? { recipients: body.recipients.map(String) } : {}),
        ...(body.weekday !== undefined ? { weekday: body.weekday } : {}),
        ...(body.dayOfMonth !== undefined ? { dayOfMonth: body.dayOfMonth } : {}),
        ...(body.hourUtc !== undefined ? { hourUtc: body.hourUtc } : {}),
        ...(body.storeId !== undefined ? { storeId: body.storeId } : {}),
        ...(typeof body.active === 'boolean' ? { active: body.active } : {}),
      });
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
      await deleteSchedule(session.organizationId, session.userId, id);
      return Response.json({ success: true, data: { deleted: true } });
    } catch (error) {
      if (error instanceof HrScheduleError) {
        return Response.json({ success: false, error: error.message, code: error.code }, { status: error.status });
      }
      throw error;
    }
  },
);
