// /api/hr/reports/schedules - scheduled HR report email digests (v2.22.0)
//
// GET  → list the organization's schedules (recipients included; PII-light:
//        email addresses only, no employee data).
// POST → create a schedule. Aggregates-only contract unchanged: the digest
//        itself is computed at send time through the governed report service.

import { hrGuard } from '@/lib/hr/guard';
import {
  createSchedule,
  listSchedules,
  toScheduleView,
  HrScheduleError,
} from '@/lib/hr/report-schedule-service';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (_request, session) => {
  const rows = await listSchedules(session.organizationId);
  return Response.json({ success: true, data: rows.map(toScheduleView) });
});

export const POST = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  const body = (await request.json().catch(() => ({}))) as {
    reportKey?: string;
    frequency?: string;
    recipients?: unknown;
    weekday?: number;
    dayOfMonth?: number;
    hourUtc?: number;
    storeId?: string | null;
  };
  try {
    const row = await createSchedule(session.organizationId, session.userId, {
      reportKey: String(body.reportKey ?? ''),
      frequency: String(body.frequency ?? 'WEEKLY'),
      recipients: Array.isArray(body.recipients) ? body.recipients.map(String) : [],
      weekday: body.weekday ?? null,
      dayOfMonth: body.dayOfMonth ?? null,
      hourUtc: body.hourUtc ?? 2,
      storeId: body.storeId ?? null,
    });
    return Response.json({ success: true, data: toScheduleView(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof HrScheduleError) {
      return Response.json({ success: false, error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
});
