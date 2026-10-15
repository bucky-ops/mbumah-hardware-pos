// POST /api/system/heal - self-heal the engraved bootstrap admin (v2.14.0)
//
// Repairs the engraved admin (create/reactivate/demote-reset), then re-runs
// the Power-On Self-Test so the caller sees the healed state immediately.
//
// Development: allowed WITHOUT auth so local healing works out of the box.
// Production: SUPER_ADMIN only.
// Every invocation writes a tamper-evident AuditLog entry (best-effort: an
// audit write failure never blocks the heal itself).

import { type NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { ensureEngravedAdminExists } from '@/lib/engraved-admin';
import { runPostChecks } from '@/lib/post';
import { auditTrail, AuditAction } from '@/lib/audit-trail';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // v2.18.3.2 (audit Finding 22): system heal runs a full repair + POST scan;
  // cap it per client IP (5/hour) so a looping client cannot turn the heal
  // endpoint into a load tool. Auth still applies on top (production).
  const rl = isRateLimited(`system-heal:${getClientIp(request)}`, {
    max: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (rl.limited) {
    return Response.json(
      { success: false, error: 'Too many heal requests. Retry later.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 3600) } },
    );
  }

  let session: Awaited<ReturnType<typeof getSessionFromRequest>> = null;

  if (process.env.NODE_ENV === 'production') {
    session = await getSessionFromRequest(request).catch(() => null);
    if (!session) {
      return Response.json(
        { success: false, error: 'Authentication required.' },
        { status: 401 }
      );
    }
    if (session.role !== 'SUPER_ADMIN') {
      return Response.json(
        { success: false, error: 'Insufficient permissions.' },
        { status: 403 }
      );
    }
  }

  const admin = await ensureEngravedAdminExists();
  const post = await runPostChecks();

  // Tamper-evident audit entry - best-effort by design.
  try {
    await auditTrail.log({
      actorId: session?.userId,
      actorRole: session?.role,
      action: AuditAction.UPDATE,
      resourceType: 'User',
      resourceId: admin.id ?? admin.email,
      reason: `System self-heal (engraved bootstrap admin): ${admin.reason}`,
      newValues: { created: admin.created, reason: admin.reason, email: admin.email },
      metadata: { postStatus: post.status, durationMs: post.durationMs },
    });
  } catch {
    /* best-effort audit - healing must never be blocked by it */
  }

  return Response.json({
    success: true,
    healed: true,
    admin: { email: admin.email, reason: admin.reason, created: admin.created },
    post,
  });
}
