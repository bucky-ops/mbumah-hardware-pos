// GET/PUT/DELETE /api/products/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest, MANAGER_PLUS_ROLES } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getProductHandler(...args: unknown[]): Promise<Response> {
  const _request = args[0] as NextRequest;
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
    // v2.6.1 UoM conversion: `sellingUnit` (string; ''/null clears it) and
    // `conversionFactor` (how many BASE units one SELLING unit contains —
    // validated below). The checkout deducts quantity × conversionFactor.
    'sellingUnit', 'conversionFactor',
  ];

  // SKU is editable so legacy products can be re-coded to the branch-code
  // convention (MBM-<branchCode>-…) without deleting historical records.
  // Globally unique — 409 on a clash.
  if (body.sku !== undefined) {
    const newSku = String(body.sku).trim();
    if (newSku.length < 2) {
      return Response.json(
        { success: false, error: 'SKU must be at least 2 characters.' },
        { status: 400 }
      );
    }
    if (newSku !== existing.sku) {
      const clash = await db.product.findUnique({ where: { sku: newSku }, select: { id: true } });
      if (clash && clash.id !== id) {
        return Response.json(
          { success: false, error: 'A product with this SKU already exists.' },
          { status: 409 }
        );
      }
      updateData.sku = newSku;
    }
  }

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // v2.6.1 UoM guards: '' sellingUnit means "sell in the base unit" (null);
  // the factor must be a positive finite number (a zero/garbage factor would
  // silently deduct no stock at checkout).
  if (updateData.sellingUnit !== undefined) {
    const su = String(updateData.sellingUnit).trim().toUpperCase();
    updateData.sellingUnit = su === '' ? null : su.slice(0, 20);
  }
  if (updateData.conversionFactor !== undefined) {
    const cf = Number(updateData.conversionFactor);
    if (!Number.isFinite(cf) || cf <= 0 || cf > 1000) {
      return Response.json(
        { success: false, error: 'conversionFactor must be a positive number (base units per selling unit).' },
        { status: 400 }
      );
    }
    updateData.conversionFactor = cf;
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

  // v2.6.0: price-change audit — any change to pricePerUnit or costPrice is
  // a money-moving event and gets a tamper-evident trail entry with the old
  // and new prices. Values are Number()-coerced plain JSON (Prisma Decimals
  // serialize as strings through Response.json — never let them reach the
  // audit chain).
  const priceChanged =
    updateData.pricePerUnit !== undefined &&
    Number(updateData.pricePerUnit) !== Number(existing.pricePerUnit);
  const costChanged =
    updateData.costPrice !== undefined &&
    Number(updateData.costPrice) !== Number(existing.costPrice);
  if (priceChanged || costChanged) {
    try {
      const session = await getSessionFromRequest(request);
      const { auditTrail } = await import('@/lib/audit-trail');
      await auditTrail.log({
        action: 'UPDATE',
        resourceType: 'PRODUCT_PRICE',
        resourceId: id,
        actorId: session?.userId,
        actorRole: session?.role,
        storeId: product.storeId,
        oldValues: {
          pricePerUnit: Number(existing.pricePerUnit),
          costPrice: Number(existing.costPrice),
        },
        newValues: {
          pricePerUnit: Number(product.pricePerUnit),
          costPrice: Number(product.costPrice),
        },
        metadata: {
          sku: product.sku,
          name: product.name,
        },
      });
    } catch {
      /* audit chain must never block the update response */
    }
  }

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
  const _request = args[0] as NextRequest;
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

// AUDIT FIX (Task 3-d): GET = any store role; PUT/DELETE (price edit, delete) =
// manager-or-above per PERMISSION_MATRIX (CASHIER has products: ['read'] only).
export const GET = withErrorBoundary(
  withSessionAuth(getProductHandler),
  'PRODUCT_DETAIL',
);
export const PUT = withErrorBoundary(
  withSessionAuth(updateProductHandler, { roles: MANAGER_PLUS_ROLES }),
  'PRODUCT_UPDATE',
);
export const DELETE = withErrorBoundary(
  withSessionAuth(deleteProductHandler, { roles: MANAGER_PLUS_ROLES }),
  'PRODUCT_DELETE',
);
