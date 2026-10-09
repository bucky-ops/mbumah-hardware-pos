// POST /api/auth/manager-authorize
//
// v2.12.2 (PR B - RBAC, Task REL-ROADMAP-B1): step-up authorization endpoint
// for the phase-2 Manager PIN/credentials modal. A logged-in user (typically a
// CASHIER at the counter) submits a manager's email + password + a reason and
// receives a durable authorization record in the security feed.
//
// Contract:
//   POST { email, password, reason? }
//     200 { success: true, manager: { id, name, role } }
//     400 validation error
//     401 no session
//     403 { code: 'INVALID_CREDENTIALS' | 'INSUFFICIENT_ROLE' }
//     429 { code: 'BRUTE_FORCE_PIN' } - 3 failed attempts / 5 min / email+ip
//
// The credential verification itself lives in src/lib/manager-auth.ts so the
// transactions route's managerOverride object and this endpoint share ONE
// bcrypt/role/brute-force implementation.
//
// Every outcome is recorded:
//   • success → SecurityEvent INFO 'MANAGER_AUTHORIZED' (in authorizeManager)
//               + hash-chained AuditLog 'MANAGER_AUTHORIZED' w/ reason
//   • failure → typed error (generic copy - never reveals which check failed)
//               + SecurityEvent 'BRUTE_FORCE' when the window trips (in
//               authorizeManager)

import { type NextRequest } from 'next/server';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { validateInput } from '@/lib/validations';
import { z } from 'zod';
import { auditTrail } from '@/lib/audit-trail';
import {
  authorizeManager,
  clientIpFromHeaders,
} from '@/lib/manager-auth';

export const dynamic = 'force-dynamic';

const managerAuthorizeSchema = z.object({
  email: z.string().email('A valid approver email is required'),
  password: z.string().min(1, 'Password is required').max(200),
  reason: z.string().max(500).optional(),
});

async function managerAuthorizeHandler(
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

  const validation = validateInput(managerAuthorizeSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const { email, password, reason } = validation.data;

  const result = await authorizeManager(
    { approverEmail: email, approverPassword: password },
    {
      ip: clientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent') || undefined,
      requesterId: session.userId,
    }
  );

  if (!result.ok) {
    // BRUTE_FORCE_PIN → 429; everything else → 403 with the generic copy
    // (never reveals whether the email or the password was wrong).
    if (result.code === 'BRUTE_FORCE_PIN') {
      return Response.json(
        {
          success: false,
          code: 'BRUTE_FORCE_PIN',
          message: result.message,
          retryAfterMinutes: result.retryAfterMinutes,
        },
        {
          status: 429,
          headers: { 'retry-after': String((result.retryAfterMinutes ?? 1) * 60) },
        }
      );
    }
    return Response.json(
      {
        success: false,
        code: result.code,
        message: result.message,
      },
      { status: 403 }
    );
  }

  // Success: durable AuditLog entry with the business reason
  try {
    await auditTrail.log({
      actorId: session.userId,
      actorRole: session.role,
      action: 'MANAGER_AUTHORIZED',
      resourceType: 'User',
      resourceId: result.manager.id,
      reason: reason ?? undefined,
      storeId: session.storeId || undefined,
      ipAddress: clientIpFromHeaders(request.headers),
      userAgent: request.headers.get('user-agent') || undefined,
      metadata: {
        approverId: result.manager.id,
        approverName: result.manager.name,
        approverEmail: result.manager.email,
        approverRole: result.manager.role,
        requesterEmail: session.email,
        surface: 'manager-authorize-endpoint',
      },
    });
  } catch {
    /* audit logging must never block the authorization response */
  }

  await systemLog({
    action: 'MANAGER_AUTHORIZED',
    component: LogComponent.AUTH,
    severity: LogSeverity.INFO,
    message: `${result.manager.name} (${result.manager.role}) authorized a step-up action for ${session.email}${reason ? ` — reason: ${reason}` : ''}.`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: {
      approverId: result.manager.id,
      approverRole: result.manager.role,
      requesterEmail: session.email,
    },
  }).catch(() => {});

  return Response.json({
    success: true,
    manager: {
      id: result.manager.id,
      name: result.manager.name,
      role: result.manager.role,
    },
  });
}

export const POST = withErrorBoundary(
  requireAuth(managerAuthorizeHandler as (...args: unknown[]) => Promise<Response>),
  'MANAGER_AUTHORIZE'
);
