// GET, PATCH /api/notifications/settings
//
// Per-user email notification preferences. Each authenticated user has
// their own row of toggles on the User model:
//   • emailNotifications — master switch (false = no email at all)
//   • receiptEmails      — receive customer receipt copies
//   • stockAlertEmails   — receive low-stock alerts
//   • reportEmails       — receive daily sales reports
//
// GET returns the current user's settings.
// PATCH updates them — only the four boolean fields above are accepted; any
// other field in the body is silently ignored to prevent mass-assignment
// vulnerabilities.
//
// Auth: any authenticated user (requireAuth with no role restriction).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// The four updatable fields, with strict typing.
interface NotificationSettings {
  emailNotifications: boolean;
  receiptEmails: boolean;
  stockAlertEmails: boolean;
  reportEmails: boolean;
}

// Helper to safely coerce any value to a boolean.
function toBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return null;
}

// ── GET ──────────────────────────────────────────────────────────────────────

async function getSettingsHandler(
  _request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      emailNotifications: true,
      receiptEmails: true,
      stockAlertEmails: true,
      reportEmails: true,
      email: true,
      name: true,
      role: true,
    },
  });

  if (!user) {
    return Response.json(
      { success: false, error: 'User not found.' },
      { status: 404 },
    );
  }

  return Response.json({
    success: true,
    data: {
      emailNotifications: user.emailNotifications,
      receiptEmails: user.receiptEmails,
      stockAlertEmails: user.stockAlertEmails,
      reportEmails: user.reportEmails,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

// ── PATCH ────────────────────────────────────────────────────────────────────

async function patchSettingsHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  // Build the update payload from ONLY the allowed boolean fields.
  const updates: Partial<NotificationSettings> = {};
  const fields: Array<keyof NotificationSettings> = [
    'emailNotifications',
    'receiptEmails',
    'stockAlertEmails',
    'reportEmails',
  ];

  let changedCount = 0;
  for (const field of fields) {
    if (field in body) {
      const value = toBool(body[field]);
      if (value === null) {
        return Response.json(
          {
            success: false,
            error: `Field "${field}" must be a boolean (true/false).`,
          },
          { status: 400 },
        );
      }
      updates[field] = value;
      changedCount++;
    }
  }

  if (changedCount === 0) {
    return Response.json(
      {
        success: false,
        error:
          'No valid fields to update. Provide at least one of: emailNotifications, receiptEmails, stockAlertEmails, reportEmails.',
      },
      { status: 400 },
    );
  }

  const updated = await db.user.update({
    where: { id: session.userId },
    data: updates,
    select: {
      emailNotifications: true,
      receiptEmails: true,
      stockAlertEmails: true,
      reportEmails: true,
    },
  });

  // Best-effort audit log — never block the response on logging.
  void systemLog({
    action: 'NOTIFICATION_SETTINGS_UPDATED',
    component: LogComponent.AUDIT,
    severity: LogSeverity.INFO,
    message: `User ${session.email} updated notification settings: ${Object.keys(updates).join(', ')}`,
    userId: session.userId,
    metadata: { updatedFields: updates },
  }).catch(() => {
    /* logging must never block */
  });

  return Response.json({
    success: true,
    data: updated,
  });
}

export const GET = withErrorBoundary(
  requireAuth(getSettingsHandler),
  'NOTIFICATIONS_SETTINGS_GET',
);

export const PATCH = withErrorBoundary(
  requireAuth(patchSettingsHandler),
  'NOTIFICATIONS_SETTINGS_UPDATE',
);
