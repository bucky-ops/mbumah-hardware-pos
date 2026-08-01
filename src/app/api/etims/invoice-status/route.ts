// GET /api/etims/invoice-status?invoiceNumber=xxx
//
// Query KRA eTIMS for the live status of a previously-submitted invoice.
// Use this to poll for ISSUED → CANCELLED transitions or refresh a FAILED
// row's error message.
//
// Query params:
//   invoiceNumber — required (KRA invoice number, not the internal tx id)
//
// Auth: any authenticated user (cashiers may poll status during a shift).
//
// Flow:
//   1. Look up the SalesTransaction by etimsInvoiceNumber (must belong to store).
//   2. Load the store's EtimsClient.
//   3. Call getInvoiceStatus(invoiceNumber).
//   4. Update SalesTransaction.etimsStatus with the mapped status.
//   5. Return the status response.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { initializeEtimsClientFromStore } from '@/lib/etims-service';

export const dynamic = 'force-dynamic';

async function invoiceStatusHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const invoiceNumber = searchParams.get('invoiceNumber');
  const storeId = searchParams.get('storeId') || session.storeId;

  if (!invoiceNumber) {
    return Response.json(
      { success: false, error: 'invoiceNumber is required.' },
      { status: 400 },
    );
  }
  if (!storeId) {
    return Response.json({ success: false, error: 'storeId is required.' }, { status: 400 });
  }

  // ── 1. Find the SalesTransaction ──────────────────────────────────────────
  const tx = await db.salesTransaction.findFirst({
    where: { etimsInvoiceNumber: invoiceNumber, storeId },
    select: { id: true, receiptNumber: true, etimsStatus: true, etimsInvoiceNumber: true },
  });

  if (!tx) {
    return Response.json(
      { success: false, error: 'No transaction found with that eTIMS invoice number in this store.' },
      { status: 404 },
    );
  }

  // ── 2. Load eTIMS client ──────────────────────────────────────────────────
  const client = await initializeEtimsClientFromStore(storeId);
  if (!client) {
    return Response.json(
      { success: false, error: 'No active KRA business profile for this store.' },
      { status: 400 },
    );
  }

  // ── 3. Query KRA ──────────────────────────────────────────────────────────
  const result = await client.getInvoiceStatus(invoiceNumber);

  // ── 4. Persist status update ──────────────────────────────────────────────
  if (result.success) {
    await db.salesTransaction.update({
      where: { id: tx.id },
      data: { etimsStatus: result.status },
    });
  }

  // ── 5. Audit log ──────────────────────────────────────────────────────────
  await systemLog({
    action: 'ETIMS_INVOICE_STATUS_QUERIED',
    component: LogComponent.PAYMENT,
    severity: LogSeverity.INFO,
    message: `eTIMS status query for ${invoiceNumber} → ${result.status}`,
    userId: session.userId,
    storeId,
    metadata: {
      transactionId: tx.id,
      invoiceNumber,
      status: result.status,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
    },
  });

  return Response.json({
    success: result.success,
    data: {
      invoiceNumber: result.invoiceNumber,
      status: result.status,
      cuPin: result.cuPin,
      referenceNumber: result.referenceNumber,
      transactionId: tx.id,
      receiptNumber: tx.receiptNumber,
    },
    message: result.success
      ? `KRA status: ${result.status}.`
      : `Status query failed: ${result.errorMessage || 'unknown error'}.`,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(invoiceStatusHandler),
  'ETIMS_INVOICE_STATUS',
);
