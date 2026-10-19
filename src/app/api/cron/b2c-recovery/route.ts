// GET /api/cron/b2c-recovery - Vercel Cron entry point for the payroll B2C
// auto-recovery sweep (v2.155.0).
//
// Payroll B2C disbursements used to recover ONLY when a manager opened the
// run dialog and clicked "Retry failed" / "Check status" (v2.33.0/v2.34.0).
// This route makes recovery durable: the hourly dispatcher now walks every
// posted/locked run that still holds unpaid money and applies the SAME gate
// arithmetic the UI uses (evaluateB2CRetryGate - exponential backoff 2m→30m,
// attempt ceiling 5, idempotent initiation), so a gate-allowed failure
// re-sends and a stuck PROCESSING transfer re-queries without human
// attendance. Ceil-blocked payslips stay human-only by design.
//
// AUTH: copied EXACTLY from /api/cron/etims-retry (the shared cron-secret
// gate) - fail-open with a WARN systemLog when CRON_SECRET is unset so the
// gap is visible, 403 on a wrong header.

import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogComponent, LogSeverity } from '@/lib/types';
import { sweepStalledPayrollB2C } from '@/lib/hr/payroll/b2c-recovery';

export const dynamic = 'force-dynamic';
// 25 runs/tick, each a handful of indexed queries + at most one Daraja
// round-trip per stalled payslip, fits the 60s serverless budget with
// headroom for Neon cold starts.
export const maxDuration = 60;

async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set - /api/cron/b2c-recovery accepted an unauthenticated request.',
      metadata: { path: '/api/cron/b2c-recovery' },
    });
    return null;
  }

  if (provided !== secret) {
    return Response.json(
      { success: false, error: 'Forbidden: invalid or missing x-cron-secret header.' },
      { status: 403 },
    );
  }

  return null;
}

async function b2cRecoveryHandler(request: Request): Promise<Response> {
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  const summary = await sweepStalledPayrollB2C();
  return Response.json({ success: true, dispatcher: '/api/cron/b2c-recovery', summary });
}

export const GET = withErrorBoundary(b2cRecoveryHandler, LogComponent.SYSTEM);
