// GET/POST /api/products

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateSKU } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getProductsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const search = searchParams.get('search') || '';
  const categoryId = searchParams.get('categoryId') || '';
  const isRental = searchParams.get('isRental');
  const isBundle = searchParams.get('isBundle');
  const lowStock = searchParams.get('lowStock') === 'true';
  const isActive = searchParams.get('isActive');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'name';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  const where: Record<string, unknown> = { storeId };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { sku: { contains: search } },
      { barcode: { contains: search } },
      { description: { contains: search } },
    ];
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (isRental !== null && isRental !== undefined) {
    where.isRental = isRental === 'true';
  }

  if (isBundle !== null && isBundle !== undefined) {
    where.isBundle = isBundle === 'true';
  }

  if (isActive !== null && isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  if (lowStock) {
    where.quantityInStock = { lte: db.product.fields.reorderLevel };
  }

    const validSortFields = ['name', 'sku', 'pricePerUnit', 'quantityInStock', 'createdAt', 'updatedAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        bundleItems: {
          include: {
            childProduct: { select: { id: true, name: true, sku: true, quantityInStock: true, pricePerUnit: true } },
          },
        },
        parentBundles: {
          include: {
            parentProduct: { select: { id: true, name: true, sku: true } },
          },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.product.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createProductHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    sku,
    barcode,
    description,
    categoryId,
    unitType,
    quantityInStock,
    reorderLevel,
    pricePerUnit,
    costPrice,
    taxRate,
    isRental,
    isBundle,
    imageUrl,
  } = body;

  if (!storeId || !name || !pricePerUnit || !costPrice) {
    return Response.json(
      { success: false, error: 'storeId, name, pricePerUnit, and costPrice are required.' },
      { status: 400 }
    );
  }

    const productSku = sku || generateSKU(categoryId || 'GEN');

    const existingSku = await db.product.findUnique({ where: { sku: productSku } });
  if (existingSku) {
    return Response.json(
      { success: false, error: 'A product with this SKU already exists.' },
      { status: 409 }
    );
  }

    if (barcode) {
    const existingBarcode = await db.product.findUnique({ where: { barcode } });
    if (existingBarcode) {
      return Response.json(
        { success: false, error: 'A product with this barcode already exists.' },
        { status: 409 }
      );
    }
  }

  const product = await db.product.create({
    data: {
      storeId,
      name,
      sku: productSku,
      barcode: barcode || null,
      description: description || null,
      categoryId: categoryId || null,
      unitType: unitType || 'PIECE',
      quantityInStock: quantityInStock ?? 0,
      reorderLevel: reorderLevel ?? 10,
      pricePerUnit,
      costPrice,
      taxRate: taxRate ?? 16,
      isRental: isRental ?? false,
      isBundle: isBundle ?? false,
      imageUrl: imageUrl || null,
      isActive: true,
    },
    include: {
      category: { select: { id: true, name: true, color: true } },
    },
  });

  await systemLog({
    action: 'PRODUCT_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Product "${name}" created with SKU ${productSku}`,
    storeId,
    metadata: { productId: product.id, sku: productSku, name },
  });

  return Response.json({ success: true, data: product }, { status: 201 });
}

export const GET = withErrorBoundary(getProductsHandler, 'PRODUCTS_LIST');
export const POST = withErrorBoundary(createProductHandler, 'PRODUCTS_CREATE');
