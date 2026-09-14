// POST /api/etims/worker — staff-triggered manual batch runner for the KRA
// eTIMS async invoice queue (v2.6.0).
//
// Runs ONE batch of the shared processor (src/lib/etims-queue.ts
// processEtimsRetryBatch) so staff can retry stuck invoices on demand from
// the UI — e.g. after a DEAD event, or when the cron is paused:
//   • claims up to 10 due ETIMS_INVOICE outbox events (PENDING/FAILED,
//     availableAt <= now) with the guarded compare-and-set claim,
//   • one KRA submission attempt per event via submitEtimsInvoiceOnce,
//   • COMPLETED / FAILED(+backoff) / DEAD per event.
//
// The response includes per-item results (event id, transaction id, receipt
// number, ok/error) — no secrets. Cross-store scope is intentional: the
// runner processes events from ALL stores (manager-gated; see the
// runWithoutTenant note in etims-queue.ts).

import { withErrorBoundary } from '@/lib/logger';
import { withSessionAuth, MANAGER_PLUS_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function etimsWorkerHandler(): Promise<Response> {
  const { processEtimsRetryBatch } = await import('@/lib/etims-queue');
  const result = await processEtimsRetryBatch();

  return Response.json({
    success: true,
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    dead: result.dead,
    results: result.results,
  });
}

export const POST = withErrorBoundary(
  withSessionAuth(etimsWorkerHandler, MANAGER_PLUS_ROLES),
  'ETIMS_WORKER'
);
