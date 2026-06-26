// POST /api/suppliers/[id]/send-order
//
// Send a purchase order (or a custom message) to a supplier via WhatsApp.
// Generates a wa.me deep link and persists a Message record. RBAC:
// SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, ACCOUNTANT.
//
// Body:
//   {
//     purchaseOrderId?: string,  // optional — if provided, format the PO
//     message?: string,          // used when purchaseOrderId is omitted
//     channel?: 'WHATSAPP'|'EMAIL' (default WHATSAPP)
//   }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Normalise Kenyan phone numbers to international format (254XXXXXXXXX). */
function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('254') && p.length === 12) return p;
  if (/^\d{9}$/.test(p)) return '254' + p;
  return null;
}

async function sendSupplierOrderHandler(
  request: NextRequest,
  session: AuthSession,
  ...rest: unknown[]
): Promise<Response> {
  const context = rest[0] as RouteContext;
  const supplierId = (await context.params).id;
  const body = await request.json();

  const { purchaseOrderId, message, channel } = body as {
    purchaseOrderId?: string;
    message?: string;
    channel?: 'WHATSAPP' | 'EMAIL';
  };

  const resolvedChannel: 'WHATSAPP' | 'EMAIL' =
    channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP';

  // Load supplier
  const supplier = await db.supplier.findUnique({
    where: { id: supplierId },
    include: { store: { select: { id: true, name: true, phone: true, address: true } } },
  });

  if (!supplier) {
    return Response.json(
      { success: false, error: 'Supplier not found.' },
      { status: 404 },
    );
  }

  let formattedMessage = '';
  let subject = `Message to ${supplier.name}`;
  const storeName = supplier.store?.name || 'Mbumah Hardware';

  if (purchaseOrderId) {
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    if (!po) {
      return Response.json(
        { success: false, error: 'Purchase order not found.' },
        { status: 404 },
      );
    }

    subject = `Purchase Order ${po.poNumber}`;
    const lines: string[] = [];
    lines.push(`\u{1F4E6} *PURCHASE ORDER* ${po.poNumber}`);
    lines.push(`From: ${storeName}`);
    lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    lines.push(`\u{1F3ED} Supplier: ${supplier.name}`);
    if (supplier.contactPerson) {
      lines.push(`\u{1F465} Contact: ${supplier.contactPerson}`);
    }
    lines.push(`\u{1F4C5} Date: ${new Date(po.orderDate).toLocaleDateString('en-KE')}`);
    if (po.expectedDate) {
      lines.push(`\u{1F4C5} Expected Delivery: ${new Date(po.expectedDate).toLocaleDateString('en-KE')}`);
    }
    lines.push(`\u{1F4CA} Status: ${po.status}`);
    lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    lines.push('*Items:*');
    for (const item of po.items) {
      const productName = item.product?.name || 'Item';
      lines.push(
        `\u2022 ${productName} (SKU: ${item.product?.sku || '-'}) x${item.quantity} @ KES ${item.unitPrice.toLocaleString()} = KES ${item.totalPrice.toLocaleString()}`,
      );
    }
    lines.push('\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501');
    lines.push(`\u{1F4B5} *TOTAL: KES ${po.totalAmount.toLocaleString()}*`);
    if (po.notes) lines.push(`\u{1F4DD} Notes: ${po.notes}`);
    if (supplier.store?.phone) {
      lines.push(`\u{1F4DE} Store Contact: ${supplier.store.phone}`);
    }
    if (message) lines.push(`\n\u{1F4AC} ${message}`);
    lines.push('\nPlease confirm availability and delivery date. \u{1F64F}');

    formattedMessage = lines.join('\n');
  } else if (message) {
    formattedMessage = `\u{1F4AC} Message to ${supplier.name}\nFrom: ${storeName}\n\n${message}`;
  } else {
    return Response.json(
      {
        success: false,
        error: 'Either purchaseOrderId or message is required.',
      },
      { status: 400 },
    );
  }

  const normalisedPhone = normalisePhone(supplier.phone);
  let waLink: string | null = null;
  let mailtoLink: string | null = null;

  if (resolvedChannel === 'WHATSAPP') {
    if (!normalisedPhone) {
      return Response.json(
        {
          success: false,
          error:
            'Supplier has no valid WhatsApp phone number. Provide a phone or use EMAIL channel.',
        },
        { status: 400 },
      );
    }
    waLink = `https://wa.me/${normalisedPhone}?text=${encodeURIComponent(formattedMessage)}`;
  } else {
    // EMAIL channel — produce a mailto: link
    if (!supplier.email) {
      return Response.json(
        {
          success: false,
          error: 'Supplier has no email address configured.',
        },
        { status: 400 },
      );
    }
    mailtoLink = `mailto:${supplier.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(formattedMessage)}`;
  }

  // Persist a Message record
  try {
    await db.message.create({
      data: {
        storeId: supplier.storeId,
        customerId: null,
        channel: resolvedChannel,
        messageType: 'PURCHASE_ORDER',
        subject,
        content: formattedMessage,
        status: 'PENDING',
        waLink: waLink || mailtoLink,
        sentAt: new Date(),
        createdBy: session.userId,
      },
    });
  } catch {
    // Non-blocking — return the link even if audit logging fails.
  }

  await systemLog({
    action: 'SUPPLIER_ORDER_SENT',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Purchase order ${purchaseOrderId || '(custom message)'} sent to supplier "${supplier.name}" via ${resolvedChannel}`,
    userId: session.userId,
    storeId: supplier.storeId,
    metadata: {
      supplierId,
      purchaseOrderId: purchaseOrderId || null,
      channel: resolvedChannel,
      recipient: resolvedChannel === 'WHATSAPP' ? normalisedPhone : supplier.email,
    },
  });

  return Response.json({
    success: true,
    data: {
      waLink: waLink || mailtoLink,
      channel: resolvedChannel,
      recipient:
        resolvedChannel === 'WHATSAPP' ? normalisedPhone : supplier.email,
      message: formattedMessage,
      subject,
    },
  });
}

export const POST = withErrorBoundary(
  requireAuth(sendSupplierOrderHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'],
  }),
  'SUPPLIER_SEND_ORDER',
);
