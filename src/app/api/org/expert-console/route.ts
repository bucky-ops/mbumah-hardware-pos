// GET /api/org/expert-console (v2.18.4, audit Finding 3: expert information)
//
// One role-gated expert snapshot for the organization console: release and
// environment identity, the workspace routing configuration as the server
// sees it, the acting user, an org KPI roll-up with a health label, and the
// per-branch diagnostics from src/lib/org/diagnostics (reason codes,
// remediation, schema drift probes).
//
// SECURITY: SUPER_ADMIN and STORE_OWNER only (in-handler requireRole, the
// exact pattern from /api/health/schema). Rate limited per user + client IP
// (30/min) because the first cold call runs real database probes.
// Org-wide reads run inside runWithoutTenant, the same pattern as
// /api/org/kpi-summary and /api/org/summary.
//
// HEALTH MODEL (v2.18.4): the full engagement-weighted model is private to
// /api/org/kpi-summary, so this endpoint computes a documented simplified
// breakdown from the KPIs it already has (the kpi-summary penalties):
//   overall = 100
//     - stockPenalty   (lowStockCount      > 0 : 2)
//     - debtPenalty    (debtTotal   > 400k     : 10)
//     - rentalsPenalty (overdueRentalsCount > 0 : 2)
//     - mpesaPenalty   (mpesaPendingCount   > 0 : 1)
//   label: overall >= 85 'Good', 70-84 'Fair', below 70 'Attention'.

import { type NextRequest } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, requireRole, type AuthSession } from '@/lib/auth';
import { isRateLimited } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/security';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { parseHost, isHostAllowed } from '@/lib/workspace/config';
import { RELEASE_VERSION } from '@/lib/version';
import { computeBranchDiagnostics, type BranchDiagnostic } from '@/lib/org/diagnostics';

export const dynamic = 'force-dynamic';

const requireConsoleRole = requireRole('SUPER_ADMIN', 'STORE_OWNER');

const WORKSPACE_MODES = ['auto', 'subdomain', 'path', 'off'] as const;

function databaseProvider(): 'sqlite' | 'postgresql' | 'unknown' {
  // Same heuristic as /api/health/schema.
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (databaseUrl.startsWith('file:')) return 'sqlite';
  if (databaseUrl.includes('postgres')) return 'postgresql';
  return 'unknown';
}

function workspaceMode(): (typeof WORKSPACE_MODES)[number] {
  const raw = (process.env.NEXT_PUBLIC_STORE_WORKSPACE_MODE || 'auto').toLowerCase();
  return (WORKSPACE_MODES as readonly string[]).includes(raw)
    ? (raw as (typeof WORKSPACE_MODES)[number])
    : 'auto';
}

function subdomainsEnabled(): boolean {
  const raw = (process.env.NEXT_PUBLIC_USE_SUBDOMAINS || 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function sumKpis(branches: BranchDiagnostic[]) {
  return branches.reduce(
    (acc, b) => ({
      revenueToday: acc.revenueToday + b.revenueToday,
      transactionsToday: acc.transactionsToday + b.transactionsToday,
      lowStockCount: acc.lowStockCount + b.lowStockCount,
      overdueRentalsCount: acc.overdueRentalsCount + b.overdueRentalsCount,
      debtTotal: acc.debtTotal + b.debtTotal,
      mpesaPendingCount: acc.mpesaPendingCount + b.mpesaPendingCount,
    }),
    {
      revenueToday: 0,
      transactionsToday: 0,
      lowStockCount: 0,
      overdueRentalsCount: 0,
      debtTotal: 0,
      mpesaPendingCount: 0,
    },
  );
}

function computeHealth(kpis: ReturnType<typeof sumKpis>) {
  const stockPenalty = kpis.lowStockCount > 0 ? 2 : 0;
  const debtPenalty = kpis.debtTotal > 400_000 ? 10 : 0;
  const rentalsPenalty = kpis.overdueRentalsCount > 0 ? 2 : 0;
  const mpesaPenalty = kpis.mpesaPendingCount > 0 ? 1 : 0;
  const overall = Math.max(0, 100 - stockPenalty - debtPenalty - rentalsPenalty - mpesaPenalty);
  const label = overall >= 85 ? 'Good' : overall >= 70 ? 'Fair' : 'Attention';
  return {
    overall,
    label,
    breakdown: [
      {
        key: 'stock',
        label: 'Stock',
        score: 100 - stockPenalty,
        detail: `${kpis.lowStockCount} low-stock item${kpis.lowStockCount === 1 ? '' : 's'} across the organization (penalty ${stockPenalty})`,
      },
      {
        key: 'debt',
        label: 'Debt',
        score: 100 - debtPenalty,
        detail: `Outstanding KES ${Math.round(kpis.debtTotal).toLocaleString('en-KE')} (penalty ${debtPenalty})`,
      },
      {
        key: 'rentals',
        label: 'Rentals',
        score: 100 - rentalsPenalty,
        detail: `${kpis.overdueRentalsCount} overdue rental${kpis.overdueRentalsCount === 1 ? '' : 's'} (penalty ${rentalsPenalty})`,
      },
      {
        key: 'mpesa',
        label: 'M-Pesa',
        score: 100 - mpesaPenalty,
        detail: `${kpis.mpesaPendingCount} pending transaction${kpis.mpesaPendingCount === 1 ? '' : 's'} (penalty ${mpesaPenalty})`,
      },
    ],
  };
}

async function expertConsoleHandler(request: NextRequest, session: AuthSession): Promise<Response> {
  return runWithoutTenant(async () => {
    const denied = requireConsoleRole(session);
    if (denied) return denied;

    // The diagnostics batch runs real database probes; cap per-user cost
    // (30/min). The key pairs the session user with the client IP so two
    // accounts on one machine do not share a budget.
    const rl = isRateLimited(`expert-console:${session.userId}:${getClientIp(request)}`, {
      max: 30,
      windowMs: 60 * 1000,
    });
    if (rl.limited) {
      return Response.json(
        { success: false, error: 'Too many expert console requests. Retry later.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
      );
    }

    // Port-stripped, lowercased request host (the same normalizer the proxy
    // and the workspace config use). Never trusted for authorization; only
    // used to build safe workspace links and validate the allowlist view.
    const requestHost = parseHost(request.headers.get('host'));

    const branches = await computeBranchDiagnostics(requestHost);
    const kpis = sumKpis(branches);

    let user: {
      id: string;
      name: string | null;
      email: string | null;
      role: string;
      isEngraved: boolean;
      isSystem: boolean;
    };
    try {
      const found = await db.user.findUnique({
        where: { id: session.userId },
        select: { id: true, name: true, email: true, role: true, isEngraved: true, isSystem: true },
      });
      user = found ?? {
        id: session.userId,
        name: null,
        email: session.email,
        role: session.role,
        isEngraved: false,
        isSystem: false,
      };
    } catch {
      user = {
        id: session.userId,
        name: null,
        email: session.email,
        role: session.role,
        isEngraved: false,
        isSystem: false,
      };
    }

    return Response.json({
      success: true,
      data: {
        ok: true,
        generatedAt: new Date().toISOString(),
        version: RELEASE_VERSION,
        environment: process.env.NODE_ENV,
        databaseProvider: databaseProvider(),
        workspace: {
          mode: workspaceMode(),
          currentHost: requestHost,
          rootDomain: (process.env.NEXT_PUBLIC_ROOT_DOMAIN || '').toLowerCase().replace(/\.$/, ''),
          subdomainsEnabled: subdomainsEnabled(),
          allowedHostsValid: requestHost ? isHostAllowed(requestHost) : false,
          trustedForwardedHost: process.env.TRUST_X_FORWARDED_HOST === '1',
        },
        user,
        health: computeHealth(kpis),
        kpis: { ...kpis, branchCount: branches.length },
        branches,
      },
    });
  });
}

export const GET = withErrorBoundary(requireAuth(expertConsoleHandler), LogComponent.API);
