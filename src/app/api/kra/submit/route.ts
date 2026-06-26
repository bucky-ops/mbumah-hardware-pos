// POST /api/kra/submit
//
// Submit a sales transaction to KRA eTIMS.
//
// Body:
//   {
//     transactionId: string,   // required — the SalesTransaction to submit
//     dryRun?: boolean,        // optional — if true, returns the mapped payload
//                              //   WITHOUT calling KRA (useful for preview/UI)
//   }
//
// Flow:
//   1. Validate the transaction exists + belongs to the caller's store.
//   2. Load the store's active KraBusinessProfile.
//   3. If an InvoiceForKRA already exists for this transaction:
//        - If status === ACCEPTED → return idempotent "already submitted" response.
//        - If status === SUBMITTED → return "in flight" response.
//        - If status === PENDING/FAILED/REJECTED → retry the submission.
//   4. Otherwise create a new InvoiceForKRA row with status PENDING.
//   5. Map the transaction (with items + customer) to the KraInvoicePayload.
//   6. If dryRun → return the payload + InvoiceForKRA row without calling KRA.
//   7. Otherwise → call kraApiService.submitInvoice.
//   8. Create a KraSubmission audit row capturing the full result.
//   9. Update the InvoiceForKRA row with the result (SUBMITTED/ACCEPTED/FAILED
//      + cuPin + qrCode + lastError + retryCount).
//  10. Return the result.

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import {
  kraApiService,
  SubmissionStatus,
  type KraInvoicePayload,
  type KraInvoiceLineItem,
} from '@/lib/kra-helpers';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'STORE_MANAGER', 'CASHIER'];

/**
 * Map a SalesTransaction + its items to the KRA invoice payload.
 * This is the corrected version of mapTransactionToKraInvoice in
 * kra-helpers.ts (which referenced item.unitPrice / item.discountAmount
 * that don't exist on SaleItem — SaleItem uses pricePerUnit / discountPercent).
 *
 * We keep this local to the route so the helper module can stay stable
 * (Phase 3 code is already committed); the route is the source of truth for
 * the live field mapping.
 */
async function buildKraInvoicePayload(
  transactionId: string,
  businessPin: string,
  sequence: number,
): Promise<{ payload: KraInvoicePayload; customerName: string; customerPin?: string } | null> {
  const tx = await db.salesTransaction.findUnique({
    where: { id: transactionId },
    include: {
      items: true,
      customer: { select: { name: true, idNumber: true } },
    },
  });

  if (!tx) return null;

  const invoiceNumber = kraApiService.generateInvoiceNumber(
    businessPin,
    tx.createdAt,
    sequence,
  );

  const items: KraInvoiceLineItem[] = tx.items.map((item) => {
    const lineTotal = item.lineTotal;
    // SaleItem.taxRate is the per-line VAT rate (default 16%).
    const vatRate = item.taxRate || 16;
    const netAmount = lineTotal / (1 + vatRate / 100);
    const vatAmount = lineTotal - netAmount;
    return {
      // Pull HS code from the related product if available, else default.
      // NOTE: Product.hsCode will be added in a future schema migration. For
      // now, all line items use the KRA default "unclassified" code.
      hsCode: '0000.00.00',
      name: item.productName,
      quantity: item.quantity,
      unitPrice: item.pricePerUnit,
      // SaleItem stores discount as a percent; convert to absolute amount.
      discount: Math.round(((item.pricePerUnit * item.discountPercent) / 100) * item.quantity * 100) / 100,
      vatRate,
      vatAmount: Math.round(vatAmount * 100) / 100,
      total: Math.round(lineTotal * 100) / 100,
    };
  });

  return {
    payload: {
      kraInvoiceNumber: invoiceNumber,
      businessPin,
      issueDate: tx.createdAt.toISOString(),
      customerPin: tx.customer?.idNumber || undefined,
      customerName: tx.customer?.name || 'Walk-in Customer',
      items,
      subtotal: Math.round(tx.subtotal * 100) / 100,
      totalDiscount: Math.round(tx.discountAmount * 100) / 100,
      totalVat: Math.round(tx.taxAmount * 100) / 100,
      totalAmount: Math.round(tx.totalAmount * 100) / 100,
      paymentMethod: tx.paymentMethod,
    },
    customerName: tx.customer?.name || 'Walk-in Customer',
    customerPin: tx.customer?.idNumber,
  };
}

async function submitHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  if (!ALLOWED_ROLES.includes(session.role)) {
    return Response.json(
      { success: false, error: 'Insufficient permissions to submit invoices to KRA.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.transactionId) {
    return Response.json(
      { success: false, error: 'transactionId is required.' },
      { status: 400 },
    );
  }

  const { transactionId, dryRun = false } = body as {
    transactionId: string;
    dryRun?: boolean;
  };

  // Resolve the store — prefer the request body, then the session.
  const url = new URL(request.url);
  const storeId = (body.storeId as string) || url.searchParams.get('storeId') || session.storeId;
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  // ── 1. Validate transaction ──────────────────────────────────────────────
  const tx = await db.salesTransaction.findUnique({
    where: { id: transactionId },
    select: { id: true, storeId: true, receiptNumber: true, createdAt: true },
  });

  if (!tx || tx.storeId !== storeId) {
    return Response.json(
      { success: false, error: 'Transaction not found in this store.' },
      { status: 404 },
    );
  }

  // ── 2. Load the store's active KraBusinessProfile ─────────────────────────
  const profile = await db.kraBusinessProfile.findFirst({
    where: { storeId, isActive: true },
  });

  if (!profile) {
    return Response.json(
      {
        success: false,
        error:
          'No active KRA business profile for this store. Configure one via PUT /api/kra/profile first.',
      },
      { status: 400 },
    );
  }

  // ── 3. Check for an existing InvoiceForKRA row (idempotency) ───────────────
  const existing = await db.invoiceForKRA.findUnique({
    where: { transactionId },
  });

  if (existing) {
    if (existing.submissionStatus === SubmissionStatus.ACCEPTED) {
      return Response.json({
        success: true,
        data: existing,
        message: 'Invoice already accepted by KRA (idempotent — no resubmit).',
      });
    }
    if (existing.submissionStatus === SubmissionStatus.SUBMITTED) {
      return Response.json({
        success: true,
        data: existing,
        message:
          'Invoice is already in SUBMITTED state. Use GET /api/kra/status?invoiceForKraId= to poll for an update.',
      });
    }
    // PENDING / FAILED / REJECTED — fall through and retry.
  }

  // ── 4. Compute sequence (per-store daily invoice count + 1) ────────────────
  // KRA requires a unique sequence per business day per PIN. We derive it from
  // the count of invoices already created today for this profile.
  const dayStart = new Date(tx.createdAt);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const todayCount = await db.invoiceForKRA.count({
    where: {
      storeId,
      createdAt: { gte: dayStart, lt: dayEnd },
    },
  });
  const sequence = todayCount + 1;

  // ── 5. Build the payload ──────────────────────────────────────────────────
  const mapped = await buildKraInvoicePayload(transactionId, profile.businessPin, sequence);
  if (!mapped) {
    return Response.json(
      { success: false, error: 'Failed to map transaction to KRA invoice payload.' },
      { status: 500 },
    );
  }

  // ── 6. Upsert the InvoiceForKRA row ───────────────────────────────────────
  const kraTaxBreakdown = JSON.stringify({
    items: mapped.payload.items,
    subtotal: mapped.payload.subtotal,
    totalDiscount: mapped.payload.totalDiscount,
    totalVat: mapped.payload.totalVat,
    totalAmount: mapped.payload.totalAmount,
  });

  let invoiceForKra;
  if (existing) {
    invoiceForKra = await db.invoiceForKRA.update({
      where: { id: existing.id },
      data: {
        kraTaxBreakdown,
        submissionStatus: SubmissionStatus.PENDING,
        lastError: null,
      },
    });
  } else {
    invoiceForKra = await db.invoiceForKRA.create({
      data: {
        storeId,
        transactionId,
        kraInvoiceNumber: mapped.payload.kraInvoiceNumber,
        kraTaxBreakdown,
        submissionStatus: SubmissionStatus.PENDING,
        retryCount: 0,
      },
    });
  }

  // ── 7. Dry-run short-circuit ───────────────────────────────────────────────
  if (dryRun) {
    return Response.json({
      success: true,
      data: {
        invoiceForKra,
        payload: mapped.payload,
        dryRun: true,
      },
      message: 'Dry-run: payload mapped. No KRA API call was made.',
    });
  }

  // ── 8. Submit to KRA ───────────────────────────────────────────────────────
  const result = await kraApiService.submitInvoice(mapped.payload, profile.id);

  // ── 9. Create the audit KraSubmission row ──────────────────────────────────
  await db.kraSubmission.create({
    data: {
      storeId,
      invoiceForKraId: invoiceForKra.id,
      kraReferenceNumber: result.kraReferenceNumber || null,
      status: result.status,
      responseJson: result.responseJson || null,
      httpStatus: result.httpStatus ?? null,
      latencyMs: result.latencyMs,
      errorMessage: result.errorMessage || null,
      processedAt: new Date(),
    },
  });

  // ── 10. Update the InvoiceForKRA row with the result ───────────────────────
  const updatedInvoice = await db.invoiceForKRA.update({
    where: { id: invoiceForKra.id },
    data: {
      submissionStatus: result.status,
      kraSubmissionId: result.kraReferenceNumber || invoiceForKra.kraSubmissionId,
      cuPin: result.cuPin || invoiceForKra.cuPin,
      qrCode: result.qrCode || invoiceForKra.qrCode,
      submittedAt: result.success ? new Date() : invoiceForKra.submittedAt,
      acceptedAt:
        result.status === SubmissionStatus.ACCEPTED ? new Date() : invoiceForKra.acceptedAt,
      retryCount: { increment: 1 },
      lastError: result.errorMessage || null,
    },
  });

  await systemLog({
    action: result.success ? 'KRA_INVOICE_SUBMITTED_API' : 'KRA_INVOICE_SUBMISSION_FAILED_API',
    component: LogComponent.PAYMENT,
    severity: result.success ? LogSeverity.INFO : LogSeverity.ERROR,
    message: `KRA submission for receipt ${tx.receiptNumber} → ${result.status}${
      result.errorMessage ? ` (${result.errorMessage})` : ''
    }`,
    userId: session.userId,
    storeId,
    metadata: {
      transactionId,
      invoiceForKraId: invoiceForKra.id,
      kraInvoiceNumber: mapped.payload.kraInvoiceNumber,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      status: result.status,
    },
  });

  return Response.json({
    success: result.success,
    data: {
      invoiceForKra: updatedInvoice,
      result,
    },
    message: result.success
      ? `Invoice submitted to KRA. Status: ${result.status}.`
      : `KRA submission failed: ${result.errorMessage || 'unknown error'}.`,
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(submitHandler),
  'KRA_SUBMIT',
);
