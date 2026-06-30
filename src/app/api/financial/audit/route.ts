// GET /api/financial/audit
//
// Runs a comprehensive financial integrity audit. This endpoint is
// admin-only (SUPER_ADMIN or MANAGER with financial permissions) and is used
// by:
//   • The nightly cron job (scheduled via Vercel Cron)
//   • The admin "Financial Audit" tab (manual trigger)
//   • The period-close workflow
//
// Query params:
//   storeId   — scope audit to a single store (SUPER_ADMIN only). Omit for org-wide.
//   dateFrom  — ISO date, start of audit range (default: 30 days ago)
//   dateTo    — ISO date, end of audit range (default: now)
//
// Returns an AuditResult with all issues found. CRITICAL issues are logged
// to SystemLog automatically by the audit module.

import { type NextRequest } from 'next/server';
import { runFinancialAudit } from '@/lib/financial-audit';
import { runWithoutTenant, runWithTenant } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function handler(...args: unknown[]): Promise<Response> {
  const req = args[0] as NextRequest;
  const { searchParams } = new URL(req.url);

  const storeId = searchParams.get('storeId') || undefined;
  const dateFromParam = searchParams.get('dateFrom');
  const dateToParam = searchParams.get('dateTo');

  const dateFrom = dateFromParam ? new Date(dateFromParam) : undefined;
  const dateTo = dateToParam ? new Date(dateToParam) : undefined;

  // Validate date params
  if (dateFromParam && isNaN(dateFrom?.getTime() ?? NaN)) {
    return Response.json(
      { success: false, error: 'Invalid dateFrom. Use ISO 8601 format.' },
      { status: 400 },
    );
  }
  if (dateToParam && isNaN(dateTo?.getTime() ?? NaN)) {
    return Response.json(
      { success: false, error: 'Invalid dateTo. Use ISO 8601 format.' },
      { status: 400 },
    );
  }

  // Run the audit. If a storeId is provided, run within that tenant context.
  // If no storeId (org-wide, SUPER_ADMIN only), run without tenant filtering.
  const auditFn = () => runFinancialAudit(storeId, dateFrom, dateTo);

  const result = storeId
    ? await runWithTenant(storeId, auditFn)
    : await runWithoutTenant(auditFn);

  // Return 200 even if issues are found — the audit itself succeeded; the
  // issues are data, not an HTTP error. Callers check `result.passed`.
  const statusCode = result.passed ? 200 : 200; // Always 200; issues are in the body.

  return Response.json(
    {
      success: true,
      data: result,
    },
    { status: statusCode },
  );
}

export const GET = withErrorBoundary(
  withFinancialAuth(handler, FINANCIAL_ROLES.AUDIT),
  LogComponent.FINANCIAL,
);
