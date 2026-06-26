// POST /api/reminders/debt/schedule
//
// Scan the store's overdue DebtLedger rows and create PENDING DebtReminder
// rows for every debt that is due for a reminder (per the escalation rules in
// src/lib/debt-helpers.ts REMINDER_RULES).
//
// This route is the FIRST half of the two-phase reminder pipeline:
//   1. POST /api/reminders/debt/schedule  — cheap, no network calls. Creates
//      PENDING rows based on aging rules + last-reminder timestamps.
//   2. POST /api/reminders/debt/process   — actually sends the messages via
//      SMS/WhatsApp/Email (Twilio/Resend). Network-bound.
//
// Splitting them lets a cron / scheduler run (1) frequently and cheaply, and
// (2) in a separate worker with longer timeouts.
//
// Body:
//   { storeId?: string }  — defaults to the caller's session storeId.
//
// Returns:
//   {
//     success: true,
//     data: ReminderScheduleResult  // { totalEligible, scheduled, skipped, errors, details }
//   }

import { type NextRequest } from 'next/server';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { scheduleReminders } from '@/lib/debt-helpers';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'STORE_MANAGER'];

async function scheduleHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  if (!ALLOWED_ROLES.includes(session.role)) {
    return Response.json(
      {
        success: false,
        error: 'Insufficient permissions. Only managers and admins may schedule debt reminders.',
      },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const storeId =
    (body.storeId as string) || url.searchParams.get('storeId') || session.storeId;

  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const result = await scheduleReminders(storeId);

  await systemLog({
    action: 'DEBT_REMINDERS_SCHEDULED_API',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Debt reminder scheduling run by ${session.email}: ${result.scheduled} scheduled, ${result.skipped} skipped, ${result.errors} errors.`,
    userId: session.userId,
    storeId,
    metadata: {
      totalEligible: result.totalEligible,
      scheduled: result.scheduled,
      skipped: result.skipped,
      errors: result.errors,
    },
  });

  return Response.json({
    success: true,
    data: result,
    message: `Scheduling complete: ${result.scheduled} reminder(s) queued, ${result.skipped} skipped (interval not elapsed), ${result.errors} error(s).`,
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(scheduleHandler),
  'DEBT_REMINDERS_SCHEDULE',
);
