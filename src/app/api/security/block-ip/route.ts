// POST /api/security/block-ip - Block an IP address
// DELETE /api/security/block-ip - Unblock an IP address
// Requires SUPER_ADMIN role
//
// AUDIT REMEDIATION (F9-6): the block previously wrote the key
// `*:${ip}:*` into the rate-limit map, but no consumer of isRateLimited()
// ever reads that format (auth/login checks the RAW ip; brute-force writes
// `login:${ip}`) — blocking was a silent no-op. The block is now stored under
// the exact key(s) the Node-runtime checks read, plus a DB-backed SecurityEvent
// so the decision is auditable and visible across serverless instances.
//
// LIMITATION (documented per audit F9-6): the Edge proxy (src/proxy.ts) keeps
// its OWN per-instance in-memory map with compound `${tier}:${ip}:${path}`
// keys and cannot be reached from this Node runtime (no shared memory, and
// Edge cannot import Prisma). Requests already rate-limit-tracked by the
// proxy therefore bypass this block until that map is moved to a shared
// store (Redis/Postgres) — tracked as the F9-5/F9-6 remediation item.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
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

  // AUDIT REMEDIATION (F9-6): store the block under the key format that
  // isRateLimited() consumers actually read — auth/login checks the raw IP
  // (`isRateLimited(ip, 'AUTH')`), so block that key (not `*:${ip}:*`).
  blockKey(ipAddress, durationMs);

  // AUDIT REMEDIATION (F9-6): DB-backed record — the in-memory block is
  // per-instance and dies on cold start; the SecurityEvent row persists and
  // is queryable for audit/forensics across all instances.
  await db.securityEvent.create({
    data: {
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity: 'WARN',
      ipAddress,
      userId: session.userId,
      storeId: session.storeId || undefined,
      resource: '/api/security/block-ip',
      action: 'IP_BLOCKED_MANUAL',
      blocked: true,
      details: JSON.stringify({
        durationMinutes: duration || 60,
        reason: reason || 'Not specified',
        blockedBy: session.email,
      }),
    },
  });

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

  // AUDIT REMEDIATION (F9-6): unblock the same key format the checks read.
  resetRateLimit(ipAddress);

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
