// GET /api/receipts/[id]
//
// AUDIT FIX (6): this route previously had NO server-side auth guard and
// returned the per-line costPrice (supplier cost) to ANY caller that passed
// the proxy's Bearer-presence check. It is now wrapped in requireStoreAccess
// (DB-backed session + ORM-level tenant scoping) and costPrice is omitted
// unless the caller's role is BRANCH_MANAGER or above (PERMISSION_MATRIX
// hierarchy in src/lib/types.ts).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
// Task 12-b: Prisma Decimal valueOf() returns a STRING — `number + decimal`
// concatenates. Receipt computed totals run through toDec().
import { toDec } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Manager-or-above per PERMISSION_MATRIX (src/lib/types.ts): the roles that
// hold `financials: read`. CASHIER / ACCOUNTANT do not see supplier cost.
const PROFIT_VISIBLE_ROLES: readonly string[] = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

async function getReceiptDetailHandler(...args: unknown[]): Promise<Response> {
  // requireStoreAccess passes (request, session, ...nextArgs) — for a dynamic
  // route, args[2] is the original route context ({ params }).
  const _request = args[0] as NextRequest;
  const session = args[1] as AuthSession;
  const context = args[2] as RouteContext;
  const { id } = await context.params;

  // AUDIT FIX (6): cost data is set to undefined (dropped from the JSON
  // payload) unless the caller is BRANCH_MANAGER or above.
  const canViewCost = PROFIT_VISIBLE_ROLES.includes(session.role);

  const receipt = await db.receipt.findUnique({
    where: { id },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          location: true,
          phone: true,
          email: true,
          address: true,
          taxPin: true,
          organization: {
            select: {
              id: true,
              name: true,
              taxPin: true,
              logoUrl: true,
            },
          },
        },
      },
      transaction: {
        include: {
          cashier: { select: { id: true, name: true, role: true } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
          items: {
            include: {
              product: {
                select: { id: true, name: true, sku: true, unitType: true, imageUrl: true },
              },
            },
          },
          payments: {
            select: {
              id: true,
              paymentMethod: true,
              amount: true,
              currency: true,
              status: true,
              reference: true,
              metadata: true,
              processedAt: true,
            },
          },
          debtLedgers: {
            select: {
              id: true,
              amountOwed: true,
              amountPaid: true,
              balance: true,
              dueDate: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!receipt) {
    return Response.json(
      { success: false, error: 'Receipt not found.' },
      { status: 404 }
    );
  }

    let mpesaReceiptNumber: string | null = null;
  const mpesaPayment = receipt.transaction.payments.find(
    (p) => p.paymentMethod === 'MPESA' && p.status === 'COMPLETED'
  );
  if (mpesaPayment?.reference) {
    mpesaReceiptNumber = mpesaPayment.reference;
  }

    if (!mpesaReceiptNumber) {
    const mpesaTx = await db.mpesaTransaction.findFirst({
      where: {
        transactionId: receipt.transactionId,
        status: 'COMPLETED',
        mpesaReceiptNumber: { not: null },
      },
      select: { mpesaReceiptNumber: true },
    });
    mpesaReceiptNumber = mpesaTx?.mpesaReceiptNumber || null;
  }

    // Task 12-b: Decimal-safe computed totals (was `0 + Decimal` string-concat
    // for lineItemsTotal and float coercion for the discount sum).
    const lineItemsTotal = receipt.transaction.items
      .reduce((acc, item) => acc.plus(toDec(item.lineTotal)), toDec(0))
      .toNumber();
  const totalItemDiscount = receipt.transaction.items
    .reduce(
      (acc, item) =>
        acc.plus(
          toDec(item.pricePerUnit)
            .mul(toDec(item.quantity))
            .mul(toDec(item.discountPercent))
            .div(100),
        ),
      toDec(0),
    )
    .toNumber();

  const receiptData = {
        id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    receiptType: receipt.receiptType,
    sentTo: receipt.sentTo,
    sentAt: receipt.sentAt,
    createdAt: receipt.createdAt,

        store: receipt.store,

        transaction: {
      id: receipt.transaction.id,
      receiptNumber: receipt.transaction.receiptNumber,
      subtotal: receipt.transaction.subtotal,
      taxAmount: receipt.transaction.taxAmount,
      discountAmount: receipt.transaction.discountAmount,
      totalAmount: receipt.transaction.totalAmount,
      paymentMethod: receipt.transaction.paymentMethod,
      paymentStatus: receipt.transaction.paymentStatus,
      transactionType: receipt.transaction.transactionType,
      notes: receipt.transaction.notes,
      createdAt: receipt.transaction.createdAt,
    },

        cashier: receipt.transaction.cashier,

        customer: receipt.transaction.customer,

        lineItems: receipt.transaction.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitType: item.unitType,
      pricePerUnit: item.pricePerUnit,
      // AUDIT FIX (6): per-line costPrice is supplier-cost data — omitted
      // unless the caller's role is BRANCH_MANAGER or above.
      costPrice: canViewCost ? item.costPrice : undefined,
      discountPercent: item.discountPercent,
      taxRate: item.taxRate,
      lineTotal: item.lineTotal,
      isRentalItem: item.isRentalItem,
      product: item.product,
    })),

        computed: {
      lineItemsTotal,
      totalItemDiscount,
      transactionDiscount: receipt.transaction.discountAmount,
      taxAmount: receipt.transaction.taxAmount,
      grandTotal: receipt.transaction.totalAmount,
    },

        payments: receipt.transaction.payments,
    mpesaReceiptNumber,

        debtLedgers: receipt.transaction.debtLedgers,
  };

  return Response.json({ success: true, data: receiptData });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getReceiptDetailHandler) as (...args: unknown[]) => Promise<Response>,
  'RECEIPT_DETAIL',
);
