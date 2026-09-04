// GET/POST /api/invoices

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const INVOICE_PREFIXES: Record<string, string> = {
  INVOICE: 'INV',
  QUOTATION: 'QUO',
  PROFORMA: 'PRO',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
};

// AUDIT FIX: quotes are Invoice rows with invoiceType QUOTATION/PROFORMA and
// dueDate as the "Valid Until" date. Invoice.status is a plain String column
// (schema.prisma ~1215 — NOT a Prisma enum), so both CONVERTED marking and
// lazy auto-expiry below are allowed without schema changes.
const QUOTE_TYPES = ['QUOTATION', 'PROFORMA'];
// Statuses that mean a quote is no longer open for conversion/auto-expiry.
const QUOTE_TERMINAL_STATUSES = ['EXPIRED', 'CONVERTED', 'CANCELLED', 'ACCEPTED', 'PAID', 'INVOICED'];
const CONVERSION_NOTES_PREFIX = 'Converted from';

/**
 * AUDIT FIX (lazy auto-expiry): quotes past their dueDate were never expired,
 * so stale prices could be converted indefinitely. On any GET/POST to this
 * route, flip overdue open quotes to EXPIRED. Best-effort: never blocks the
 * enclosing request.
 */
async function expireStaleQuotes(storeId?: string): Promise<void> {
  try {
    await db.invoice.updateMany({
      where: {
        invoiceType: { in: QUOTE_TYPES },
        status: { notIn: QUOTE_TERMINAL_STATUSES },
        dueDate: { lt: new Date() },
        ...(storeId ? { storeId } : {}),
      },
      data: { status: 'EXPIRED' },
    });
  } catch (error) {
    // Lazy side-effect must not take the invoices route down.
    console.error('Lazy quote auto-expiry failed (non-fatal):', error);
  }
}

/** Sentinel for the atomic quote-claim inside the create transaction. */
class QuoteAlreadyConvertedError extends Error {
  constructor(public sourceInvoiceNumber: string) {
    super(`Quote ${sourceInvoiceNumber} has already been converted to an invoice.`);
    this.name = 'QuoteAlreadyConvertedError';
  }
}

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

  // AUDIT FIX: lazily expire overdue quotes so listings reflect reality.
  await expireStaleQuotes(storeId);

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

  // AUDIT FIX: lazily expire overdue quotes on POST too.
  await expireStaleQuotes(typeof storeId === 'string' ? storeId : undefined);

  // ── Quote→Invoice conversion enforcement ─────────────────────────────────
  // The client converts a quote by re-POSTing an INVOICE-type document whose
  // notes start with "Converted from <quoteNumber>" and that copy the quote's
  // (possibly stale) dueDate — see src/app/tabs/invoices-tab.tsx:477-503.
  // Detection below mirrors that exact payload shape.
  let sourceQuote: {
    id: string;
    invoiceNumber: string;
    dueDate: Date | null;
    status: string;
    invoiceType: string;
  } | null = null;

  if (type === 'INVOICE' && typeof notes === 'string' && notes.startsWith(CONVERSION_NOTES_PREFIX)) {
    const sourceRef = notes.slice(CONVERSION_NOTES_PREFIX.length).trim().split(/\s+/)[0] || '';
    if (sourceRef) {
      sourceQuote = await db.invoice.findFirst({
        where: {
          storeId,
          invoiceNumber: sourceRef,
          invoiceType: { in: QUOTE_TYPES },
        },
        select: { id: true, invoiceNumber: true, dueDate: true, status: true, invoiceType: true },
      });
    }
  }

  if (sourceQuote) {
    // (b) Double-conversion guard #1 — quotes converted after this fix are
    // marked CONVERTED (Invoice.status is a plain String column).
    if (sourceQuote.status === 'CONVERTED') {
      return Response.json(
        {
          success: false,
          error: `Quote ${sourceQuote.invoiceNumber} has already been converted to an invoice.`,
          code: 'QUOTE_ALREADY_CONVERTED',
        },
        { status: 409 }
      );
    }

    // (b) Double-conversion guard #2 (back-compat) — quotes converted before
    // this fix carry no CONVERTED status; detect via the client's own
    // "Converted from <quoteNumber>" notes fingerprint.
    const existingConversion = await db.invoice.findFirst({
      where: {
        storeId,
        invoiceType: 'INVOICE',
        notes: { contains: `${CONVERSION_NOTES_PREFIX} ${sourceQuote.invoiceNumber}` },
      },
      select: { invoiceNumber: true },
    });
    if (existingConversion) {
      return Response.json(
        {
          success: false,
          error: `Quote ${sourceQuote.invoiceNumber} has already been converted (invoice ${existingConversion.invoiceNumber}).`,
          code: 'QUOTE_ALREADY_CONVERTED',
        },
        { status: 409 }
      );
    }

    // (a) Expiry guard: dueDate is the quote's "Valid Until". Compare against
    // the START of today so a quote valid through today still converts.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (
      (sourceQuote.dueDate && sourceQuote.dueDate < startOfToday) ||
      sourceQuote.status === 'EXPIRED'
    ) {
      return Response.json(
        {
          success: false,
          error: `Quote ${sourceQuote.invoiceNumber} expired${sourceQuote.dueDate ? ` on ${sourceQuote.dueDate.toISOString().split('T')[0]}` : ''}. Please revalidate prices/items (create a fresh quote) before converting.`,
          code: 'QUOTE_EXPIRED',
        },
        { status: 409 }
      );
    }
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

  // AUDIT FIX: create + atomic quote claim run in one transaction so two
  // concurrent conversions cannot both pass the pre-checks above.
  const invoice = await db.$transaction(async (tx) => {
    if (sourceQuote) {
      // (b) Atomic claim of the source quote — the updateMany predicate makes
      // check-and-mark a single operation; a concurrent loser gets count 0.
      const claim = await tx.invoice.updateMany({
        where: { id: sourceQuote.id, status: { not: 'CONVERTED' } },
        data: { status: 'CONVERTED' },
      });
      if (claim.count === 0) {
        throw new QuoteAlreadyConvertedError(sourceQuote.invoiceNumber);
      }
    }

    return tx.invoice.create({
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
  }).catch((error: unknown) => {
    if (error instanceof QuoteAlreadyConvertedError) {
      return Response.json(
        {
          success: false,
          error: error.message,
          code: 'QUOTE_ALREADY_CONVERTED',
        },
        { status: 409 }
      );
    }
    throw error;
  });

  // The transaction catch above can resolve to a 409 Response — short-circuit.
  if (invoice instanceof Response) {
    return invoice;
  }

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
      // AUDIT FIX: trace quote conversions in the audit log.
      convertedFrom: sourceQuote?.invoiceNumber ?? undefined,
    },
  });

  return Response.json({ success: true, data: invoice }, { status: 201 });
}

// AUDIT FIX: session auth verified present on both handlers (base wrapper,
// no roles — mirrors the other money routes). Quote expiry enforcement from
// fix 4 runs inside the handlers above.
export const GET = withErrorBoundary(withSessionAuth(getInvoicesHandler), 'INVOICES_LIST');
export const POST = withErrorBoundary(withSessionAuth(createInvoiceHandler), 'INVOICES_CREATE');
