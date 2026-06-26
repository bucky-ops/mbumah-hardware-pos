// POST /api/security/block-ip - Block an IP address
// DELETE /api/security/block-ip - Unblock an IP address
// Requires SUPER_ADMIN role

import { type NextRequest } from 'next/server';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { blockKey, resetRateLimit } from '@/lib/rate-limit';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function blockIPHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const body = await request.json();
  const { ipAddress, duration, reason } = body;

  if (!ipAddress || typeof ipAddress !== 'string') {
    return Response.json({ success: false, error: 'IP address is required.' }, { status: 400 });
  }

  const durationMs = (duration || 60) * 60 * 1000; // Default 1 hour
  blockKey(`*:${ipAddress}:*`, durationMs);

  // Log the action
  await systemLog({
    action: 'IP_BLOCKED_MANUAL',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.WARN,
    message: `IP ${ipAddress} blocked by ${session.email} for ${duration || 60} minutes. Reason: ${reason || 'Not specified'}`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { ipAddress, duration, reason },
  });

  return Response.json({ success: true, data: { ipAddress, blocked: true, durationMinutes: duration || 60 } });
}

async function unblockIPHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const body = await request.json();
  const { ipAddress } = body;

  if (!ipAddress || typeof ipAddress !== 'string') {
    return Response.json({ success: false, error: 'IP address is required.' }, { status: 400 });
  }

  resetRateLimit(`*:${ipAddress}:*`);

  await systemLog({
    action: 'IP_UNBLOCKED_MANUAL',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `IP ${ipAddress} unblocked by ${session.email}`,
    userId: session.userId,
    storeId: session.storeId || undefined,
    metadata: { ipAddress },
  });

  return Response.json({ success: true, data: { ipAddress, blocked: false } });
}

export const POST = withErrorBoundary(
  requireAuth(blockIPHandler, { roles: ['SUPER_ADMIN'] }),
  'SECURITY_BLOCK_IP'
);

export const DELETE = withErrorBoundary(
  requireAuth(unblockIPHandler, { roles: ['SUPER_ADMIN'] }),
  'SECURITY_UNBLOCK_IP'
);
