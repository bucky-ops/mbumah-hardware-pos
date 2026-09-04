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

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEtimsConfig, initializeEtimsClient } from '@/lib/etims-service';
import { generateInvoiceNumber } from '@/lib/etims-utils';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { isEtimsMock } from '@/lib/etims-service';

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

  const config = getEtimsConfig();
  const client = initializeEtimsClient(config);

  // Per-store daily sequence (F9-2): the previous count was global across all
  // stores and raced under concurrency. Counting this store's transactions
  // issued today keeps the sequence deterministic and scoped; the retry-free
  // window is acceptable because issuance is a rare, user-triggered action —
  // the canonical high-volume path is kra/submit (see audit F9-2 remediation).
  const dayStart = new Date(transaction.createdAt);
  dayStart.setHours(0, 0, 0, 0);
  const invoiceCount = await db.salesTransaction.count({
    where: {
      storeId: transaction.storeId,
      etimsStatus: 'ISSUED',
      createdAt: { gte: dayStart, lte: transaction.createdAt },
    },
  });

  const invoiceNumber = generateInvoiceNumber(
    transaction.store?.code || 'MBM',
    invoiceCount + 1,
    transaction.createdAt
  );

  const response = await client.issueInvoice({
    invoiceNumber,
    date: transaction.createdAt,
    customerTin: transaction.customer?.kraPin || undefined,
    customerName: transaction.customer?.name || 'Walk-in Customer',
    items: transaction.items.map((item) => ({
      itemCode: item.product?.etimsItemCode || 'ITEM00000',
      name: item.product?.name || 'Unknown',
      quantity: Number(item.quantity),
      price: Number(item.pricePerUnit),
      // F9-2: per-line tax rate (was hardcoded 0.16 — zero-rated/exempt lines
      // were over-declared to KRA).
      taxRate: Number(item.taxRate) / 100,
      // F9-2: line discount actually DERIVED (SaleItem stores discountPercent,
      // not discountAmount — the old lookup was always undefined → 0, so
      // discounts were never reported and taxable value was overstated).
      discount: (Number(item.pricePerUnit) * Number(item.quantity) * Number(item.discountPercent || 0)) / 100,
    })),
    payments: [
      {
        method: transaction.paymentMethod,
        amount: Number(transaction.totalAmount),
      },
    ],
    totalAmount: Number(transaction.totalAmount),
    vatAmount: Number(transaction.taxAmount || 0),
  });

  await db.salesTransaction.update({
    where: { id: transactionId },
    data: {
      etimsInvoiceNumber: response.invoiceNumber,
      etimsQrCode: response.qrCode,
      etimsUrl: response.url,
      etimsStatus: response.status,
      etimsIssuedAt: response.issuedAt,
    },
  });

  return NextResponse.json({
    success: true,
    data: response,
  });
}

export const POST = withErrorBoundary(
  withSessionAuth(issueInvoiceHandler, FINANCIAL_ROLES.WRITE),
  'ETIMS_ISSUE_INVOICE'
);
