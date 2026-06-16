// POST /api/receipts/[id]/send — Send a receipt via WhatsApp or Email
//
// Body: { channel: 'WHATSAPP' | 'EMAIL', phone?, email? }
//
// Behavior:
//   - WHATSAPP: builds a wa.me deep link via `buildWhatsAppLink`, updates
//     `Receipt.receiptType='WHATSAPP'`, `Receipt.sentTo=<normalized phone>`,
//     `Receipt.sentAt=now()`. Creates a `Message` row (channel='WHATSAPP',
//     messageType='RECEIPT', status='SENT', waLink, customerId if available).
//   - EMAIL:   builds a `mailto:` deep link via `buildMailtoLink` (graceful
//     fallback — no SMTP provider is configured; see `receipt-delivery.ts`).
//     Updates `Receipt.receiptType='EMAIL'`, `Receipt.sentTo=<email>`,
//     `Receipt.sentAt=now()`. Creates a `Message` row (channel='EMAIL',
//     messageType='RECEIPT', status='SENT').
//
// The route returns `{ success, waLink|mailtoLink, receipt }`. The caller is
// responsible for actually opening the deep link in a browser/mailto handler
// — server-side we only persist the audit trail and the formatted message.

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  formatReceiptForWhatsApp,
  formatReceiptForEmail,
  buildWhatsAppLink,
  buildMailtoLink,
  normalizePhone,
  type ReceiptPayload,
} from '@/lib/receipt-delivery';

interface RouteContext {
  params: Promise<{ id: string }>;
}

type SendChannel = 'WHATSAPP' | 'EMAIL';

interface SendBody {
  channel?: SendChannel;
  phone?: string;
  email?: string;
}

async function sendReceiptHandler(
  request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as RouteContext;
  const { id } = await context.params;

  const body = (await request.json().catch(() => ({}))) as SendBody;
  const channel = body.channel;
  if (channel !== 'WHATSAPP' && channel !== 'EMAIL') {
    return Response.json(
      { success: false, error: "channel must be 'WHATSAPP' or 'EMAIL'." },
      { status: 400 }
    );
  }

  // Fetch the receipt with all relations needed to format an outbound message.
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
          organization: { select: { id: true, name: true, taxPin: true } },
        },
      },
      transaction: {
        include: {
          cashier: { select: { id: true, name: true, role: true } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true, unitType: true } },
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

  // Reject sends for already-cancelled receipts.
  if (receipt.receiptType === 'CANCELLED') {
    return Response.json(
      { success: false, error: 'Cannot send a cancelled receipt.' },
      { status: 409 }
    );
  }

  // Look up the M-Pesa receipt number (mirrors GET /api/receipts/[id]).
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

  // Build the ReceiptPayload view that the formatters expect. The
  // `lineItems` field is the canonical one used by `formatReceiptForWhatsApp`
  // / `formatReceiptForEmail`; we map `transaction.items` into it.
  const receiptPayload: ReceiptPayload = {
    id: receipt.id,
    receiptNumber: receipt.receiptNumber,
    receiptType: receipt.receiptType,
    sentTo: receipt.sentTo,
    sentAt: receipt.sentAt,
    createdAt: receipt.createdAt,
    store: receipt.store,
    cashier: receipt.transaction.cashier,
    customer: receipt.transaction.customer,
    lineItems: receipt.transaction.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitType: item.unitType,
      pricePerUnit: item.pricePerUnit,
      discountPercent: item.discountPercent,
      lineTotal: item.lineTotal,
    })),
    payments: receipt.transaction.payments.map((p) => ({
      paymentMethod: p.paymentMethod,
      amount: p.amount,
      status: p.status,
      reference: p.reference,
    })),
    mpesaReceiptNumber,
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
      cashier: receipt.transaction.cashier,
      customer: receipt.transaction.customer,
      items: receipt.transaction.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitType: item.unitType,
        pricePerUnit: item.pricePerUnit,
        discountPercent: item.discountPercent,
        lineTotal: item.lineTotal,
      })),
      payments: receipt.transaction.payments.map((p) => ({
        paymentMethod: p.paymentMethod,
        amount: p.amount,
        status: p.status,
        reference: p.reference,
      })),
    },
  };

  const customerId = receipt.transaction.customer?.id || null;
  const storeId = receipt.storeId;

  if (channel === 'WHATSAPP') {
    // Resolve phone: body > customer > receipt.sentTo.
    const phone = body.phone || receipt.transaction.customer?.phone || receipt.sentTo || '';
    if (!phone) {
      return Response.json(
        {
          success: false,
          error:
            'No phone number available. Provide a phone in the request body or attach a customer to the transaction.',
        },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return Response.json(
        { success: false, error: 'Invalid phone number format.' },
        { status: 400 }
      );
    }

    const message = formatReceiptForWhatsApp(receiptPayload);
    const waLink = buildWhatsAppLink(normalized, message);
    if (!waLink) {
      return Response.json(
        { success: false, error: 'Could not build WhatsApp link.' },
        { status: 400 }
      );
    }

    const now = new Date();

    // Update the Receipt row to reflect the WhatsApp send.
    const updatedReceipt = await db.receipt.update({
      where: { id },
      data: {
        receiptType: 'WHATSAPP',
        sentTo: normalized,
        sentAt: now,
      },
    });

    // Create a Message audit row. The Message schema supports channel values
    // WHATSAPP / SMS / EMAIL / BOTH (see prisma/schema.prisma).
    try {
      await db.message.create({
        data: {
          storeId,
          customerId: customerId || null,
          channel: 'WHATSAPP',
          messageType: 'RECEIPT',
          subject: `Receipt ${receipt.receiptNumber}`,
          content: message,
          status: 'SENT',
          waLink,
          sentAt: now,
          createdBy: session.userId,
        },
      });
    } catch {
      // Non-critical — message-log failure shouldn't block the send.
    }

    await systemLog({
      action: 'RECEIPT_SENT_WHATSAPP',
      component: LogComponent.POS,
      severity: LogSeverity.INFO,
      message: `Receipt ${receipt.receiptNumber} sent via WhatsApp to ${normalized}`,
      userId: session.userId,
      storeId,
      metadata: {
        receiptId: id,
        receiptNumber: receipt.receiptNumber,
        channel: 'WHATSAPP',
        phone: normalized,
        customerId: customerId || null,
      },
    });

    return Response.json({
      success: true,
      channel: 'WHATSAPP',
      waLink,
      receipt: updatedReceipt,
    });
  }

  // channel === 'EMAIL'
  const email =
    body.email || receipt.transaction.customer?.email || receipt.sentTo || '';
  if (!email) {
    return Response.json(
      {
        success: false,
        error:
          'No email address available. Provide an email in the request body or attach a customer with an email to the transaction.',
      },
      { status: 400 }
    );
  }

  // Basic email shape validation (not exhaustive — the mailto: handler will
  // ultimately decide whether the address is deliverable).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json(
      { success: false, error: 'Invalid email address format.' },
      { status: 400 }
    );
  }

  const { subject, body: emailBody } = formatReceiptForEmail(receiptPayload);
  const mailtoLink = buildMailtoLink(email, subject, emailBody);
  if (!mailtoLink) {
    return Response.json(
      { success: false, error: 'Could not build mailto link.' },
      { status: 400 }
    );
  }

  const now = new Date();

  // Update the Receipt row to reflect the Email send.
  const updatedReceipt = await db.receipt.update({
    where: { id },
    data: {
      receiptType: 'EMAIL',
      sentTo: email,
      sentAt: now,
    },
  });

  // Create a Message audit row. The Message schema supports 'EMAIL' as a
  // channel value (see prisma/schema.prisma — channel enum comment lists
  // WHATSAPP, SMS, EMAIL, BOTH). We store the mailto: link in `waLink` (the
  // closest existing field) since the schema has no dedicated email-link
  // column; the `subject` field captures the email subject.
  try {
    await db.message.create({
      data: {
        storeId,
        customerId: customerId || null,
        channel: 'EMAIL',
        messageType: 'RECEIPT',
        subject,
        content: emailBody,
        status: 'SENT',
        waLink: mailtoLink,
        sentAt: now,
        createdBy: session.userId,
      },
    });
  } catch {
    // Non-critical — message-log failure shouldn't block the send.
  }

  await systemLog({
    action: 'RECEIPT_SENT_EMAIL',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Receipt ${receipt.receiptNumber} sent via Email to ${email} (mailto: fallback — no SMTP provider configured)`,
    userId: session.userId,
    storeId,
    metadata: {
      receiptId: id,
      receiptNumber: receipt.receiptNumber,
      channel: 'EMAIL',
      email,
      customerId: customerId || null,
      transport: 'mailto',
    },
  });

  return Response.json({
    success: true,
    channel: 'EMAIL',
    mailtoLink,
    receipt: updatedReceipt,
  });
}

export const POST = withErrorBoundary(
  requireAuth(sendReceiptHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  }),
  'RECEIPT_SEND'
);
