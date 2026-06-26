// GET /api/kra/status?invoiceForKraId=xxx
//
// Query KRA for the live submission status of an invoice. Use this to poll
// for ACCEPTED/REJECTED transitions after a SUBMITTED response, or to refresh
// a FAILED row's error message.
//
// Flow:
//   1. Load the InvoiceForKRA row (must belong to caller's store).
//   2. Load the store's active KraBusinessProfile.
//   3. If the invoice is already ACCEPTED, short-circuit (no KRA call needed).
//   4. Otherwise call kraApiService.querySubmissionStatus using the cached
//      kraReferenceNumber (kraSubmissionId).
//   5. Create a KraSubmission audit row.
//   6. Update the InvoiceForKRA.submissionStatus + acceptedAt if applicable.
//   7. Return the refreshed InvoiceForKRA row.

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { kraApiService, SubmissionStatus } from '@/lib/kra-helpers';

export const dynamic = 'force-dynamic';

async function statusHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const invoiceForKraId = searchParams.get('invoiceForKraId');

  if (!invoiceForKraId) {
    return Response.json(
      { success: false, error: 'invoiceForKraId is required.' },
      { status: 400 },
    );
  }

  const invoice = await db.invoiceForKRA.findUnique({
    where: { id: invoiceForKraId },
    include: { store: { include: { kraBusinessProfiles: { where: { isActive: true }, take: 1 } } } },
  });

  if (!invoice) {
    return Response.json(
      { success: false, error: 'Invoice not found.' },
      { status: 404 },
    );
  }

  // Cross-store guard: non-SUPER_ADMIN users can only query their own store.
  if (session.role !== 'SUPER_ADMIN' && session.storeId && invoice.storeId !== session.storeId) {
    return Response.json(
      { success: false, error: 'You can only query invoices from your own store.' },
      { status: 403 },
    );
  }

  // Short-circuit if already accepted — no need to query KRA.
  if (invoice.submissionStatus === SubmissionStatus.ACCEPTED) {
    return Response.json({
      success: true,
      data: invoice,
      message: 'Invoice already accepted by KRA (no live query needed).',
    });
  }

  // Need a kraSubmissionId / reference number to poll. If missing, the
  // original submit never returned a reference.
  if (!invoice.kraSubmissionId) {
    return Response.json(
      {
        success: false,
        error:
          'Invoice has no KRA reference number (kraSubmissionId). The original submission likely failed before KRA returned a reference. Retry the submission via POST /api/kra/submit.',
      },
      { status: 400 },
    );
  }

  const profile = invoice.store.kraBusinessProfiles[0];
  if (!profile) {
    return Response.json(
      {
        success: false,
        error:
          'No active KRA business profile for this store. Reconfigure via PUT /api/kra/profile.',
      },
      { status: 400 },
    );
  }

  // Live KRA query.
  const result = await kraApiService.querySubmissionStatus(
    invoice.kraSubmissionId,
    profile.id,
  );

  // Audit row.
  await db.kraSubmission.create({
    data: {
      storeId: invoice.storeId,
      invoiceForKraId: invoice.id,
      kraReferenceNumber: invoice.kraSubmissionId,
      status: result.status,
      responseJson: result.responseJson || null,
      errorMessage: result.errorMessage || null,
      processedAt: new Date(),
    },
  });

  // Update the InvoiceForKRA row.
  const updated = await db.invoiceForKRA.update({
    where: { id: invoice.id },
    data: {
      submissionStatus: result.status,
      acceptedAt:
        result.status === SubmissionStatus.ACCEPTED
          ? new Date()
          : invoice.acceptedAt,
      lastError: result.errorMessage || null,
    },
  });

  await systemLog({
    action: 'KRA_STATUS_QUERIED',
    component: LogComponent.PAYMENT,
    severity: LogSeverity.INFO,
    message: `KRA status query for invoice ${invoice.kraInvoiceNumber} → ${result.status}`,
    userId: session.userId,
    storeId: invoice.storeId,
    metadata: {
      invoiceForKraId: invoice.id,
      kraInvoiceNumber: invoice.kraInvoiceNumber,
      kraReferenceNumber: invoice.kraSubmissionId,
      status: result.status,
    },
  });

  return Response.json({
    success: result.success,
    data: updated,
    message: result.success
      ? `KRA status: ${result.status}.`
      : `KRA status query failed: ${result.errorMessage || 'unknown error'}.`,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(statusHandler),
  'KRA_STATUS',
);
