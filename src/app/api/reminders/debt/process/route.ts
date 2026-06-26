// POST /api/reminders/debt/process
//
// Process all PENDING DebtReminder rows for a store: actually send the
// messages via the appropriate channel (SMS/WhatsApp via Twilio, Email via
// Resend). This is the SECOND half of the two-phase reminder pipeline.
//
// Network-bound — each PENDING reminder results in 1 outbound HTTP call to a
// provider. We process in batches of 100 to avoid timeouts. Failed sends are
// recorded with the provider's error message and can be retried by re-running
// this route (the row's status is FAILED, not PENDING, so re-running won't
// auto-retry — use POST /api/reminders/debt/retry for that, or update the
// row's status back to PENDING via a future admin route).
//
// Body:
//   { storeId?: string }  — defaults to the caller's session storeId.
//
// Returns:
//   { success: true, data: { sent, failed, total } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { processPendingDebtReminders } from '@/lib/notification-helpers';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'STORE_MANAGER'];

async function processHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  if (!ALLOWED_ROLES.includes(session.role)) {
    return Response.json(
      {
        success: false,
        error: 'Insufficient permissions. Only managers and admins may process debt reminders.',
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

  // Quick pre-check: how many are pending? If zero, short-circuit.
  const pendingCount = await db.debtReminder.count({
    where: { storeId, status: 'PENDING' },
  });

  if (pendingCount === 0) {
    return Response.json({
      success: true,
      data: { sent: 0, failed: 0, total: 0 },
      message: 'No pending reminders to process.',
    });
  }

  const result = await processPendingDebtReminders(storeId);

  await systemLog({
    action: 'DEBT_REMINDERS_PROCESSED_API',
    component: LogComponent.FINANCIAL,
    severity: result.failed > 0 ? LogSeverity.WARN : LogSeverity.INFO,
    message: `Debt reminder processing run by ${session.email}: ${result.sent} sent, ${result.failed} failed (of ${result.total} pending).`,
    userId: session.userId,
    storeId,
    metadata: result,
  });

  return Response.json({
    success: true,
    data: result,
    message: `Processing complete: ${result.sent} sent, ${result.failed} failed (of ${result.total} pending).`,
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(processHandler),
  'DEBT_REMINDERS_PROCESS',
);
