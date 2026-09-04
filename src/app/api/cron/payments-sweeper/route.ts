// GET /api/cron/payments-sweeper — expire abandoned M-Pesa STK pushes.
//
// AUDIT REFERENCE — FINANCIAL_MODULE_AUDIT_REPORT.md (F6 race atlas / Wave 1):
//   An STK push that is never completed (customer dismissed the prompt, phone
//   offline, wrong PIN) leaves MpesaTransaction rows stuck in 'PENDING' and —
//   for STK-initiated sales — SalesTransaction rows stuck in paymentStatus
//   'PENDING' forever. Safaricom expires the request after ~2 minutes, but
//   the Daraja failure callback can be lost, so nothing closes the loop.
//
// ── IMPORTANT — stock compensation is NOT done here ──────────────────────────
// When Daraja DOES deliver the failure callback, /api/payments/mpesa/callback
// already restores stock and posts the failure journal. This sweeper only
// closes rows whose callbacks never arrive (network loss, callback endpoint
// down, lambda frozen before the callback was recorded). It deliberately
// targets only sales still in paymentStatus 'PENDING' so it can never race a
// callback that already flipped the sale to COMPLETED, and every status flip
// re-asserts the old status in its `where` clause (conditional update — see
// R1 in the audit's race atlas) so a late callback always wins.
//
// SCHEDULE NOTE (Vercel Hobby plan): Hobby clamps crons to a daily minimum —
// the hourly "5 * * * *" expression is accepted syntax and degrades
// gracefully (runs once daily at 00:05 UTC on Hobby).
//
// AUTH: same CRON_SECRET gate as /api/cron/outbox (see that file for the
// full rationale).

import { db, runWithoutTenant } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// STK pushes are expired by Safaricom after ~2 minutes; 10 minutes gives the
// Daraja callback generous room to arrive before we consider it lost.
const STALE_AFTER_MINUTES = 10;
// Bounded batch keeps lambda duration predictable; the next hourly run
// picks up anything left over.
const BATCH_LIMIT = 200;

async function verifyCronSecret(request: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('x-cron-secret');

  if (!secret) {
    await systemLog({
      action: 'CRON_SECRET_UNSET',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.WARN,
      message:
        'CRON_SECRET env var is not set — /api/cron/payments-sweeper accepted an unauthenticated request.',
      metadata: { path: '/api/cron/payments-sweeper' },
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

async function paymentsSweeperHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const denied = await verifyCronSecret(request);
  if (denied) return denied;

  // Cross-tenant by design: the sweeper must see every store's stale rows.
  // runWithoutTenant is the documented escape hatch for org-wide jobs.
  return runWithoutTenant(async () => {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);

    const stale = await db.mpesaTransaction.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
      select: {
        id: true,
        storeId: true,
        checkoutRequestId: true,
        transactionId: true,
        createdAt: true,
      },
    });

    // Only rows linked to a sale that is STILL 'PENDING' are expired. If the
    // sale already moved on (COMPLETED via a late callback, FAILED, or
    // settled at the till), the M-Pesa row is left alone for the callback
    // handler / DLQ flow to reconcile.
    const saleIds = stale
      .map((t) => t.transactionId)
      .filter((id): id is string => Boolean(id));

    const pendingSales = saleIds.length
      ? await db.salesTransaction.findMany({
          where: { id: { in: saleIds }, paymentStatus: 'PENDING' },
          select: { id: true },
        })
      : [];
    const pendingSaleIds = new Set(pendingSales.map((s) => s.id));

    const toExpire = stale.filter(
      (t): t is (typeof t) & { transactionId: string } =>
        Boolean(t.transactionId) && pendingSaleIds.has(t.transactionId as string),
    );

    let cancelled = 0;
    let salesFailed = 0;

    for (const txn of toExpire) {
      // Claim the M-Pesa row with a guarded compare-and-set: count === 0
      // means a Daraja callback flipped the row mid-sweep — it wins, we skip.
      const claimed = await db.mpesaTransaction.updateMany({
        where: { id: txn.id, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          resultDesc: `STK push expired after ${STALE_AFTER_MINUTES}m with no callback (payments-sweeper)`,
        },
      });
      if (claimed.count === 0) continue;
      cancelled++;

      // Flip the linked sale — guarded on paymentStatus 'PENDING' for the
      // same race-safety reason as above.
      const flipped = await db.salesTransaction.updateMany({
        where: { id: txn.transactionId, paymentStatus: 'PENDING' },
        data: { paymentStatus: 'FAILED' },
      });
      salesFailed += flipped.count;

      await systemLog({
        action: 'MPESA_STK_EXPIRED',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.WARN,
        message: `Stale PENDING M-Pesa STK push older than ${STALE_AFTER_MINUTES}m expired by payments-sweeper; linked sale marked FAILED (stock compensation, if the callback later arrives, is owned by the Daraja callback handler).`,
        storeId: txn.storeId,
        metadata: {
          mpesaTransactionId: txn.id,
          checkoutRequestId: txn.checkoutRequestId,
          transactionId: txn.transactionId,
          ageMinutes: Math.round((Date.now() - txn.createdAt.getTime()) / 60_000),
        },
      });
    }

    return Response.json({
      success: true,
      result: {
        examined: stale.length,
        cancelled,
        salesFailed,
        staleAfterMinutes: STALE_AFTER_MINUTES,
        cutoffIso: cutoff.toISOString(),
      },
    });
  });
}

export const GET = withErrorBoundary(paymentsSweeperHandler, LogComponent.PAYMENT);
