// GET/PUT/DELETE /api/purchase-orders/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { calculateWeightedAverageCost } from '@/lib/account-helper';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getPurchaseOrderHandler(
  _request: NextRequest,
  _session: AuthSession,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;

  const purchaseOrder = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              unitType: true,
              quantityInStock: true,
              costPrice: true,
            },
          },
        },
      },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      cancelledBy: { select: { id: true, name: true } },
    },
  });

  if (!purchaseOrder) {
    return Response.json(
      { success: false, error: 'Purchase order not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: purchaseOrder });
}

async function updatePurchaseOrderHandler(
  request: NextRequest,
  _session: AuthSession,
  context: RouteContext,
): Promise<Response> {
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Purchase order not found.' },
      { status: 404 }
    );
  }

  // ── Status change (approve, send, confirm, cancel) ──────────────────────
  if (body.status) {
    const validStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];
    if (!validStatuses.includes(body.status)) {
      return Response.json(
        { success: false, error: 'Invalid status. Valid statuses: ' + validStatuses.join(', ') },
        { status: 400 }
      );
    }

    // Enforce status transition rules
    const statusTransitions: Record<string, string[]> = {
      DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
      PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
      APPROVED: ['SENT', 'CANCELLED'],
      SENT: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
      PARTIALLY_RECEIVED: ['RECEIVED'],
      RECEIVED: [],
      CANCELLED: [],
    };

    const allowed = statusTransitions[existing.status] || [];
    if (!allowed.includes(body.status)) {
      return Response.json(
        { success: false, error: `Cannot transition from ${existing.status} to ${body.status}. Allowed: ${allowed.join(', ') || 'none'}` },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      status: body.status,
      notes: body.notes || existing.notes,
    };

    // Track approval
    if (body.status === 'APPROVED') {
      updateData.approvedById = body.approvedById || null;
      updateData.approvedAt = new Date();
    }

    // Track cancellation
    if (body.status === 'CANCELLED') {
      updateData.cancelledById = body.cancelledById || null;
      updateData.cancelledAt = new Date();
    }

    const purchaseOrder = await db.purchaseOrder.update({
      where: { id },
      data: updateData,
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });

    await systemLog({
      action: 'PURCHASE_ORDER_STATUS_UPDATED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Purchase Order ${existing.poNumber} status changed to ${body.status}`,
      storeId: existing.storeId,
      metadata: { poId: id, poNumber: existing.poNumber, newStatus: body.status, previousStatus: existing.status },
    });

    return Response.json({ success: true, data: purchaseOrder });
  }

  // ── Receive items (Goods Receipt Note) ──────────────────────────────────
  if (body.action === 'receive' && body.receivedItems) {
    if (existing.status === 'CANCELLED') {
      return Response.json(
        { success: false, error: 'Cannot receive items for a cancelled purchase order.' },
        { status: 400 }
      );
    }

    if (existing.status !== 'CONFIRMED' && existing.status !== 'PARTIALLY_RECEIVED') {
      return Response.json(
        { success: false, error: 'Can only receive items for CONFIRMED or PARTIALLY_RECEIVED orders.' },
        { status: 400 }
      );
    }

    const receivedItems: { itemId: string; receivedQty: number }[] = body.receivedItems;
    const receivedById = body.receivedById || null;

    const result = await db.$transaction(async (tx) => {
      for (const recv of receivedItems) {
        const item = existing.items.find((i) => i.id === recv.itemId);
        if (!item) continue;

        if (recv.receivedQty <= 0) continue;

        const newReceivedQty = Number(item.receivedQty) + recv.receivedQty;

        // Validate not over-receiving
        if (newReceivedQty > Number(item.quantity)) {
          throw new Error(`Cannot receive more than ordered for item ${item.productName}. Ordered: ${item.quantity}, Already received: ${item.receivedQty}, Attempting: ${recv.receivedQty}`);
        }

        await tx.purchaseOrderItem.update({
          where: { id: recv.itemId },
          data: { receivedQty: newReceivedQty },
        });

        // ── Weighted Average Cost (WAC) recompute ──
        const productBefore = await tx.product.findUnique({
          where: { id: item.productId },
          select: { quantityInStock: true, costPrice: true, name: true, sku: true },
        });

        if (!productBefore) {
          throw new Error(`Product ${item.productId} not found during GRN receive.`);
        }

        const wac = calculateWeightedAverageCost({
          currentStock: productBefore.quantityInStock,
          currentWac: productBefore.costPrice,
          incomingStock: recv.receivedQty,
          incomingUnitCost: item.unitCost,
        });

        await tx.product.update({
          where: { id: item.productId },
          data: {
            quantityInStock: { increment: recv.receivedQty },
            costPrice: wac.newWac,
          },
        });

        // Update warehouse stock
        const warehouseStock = await tx.warehouseStock.findUnique({
          where: {
            storeId_productId_warehouse: {
              storeId: existing.storeId,
              productId: item.productId,
              warehouse: 'RECEIVING',
            },
          },
        });

        if (warehouseStock) {
          await tx.warehouseStock.update({
            where: { id: warehouseStock.id },
            data: { quantity: { increment: recv.receivedQty } },
          });
        } else {
          await tx.warehouseStock.create({
            data: {
              storeId: existing.storeId,
              productId: item.productId,
              warehouse: 'RECEIVING',
              quantity: recv.receivedQty,
            },
          });
        }

        // Create stock movement
        await tx.stockMovement.create({
          data: {
            storeId: existing.storeId,
            productId: item.productId,
            movementType: 'PURCHASE',
            quantity: recv.receivedQty,
            referenceId: existing.id,
            notes: `Received from PO ${existing.poNumber}`,
          },
        });
      }

      // Check if all items are fully received
      const allItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
      });

      const allReceived = allItems.every((item) => Number(item.receivedQty) >= Number(item.quantity));
      const anyReceived = allItems.some((item) => Number(item.receivedQty) > 0);

      let newStatus = existing.status;
      if (allReceived) {
        newStatus = 'RECEIVED';
      } else if (anyReceived) {
        newStatus = 'PARTIALLY_RECEIVED';
      }

      const updatePayload: Record<string, unknown> = { status: newStatus };

      if (allReceived) {
        updatePayload.receivedById = receivedById;
        updatePayload.receivedAt = new Date();
      }

      await tx.purchaseOrder.update({
        where: { id },
        data: updatePayload,
      });

      return tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true, unitType: true } } } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
        },
      });
    });

    await systemLog({
      action: 'PURCHASE_ORDER_ITEMS_RECEIVED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Items received for Purchase Order ${existing.poNumber}`,
      storeId: existing.storeId,
      metadata: {
        poId: id,
        poNumber: existing.poNumber,
        receivedCount: receivedItems.length,
      },
    });

    return Response.json({ success: true, data: result });
  }

  // ── Delete (only DRAFT or CANCELLED) ────────────────────────────────────
  if (body.action === 'delete') {
    if (existing.status !== 'DRAFT' && existing.status !== 'CANCELLED') {
      return Response.json(
        { success: false, error: 'Can only delete DRAFT or CANCELLED purchase orders.' },
        { status: 400 }
      );
    }

    await db.purchaseOrder.delete({ where: { id } });

    await systemLog({
      action: 'PURCHASE_ORDER_DELETED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Purchase Order ${existing.poNumber} deleted`,
      storeId: existing.storeId,
      metadata: { poId: id, poNumber: existing.poNumber },
    });

    return Response.json({ success: true, data: { id, deleted: true } });
  }

  return Response.json(
    { success: false, error: 'No valid action specified. Use "status", "action: receive", or "action: delete".' },
    { status: 400 }
  );
}

export const GET = withErrorBoundary(
  requireStoreAccess(getPurchaseOrderHandler),
  'PURCHASE_ORDER_DETAIL',
);
export const PUT = withErrorBoundary(
  requireStoreAccess(updatePurchaseOrderHandler),
  'PURCHASE_ORDER_UPDATE',
);
export const DELETE = withErrorBoundary(
  requireStoreAccess(updatePurchaseOrderHandler),
  'PURCHASE_ORDER_DELETE',
);
