// GET/PUT /api/invoices/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getInvoiceHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, quantityInStock: true },
          },
        },
      },
    },
  });

  if (!invoice) {
    return Response.json(
      { success: false, error: 'Invoice not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: invoice });
}

async function updateInvoiceHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Invoice not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};

  // Handle status changes
  if (body.status) {
    const validStatuses = ['DRAFT', 'SENT', 'ACCEPTED', 'INVOICED', 'PAID', 'CANCELLED', 'EXPIRED'];
    if (!validStatuses.includes(body.status)) {
      return Response.json(
        { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }
    updateData.status = body.status;
  }

  // Allow updating basic fields
  const allowedFields = [
    'customerName', 'customerPhone', 'customerEmail', 'customerAddress',
    'notes', 'terms',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (body.dueDate !== undefined) {
    updateData.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }

  if (body.discountAmount !== undefined) {
    updateData.discountAmount = body.discountAmount;
    // Recalculate total
    updateData.totalAmount = existing.subtotal - body.discountAmount + existing.taxAmount;
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const invoice = await db.invoice.update({
    where: { id },
    data: updateData,
    include: {
      items: true,
    },
  });

  await systemLog({
    action: 'INVOICE_UPDATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `${existing.invoiceType} ${existing.invoiceNumber} updated`,
    storeId: existing.storeId,
    metadata: {
      invoiceId: id,
      invoiceNumber: existing.invoiceNumber,
      updatedFields: Object.keys(updateData),
      previousStatus: existing.status,
    },
  });

  return Response.json({ success: true, data: invoice });
}

export const GET = withErrorBoundary(getInvoiceHandler, 'INVOICE_DETAIL');
export const PUT = withErrorBoundary(updateInvoiceHandler, 'INVOICE_UPDATE');
