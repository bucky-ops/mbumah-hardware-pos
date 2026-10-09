// POST /api/access-requests
//
// v2.12.5 (PR B phase 2 - RBAC frontend, Task REL-ROADMAP-B2): the "Request
// Access" action on LockedCard. A user who hits a locked feature tells their
// manager they need it; the request is durably recorded and the right people
// are notified.
//
// Contract:
//   POST { permission, note? }          (permission = FEATURE_PERMISSIONS key)
//     200 { success: true, message }
//     400 validation error / unknown permission key
//     401 no session
//
// Writes:
//   • SecurityEvent(eventType: 'ACCESS_REQUEST', severity: INFO,
//     details: { permission, email, role, note? }) - the durable audit record
//   • Notification rows for EVERY active SUPER_ADMIN + BRANCH_MANAGER of the
//     requester's organization (except the requester themself) - mirrors the
//     phase-1 privilege-abuse lockout notification pattern in src/lib/auth.ts
//   • systemLog INFO breadcrumb
//
// NOTE: no permission is ever GRANTED here - the route only records intent.
// Grants remain an admin action (role change is settings.roles.manage =
// SUPER_ADMIN-only since phase 1).

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { validateInput } from '@/lib/validations';
import { FEATURE_PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const accessRequestSchema = z.object({
  permission: z.string().min(1, 'A permission key is required').max(100),
  note: z.string().max(500).optional(),
});

async function accessRequestHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }

  const validation = validateInput(accessRequestSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const { permission, note } = validation.data;

  // Fail fast on unknown keys - keeps the security feed clean of noise.
  if (!FEATURE_PERMISSIONS[permission]) {
    return Response.json(
      { success: false, error: `Unknown permission key: ${permission}` },
      { status: 400 }
    );
  }

  // Durable security record (SecurityEvent - the feed auditors read).
  try {
    await db.securityEvent.create({
      data: {
        eventType: 'ACCESS_REQUEST',
        severity: 'INFO',
        userId: session.userId,
        storeId: session.storeId || undefined,
        resource: new URL(request.url).pathname,
        action: 'ACCESS_REQUEST',
        details: JSON.stringify({
          permission,
          email: session.email,
          role: session.role,
          ...(note ? { note } : {}),
        }),
        userAgent: request.headers.get('user-agent') || undefined,
        blocked: false,
      },
    });
  } catch {
    /* never block the request on logging */
  }

  // Notify every active SUPER_ADMIN + BRANCH_MANAGER of the org (durable
  // Notification rows - same shape as the phase-1 lockout notifications).
  try {
    const approvers = await db.user.findMany({
      where: {
        role: { in: ['SUPER_ADMIN', 'BRANCH_MANAGER'] },
        isActive: true,
        organizationId: session.organizationId,
        id: { not: session.userId }, // never notify the requester about themself
      },
      select: { id: true },
    });

    if (approvers.length > 0) {
      await db.notification.createMany({
        data: approvers.map((approver) => ({
          userId: approver.id,
          storeId: session.storeId || null,
          title: 'Access request',
          message: `${session.email} (role: ${session.role}) requested access to "${permission}".${note ? ` Note: ${note}` : ''} Review their role in Admin if appropriate.`,
          type: 'INFO',
          category: 'SECURITY',
          priority: 'NORMAL',
          actionUrl: '/dashboard?tab=security',
          actionLabel: 'Review access requests',
          metadata: JSON.stringify({
            kind: 'ACCESS_REQUEST',
            permission,
            requesterId: session.userId,
            requesterEmail: session.email,
            requesterRole: session.role,
            ...(note ? { note } : {}),
          }),
        })),
      });
    }
  } catch {
    /* never block the request on notifications */
  }

  await systemLog({
    action: 'ACCESS_REQUEST',
    component: LogComponent.AUTH,
    severity: LogSeverity.INFO,
    message: `${session.email} (${session.role}) requested access to "${permission}".`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { permission, role: session.role },
  }).catch(() => {});

  return Response.json({
    success: true,
    message: 'Request sent to your Branch Manager',
  });
}

export const POST = withErrorBoundary(
  requireAuth(accessRequestHandler as (...args: unknown[]) => Promise<Response>),
  'ACCESS_REQUESTS'
);
