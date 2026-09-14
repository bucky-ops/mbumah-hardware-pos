// POST /api/etims/issue-invoice — Issue an electronic tax invoice (KRA eTIMS)
// for a sales transaction.
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • SYS-1: the endpoint was a bare `export async function POST` with no
//     wrapper at all — now session-gated with FINANCIAL_ROLES.WRITE.
//   • F9-2 (P0): the etims-service is a MOCK that hardcodes
//     `status: 'ISSUED'` and a fabricated QR. Issuing fake "compliant"
//     tax invoices in production is a Tax Procedures Act violation. The
//     route now HARD-FAILS (503) when the configured client is a mock and
//     ETIMS_ALLOW_MOCK_ISSUANCE !== 'true' — ops must either integrate the
//     real KRA API or explicitly accept mock mode with this flag.
//   • F9-2 payload fixes: per-line tax rate from the SaleItem (the mock sent
//     a hardcoded 0.16 for every line — zero-rated items were over-declared),
//     per-line discount computed from discountPercent (the field read,
//     `discountAmount`, does not exist on SaleItem so discounts were never
//     reported), and the invoice number sequence is scoped per store instead
//     of a global unsynchronised count.
//
// v2.6.0: the submission core (client call + etims-field persistence) moved
// to src/lib/etims-queue.ts `submitEtimsInvoiceOnce` so the async outbox
// queue (/api/cron/etims-retry, /api/etims/worker) and this manual route run
// the EXACT same logic. The route keeps its own pre-checks and response
// bodies so external behaviour is unchanged.

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { isEtimsMock } from '@/lib/etims-service';
import { submitEtimsInvoiceOnce } from '@/lib/etims-queue';

export const dynamic = 'force-dynamic';

async function issueInvoiceHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as Request;
  const body = await request.json();
  const { transactionId } = body;

  if (!transactionId) {
    return NextResponse.json(
      { success: false, error: 'Transaction ID is required' },
      { status: 400 }
    );
  }

  const transaction = await db.salesTransaction.findUnique({
    where: { id: transactionId },
    include: {
      customer: true,
      items: { include: { product: true } },
      store: true,
    },
  });

  if (!transaction) {
    return NextResponse.json(
      { success: false, error: 'Transaction not found' },
      { status: 404 }
    );
  }

  if (transaction.etimsStatus === 'ISSUED') {
    return NextResponse.json(
      { success: false, error: 'Invoice already issued' },
      { status: 400 }
    );
  }

  // F9-2: refuse to mint fake tax invoices in production.
  if (isEtimsMock() && process.env.ETIMS_ALLOW_MOCK_ISSUANCE !== 'true') {
    await systemLog({
      action: 'ETIMS_MOCK_ISSUANCE_BLOCKED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.WARN,
      message: 'eTIMS invoice issuance blocked: the configured KRA client is a mock. Set ETIMS_ALLOW_MOCK_ISSUANCE=true to override (NOT compliant) or integrate the real KRA eTIMS API.',
      storeId: transaction.storeId,
      metadata: { transactionId },
    }).catch(() => {});
    return NextResponse.json(
      {
        success: false,
        error:
          'eTIMS integration is a mock — refusing to issue a tax invoice that was never transmitted to KRA (compliance control). Integrate the real KRA API or set ETIMS_ALLOW_MOCK_ISSUANCE=true to override.',
      },
      { status: 503 }
    );
  }

  // v2.6.0: ONE submission attempt through the shared core (loads the
  // transaction again cross-store-safe, issues via the configured client and
  // persists etimsInvoiceNumber/QrCode/Url/Status/IssuedAt).
  const result = await submitEtimsInvoiceOnce(transactionId);

  if (!result.ok || !result.status) {
    // Parity with the pre-extraction behaviour: an unexpected submission
    // failure escaped as a throw → withErrorBoundary emits the 500.
    throw new Error(result.error || 'eTIMS invoice submission failed');
  }

  return NextResponse.json({
    success: true,
    data: {
      invoiceNumber: result.invoiceNumber,
      qrCode: result.qr,
      url: result.url,
      status: result.status,
      issuedAt: result.issuedAt,
    },
  });
}

export const POST = withErrorBoundary(
  withSessionAuth(issueInvoiceHandler, FINANCIAL_ROLES.WRITE),
  'ETIMS_ISSUE_INVOICE'
);
