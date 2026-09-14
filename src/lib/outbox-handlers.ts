// Outbox handler registry — wires event kinds to delivery implementations.
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md (F8-4):
//   Imported once by the cron pump route (/api/cron/outbox) and by any
//   opportunistically-pumping caller, so every kind has a live handler.
//
// Server-only module.

import { registerOutboxHandler } from '@/lib/outbox';
import { initiateStkPush } from '@/lib/mpesa-daraja';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

let registered = false;

/** Idempotent registration of all outbox event handlers. */
export function ensureOutboxHandlers(): void {
  if (registered) return;
  registered = true;

  // MPESA_STK_PUSH — the checkout flow enqueues this INSIDE its transaction
  // (F6-2). Delivery re-uses the shared Daraja core; the outbox retries with
  // backoff if Safaricom is unreachable.
  registerOutboxHandler('MPESA_STK_PUSH', async ({ payload }) => {
    const phone = String(payload.phoneNumber ?? payload.phone ?? '');
    const amount = Number(payload.amount ?? 0);
    if (!phone || !amount) throw new Error('MPESA_STK_PUSH payload missing phone/amount');
    await initiateStkPush({
      phone,
      amount,
      accountReference: payload.accountReference ? String(payload.accountReference) : undefined,
      transactionDesc: payload.transactionDesc ? String(payload.transactionDesc) : undefined,
      storeId: payload.storeId ? String(payload.storeId) : undefined,
      transactionId: payload.transactionId ? String(payload.transactionId) : undefined,
    });
  });

  // ETIMS_INVOICE (v2.6.0) — checkout enqueues this right after the sale
  // commits (SalesTransaction.etimsStatus = 'PENDING'). The shared core in
  // src/lib/etims-queue.ts performs ONE KRA submission attempt; the pump's
  // backoff/dead-letter semantics apply on failure, and the dedicated retry
  // cron (/api/cron/etims-retry) is the durable fallback. Registration here
  // is REQUIRED — without it pumpOutbox would fail every ETIMS_INVOICE event
  // with "No outbox handler registered" and dead-letter real tax invoices.
  registerOutboxHandler('ETIMS_INVOICE', async ({ payload }) => {
    const { submitEtimsInvoiceOnce } = await import('@/lib/etims-queue');
    const transactionId = String(payload.transactionId ?? '');
    if (!transactionId) throw new Error('ETIMS_INVOICE payload missing transactionId');
    const result = await submitEtimsInvoiceOnce(transactionId);
    if (!result.ok) throw new Error(result.error || 'eTIMS invoice submission failed');
  });

  // AUDIT_ALERT — reserved for reconciliation findings surfaced to ops (F6-6).
  registerOutboxHandler('AUDIT_ALERT', async ({ payload }) => {
    await systemLog({
      action: 'RECONCILIATION_ALERT',
      component: LogComponent.FINANCIAL,
      severity: String(payload.severity ?? LogSeverity.WARN) as LogSeverity,
      message: String(payload.message ?? 'Reconciliation alert'),
      storeId: payload.storeId ? String(payload.storeId) : undefined,
      metadata: payload,
    }).catch(() => {});
  });
}
