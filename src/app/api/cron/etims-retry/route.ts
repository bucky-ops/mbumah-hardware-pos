// GET /api/cron/etims-retry — Vercel Cron entry point for the KRA eTIMS
// async invoice queue (v2.6.0).
//
// Sales commit with SalesTransaction.etimsStatus = 'PENDING' and an
// OutboxEvent kind='ETIMS_INVOICE'. Delivery is attempted opportunistically
// by the post-checkout outbox pump (the ETIMS_INVOICE handler is registered
// in src/lib/outbox-handlers.ts); THIS cron is the durable fallback that
// drains events the pump could not deliver (KRA downtime, cold starts) via
// the shared batch runner in src/lib/etims-queue.ts:
//
//   • claims up to 10 due events (status PENDING or FAILED,
//     availableAt <= now) with the outbox worker's guarded compare-and-set,
//   • on success: event COMPLETED + the transaction marked ISSUED,
//   • on failure: attempts+1 with exponential backoff (min(2^n × 60s, 1h)),
//     then DEAD + ERROR systemLog (etimsStatus stays 'PENDING' so staff can
//     re-issue manually via POST /api/etims/worker).
//
// AUTH: copied EXACTLY from /api/cron/outbox — Vercel Cron sends
// unauthenticated GETs; we gate on the `x-cron-secret` header against the
// CRON_SECRET env var (fail-open with a WARN systemLog when CRON_SECRET is
// unset so the gap is visible and alertable — deploy with CRON_SECRET set).

import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';
// A 10-event batch with one KRA round-trip each fits comfortably in 60s,
// leaving headroom for Neon cold starts on a fresh lambda instance.
export const maxDuration = 60;

// ── Shared cron secret gate (verbatim /api/cron/outbox pattern) ─────────────
// Returns a 403 Response when the caller is not authorised, or null to allow
// the request through. Inlined per cron route (cron routes are standalone by
// design — no shared mutable state between schedulers).
async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    // Fail-open is deliberate: Vercel Cron cannot be configured to send a
    // secret per-invocation on all plans, and blocking would stall outbox
    // delivery entirely. The WARN audit trail makes the gap detectable.
    const { systemLog } = await import('@/lib/logger');
    const { LogSeverity } = await import('@/lib/types');
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set — /api/cron/etims-retry accepted an unauthenticated request.',
      metadata: { path: '/api/cron/etims-retry' },
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

async function etimsRetryCronHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  // Lazy-import the queue machinery so a cold invocation that 403s never
  // pays for loading it, and so this route stays independent of the eTIMS
  // internals.
  const { processEtimsRetryBatch } = await import('@/lib/etims-queue');
  const result = await processEtimsRetryBatch();

  return Response.json({
    success: true,
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    dead: result.dead,
  });
}

export const GET = withErrorBoundary(etimsRetryCronHandler, LogComponent.SYSTEM);
