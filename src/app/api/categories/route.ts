/**
 * MBUMAH HARDWARE POS - Categories API
 * GET /api/categories - List categories for a store
 * POST /api/categories - Create a new category
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getCategoriesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const includeProductCount = searchParams.get('includeProductCount') === 'true';
  const isActive = searchParams.get('isActive');

  const where: Record<string, unknown> = { storeId };
  if (isActive !== null && isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  const categories = await db.productCategory.findMany({
    where,
    orderBy: { sortOrder: 'asc' },
    include: includeProductCount
      ? { _count: { select: { products: { where: { isActive: true } } } } }
      : undefined,
  });

  const result = categories.map((cat) => {
    const { _count, ...categoryData } = cat as typeof cat & { _count?: { products: number } };
    return {
      ...categoryData,
      ...(includeProductCount ? { productCount: _count?.products || 0 } : {}),
    };
  });

  return Response.json({ success: true, data: result });
}

async function createCategoryHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, name, description, icon, color, sortOrder, isActive } = body;

  if (!storeId || !name) {
    return Response.json(
      { success: false, error: 'storeId and name are required.' },
      { status: 400 }
    );
  }

  // Check for duplicate name within store
  const existing = await db.productCategory.findFirst({
    where: { storeId, name: { equals: name } },
  });

  if (existing) {
    return Response.json(
      { success: false, error: 'A category with this name already exists in this store.' },
      { status: 409 }
    );
  }

  // Get the next sort order if not provided
  let categorySortOrder = sortOrder;
  if (categorySortOrder === undefined || categorySortOrder === null) {
    const maxSort = await db.productCategory.findFirst({
      where: { storeId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    categorySortOrder = (maxSort?.sortOrder ?? 0) + 1;
  }

  const category = await db.productCategory.create({
    data: {
      storeId,
      name,
      description: description || null,
      icon: icon || null,
      color: color || null,
      sortOrder: categorySortOrder,
      isActive: isActive ?? true,
    },
  });

  await systemLog({
    action: 'CATEGORY_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Category "${name}" created`,
    storeId,
    metadata: { categoryId: category.id, name },
  });

  return Response.json({ success: true, data: category }, { status: 201 });
}

export const GET = withErrorBoundary(getCategoriesHandler, 'CATEGORIES_LIST');
export const POST = withErrorBoundary(createCategoryHandler, 'CATEGORIES_CREATE');
