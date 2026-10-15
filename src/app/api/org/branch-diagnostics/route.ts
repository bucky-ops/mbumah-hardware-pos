// GET /api/org/branch-diagnostics (v2.18.4, audit Finding 3)
//
// Per-branch diagnostics for the organization console: identity, workspace
// href, precise reason code, remediation sentence, schema drift status and
// the cheap operational snapshot (revenue today, transactions, low stock,
// overdue rentals, debt, pending M-Pesa, eTIMS queue, shift state).
//
// SECURITY: SUPER_ADMIN and STORE_OWNER only (in-handler requireRole, the
// exact pattern from /api/health/schema). Rate limited per user + client IP
// (30/min). Org-wide reads run inside runWithoutTenant (the kpi-summary
// pattern); the route is the authorization boundary, the data layer does
// no session checks of its own.

import { type NextRequest } from 'next/server';
import { runWithoutTenant } from '@/lib/db';
import { requireAuth, requireRole, type AuthSession } from '@/lib/auth';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { parseHost } from '@/lib/workspace/config';
import { computeBranchDiagnostics } from '@/lib/org/diagnostics';

export const dynamic = 'force-dynamic';

const requireConsoleRole = requireRole('SUPER_ADMIN', 'STORE_OWNER');

async function branchDiagnosticsHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  return runWithoutTenant(async () => {
    const denied = requireConsoleRole(session);
    if (denied) return denied;

    const rl = isRateLimited(`branch-diagnostics:${session.userId}:${getClientIp(request)}`, {
      max: 30,
      windowMs: 60 * 1000,
    });
    if (rl.limited) {
      return Response.json(
        { success: false, error: 'Too many diagnostics requests. Retry later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    const requestHost = parseHost(request.headers.get('host'));
    const branches = await computeBranchDiagnostics(requestHost);

    return Response.json({ success: true, data: { branches } });
  });
}

export const GET = withErrorBoundary(requireAuth(branchDiagnosticsHandler), LogComponent.API);
