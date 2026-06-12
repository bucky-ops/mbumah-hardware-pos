/**
 * MBUMAH HARDWARE - Receipt Detail API
 * GET /api/receipts/[id] - Get full receipt with all details for printing
 *
 * Includes store info, line items, taxes, payment method, M-Pesa receipt number
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getReceiptDetailHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

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

  // Resolve M-Pesa receipt number from payment reference or MpesaTransaction
  let mpesaReceiptNumber: string | null = null;
  const mpesaPayment = receipt.transaction.payments.find(
    (p) => p.paymentMethod === 'MPESA' && p.status === 'COMPLETED'
  );
  if (mpesaPayment?.reference) {
    mpesaReceiptNumber = mpesaPayment.reference;
  }

  // Also try to get from MpesaTransaction table
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

  // Calculate totals for receipt printing
  const lineItemsTotal = receipt.transaction.items.reduce(
    (sum, item) => sum + item.lineTotal,
    0
  );
  const totalItemDiscount = receipt.transaction.items.reduce(
    (sum, item) => sum + (item.pricePerUnit * item.quantity * item.discountPercent / 100),
    0
  );

  const receiptData = {
    // Receipt metadata
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    receiptType: receipt.receiptType,
    sentTo: receipt.sentTo,
    sentAt: receipt.sentAt,
    createdAt: receipt.createdAt,

    // Store info
    store: receipt.store,

    // Transaction details
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

    // Cashier info
    cashier: receipt.transaction.cashier,

    // Customer info
    customer: receipt.transaction.customer,

    // Line items with full detail
    lineItems: receipt.transaction.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitType: item.unitType,
      pricePerUnit: item.pricePerUnit,
      costPrice: item.costPrice,
      discountPercent: item.discountPercent,
      taxRate: item.taxRate,
      lineTotal: item.lineTotal,
      isRentalItem: item.isRentalItem,
      product: item.product,
    })),

    // Computed totals
    computed: {
      lineItemsTotal,
      totalItemDiscount,
      transactionDiscount: receipt.transaction.discountAmount,
      taxAmount: receipt.transaction.taxAmount,
      grandTotal: receipt.transaction.totalAmount,
    },

    // Payment info
    payments: receipt.transaction.payments,
    mpesaReceiptNumber,

    // Debt info (if applicable)
    debtLedgers: receipt.transaction.debtLedgers,
  };

  return Response.json({ success: true, data: receiptData });
}

export const GET = withErrorBoundary(getReceiptDetailHandler, 'RECEIPT_DETAIL');
