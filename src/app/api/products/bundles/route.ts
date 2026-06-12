/**
 * MBUMAH HARDWARE - Product Bundles API
 * GET /api/products/bundles
 * POST /api/products/bundles
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
                costPrice: true,
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

  // Enrich each bundle with computed discount and component pricing
  const enrichedBundles = bundles.map((bundle) => {
    const componentTotalPrice = bundle.bundleItems.reduce(
      (sum, bi) => sum + (bi.childProduct.pricePerUnit * bi.quantityRequired),
      0
    );
    const componentTotalCost = bundle.bundleItems.reduce(
      (sum, bi) => sum + (bi.childProduct.costPrice * bi.quantityRequired),
      0
    );
    const discountAmount = componentTotalPrice - bundle.pricePerUnit;
    const discountPercent = componentTotalPrice > 0
      ? Math.round((discountAmount / componentTotalPrice) * 10000) / 100
      : 0;

    return {
      ...bundle,
      computed: {
        componentTotalPrice,
        componentTotalCost,
        discountAmount: Math.max(0, discountAmount),
        discountPercent: Math.max(0, discountPercent),
      },
    };
  });

  return Response.json({
    success: true,
    data: enrichedBundles,
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
    // New interface fields
    componentProducts,
    discountPercent,
  } = body;

  Determine which interface is being used
  const useNewInterface = componentProducts && Array.isArray(componentProducts) && componentProducts.length > 0;
  const useLegacyInterface = items && Array.isArray(items) && items.length > 0;

  if (!storeId || !name) {
    return Response.json(
      { success: false, error: 'storeId and name are required.' },
      { status: 400 }
    );
  }

  if (!useNewInterface && !useLegacyInterface) {
    return Response.json(
      { success: false, error: 'Either componentProducts or items array is required.' },
      { status: 400 }
    );
  }

  if (useLegacyInterface && (!pricePerUnit || !costPrice)) {
    return Response.json(
      { success: false, error: 'pricePerUnit and costPrice are required when using the items interface.' },
      { status: 400 }
    );
  }

  Normalize to a unified format
  // bundleComponents: Array of { productId, quantity }
  let bundleComponents: Array<{ productId: string; quantity: number }>;

  if (useNewInterface) {
    // New interface: componentProducts with productId + quantity
    bundleComponents = componentProducts.map(
      (cp: { productId: string; quantity: number }) => ({
        productId: cp.productId,
        quantity: parseFloat(String(cp.quantity || 1)),
      })
    );

    // Validate componentProducts entries
    for (const cp of bundleComponents) {
      if (!cp.productId || cp.quantity <= 0) {
        return Response.json(
          { success: false, error: 'Each componentProduct must have a valid productId and quantity > 0.' },
          { status: 400 }
        );
      }
    }
  } else {
    // Legacy interface: items with childProductId + quantityRequired
    bundleComponents = items.map(
      (item: { childProductId: string; quantityRequired: number }) => ({
        productId: item.childProductId,
        quantity: parseFloat(String(item.quantityRequired || 1)),
      })
    );
  }

  Validate all constituent products exist
  const childProductIds = bundleComponents.map((c) => c.productId);
  const childProducts = await db.product.findMany({
    where: { id: { in: childProductIds }, storeId, isActive: true },
  });

  if (childProducts.length !== childProductIds.length) {
    const foundIds = childProducts.map((p) => p.id);
    const missingIds = childProductIds.filter((id: string) => !foundIds.includes(id));
    return Response.json(
      { success: false, error: `Some constituent products not found or inactive: ${missingIds.join(', ')}` },
      { status: 400 }
    );
  }

  const childProductMap = new Map(childProducts.map((p) => [p.id, p]));

  Calculate bundle price for new interface
  let finalPricePerUnit: number;
  let finalCostPrice: number;

  if (useNewInterface) {
    // Calculate from component prices minus discount
    const componentTotalPrice = bundleComponents.reduce((sum, comp) => {
      const product = childProductMap.get(comp.productId);
      return sum + (product ? product.pricePerUnit * comp.quantity : 0);
    }, 0);

    const componentTotalCost = bundleComponents.reduce((sum, comp) => {
      const product = childProductMap.get(comp.productId);
      return sum + (product ? product.costPrice * comp.quantity : 0);
    }, 0);

    const discountValue = parseFloat(String(discountPercent || 0));
    if (discountValue < 0 || discountValue >= 100) {
      return Response.json(
        { success: false, error: 'discountPercent must be between 0 and 99.' },
        { status: 400 }
      );
    }

    finalPricePerUnit = componentTotalPrice * (1 - discountValue / 100);
    finalCostPrice = componentTotalCost;
  } else {
    finalPricePerUnit = parseFloat(String(pricePerUnit));
    finalCostPrice = parseFloat(String(costPrice));
  }

  // Round to 2 decimal places
  finalPricePerUnit = Math.round(finalPricePerUnit * 100) / 100;
  finalCostPrice = Math.round(finalCostPrice * 100) / 100;

  Generate SKU if not provided
  const bundleSku = sku || generateSKU('BDL');

  // Check for duplicate SKU
  const existingSku = await db.product.findUnique({ where: { sku: bundleSku } });
  if (existingSku) {
    return Response.json(
      { success: false, error: 'A product with this SKU already exists.' },
      { status: 409 }
    );
  }

  Create the bundle product and its constituent items in a transaction
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
        pricePerUnit: finalPricePerUnit,
        costPrice: finalCostPrice,
        taxRate: taxRate ?? 16,
        isBundle: true,
        isActive: true,
      },
    });

    const bundleItemsData = bundleComponents.map((comp) => ({
      parentProductId: product.id,
      childProductId: comp.productId,
      quantityRequired: comp.quantity,
    }));

    await tx.productBundle.createMany({ data: bundleItemsData });

    return tx.product.findUnique({
      where: { id: product.id },
      include: {
        category: { select: { id: true, name: true } },
        bundleItems: {
          include: {
            childProduct: { select: { id: true, name: true, sku: true, pricePerUnit: true, costPrice: true, unitType: true } },
          },
        },
      },
    });
  });

  // Calculate computed fields for the response
  const componentTotalPrice = bundleComponents.reduce((sum, comp) => {
    const product = childProductMap.get(comp.productId);
    return sum + (product ? product.pricePerUnit * comp.quantity : 0);
  }, 0);
  const effectiveDiscount = componentTotalPrice - finalPricePerUnit;
  const effectiveDiscountPercent = componentTotalPrice > 0
    ? Math.round((effectiveDiscount / componentTotalPrice) * 10000) / 100
    : 0;

  await systemLog({
    action: 'BUNDLE_CREATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Bundle "${name}" created with ${bundleComponents.length} items, price KES ${finalPricePerUnit}`,
    storeId,
    metadata: {
      bundleId: bundle!.id,
      sku: bundleSku,
      itemCount: bundleComponents.length,
      pricePerUnit: finalPricePerUnit,
      costPrice: finalCostPrice,
      discountPercent: effectiveDiscountPercent,
      interface: useNewInterface ? 'componentProducts' : 'items',
    },
  });

  return Response.json({
    success: true,
    data: {
      ...bundle,
      computed: {
        componentTotalPrice,
        discountAmount: Math.max(0, effectiveDiscount),
        discountPercent: Math.max(0, effectiveDiscountPercent),
      },
    },
  }, { status: 201 });
}

export const GET = withErrorBoundary(getBundlesHandler, 'BUNDLES_LIST');
export const POST = withErrorBoundary(createBundleHandler, 'BUNDLES_CREATE');
