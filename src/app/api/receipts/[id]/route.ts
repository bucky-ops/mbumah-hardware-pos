// GET /api/receipts/[id]         — fetch receipt detail
// PUT /api/receipts/[id]         — edit receiptType / sentTo / linked transaction notes
// DELETE /api/receipts/[id]      — soft-delete (void) the receipt

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Allowed receiptType values. 'CANCELLED' is added by this module as a
// soft-delete sentinel (see DELETE handler below). The schema's comment
// lists DIGITAL, PRINTED, EMAIL, SMS, WHATSAPP; we keep that list and append
// CANCELLED for the soft-delete case.
const ALLOWED_RECEIPT_TYPES = [
  'DIGITAL',
  'PRINTED',
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'CANCELLED',
] as const;
type AllowedReceiptType = (typeof ALLOWED_RECEIPT_TYPES)[number];

function isAllowedReceiptType(value: unknown): value is AllowedReceiptType {
  return typeof value === 'string' && (ALLOWED_RECEIPT_TYPES as readonly string[]).includes(value);
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

    const lineItemsTotal = receipt.transaction.items.reduce(
    (sum, item) => sum + item.lineTotal,
    0
  );
  const totalItemDiscount = receipt.transaction.items.reduce(
    (sum, item) => sum + (item.pricePerUnit * item.quantity * item.discountPercent / 100),
    0
  );

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
      costPrice: item.costPrice,
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

// ── PUT /api/receipts/[id] ───────────────────────────────────────────────────
//
// Edit a receipt. Allows updating:
//   - `receiptType` (validated against ALLOWED_RECEIPT_TYPES)
//   - `sentTo` (free-form string; usually a phone or email)
//   - `notes` (writes through to the linked SalesTransaction.notes — the
//     transaction is the source of truth for line-item-level notes; the
//     Receipt model has no notes column of its own)
//   - Optional `customerName` / `customerPhone` / `customerEmail` — applied
//     to the linked Customer row if the transaction has a customer. These
//     are intentionally a narrow allowlist; loyalty points, debt limit, etc.
//     must not be mutated from here (see H-02 in the customer-update route).
//
// Role check: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT.

interface UpdateReceiptBody {
  receiptType?: unknown;
  sentTo?: unknown;
  notes?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  customerEmail?: unknown;
}

async function updateReceiptHandler(
  request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as RouteContext;
  const { id } = await context.params;

  const body = (await request.json().catch(() => ({}))) as UpdateReceiptBody;

  const existing = await db.receipt.findUnique({
    where: { id },
    include: {
      transaction: {
        select: {
          id: true,
          notes: true,
          customerId: true,
        },
      },
    },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Receipt not found.' },
      { status: 404 }
    );
  }

  if (existing.receiptType === 'CANCELLED') {
    return Response.json(
      { success: false, error: 'Cannot edit a cancelled receipt.' },
      { status: 409 }
    );
  }

  // Validate receiptType if provided.
  if (body.receiptType !== undefined && !isAllowedReceiptType(body.receiptType)) {
    return Response.json(
      {
        success: false,
        error: `receiptType must be one of: ${ALLOWED_RECEIPT_TYPES.join(', ')}`,
      },
      { status: 400 }
    );
  }

  // Disallow setting receiptType to CANCELLED via PUT — use DELETE for that
  // (DELETE writes an explicit audit log entry).
  if (body.receiptType === 'CANCELLED') {
    return Response.json(
      { success: false, error: 'Use DELETE to cancel a receipt.' },
      { status: 400 }
    );
  }

  // Build the Receipt update payload.
  const receiptUpdate: Record<string, unknown> = {};
  if (typeof body.receiptType === 'string') {
    receiptUpdate.receiptType = body.receiptType;
  }
  if (typeof body.sentTo === 'string') {
    receiptUpdate.sentTo = body.sentTo.trim() || null;
  }

  // Build the SalesTransaction update payload (only notes is mutable here).
  const transactionUpdate: Record<string, unknown> = {};
  if (body.notes !== undefined) {
    if (typeof body.notes === 'string') {
      transactionUpdate.notes = body.notes.trim() || null;
    } else if (body.notes === null) {
      transactionUpdate.notes = null;
    }
  }

  // Build the Customer update payload if a customer is linked.
  const customerUpdate: Record<string, unknown> = {};
  if (typeof body.customerName === 'string' && body.customerName.trim()) {
    customerUpdate.name = body.customerName.trim();
  }
  if (typeof body.customerPhone === 'string') {
    customerUpdate.phone = body.customerPhone.trim() || null;
  }
  if (typeof body.customerEmail === 'string') {
    customerUpdate.email = body.customerEmail.trim() || null;
  }

  if (
    Object.keys(receiptUpdate).length === 0 &&
    Object.keys(transactionUpdate).length === 0 &&
    Object.keys(customerUpdate).length === 0
  ) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  // Apply updates in a transaction so the receipt + transaction + customer
  // stay consistent.
  const updatedReceipt = await db.$transaction(async (tx) => {
    if (Object.keys(transactionUpdate).length > 0) {
      await tx.salesTransaction.update({
        where: { id: existing.transactionId },
        data: transactionUpdate,
      });
    }
    if (
      Object.keys(customerUpdate).length > 0 &&
      existing.transaction.customerId
    ) {
      await tx.customer.update({
        where: { id: existing.transaction.customerId },
        data: customerUpdate,
      });
    }
    return tx.receipt.update({
      where: { id },
      data: receiptUpdate,
    });
  });

  await systemLog({
    action: 'RECEIPT_UPDATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Receipt ${existing.receiptNumber} updated by ${session.email}`,
    userId: session.userId,
    storeId: existing.storeId,
    metadata: {
      receiptId: id,
      receiptNumber: existing.receiptNumber,
      receiptFields: Object.keys(receiptUpdate),
      transactionFields: Object.keys(transactionUpdate),
      customerFields: Object.keys(customerUpdate),
      customerId: existing.transaction.customerId || null,
    },
  });

  return Response.json({ success: true, data: updatedReceipt });
}

// ── DELETE /api/receipts/[id] ────────────────────────────────────────────────
//
// Soft-delete (void) a receipt. The Receipt model has no `deletedAt` column,
// so we void the receipt by setting `receiptType = 'CANCELLED'` and writing a
// WARN-level systemLog entry. The row is preserved for audit trail.
//
// Role check: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT.

async function deleteReceiptHandler(
  _request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as RouteContext;
  const { id } = await context.params;

  const existing = await db.receipt.findUnique({
    where: { id },
    select: {
      id: true,
      receiptNumber: true,
      receiptType: true,
      storeId: true,
      transactionId: true,
    },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Receipt not found.' },
      { status: 404 }
    );
  }

  if (existing.receiptType === 'CANCELLED') {
    return Response.json(
      { success: false, error: 'Receipt is already cancelled.' },
      { status: 409 }
    );
  }

  const updated = await db.receipt.update({
    where: { id },
    data: { receiptType: 'CANCELLED' },
  });

  await systemLog({
    action: 'RECEIPT_CANCELLED',
    component: LogComponent.POS,
    severity: LogSeverity.WARN,
    message: `Receipt ${existing.receiptNumber} cancelled by ${session.email}`,
    userId: session.userId,
    storeId: existing.storeId,
    metadata: {
      receiptId: id,
      receiptNumber: existing.receiptNumber,
      transactionId: existing.transactionId,
      previousReceiptType: existing.receiptType,
    },
  });

  return Response.json({
    success: true,
    data: updated,
    message: `Receipt ${existing.receiptNumber} cancelled.`,
  });
}

export const GET = withErrorBoundary(getReceiptDetailHandler, 'RECEIPT_DETAIL');
export const PUT = withErrorBoundary(
  requireAuth(updateReceiptHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'],
  }),
  'RECEIPT_UPDATE'
);
export const DELETE = withErrorBoundary(
  requireAuth(deleteReceiptHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'],
  }),
  'RECEIPT_DELETE'
);
