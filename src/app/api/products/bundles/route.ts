/**
 * MBUMAH HARDWARE POS - Product Bundles API
 * GET /api/products/bundles - List all bundle products with their constituent items
 * POST /api/products/bundles - Create a new bundle product with constituent items
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateSKU } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getBundlesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');

  const where = { storeId, isBundle: true };

  const [bundles, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true } },
        bundleItems: {
          include: {
            childProduct: {
              select: {
                id: true,
                name: true,
                sku: true,
                quantityInStock: true,
                pricePerUnit: true,
                unitType: true,
                isActive: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.product.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: bundles,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createBundleHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    description,
    categoryId,
    pricePerUnit,
    costPrice,
    taxRate,
    sku,
    items,
  } = body;

  if (!storeId || !name || !pricePerUnit || !costPrice || !items || !Array.isArray(items) || items.length === 0) {
    return Response.json(
      { success: false, error: 'storeId, name, pricePerUnit, costPrice, and items array are required.' },
      { status: 400 }
    );
  }

  // Validate all constituent products exist
  const childProductIds = items.map((item: { childProductId: string; quantityRequired: number }) => item.childProductId);
  const childProducts = await db.product.findMany({
    where: { id: { in: childProductIds }, storeId },
  });

  if (childProducts.length !== childProductIds.length) {
    const foundIds = childProducts.map((p) => p.id);
    const missingIds = childProductIds.filter((id: string) => !foundIds.includes(id));
    return Response.json(
      { success: false, error: `Some constituent products not found: ${missingIds.join(', ')}` },
      { status: 400 }
    );
  }

  // Generate SKU if not provided
  const bundleSku = sku || generateSKU('BDL');

  // Check for duplicate SKU
  const existingSku = await db.product.findUnique({ where: { sku: bundleSku } });
  if (existingSku) {
    return Response.json(
      { success: false, error: 'A product with this SKU already exists.' },
      { status: 409 }
    );
  }

  // Create the bundle product and its constituent items in a transaction
  const bundle = await db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        storeId,
        name,
        description: description || null,
        categoryId: categoryId || null,
        sku: bundleSku,
        unitType: 'SET',
        quantityInStock: 999,
        reorderLevel: 0,
        pricePerUnit,
        costPrice,
        taxRate: taxRate ?? 16,
        isBundle: true,
        isActive: true,
      },
    });

    const bundleItemsData = items.map((item: { childProductId: string; quantityRequired: number }) => ({
      parentProductId: product.id,
      childProductId: item.childProductId,
      quantityRequired: item.quantityRequired,
    }));

    await tx.productBundle.createMany({ data: bundleItemsData });

    return tx.product.findUnique({
      where: { id: product.id },
      include: {
        category: { select: { id: true, name: true } },
        bundleItems: {
          include: {
            childProduct: { select: { id: true, name: true, sku: true, pricePerUnit: true, unitType: true } },
          },
        },
      },
    });
  });

  await systemLog({
    action: 'BUNDLE_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Bundle "${name}" created with ${items.length} items`,
    storeId,
    metadata: { bundleId: bundle!.id, sku: bundleSku, itemCount: items.length },
  });

  return Response.json({ success: true, data: bundle }, { status: 201 });
}

export const GET = withErrorBoundary(getBundlesHandler, 'BUNDLES_LIST');
export const POST = withErrorBoundary(createBundleHandler, 'BUNDLES_CREATE');
