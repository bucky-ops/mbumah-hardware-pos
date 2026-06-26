// GET/POST /api/tax/categories

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getTaxCategoriesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const isActive = searchParams.get('isActive');
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (isActive !== null && isActive !== undefined && isActive !== '') {
    where.isActive = isActive === 'true';
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { etimsCode: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['name', 'rate', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [categories, total] = await Promise.all([
    db.taxCategory.findMany({
      where,
      include: {
        taxRates: {
          where: { isActive: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 3,
        },
        _count: { select: { taxRates: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.taxCategory.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: categories,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createTaxCategoryHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    rate,
    description,
    etimsCode,
  } = body;

  if (!storeId || !name || rate === undefined) {
    return Response.json(
      { success: false, error: 'storeId, name, and rate are required.' },
      { status: 400 }
    );
  }

  if (rate < 0 || rate > 100) {
    return Response.json(
      { success: false, error: 'rate must be between 0 and 100.' },
      { status: 400 }
    );
  }

  const category = await db.taxCategory.create({
    data: {
      storeId,
      name,
      rate: parseFloat(String(rate)),
      description: description || null,
      etimsCode: etimsCode || null,
      isActive: true,
    },
  });

  await systemLog({
    action: 'TAX_CATEGORY_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Tax category "${name}" created with rate ${rate}%`,
    storeId,
    metadata: { taxCategoryId: category.id, name, rate, etimsCode: etimsCode || null },
  });

  return Response.json({ success: true, data: category }, { status: 201 });
}

export const GET = withErrorBoundary(getTaxCategoriesHandler, 'TAX_CATEGORIES_LIST');
export const POST = withErrorBoundary(createTaxCategoryHandler, 'TAX_CATEGORIES_CREATE');
