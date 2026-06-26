// GET /api/customers/[id]/history
//
// Returns a customer's full history as a unified, chronological timeline
// plus summary stats. Pulls from SalesTransactions, Invoices,
// CustomerCredits, GiftCardRedemptions (via GiftCard.issuedTo),
// VoucherRedemptions (via redeemedBy), DebtPayments (via DebtLedger),
// DeliveryNotes. The CustomerInteraction model is not present in the
// current Prisma schema, so it is intentionally omitted.
//
// RBAC: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, ACCOUNTANT.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

type TimelineEntry =
  | {
      type: 'SALE';
      id: string;
      timestamp: string;
      ref: string;
      amount: number;
      paymentMethod: string;
      paymentStatus: string;
      itemCount: number;
    }
  | {
      type: 'INVOICE';
      id: string;
      timestamp: string;
      ref: string;
      amount: number;
      status: string;
      invoiceType: string;
      itemCount: number;
    }
  | {
      type: 'CREDIT';
      id: string;
      timestamp: string;
      ref: string;
      amount: number;
      creditType: string;
      status: string;
      description: string | null;
    }
  | {
      type: 'GIFT_CARD_REDEMPTION';
      id: string;
      timestamp: string;
      ref: string;
      amount: number;
      giftCardCode: string;
    }
  | {
      type: 'VOUCHER_REDEMPTION';
      id: string;
      timestamp: string;
      ref: string;
      discountAmount: number;
      voucherCode: string;
    }
  | {
      type: 'DEBT_PAYMENT';
      id: string;
      timestamp: string;
      ref: string;
      amount: number;
      paymentMethod: string;
    }
  | {
      type: 'DELIVERY_NOTE';
      id: string;
      timestamp: string;
      ref: string;
      status: string;
      deliveryAddress: string | null;
    };

interface CustomerHistorySummary {
  totalSpent: number;
  outstandingDebt: number;
  lastVisit: string | null;
  loyaltyPoints: number;
  transactionCount: number;
  avgOrderValue: number;
  invoiceCount: number;
  outstandingInvoices: number;
  creditsTotal: number;
  deliveryNotesCount: number;
}

async function customerHistoryHandler(
  _request: NextRequest,
  _session: AuthSession,
  ...rest: unknown[]
): Promise<Response> {
  const context = rest[0] as RouteContext;
  const customerId = (await context.params).id;

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      storeId: true,
      currentDebtBalance: true,
      debtLimit: true,
      loyaltyPoints: true,
      createdAt: true,
    },
  });

  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 },
    );
  }

  // Run all lookups in parallel
  const [
    transactions,
    invoices,
    customerCredits,
    giftCardRedemptions,
    voucherRedemptions,
    debtPayments,
    deliveryNotes,
  ] = await Promise.all([
    db.salesTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        receiptNumber: true,
        totalAmount: true,
        paymentMethod: true,
        paymentStatus: true,
        createdAt: true,
        items: { select: { id: true } },
      },
    }),
    db.invoice.findMany({
      where: { customerId },
      orderBy: { issueDate: 'desc' },
      take: 200,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceType: true,
        totalAmount: true,
        status: true,
        issueDate: true,
        items: { select: { id: true } },
      },
    }),
    db.customerCredit.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        amount: true,
        creditType: true,
        status: true,
        reference: true,
        description: true,
        createdAt: true,
      },
    }),
    db.giftCardRedemption.findMany({
      where: { giftCard: { issuedTo: customerId } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        giftCard: { select: { code: true } },
      },
    }),
    db.voucherRedemption.findMany({
      where: { redeemedBy: customerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        discountAmount: true,
        finalTotal: true,
        createdAt: true,
        voucher: { select: { code: true } },
      },
    }),
    db.debtPayment.findMany({
      where: { debtLedger: { customerId } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        reference: true,
        createdAt: true,
        debtLedger: { select: { id: true } },
      },
    }),
    db.deliveryNote.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        deliveryNumber: true,
        status: true,
        deliveryAddress: true,
        createdAt: true,
      },
    }),
  ]);

  // Build unified timeline
  const timeline: TimelineEntry[] = [];

  for (const t of transactions) {
    timeline.push({
      type: 'SALE',
      id: t.id,
      timestamp: t.createdAt.toISOString(),
      ref: t.receiptNumber,
      amount: t.totalAmount,
      paymentMethod: t.paymentMethod,
      paymentStatus: t.paymentStatus,
      itemCount: t.items.length,
    });
  }

  for (const inv of invoices) {
    timeline.push({
      type: 'INVOICE',
      id: inv.id,
      timestamp: inv.issueDate.toISOString(),
      ref: inv.invoiceNumber,
      amount: inv.totalAmount,
      status: inv.status,
      invoiceType: inv.invoiceType,
      itemCount: inv.items.length,
    });
  }

  for (const c of customerCredits) {
    timeline.push({
      type: 'CREDIT',
      id: c.id,
      timestamp: c.createdAt.toISOString(),
      ref: c.reference || c.id,
      amount: c.amount,
      creditType: c.creditType,
      status: c.status,
      description: c.description,
    });
  }

  for (const g of giftCardRedemptions) {
    timeline.push({
      type: 'GIFT_CARD_REDEMPTION',
      id: g.id,
      timestamp: g.createdAt.toISOString(),
      ref: g.giftCard.code,
      amount: g.amount,
      giftCardCode: g.giftCard.code,
    });
  }

  for (const v of voucherRedemptions) {
    timeline.push({
      type: 'VOUCHER_REDEMPTION',
      id: v.id,
      timestamp: v.createdAt.toISOString(),
      ref: v.voucher.code,
      discountAmount: v.discountAmount,
      voucherCode: v.voucher.code,
    });
  }

  for (const d of debtPayments) {
    timeline.push({
      type: 'DEBT_PAYMENT',
      id: d.id,
      timestamp: d.createdAt.toISOString(),
      ref: d.reference || d.id,
      amount: d.amount,
      paymentMethod: d.paymentMethod,
    });
  }

  for (const dn of deliveryNotes) {
    timeline.push({
      type: 'DELIVERY_NOTE',
      id: dn.id,
      timestamp: dn.createdAt.toISOString(),
      ref: dn.deliveryNumber,
      status: dn.status,
      deliveryAddress: dn.deliveryAddress,
    });
  }

  // Sort timeline chronologically desc
  timeline.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  // Compute summary stats
  const completedTxns = transactions.filter(
    (t) => t.paymentStatus !== 'FAILED' && t.paymentStatus !== 'REFUNDED',
  );
  const totalSpent = completedTxns.reduce((s, t) => s + t.totalAmount, 0);
  const transactionCount = completedTxns.length;
  const avgOrderValue = transactionCount > 0 ? totalSpent / transactionCount : 0;
  const lastVisit =
    transactions.length > 0
      ? transactions[0].createdAt.toISOString()
      : null;
  const outstandingInvoices = invoices.filter(
    (i) => i.status !== 'PAID' && i.status !== 'CANCELLED',
  ).length;
  const creditsTotal = customerCredits
    .filter((c) => c.status === 'ACTIVE' && c.creditType === 'CREDIT')
    .reduce((s, c) => s + c.amount, 0);

  const summary: CustomerHistorySummary = {
    totalSpent,
    outstandingDebt: customer.currentDebtBalance,
    lastVisit,
    loyaltyPoints: customer.loyaltyPoints,
    transactionCount,
    avgOrderValue,
    invoiceCount: invoices.length,
    outstandingInvoices,
    creditsTotal,
    deliveryNotesCount: deliveryNotes.length,
  };

  return Response.json({
    success: true,
    data: {
      customer,
      summary,
      timeline,
      // also expose raw slices for callers that want them
      sections: {
        transactions,
        invoices,
        customerCredits,
        giftCardRedemptions,
        voucherRedemptions,
        debtPayments,
        deliveryNotes,
      },
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(customerHistoryHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  }),
  'CUSTOMER_HISTORY',
);
