// GET/POST /api/tax/filings

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getTaxFilingsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const filingType = searchParams.get('filingType');
  const status = searchParams.get('status');
  const filingPeriod = searchParams.get('filingPeriod');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (filingType) {
    where.filingType = filingType;
  }

  if (status) {
    where.status = status;
  }

  if (filingPeriod) {
    where.filingPeriod = filingPeriod;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  const validSortFields = ['filingPeriod', 'filingType', 'totalTax', 'status', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [filings, total] = await Promise.all([
    db.taxFiling.findMany({
      where,
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.taxFiling.count({ where }),
  ]);

  // Summary stats
  const summary = await db.taxFiling.aggregate({
    where,
    _sum: { totalSales: true, totalTax: true, totalWht: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: filings,
    summary: {
      totalSales: summary._sum.totalSales || 0,
      totalTax: summary._sum.totalTax || 0,
      totalWht: summary._sum.totalWht || 0,
      count: summary._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createTaxFilingHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    filingPeriod,
    filingType,
    totalSales,
    totalTax,
    totalWht,
    filingDate,
    dueDate,
    etimsReference,
    notes,
    filedBy,
  } = body;

  if (!storeId || !filingPeriod || !filingType) {
    return Response.json(
      { success: false, error: 'storeId, filingPeriod, and filingType are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['VAT', 'WHT', 'INCOME_TAX', 'TURNOVER_TAX'];
  if (!validTypes.includes(filingType)) {
    return Response.json(
      { success: false, error: `Invalid filingType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const filing = await db.taxFiling.create({
    data: {
      storeId,
      filingPeriod,
      filingType,
      totalSales: totalSales ?? 0,
      totalTax: totalTax ?? 0,
      totalWht: totalWht ?? 0,
      status: 'DRAFT',
      filingDate: filingDate ? new Date(filingDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      etimsReference: etimsReference || null,
      notes: notes || null,
      filedBy: filedBy || null,
    },
  });

  await systemLog({
    action: 'TAX_FILING_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Tax filing created: ${filingType} for period ${filingPeriod}`,
    storeId,
    userId: filedBy || undefined,
    metadata: {
      taxFilingId: filing.id,
      filingPeriod,
      filingType,
      totalTax: totalTax || 0,
    },
  });

  return Response.json({ success: true, data: filing }, { status: 201 });
}

export const GET = withErrorBoundary(getTaxFilingsHandler, 'TAX_FILINGS_LIST');
export const POST = withErrorBoundary(createTaxFilingHandler, 'TAX_FILINGS_CREATE');
