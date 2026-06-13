// GET/PUT /api/store-transfers/[id]

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getStoreTransferHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const transfer = await db.storeTransfer.findUnique({
    where: { id },
    include: {
      fromStore: { select: { id: true, name: true, location: true, phone: true } },
      toStore: { select: { id: true, name: true, location: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, quantityInStock: true, unitType: true } },
        },
      },
    },
  });

  if (!transfer) {
    return Response.json(
      { success: false, error: 'Store transfer not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: transfer });
}

async function updateStoreTransferHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.storeTransfer.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) {
    return Response.json(
      { success: false, error: 'Store transfer not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const action = body.action; // approve, ship, receive, cancel

  if (action === 'approve') {
    if (existing.status !== 'PENDING') {
      return Response.json(
        { success: false, error: 'Only PENDING transfers can be approved.' },
        { status: 400 }
      );
    }
    updateData.status = 'IN_TRANSIT';
    updateData.approvedBy = body.approvedBy || null;

    await systemLog({
      action: 'STORE_TRANSFER_APPROVED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Transfer ${existing.transferNumber} approved`,
      storeId: existing.fromStoreId,
      userId: body.approvedBy || undefined,
      metadata: { transferId: id, transferNumber: existing.transferNumber },
    });
  } else if (action === 'ship') {
    if (existing.status !== 'IN_TRANSIT') {
      return Response.json(
        { success: false, error: 'Only IN_TRANSIT transfers can be shipped (must be approved first).' },
        { status: 400 }
      );
    }
    updateData.shippedAt = new Date();
    // Status stays IN_TRANSIT but we mark shippedAt

    // Deduct stock from origin store
    for (const item of existing.items) {
      const inventory = await db.inventory.findFirst({
        where: { productId: item.productId, storeId: existing.fromStoreId },
      });
      if (inventory) {
        await db.inventory.update({
          where: { id: inventory.id },
          data: { quantityInStock: { decrement: item.quantity } },
        });
      }
      // Log stock movement
      await db.stockMovement.create({
        data: {
          productId: item.productId,
          storeId: existing.fromStoreId,
          type: 'TRANSFER',
          quantity: -item.quantity,
          reason: `Transfer ${existing.transferNumber} to destination store`,
          referenceId: existing.id,
        },
      });
    }

    await systemLog({
      action: 'STORE_TRANSFER_SHIPPED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Transfer ${existing.transferNumber} shipped - stock deducted from origin`,
      storeId: existing.fromStoreId,
      userId: body.shippedBy || undefined,
      metadata: { transferId: id, transferNumber: existing.transferNumber, itemCount: existing.items.length },
    });
  } else if (action === 'receive') {
    if (existing.status !== 'IN_TRANSIT') {
      return Response.json(
        { success: false, error: 'Only IN_TRANSIT transfers can be received.' },
        { status: 400 }
      );
    }
    updateData.status = 'RECEIVED';
    updateData.receivedBy = body.receivedBy || null;
    updateData.receivedAt = new Date();

    // Add stock to destination store and update receivedQty
    const receivedItems = body.items || [];
    for (const item of existing.items) {
      const receivedItem = receivedItems.find(
        (ri: { productId: string }) => ri.productId === item.productId
      );
      const receivedQty = receivedItem?.receivedQty ?? item.quantity;

      // Update receivedQty on transfer item
      await db.storeTransferItem.update({
        where: { id: item.id },
        data: { receivedQty: parseFloat(String(receivedQty)) },
      });

      // Add stock to destination store
      const destInventory = await db.inventory.findFirst({
        where: { productId: item.productId, storeId: existing.toStoreId },
      });
      if (destInventory) {
        await db.inventory.update({
          where: { id: destInventory.id },
          data: { quantityInStock: { increment: parseFloat(String(receivedQty)) } },
        });
      } else {
        // Create inventory record if it doesn't exist
        const product = await db.product.findUnique({ where: { id: item.productId } });
        if (product) {
          await db.inventory.create({
            data: {
              productId: item.productId,
              storeId: existing.toStoreId,
              quantityInStock: parseFloat(String(receivedQty)),
              reorderLevel: product.reorderLevel,
            },
          });
        }
      }

      // Log stock movement
      await db.stockMovement.create({
        data: {
          productId: item.productId,
          storeId: existing.toStoreId,
          type: 'TRANSFER',
          quantity: parseFloat(String(receivedQty)),
          reason: `Received from transfer ${existing.transferNumber}`,
          referenceId: existing.id,
        },
      });
    }

    // Check for partial receipt
    const allItemsReceived = existing.items.every((item) => {
      const receivedItem = receivedItems.find(
        (ri: { productId: string }) => ri.productId === item.productId
      );
      const receivedQty = receivedItem?.receivedQty ?? item.quantity;
      return receivedQty >= item.quantity;
    });

    if (!allItemsReceived) {
      updateData.status = 'PARTIAL';
    }

    await systemLog({
      action: 'STORE_TRANSFER_RECEIVED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Transfer ${existing.transferNumber} received - stock added to destination`,
      storeId: existing.toStoreId,
      userId: body.receivedBy || undefined,
      metadata: { transferId: id, transferNumber: existing.transferNumber, status: updateData.status },
    });
  } else if (action === 'cancel') {
    if (!['PENDING', 'IN_TRANSIT'].includes(existing.status)) {
      return Response.json(
        { success: false, error: 'Only PENDING or IN_TRANSIT transfers can be cancelled.' },
        { status: 400 }
      );
    }
    updateData.status = 'CANCELLED';

    // If already shipped, reverse the stock deduction from origin
    if (existing.shippedAt) {
      for (const item of existing.items) {
        const inventory = await db.inventory.findFirst({
          where: { productId: item.productId, storeId: existing.fromStoreId },
        });
        if (inventory) {
          await db.inventory.update({
            where: { id: inventory.id },
            data: { quantityInStock: { increment: item.quantity } },
          });
        }
      }
    }

    await systemLog({
      action: 'STORE_TRANSFER_CANCELLED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.WARN,
      message: `Transfer ${existing.transferNumber} cancelled`,
      storeId: existing.fromStoreId,
      userId: body.cancelledBy || undefined,
      metadata: { transferId: id, transferNumber: existing.transferNumber },
    });
  } else if (body.notes !== undefined) {
    // Allow updating notes only
    updateData.notes = body.notes;
  } else {
    return Response.json(
      { success: false, error: 'Valid action required: approve, ship, receive, or cancel.' },
      { status: 400 }
    );
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const transfer = await db.storeTransfer.update({
    where: { id },
    data: updateData,
    include: {
      fromStore: { select: { id: true, name: true, location: true } },
      toStore: { select: { id: true, name: true, location: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true } },
        },
      },
    },
  });

  return Response.json({ success: true, data: transfer });
}

export const GET = withErrorBoundary(getStoreTransferHandler, 'STORE_TRANSFER_DETAIL');
export const PUT = withErrorBoundary(updateStoreTransferHandler, 'STORE_TRANSFER_UPDATE');
