/**
 * MBUMAH HARDWARE - Product Detail API
 * GET /api/products/[id] - Get product by ID
 * PUT /api/products/[id] - Update product
 * DELETE /api/products/[id] - Delete product
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getProductHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, color: true, icon: true } },
      bundleItems: {
        include: {
          childProduct: { select: { id: true, name: true, sku: true, quantityInStock: true, pricePerUnit: true, unitType: true } },
        },
      },
      parentBundles: {
        include: {
          parentProduct: { select: { id: true, name: true, sku: true, pricePerUnit: true } },
        },
      },
      stockMovements: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          movementType: true,
          quantity: true,
          notes: true,
          createdAt: true,
        },
      },
      warehouseStocks: true,
    },
  });

  if (!product) {
    return Response.json(
      { success: false, error: 'Product not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: product });
}

async function updateProductHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.product.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Product not found.' },
      { status: 404 }
    );
  }

  // Check for duplicate barcode if being updated
  if (body.barcode && body.barcode !== existing.barcode) {
    const duplicateBarcode = await db.product.findUnique({ where: { barcode: body.barcode } });
    if (duplicateBarcode) {
      return Response.json(
        { success: false, error: 'A product with this barcode already exists.' },
        { status: 409 }
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'name', 'description', 'barcode', 'categoryId', 'unitType',
    'reorderLevel', 'pricePerUnit', 'costPrice', 'taxRate',
    'isRental', 'isBundle', 'imageUrl', 'isActive',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const product = await db.product.update({
    where: { id },
    data: updateData,
    include: {
      category: { select: { id: true, name: true, color: true } },
    },
  });

  await systemLog({
    action: 'PRODUCT_UPDATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Product "${product.name}" updated`,
    storeId: product.storeId,
    metadata: { productId: id, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: product });
}

async function deleteProductHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.product.findUnique({
    where: { id },
    include: {
      saleItems: { take: 1 },
      stockMovements: { take: 1 },
    },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Product not found.' },
      { status: 404 }
    );
  }

  if (existing.saleItems.length > 0 || existing.stockMovements.length > 0) {
    // Soft delete instead
    await db.product.update({
      where: { id },
      data: { isActive: false },
    });

    await systemLog({
      action: 'PRODUCT_SOFT_DELETED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.WARN,
      message: `Product "${existing.name}" soft-deleted (has related records)`,
      storeId: existing.storeId,
      metadata: { productId: id, sku: existing.sku },
    });

    return Response.json({
      success: true,
      message: 'Product deactivated (has related records).',
      data: { id, isActive: false },
    });
  }

  await db.product.delete({ where: { id } });

  await systemLog({
    action: 'PRODUCT_DELETED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Product "${existing.name}" permanently deleted`,
    storeId: existing.storeId,
    metadata: { productId: id, sku: existing.sku },
  });

  return Response.json({
    success: true,
    message: 'Product deleted successfully.',
  });
}

export const GET = withErrorBoundary(getProductHandler, 'PRODUCT_DETAIL');
export const PUT = withErrorBoundary(updateProductHandler, 'PRODUCT_UPDATE');
export const DELETE = withErrorBoundary(deleteProductHandler, 'PRODUCT_DELETE');
