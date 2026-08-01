// POST /api/etims/cancel-invoice
//
// Cancel an issued eTIMS invoice (KRA credit-note flow). After cancellation,
// the invoice's etimsStatus is updated to CANCELLED and the receipt cannot be
// re-used for verification.
//
// Body:
//   { invoiceNumber: string, reason: string }
//
// Auth: SUPER_ADMIN, STORE_OWNER (managers only — cancellation is a financial
// event that requires approval).
//
// Flow:
//   1. Validate body + role.
//   2. Find the SalesTransaction by etimsInvoiceNumber (must belong to store).
//   3. Refuse if status is not ISSUED (you can't cancel a PENDING/FAILED invoice).
//   4. Load eTIMS client + call cancelInvoice(invoiceNumber, reason).
//   5. Update SalesTransaction.etimsStatus = CANCELLED.
//   6. Return the result.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { initializeEtimsClientFromStore } from '@/lib/etims-service';
import { EtimsInvoiceStatus } from '@/lib/etims-types';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'STORE_OWNER'];

async function cancelInvoiceHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  if (!ALLOWED_ROLES.includes(session.role)) {
    return Response.json(
      { success: false, error: 'Insufficient permissions. Only SUPER_ADMIN and STORE_OWNER may cancel invoices.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.invoiceNumber || !body.reason) {
    return Response.json(
      { success: false, error: 'invoiceNumber and reason are required.' },
      { status: 400 },
    );
  }

  const { invoiceNumber, reason } = body as { invoiceNumber: string; reason: string };
  if (reason.trim().length < 5) {
    return Response.json(
      { success: false, error: 'Cancellation reason must be at least 5 characters.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const storeId = (body.storeId as string) || url.searchParams.get('storeId') || session.storeId;
  if (!storeId) {
    return Response.json({ success: false, error: 'storeId is required.' }, { status: 400 });
  }

  // ── 1. Find the SalesTransaction ──────────────────────────────────────────
  const tx = await db.salesTransaction.findFirst({
    where: { etimsInvoiceNumber: invoiceNumber, storeId },
    select: { id: true, receiptNumber: true, etimsStatus: true },
  });

  if (!tx) {
    return Response.json(
      { success: false, error: 'No transaction found with that eTIMS invoice number in this store.' },
      { status: 404 },
    );
  }

  // ── 2. Status guard ────────────────────────────────────────────────────────
  if (tx.etimsStatus !== EtimsInvoiceStatus.ISSUED) {
    return Response.json(
      {
        success: false,
        error: `Cannot cancel invoice in status "${tx.etimsStatus}". Only ISSUED invoices can be cancelled.`,
      },
      { status: 400 },
    );
  }

  // ── 3. Load eTIMS client ──────────────────────────────────────────────────
  const client = await initializeEtimsClientFromStore(storeId);
  if (!client) {
    return Response.json(
      { success: false, error: 'No active KRA business profile for this store.' },
      { status: 400 },
    );
  }

  // ── 4. Cancel via KRA ─────────────────────────────────────────────────────
  const result = await client.cancelInvoice(invoiceNumber, reason);

  // ── 5. Persist status ─────────────────────────────────────────────────────
  if (result.success) {
    await db.salesTransaction.update({
      where: { id: tx.id },
      data: { etimsStatus: EtimsInvoiceStatus.CANCELLED },
    });
  }

  // ── 6. Audit log ──────────────────────────────────────────────────────────
  await systemLog({
    action: result.success ? 'ETIMS_INVOICE_CANCELLED' : 'ETIMS_INVOICE_CANCEL_FAILED',
    component: LogComponent.PAYMENT,
    severity: result.success ? LogSeverity.WARN : LogSeverity.ERROR,
    message: `eTIMS invoice cancellation for ${invoiceNumber} (receipt ${tx.receiptNumber}): ${result.success ? 'success' : 'failed'} — ${result.cancellationReference || result.errorMessage}`,
    userId: session.userId,
    storeId,
    metadata: {
      transactionId: tx.id,
      invoiceNumber,
      reason,
      cancellationReference: result.cancellationReference,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      errorMessage: result.errorMessage,
    },
  });

  return Response.json({
    success: result.success,
    data: {
      invoiceNumber,
      status: result.status,
      cancellationReference: result.cancellationReference,
      transactionId: tx.id,
      receiptNumber: tx.receiptNumber,
      result,
    },
    message: result.success
      ? `Invoice cancelled. Reference: ${result.cancellationReference}.`
      : `Cancel failed: ${result.errorMessage || 'unknown error'}.`,
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(cancelInvoiceHandler),
  'ETIMS_CANCEL_INVOICE',
);
