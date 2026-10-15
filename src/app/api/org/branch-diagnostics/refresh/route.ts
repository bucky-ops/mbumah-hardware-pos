// POST /api/org/branch-diagnostics/refresh (v2.18.4, audit Finding 3)
//
// Force-refresh variant of GET /api/org/branch-diagnostics: bypasses the
// 60-second module-level schema-probe cache so an operator can re-check a
// suspected drift immediately after running a repair, and writes a
// best-effort ORG_DIAGNOSTICS_REFRESH entry to the SystemLog audit trail.
//
// SECURITY: SUPER_ADMIN and STORE_OWNER only (in-handler requireRole, the
// exact pattern from /api/health/schema). Rate limited STRICTLY per user +
// client IP (6/min) because forceFresh re-runs the database probes on every
// call; a looping client must not be able to turn diagnostics into a load
// tool. Org-wide reads run inside runWithoutTenant (the kpi-summary
// pattern).

import { type NextRequest } from 'next/server';
import { runWithoutTenant } from '@/lib/db';
import { requireAuth, requireRole, type AuthSession } from '@/lib/auth';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogComponent, LogSeverity } from '@/lib/types';
import { parseHost } from '@/lib/workspace/config';
import { computeBranchDiagnostics } from '@/lib/org/diagnostics';

export const dynamic = 'force-dynamic';

const requireConsoleRole = requireRole('SUPER_ADMIN', 'STORE_OWNER');

async function refreshDiagnosticsHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  return runWithoutTenant(async () => {
    const denied = requireConsoleRole(session);
    if (denied) return denied;

    const rl = isRateLimited(
      `branch-diagnostics-refresh:${session.userId}:${getClientIp(request)}`,
      { max: 6, windowMs: 60 * 1000 },
    );
    if (rl.limited) {
      return Response.json(
        { success: false, error: 'Too many refresh requests. Retry in a minute.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    const requestHost = parseHost(request.headers.get('host'));
    const branches = await computeBranchDiagnostics(requestHost, { forceFresh: true });

    // Best-effort audit entry: systemLog already never throws on failure.
    await systemLog({
      userId: session.userId,
      action: 'ORG_DIAGNOSTICS_REFRESH',
      component: LogComponent.API,
      severity: LogSeverity.INFO,
      message: 'Organization branch diagnostics refreshed (schema cache bypassed).',
      metadata: { branchCount: branches.length, host: requestHost || null },
      ipAddress: getClientIp(request),
    });

    return Response.json({ success: true, data: { branches } });
  });
}

export const POST = withErrorBoundary(requireAuth(refreshDiagnosticsHandler), LogComponent.API);
