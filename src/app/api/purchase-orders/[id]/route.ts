// GET/PUT /api/purchase-orders/[id]

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { calculateWeightedAverageCost } from '@/lib/account-helper';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getPurchaseOrderHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
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

async function updatePurchaseOrderHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
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

    if (body.status) {
    const validStatuses = ['DRAFT', 'SENT', 'CONFIRMED', 'RECEIVED', 'CANCELLED'];
    if (!validStatuses.includes(body.status)) {
      return Response.json(
        { success: false, error: 'Invalid status. Valid statuses: ' + validStatuses.join(', ') },
        { status: 400 }
      );
    }

    const purchaseOrder = await db.purchaseOrder.update({
      where: { id },
      data: { status: body.status, notes: body.notes || existing.notes },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });

    await systemLog({
      action: 'PURCHASE_ORDER_STATUS_UPDATED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Purchase Order ${existing.poNumber} status changed to ${body.status}`,
      storeId: existing.storeId,
      metadata: { poId: id, poNumber: existing.poNumber, newStatus: body.status },
    });

    return Response.json({ success: true, data: purchaseOrder });
  }

    if (body.action === 'receive' && body.receivedItems) {
    if (existing.status === 'CANCELLED') {
      return Response.json(
        { success: false, error: 'Cannot receive items for a cancelled purchase order.' },
        { status: 400 }
      );
    }

    const receivedItems: { itemId: string; receivedQty: number }[] = body.receivedItems;

        const result = await db.$transaction(async (tx) => {
            for (const recv of receivedItems) {
        const item = existing.items.find((i) => i.id === recv.itemId);
        if (!item) continue;

        const newReceivedQty = item.receivedQty + recv.receivedQty;

        await tx.purchaseOrderItem.update({
          where: { id: recv.itemId },
          data: { receivedQty: newReceivedQty },
        });

        // ── Weighted Average Cost (WAC) recompute ──
        // IAS 2 mandates WAC for interchangeable inventory. Each reception
        // blends the incoming per-unit cost with the on-hand WAC, producing
        // a new per-unit cost that is used for COGS at checkout and balance-
        // sheet valuation. We read the current stock + costPrice, compute
        // the new WAC, then update BOTH fields in a single write so the
        // books stay consistent.
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
          incomingUnitCost: item.unitPrice,
        });

                await tx.product.update({
          where: { id: item.productId },
          data: {
            quantityInStock: { increment: recv.receivedQty },
            // Persist the new blended WAC so the next checkout / valuation
            // uses the correct per-unit cost. Rounded to 4 DP inside the
            // helper (KRA eTIMS precision).
            costPrice: wac.newWac,
          },
        });

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

            const allItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
      });

      const allReceived = allItems.every((item) => item.receivedQty >= item.quantity);

      if (allReceived && existing.status !== 'RECEIVED') {
        await tx.purchaseOrder.update({
          where: { id },
          data: { status: 'RECEIVED' },
        });
      }

      return tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true, unitType: true } } } },
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

  return Response.json(
    { success: false, error: 'No valid action specified. Use "status" or "action: receive".' },
    { status: 400 }
  );
}

export const GET = withErrorBoundary(getPurchaseOrderHandler, 'PURCHASE_ORDER_DETAIL');
export const PUT = withErrorBoundary(updatePurchaseOrderHandler, 'PURCHASE_ORDER_UPDATE');
