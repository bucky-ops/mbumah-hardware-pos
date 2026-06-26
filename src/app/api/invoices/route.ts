// GET/POST /api/invoices

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const INVOICE_PREFIXES: Record<string, string> = {
  INVOICE: 'INV',
  QUOTATION: 'QUO',
  PROFORMA: 'PRO',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
};

async function generateInvoiceNumber(invoiceType: string): Promise<string> {
  const prefix = INVOICE_PREFIXES[invoiceType] || 'INV';

  // Find the latest invoice of this type to determine next sequence
  const latest = await db.invoice.findFirst({
    where: { invoiceType },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });

  let nextSeq = 1;
  if (latest) {
    const match = latest.invoiceNumber.match(/(\d+)$/);
    if (match) {
      nextSeq = parseInt(match[1]) + 1;
    }
  }

  return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
}

async function getInvoicesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const invoiceType = searchParams.get('invoiceType');
  const status = searchParams.get('status');
  const customerId = searchParams.get('customerId');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';
  const search = searchParams.get('search') || '';

  const where: Record<string, unknown> = { storeId };

  if (invoiceType) {
    const types = invoiceType.split(',');
    where.invoiceType = types.length === 1 ? types[0] : { in: types };
  }

  if (status) {
    const statuses = status.split(',');
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search } },
      { customerName: { contains: search } },
      { customerPhone: { contains: search } },
      { customerEmail: { contains: search } },
    ];
  }

  const validSortFields = ['invoiceNumber', 'customerName', 'totalAmount', 'status', 'createdAt', 'issueDate', 'dueDate'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [invoices, total] = await Promise.all([
    db.invoice.findMany({
      where,
      include: {
        _count: {
          select: { items: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.invoice.count({ where }),
  ]);

  const result = invoices.map((inv) => {
    const { _count, ...invData } = inv;
    return {
      ...invData,
      itemCount: _count.items,
    };
  });

  return Response.json({
    success: true,
    data: result,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createInvoiceHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    invoiceType,
    customerId,
    customerName,
    customerPhone,
    customerEmail,
    customerAddress,
    issueDate,
    dueDate,
    discountAmount,
    notes,
    terms,
    createdBy,
    items,
  } = body;

  if (!storeId || !customerName) {
    return Response.json(
      { success: false, error: 'storeId and customerName are required.' },
      { status: 400 }
    );
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: 'At least one invoice item is required.' },
      { status: 400 }
    );
  }

  const type = invoiceType || 'INVOICE';
  const validTypes = ['INVOICE', 'QUOTATION', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE'];
  if (!validTypes.includes(type)) {
    return Response.json(
      { success: false, error: `Invalid invoiceType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  // Validate items and compute totals
  let subtotal = 0;
  let taxAmount = 0;
  const invoiceItems = items.map((item: {
    productId?: string;
    productName: string;
    description?: string;
    quantity: number;
    unitType?: string;
    pricePerUnit: number;
    discountPercent?: number;
    taxRate?: number;
  }) => {
    if (!item.productName || item.quantity === undefined || item.pricePerUnit === undefined) {
      throw new Error('Each item must have productName, quantity, and pricePerUnit.');
    }
    if (item.quantity <= 0) {
      throw new Error('Item quantity must be greater than 0.');
    }

    const discountPct = item.discountPercent || 0;
    const taxRt = item.taxRate ?? 16;
    const lineSubtotal = item.quantity * item.pricePerUnit;
    const lineDiscount = lineSubtotal * (discountPct / 100);
    const lineAfterDiscount = lineSubtotal - lineDiscount;
    const lineTax = lineAfterDiscount * (taxRt / 100);
    const lineTotal = lineAfterDiscount + lineTax;

    subtotal += lineSubtotal;
    taxAmount += lineTax;

    return {
      productId: item.productId || null,
      productName: item.productName,
      description: item.description || null,
      quantity: item.quantity,
      unitType: item.unitType || 'PIECE',
      pricePerUnit: item.pricePerUnit,
      discountPercent: discountPct,
      taxRate: taxRt,
      lineTotal,
    };
  });

  const totalDiscount = discountAmount || 0;
  const totalAmount = subtotal - totalDiscount + taxAmount;

  // Generate invoice number
  const invoiceNumber = await generateInvoiceNumber(type);

  const invoice = await db.invoice.create({
    data: {
      storeId,
      invoiceNumber,
      invoiceType: type,
      customerId: customerId || null,
      customerName,
      customerPhone: customerPhone || null,
      customerEmail: customerEmail || null,
      customerAddress: customerAddress || null,
      issueDate: issueDate ? new Date(issueDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : null,
      subtotal,
      taxAmount,
      discountAmount: totalDiscount,
      totalAmount,
      status: 'DRAFT',
      notes: notes || null,
      terms: terms || null,
      createdBy: createdBy || null,
      items: {
        create: invoiceItems,
      },
    },
    include: {
      items: true,
    },
  });

  await systemLog({
    action: 'INVOICE_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `${type} ${invoiceNumber} created for ${customerName}`,
    storeId,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber,
      invoiceType: type,
      totalAmount,
      itemCount: items.length,
    },
  });

  return Response.json({ success: true, data: invoice }, { status: 201 });
}

export const GET = withErrorBoundary(getInvoicesHandler, 'INVOICES_LIST');
export const POST = withErrorBoundary(createInvoiceHandler, 'INVOICES_CREATE');
