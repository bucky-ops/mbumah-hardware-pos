// POST /api/whatsapp/send-document - Send document via WhatsApp

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, AuthSession } from '@/lib/auth';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

type DocumentType =
  | 'invoice'
  | 'receipt'
  | 'quotation'
  | 'voucher'
  | 'inventory'
  | 'delivery_note'
  | 'gift_card'
  | 'credit_note'
  | 'purchase_order'
  | 'statement';

async function sendDocumentHandler(request: NextRequest, session: AuthSession): Promise<Response> {
  const body = await request.json();
  const { type, documentId, storeId, phone, message, customerId } = body as {
    type: DocumentType;
    documentId?: string;
    storeId: string;
    phone?: string;
    message?: string;
    customerId?: string;
  };

  if (!type || !storeId) {
    return Response.json(
      { success: false, error: 'type and storeId are required.' },
      { status: 400 },
    );
  }

  // For inventory and statement types, documentId is optional
  if (!documentId && type !== 'inventory' && type !== 'statement') {
    return Response.json(
      { success: false, error: 'documentId is required for this document type.' },
      { status: 400 },
    );
  }

  let whatsappMessage = '';
  let recipientPhone = phone || '';
  let documentTitle = '';

  try {
    switch (type) {
      case 'invoice': {
        const invoice = await db.invoice.findUnique({
          where: { id: documentId },
          include: { items: true, store: true },
        });
        if (!invoice)
          return Response.json({ success: false, error: 'Invoice not found.' }, { status: 404 });

        recipientPhone = recipientPhone || invoice.customerPhone || '';
        documentTitle = `Invoice ${invoice.invoiceNumber}`;

        whatsappMessage = `\u{1F4CB} *INVOICE* ${invoice.invoiceNumber}\n`;
        whatsappMessage += `From: ${invoice.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F464} Customer: ${invoice.customerName || 'N/A'}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date(invoice.issueDate).toLocaleDateString('en-KE')}\n`;
        if (invoice.dueDate)
          whatsappMessage += `\u{1F4C5} Due: ${new Date(invoice.dueDate).toLocaleDateString('en-KE')}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;

        if (invoice.items && Array.isArray(invoice.items)) {
          for (const item of invoice.items) {
            const itemTotal = item.lineTotal || item.quantity * item.pricePerUnit;
            whatsappMessage += `\u2022 ${item.productName || 'Item'} x${item.quantity} @ KES ${item.pricePerUnit.toLocaleString()} = KES ${itemTotal.toLocaleString()}\n`;
          }
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F4B0} Subtotal: KES ${invoice.subtotal.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4CA} Tax: KES ${invoice.taxAmount.toLocaleString()}\n`;
        if (invoice.discountAmount > 0)
          whatsappMessage += `\u{1F3F7}\uFE0F Discount: KES ${invoice.discountAmount.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4B5} *TOTAL: KES ${invoice.totalAmount.toLocaleString()}*\n`;
        whatsappMessage += `\u{1F4CA} Status: ${invoice.status}\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nThank you for your business! \u{1F64F}`;
        break;
      }

      case 'receipt': {
        const transaction = await db.salesTransaction.findUnique({
          where: { id: documentId },
          include: { customer: true, cashier: true, items: { include: { product: true } }, store: true },
        });
        if (!transaction)
          return Response.json({ success: false, error: 'Transaction not found.' }, { status: 404 });

        recipientPhone = recipientPhone || transaction.customer?.phone || '';
        documentTitle = `Receipt ${transaction.receiptNumber}`;

        whatsappMessage = `\u{1F9FE} *RECEIPT* ${transaction.receiptNumber}\n`;
        whatsappMessage += `From: ${transaction.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        if (transaction.customer)
          whatsappMessage += `\u{1F464} Customer: ${transaction.customer.name}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date(transaction.createdAt).toLocaleDateString('en-KE')}\n`;
        whatsappMessage += `\u{1F550} Time: ${new Date(transaction.createdAt).toLocaleTimeString('en-KE')}\n`;
        whatsappMessage += `\u{1F464} Cashier: ${transaction.cashier?.name || 'N/A'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;

        if (transaction.items && Array.isArray(transaction.items)) {
          for (const item of transaction.items) {
            whatsappMessage += `\u2022 ${item.productName} x${item.quantity} @ KES ${(item.pricePerUnit || 0).toLocaleString()} = KES ${(item.lineTotal || 0).toLocaleString()}\n`;
          }
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F4B0} Subtotal: KES ${transaction.subtotal.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4CA} Tax: KES ${transaction.taxAmount.toLocaleString()}\n`;
        if (transaction.discountAmount > 0)
          whatsappMessage += `\u{1F3F7}\uFE0F Discount: KES ${transaction.discountAmount.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4B5} *TOTAL: KES ${transaction.totalAmount.toLocaleString()}*\n`;
        whatsappMessage += `\u{1F4B3} Payment: ${transaction.paymentMethod}\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nThank you for shopping with us! \u{1F64F}`;
        break;
      }

      case 'quotation': {
        const quotation = await db.invoice.findUnique({
          where: { id: documentId },
          include: { items: true, store: true },
        });
        if (!quotation)
          return Response.json({ success: false, error: 'Quotation not found.' }, { status: 404 });

        recipientPhone = recipientPhone || quotation.customerPhone || '';
        documentTitle = `Quotation ${quotation.invoiceNumber}`;

        whatsappMessage = `\u{1F4DD} *QUOTATION* ${quotation.invoiceNumber}\n`;
        whatsappMessage += `From: ${quotation.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F464} Client: ${quotation.customerName || 'N/A'}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date(quotation.issueDate).toLocaleDateString('en-KE')}\n`;
        whatsappMessage += `\u{1F4C5} Valid Until: ${quotation.dueDate ? new Date(quotation.dueDate).toLocaleDateString('en-KE') : '30 days'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;

        if (quotation.items && Array.isArray(quotation.items)) {
          for (const item of quotation.items) {
            const itemTotal = item.lineTotal || item.quantity * item.pricePerUnit;
            whatsappMessage += `\u2022 ${item.productName || 'Item'} x${item.quantity} @ KES ${item.pricePerUnit.toLocaleString()} = KES ${itemTotal.toLocaleString()}\n`;
          }
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F4B5} *TOTAL: KES ${quotation.totalAmount.toLocaleString()}*\n`;
        whatsappMessage += `\u26A0\uFE0F *This is a quotation. Prices subject to change.*\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nContact us to place your order! \u{1F4DE}`;
        break;
      }

      case 'voucher': {
        const voucher = await db.voucher.findUnique({
          where: { id: documentId },
          include: { store: true },
        });
        if (!voucher)
          return Response.json({ success: false, error: 'Voucher not found.' }, { status: 404 });

        recipientPhone = recipientPhone || '';
        documentTitle = `Voucher ${voucher.code}`;

        whatsappMessage = `\u{1F381} *VOUCHER* ${voucher.code}\n`;
        whatsappMessage += `From: ${voucher.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F3F7}\uFE0F Name: ${voucher.name}\n`;
        whatsappMessage += `\u{1F4CB} Type: ${voucher.voucherType}\n`;
        if (voucher.voucherType === 'PERCENTAGE') {
          whatsappMessage += `\u{1F4B0} Value: ${voucher.value}% off\n`;
        } else if (voucher.voucherType === 'FIXED') {
          whatsappMessage += `\u{1F4B0} Value: KES ${voucher.value.toLocaleString()} off\n`;
        } else if (voucher.voucherType === 'FREE_PRODUCT') {
          whatsappMessage += `\u{1F381} Value: Free Product\n`;
        } else {
          whatsappMessage += `\u{1F4B0} Value: KES ${voucher.value.toLocaleString()}\n`;
        }
        if (voucher.description) whatsappMessage += `\u{1F4DD} ${voucher.description}\n`;
        if (voucher.minimumPurchase > 0)
          whatsappMessage += `\u{1F512} Min. Purchase: KES ${voucher.minimumPurchase.toLocaleString()}\n`;
        if (voucher.maxDiscount)
          whatsappMessage += `\u{1F4CA} Max Discount: KES ${voucher.maxDiscount.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4C5} Valid: ${new Date(voucher.startDate).toLocaleDateString('en-KE')}${voucher.endDate ? ' - ' + new Date(voucher.endDate).toLocaleDateString('en-KE') : ' onwards'}\n`;
        whatsappMessage += `\u{1F504} Uses: ${voucher.currentUses}/${voucher.maxUses}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F511} Code: *${voucher.code}*\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nUse this code at checkout! \u{1F6D2}`;
        break;
      }

      case 'inventory': {
        const store = await db.store.findUnique({ where: { id: storeId } });
        const products = await db.product.findMany({
          where: { storeId, isActive: true },
          orderBy: { quantityInStock: 'asc' },
          take: 50,
          include: { category: true },
        });

        documentTitle = 'Inventory Report';

        whatsappMessage = `\u{1F4E6} *INVENTORY REPORT*\n`;
        whatsappMessage += `Store: ${store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date().toLocaleDateString('en-KE')}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;

        let totalItems = 0;
        let lowStockItems = 0;

        for (const product of products) {
          totalItems++;
          const isLow = product.quantityInStock <= product.reorderLevel;
          if (isLow) lowStockItems++;
          whatsappMessage += `${isLow ? '\u26A0\uFE0F' : '\u2705'} ${product.name} (${product.sku}): ${product.quantityInStock} @ KES ${product.pricePerUnit.toLocaleString()}\n`;
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F4CA} Total Items: ${totalItems}\n`;
        whatsappMessage += `\u26A0\uFE0F Low Stock: ${lowStockItems}\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        break;
      }

      case 'delivery_note': {
        const delivery = await db.deliveryNote.findUnique({
          where: { id: documentId },
          include: { store: true, items: true },
        });
        if (!delivery)
          return Response.json({ success: false, error: 'Delivery note not found.' }, { status: 404 });

        recipientPhone = recipientPhone || delivery.customerPhone || '';
        documentTitle = `Delivery Note ${delivery.deliveryNumber}`;

        whatsappMessage = `\u{1F69A} *DELIVERY NOTE* ${delivery.deliveryNumber}\n`;
        whatsappMessage += `From: ${delivery.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F464} Customer: ${delivery.customerName || 'N/A'}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date(delivery.createdAt).toLocaleDateString('en-KE')}\n`;
        if (delivery.deliveryAddress)
          whatsappMessage += `\u{1F4CD} Address: ${delivery.deliveryAddress}\n`;
        if (delivery.driverName) whatsappMessage += `\u{1F9D1}\u200D\u270D\uFE0F Driver: ${delivery.driverName}\n`;
        if (delivery.vehicleNumber)
          whatsappMessage += `\u{1F697} Vehicle: ${delivery.vehicleNumber}\n`;
        whatsappMessage += `\u{1F4CA} Status: ${delivery.status}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;

        if (delivery.items && Array.isArray(delivery.items)) {
          for (const item of delivery.items) {
            whatsappMessage += `\u2022 ${item.productName} x${item.quantity} ${item.unitType}\n`;
          }
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        if (delivery.notes) whatsappMessage += `\u{1F4DD} Notes: ${delivery.notes}\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nThank you for choosing us! \u{1F64F}`;
        break;
      }

      case 'gift_card': {
        const giftCard = await db.giftCard.findUnique({
          where: { id: documentId },
          include: { store: true, issuedToCustomer: true },
        });
        if (!giftCard)
          return Response.json({ success: false, error: 'Gift card not found.' }, { status: 404 });

        recipientPhone =
          recipientPhone || giftCard.recipientPhone || giftCard.issuedToCustomer?.phone || '';
        documentTitle = `Gift Card ${giftCard.code}`;

        whatsappMessage = `\u{1F381} *GIFT CARD* ${giftCard.code}\n`;
        whatsappMessage += `From: ${giftCard.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F511} Code: *${giftCard.code}*\n`;
        whatsappMessage += `\u{1F4B0} Balance: KES ${giftCard.currentBalance.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4CB} Status: ${giftCard.status}\n`;
        if (giftCard.recipientName)
          whatsappMessage += `\u{1F464} Recipient: ${giftCard.recipientName}\n`;
        if (giftCard.expiresAt)
          whatsappMessage += `\u{1F4C5} Expires: ${new Date(giftCard.expiresAt).toLocaleDateString('en-KE')}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nUse this code at checkout! \u{1F6D2}`;
        break;
      }

      case 'credit_note': {
        const credit = await db.customerCredit.findUnique({
          where: { id: documentId },
          include: { customer: true, store: true },
        });
        if (!credit)
          return Response.json({ success: false, error: 'Credit note not found.' }, { status: 404 });

        recipientPhone = recipientPhone || credit.customer?.phone || '';
        documentTitle = `Credit Note`;

        whatsappMessage = `\u{1F4C4} *CREDIT NOTE*\n`;
        whatsappMessage += `From: ${credit.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F464} Customer: ${credit.customer?.name || 'N/A'}\n`;
        whatsappMessage += `\u{1F4B0} Amount: KES ${credit.amount.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4CB} Type: ${credit.creditType}\n`;
        whatsappMessage += `\u{1F4CA} Status: ${credit.status}\n`;
        if (credit.description) whatsappMessage += `\u{1F4DD} Description: ${credit.description}\n`;
        if (credit.reference) whatsappMessage += `\u{1F517} Reference: ${credit.reference}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date(credit.createdAt).toLocaleDateString('en-KE')}\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nThank you for your patience! \u{1F64F}`;
        break;
      }

      case 'purchase_order': {
        const po = await db.purchaseOrder.findUnique({
          where: { id: documentId },
          include: { supplier: true, store: true, items: true },
        });
        if (!po)
          return Response.json(
            { success: false, error: 'Purchase order not found.' },
            { status: 404 },
          );

        recipientPhone = recipientPhone || po.supplier?.phone || '';
        documentTitle = `PO ${po.poNumber}`;

        whatsappMessage = `\u{1F4E6} *PURCHASE ORDER* ${po.poNumber}\n`;
        whatsappMessage += `From: ${po.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F3ED} Supplier: ${po.supplier?.name || 'N/A'}\n`;
        whatsappMessage += `\u{1F4C5} Date: ${new Date(po.orderDate).toLocaleDateString('en-KE')}\n`;
        whatsappMessage += `\u{1F4CA} Status: ${po.status}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;

        if (po.items && Array.isArray(po.items)) {
          for (const item of po.items) {
            const productName = item.product
              ? (await db.product.findUnique({ where: { id: item.productId } }))?.name || 'Item'
              : 'Item';
            whatsappMessage += `\u2022 ${productName} x${item.quantity} @ KES ${item.unitPrice.toLocaleString()}\n`;
          }
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F4B5} *TOTAL: KES ${po.totalAmount.toLocaleString()}*\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nPlease confirm availability. \u{1F64F}`;
        break;
      }

      case 'statement': {
        if (!customerId)
          return Response.json(
            { success: false, error: 'customerId required for statement.' },
            { status: 400 },
          );

        const customer = await db.customer.findUnique({
          where: { id: customerId },
          include: { store: true },
        });
        if (!customer)
          return Response.json({ success: false, error: 'Customer not found.' }, { status: 404 });

        recipientPhone = recipientPhone || customer.phone || '';
        documentTitle = 'Account Statement';

        const recentTxns = await db.salesTransaction.findMany({
          where: { customerId, storeId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        whatsappMessage = `\u{1F4CA} *ACCOUNT STATEMENT*\n`;
        whatsappMessage += `From: ${customer.store?.name || 'Mbumah Hardware'}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `\u{1F464} Customer: ${customer.name}\n`;
        whatsappMessage += `\u{1F4B0} Outstanding Debt: KES ${customer.currentDebtBalance.toLocaleString()}\n`;
        whatsappMessage += `\u{1F4CA} Credit Limit: KES ${customer.debtLimit.toLocaleString()}\n`;
        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        whatsappMessage += `*Recent Transactions:*\n`;

        for (const txn of recentTxns) {
          whatsappMessage += `\u2022 ${txn.receiptNumber}: KES ${txn.totalAmount.toLocaleString()} (${txn.paymentMethod}) - ${new Date(txn.createdAt).toLocaleDateString('en-KE')}\n`;
        }

        whatsappMessage += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        if (message) whatsappMessage += `\n\u{1F4AC} ${message}\n`;
        whatsappMessage += `\nContact us for queries. \u{1F4DE}`;
        break;
      }

      default:
        return Response.json(
          { success: false, error: `Unknown document type: ${type}` },
          { status: 400 },
        );
    }

    if (!recipientPhone && type !== 'inventory') {
      return Response.json(
        { success: false, error: 'No phone number found. Please provide a phone number.' },
        { status: 400 },
      );
    }

    // Clean phone number (remove spaces, ensure starts with 254 for Kenya)
    let cleanPhone = recipientPhone.replace(/[\s\-()]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '254' + cleanPhone.slice(1);
    if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.slice(1);

    // Generate wa.me link
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappMessage)}`;

    // Save message record
    try {
      await db.message.create({
        data: {
          storeId,
          customerId: customerId || null,
          channel: 'WHATSAPP',
          messageType: type.toUpperCase(),
          subject: documentTitle,
          content: whatsappMessage,
          status: 'PENDING',
          waLink,
          createdBy: session.userId,
        },
      });
    } catch {
      // Non-critical - message logging failure shouldn't block the send
    }

    await systemLog({
      action: 'WHATSAPP_DOCUMENT_SENT',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: `${type} document "${documentTitle}" sent via WhatsApp to ${cleanPhone}`,
      userId: session.userId,
      storeId,
      metadata: { type, documentId: documentId || '', phone: cleanPhone, documentTitle },
    });

    return Response.json({
      success: true,
      data: {
        waLink,
        phone: cleanPhone,
        message: whatsappMessage,
        documentTitle,
      },
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to send document.' },
      { status: 500 },
    );
  }
}

export const POST = withErrorBoundary(
  requireAuth(sendDocumentHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  }),
  'WHATSAPP_SEND_DOCUMENT',
);
