// GET /api/org/branch-diagnostics/[storeCode] (v2.18.4, audit Finding 3)
//
// Diagnostics for ONE branch, resolved by slug, branch code or store id.
// A miss is a plain 404 ("Branch not found.") that reveals nothing about
// the other stores in the organization.
//
// SECURITY: SUPER_ADMIN and STORE_OWNER only (in-handler requireRole, the
// exact pattern from /api/health/schema). Rate limited per user + client IP
// (30/min). Org-wide reads run inside runWithoutTenant (the kpi-summary
// pattern).
//
// v1 SIMPLIFICATION: the handler reuses computeBranchDiagnostics (the full
// org batch, bounded query budget) and filters to the requested branch
// afterwards instead of issuing a dedicated single-store query path. The
// batch is about ten grouped queries total, so the extra work is bounded;
// a single-store path can replace this when a profile shows the need.

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

interface RouteContext {
  params: Promise<{ storeCode: string }>;
}

async function branchDiagnosticHandler(
  request: NextRequest,
  session: AuthSession,
  context: RouteContext,
): Promise<Response> {
  return runWithoutTenant(async () => {
    const denied = requireConsoleRole(session);
    if (denied) return denied;

    const rl = isRateLimited(
      `branch-diagnostics:${session.userId}:${getClientIp(request)}`,
      { max: 30, windowMs: 60 * 1000 },
    );
    if (rl.limited) {
      return Response.json(
        { success: false, error: 'Too many diagnostics requests. Retry later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    const { storeCode } = await context.params;
    const wanted = (storeCode ?? '').toString().trim().toLowerCase();
    if (!wanted) {
      return Response.json({ success: false, error: 'Branch not found.' }, { status: 404 });
    }

    const requestHost = parseHost(request.headers.get('host'));
    const branches = await computeBranchDiagnostics(requestHost);
    const match = branches.find(
      (b) => b.storeId === storeCode || b.slug === wanted || b.code?.toLowerCase() === wanted,
    );
    if (!match) {
      // 404-safe: the response never lists or hints at other stores.
      return Response.json({ success: false, error: 'Branch not found.' }, { status: 404 });
    }

    return Response.json({ success: true, data: match });
  });
}

export const GET = withErrorBoundary(
  // The route context (params) is Next.js' second handler argument; the auth
  // wrapper forwards it as the third. The cast mirrors the repo pattern used
  // by the other dynamic-param routes (src/app/api/employees/[id]/route.ts).
  requireAuth(branchDiagnosticHandler as (...args: unknown[]) => Promise<Response>),
  LogComponent.API,
);
