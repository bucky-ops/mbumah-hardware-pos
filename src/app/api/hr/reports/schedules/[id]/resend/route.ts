// GET + POST /api/hr/reports/schedules/[id]/resend - re-send to the
// recipients the latest delivery batch missed (v2.55.0).
//
// GET answers "who would a re-send reach right now?" — read-only, no stamps,
// no audit: the latest batch's honest verdict (SENT/PARTIAL/FAILED/PENDING),
// its historical delivered/total facts, and the narrowed target list
// (batch-failed ∩ CURRENT recipients).
//
// POST performs the re-send: the target set is derived SERVER-SIDE from the
// NotificationLog (never trusted from the client), the digest is recomputed
// fresh through the same governed path as every send, and only the missed
// addresses are emailed — everyone who already received the latest batch is
// never spammed with a second copy. Nothing to re-send is an honest 409
// (NOTHING_TO_RESEND). Cadence untouched (lastRunAt is never written).
//
// Scope rules mirror the schedules service: BRANCH managers may only act on
// their own branch's schedule; org roles may act on any schedule of their
// organization.

import { hrGuard } from '@/lib/hr/guard';
import {
  getScheduleResendInfo,
  resendFailedDigest,
  HrScheduleError,
} from '@/lib/hr/report-schedule-service';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (_request, session, context) => {
    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    try {
      const info = await getScheduleResendInfo(
        session.organizationId,
        { id: session.userId, role: session.role, storeId: session.storeId },
        id,
      );
      return Response.json({ success: true, data: info });
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

export const POST = hrGuard('hr.report.branch', REPORT_ROLES)(
  async (_request, session, context) => {
    const { id } = await (context as { params: Promise<{ id: string }> }).params;
    try {
      const result = await resendFailedDigest(
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
