// GET/PUT/DELETE /api/products/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
// v2.12.2 (PR B — RBAC): supplier-cost visibility gate + product-edit roles.
// v2.12.7 (PR C): recordPermissionDenied feeds the HIGH_RISK_ATTEMPT price-guard
// denial into the SecurityEvent feed + the hash-chained AuditLog.
import {
  withSessionAuth,
  getSessionFromRequest,
  MANAGER_PLUS_ROLES,
  recordPermissionDenied,
} from '@/lib/auth';
import { hasFeaturePermission } from '@/lib/permissions';
// v2.12.7 (PR C): manager step-up for the ±20% price guard (same credential
// rules as checkout + /api/auth/manager-authorize — never a drifting copy).
import { authorizeManager, clientIpFromHeaders } from '@/lib/manager-auth';

export const dynamic = 'force-dynamic';

/** v2.12.2 (PR B — RBAC): roles allowed to EDIT catalog items —
 *  MANAGER_PLUS_ROLES + INVENTORY_MANAGER (PERMISSION_MATRIX.products
 *  create/update and FEATURE_PERMISSIONS['inventory.edit']). */
const PRODUCT_EDIT_ROLES: readonly string[] = [...MANAGER_PLUS_ROLES, 'INVENTORY_MANAGER'];

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

  // v2.12.2 (PR B — RBAC): supplier-cost visibility. Roles without
  // 'inventory.view.cost' (CASHIER / ACCOUNTANT) get costPrice nulled on the
  // detail payload too (the list route strips the same field — the detail
  // route must not be the leak-around).
  const detailSession = await getSessionFromRequest(_request);
  const canViewCost = hasFeaturePermission(detailSession?.role, 'inventory.view.cost');

  return Response.json({
    success: true,
    data: {
      ...product,
      costPrice: canViewCost ? Number(product.costPrice) : null,
    },
  });
}

async function updateProductHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  // v2.12.7 (PR C): session resolved once up-front (was previously re-resolved
  // inside the price-change audit block) — the price guard below needs it.
  const session = await getSessionFromRequest(request);

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

  // ── v2.12.7 (PR C): INVENTORY_MANAGER price guard (±20% of cost) ──────────
  // INVENTORY_MANAGER is the catalog steward (PRODUCT_EDIT_ROLES) but a
  // business-price decision that moves the price more than ±20% away from the
  // cost basis is a manager-tier call. Deviations beyond that threshold from a
  // bare INVENTORY_MANAGER session are refused with MANAGER_APPROVAL_REQUIRED
  // and recorded as a HIGH_RISK_ATTEMPT (SecurityEvent + AuditLog PERMISSION_DENIED
  // row — visible in the Audit Trail). The SAME managerOverride credential
  // object used at checkout ({approverEmail, approverPassword, reason}) lets a
  // Branch Manager+ approve the change inline; the approval consumes one
  // MANAGER_OVERRIDE hash-chained audit row (overrideContext
  // PRODUCT_PRICE_GUARD).
  //
  // Deliberately scoped to INVENTORY_MANAGER only: every other role either
  // holds manager-tier trust already (MANAGER_PLUS_ROLES) or cannot reach this
  // handler at all (the route's roles gate).
  if (updateData.pricePerUnit !== undefined && session && session.role === 'INVENTORY_MANAGER') {
    const newPrice = Number(updateData.pricePerUnit);
    const oldPrice = Number(existing.pricePerUnit);
    const costPrice = existing.costPrice === null ? null : Number(existing.costPrice);
    // Baseline: cost when present and positive, else the OLD selling price.
    const baseline =
      costPrice !== null && Number.isFinite(costPrice) && costPrice > 0
        ? costPrice
        : oldPrice;
    const deviation =
      Number.isFinite(newPrice) && baseline > 0
        ? Math.abs(newPrice - baseline) / baseline
        : 0;

    if (Number.isFinite(newPrice) && deviation > 0.2) {
      const overrideObject =
        body?.managerOverride && typeof body.managerOverride === 'object'
          ? (body.managerOverride as {
              approverEmail?: unknown;
              approverPassword?: unknown;
              reason?: unknown;
            })
          : null;

      let approved = false;
      if (overrideObject?.approverEmail && overrideObject?.approverPassword) {
        const overrideAuth = await authorizeManager(
          {
            approverEmail: String(overrideObject.approverEmail),
            approverPassword: String(overrideObject.approverPassword),
          },
          {
            ip: clientIpFromHeaders(request.headers),
            userAgent: request.headers.get('user-agent') || undefined,
            storeId: existing.storeId,
            requesterId: session.userId,
          }
        );

        if (overrideAuth.ok) {
          approved = true;
          // One MANAGER_OVERRIDE AuditLog row for this approved price change.
          try {
            const { auditTrail } = await import('@/lib/audit-trail');
            await auditTrail.log({
              actorId: session.userId,
              actorRole: session.role,
              action: 'MANAGER_OVERRIDE',
              resourceType: 'ManagerOverride',
              resourceId: overrideAuth.manager.id,
              reason:
                (typeof overrideObject.reason === 'string' && overrideObject.reason) ||
                `Price guard override for ${existing.sku} (KES ${oldPrice} → ${newPrice})`,
              storeId: existing.storeId,
              ipAddress: clientIpFromHeaders(request.headers),
              userAgent: request.headers.get('user-agent') || undefined,
              metadata: {
                approverId: overrideAuth.manager.id,
                approverName: overrideAuth.manager.name,
                approverEmail: overrideAuth.manager.email,
                approverRole: overrideAuth.manager.role,
                overrideContext: 'PRODUCT_PRICE_GUARD',
                productId: id,
                sku: existing.sku,
                oldPricePerUnit: oldPrice,
                newPricePerUnit: newPrice,
                costPrice,
              },
            });
          } catch {
            /* audit logging must never block an approved update */
          }
        } else if (overrideAuth.code === 'BRUTE_FORCE_PIN') {
          return Response.json(
            {
              success: false,
              code: 'BRUTE_FORCE_PIN',
              message: overrideAuth.message,
              retryAfterMinutes: overrideAuth.retryAfterMinutes,
            },
            {
              status: 429,
              headers: {
                'retry-after': String((overrideAuth.retryAfterMinutes ?? 1) * 60),
              },
            }
          );
        } else {
          // Invalid credentials / wrong role → behaves as if no override was
          // sent. One WARN breadcrumb keeps it triageable.
          await systemLog({
            action: 'MANAGER_OVERRIDE_DENIED',
            component: LogComponent.INVENTORY,
            severity: LogSeverity.WARN,
            message: `Product price-guard managerOverride rejected (${overrideAuth.code}) for ${String(overrideObject.approverEmail)}.`,
            storeId: existing.storeId,
            userId: session.userId,
            metadata: {
              productId: id,
              sku: existing.sku,
              approverEmail: String(overrideObject.approverEmail),
              code: overrideAuth.code,
            },
          }).catch(() => {});
        }
      }

      if (!approved) {
        try {
          await recordPermissionDenied({
            session,
            permission: 'inventory.price.guard',
            request,
            resource: `/api/products/${id}`,
            kind: 'HIGH_RISK_ATTEMPT',
          });
        } catch {
          /* never block the 403 on logging */
        }
        return Response.json(
          {
            success: false,
            code: 'MANAGER_APPROVAL_REQUIRED',
            message:
              'Price change exceeds 20% of cost. Ask your Branch Manager to approve.',
          },
          { status: 403 }
        );
      }
    }
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
      // (session is resolved once at the top of the handler — v2.12.7)
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
// v2.12.2: PUT adds INVENTORY_MANAGER (catalog steward role).
export const GET = withErrorBoundary(
  withSessionAuth(getProductHandler),
  'PRODUCT_DETAIL',
);
export const PUT = withErrorBoundary(
  withSessionAuth(updateProductHandler, { roles: PRODUCT_EDIT_ROLES }),
  'PRODUCT_UPDATE',
);
export const DELETE = withErrorBoundary(
  withSessionAuth(deleteProductHandler, { roles: PRODUCT_EDIT_ROLES }),
  'PRODUCT_DELETE',
);
