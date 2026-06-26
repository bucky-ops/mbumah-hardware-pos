// GET/POST /api/subcategories

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getSubCategoriesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  const categoryId = searchParams.get('categoryId');

  const where: Record<string, unknown> = {};

  if (categoryId) {
    where.categoryId = categoryId;
  }

  // Filter by storeId through the parent category relation
  if (storeId) {
    where.category = { storeId };
  }

  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'sortOrder';
  const sortOrder = searchParams.get('sortOrder') || 'asc';
  const isActive = searchParams.get('isActive');

  if (isActive !== null && isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  const validSortFields = ['name', 'sortOrder', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'sortOrder';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [subCategories, total] = await Promise.all([
    db.subCategory.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true, storeId: true },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.subCategory.count({ where }),
  ]);

  const result = subCategories.map((sub: { id: string; name: string }) => {
    const { _count, ...subData } = sub;
    return {
      ...subData,
      productCount: _count.products,
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

async function createSubCategoryHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    categoryId,
    name,
    description,
    icon,
    color,
    sortOrder,
    isActive,
  } = body;

  if (!categoryId || !name) {
    return Response.json(
      { success: false, error: 'categoryId and name are required.' },
      { status: 400 }
    );
  }

  // Verify the parent category exists
  const category = await db.productCategory.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    return Response.json(
      { success: false, error: 'Parent category not found.' },
      { status: 404 }
    );
  }

  // Check for duplicate name within the same category
  const existing = await db.subCategory.findFirst({
    where: { categoryId, name },
  });

  if (existing) {
    return Response.json(
      { success: false, error: 'A sub-category with this name already exists in this category.' },
      { status: 409 }
    );
  }

  const subCategory = await db.subCategory.create({
    data: {
      categoryId,
      name,
      description: description || null,
      icon: icon || null,
      color: color || null,
      sortOrder: sortOrder ?? 0,
      isActive: isActive ?? true,
    },
    include: {
      category: {
        select: { id: true, name: true, storeId: true },
      },
    },
  });

  await systemLog({
    action: 'SUBCATEGORY_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Sub-category "${name}" created under category "${category.name}"`,
    storeId: category.storeId,
    metadata: { subCategoryId: subCategory.id, categoryId },
  });

  return Response.json({ success: true, data: subCategory }, { status: 201 });
}

export const GET = withErrorBoundary(getSubCategoriesHandler, 'SUBCATEGORIES_LIST');
export const POST = withErrorBoundary(createSubCategoryHandler, 'SUBCATEGORIES_CREATE');
