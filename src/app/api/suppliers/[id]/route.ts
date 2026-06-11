/**
 * MBUMAH HARDWARE POS - Supplier Detail API
 * GET /api/suppliers/[id] - Get supplier details with PO stats
 * PUT /api/suppliers/[id] - Update supplier
 * DELETE /api/suppliers/[id] - Soft delete (set isActive = false)
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getSupplierHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const supplier = await db.supplier.findUnique({
    where: { id },
    include: {
      purchaseOrders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          _count: { select: { items: true } },
        },
      },
    },
  });

  if (!supplier) {
    return Response.json(
      { success: false, error: 'Supplier not found.' },
      { status: 404 }
    );
  }

  const totalPOs = await db.purchaseOrder.count({
    where: { supplierId: id },
  });

  const totalPOValue = await db.purchaseOrder.aggregate({
    where: { supplierId: id, status: { not: 'CANCELLED' } },
    _sum: { totalAmount: true },
  });

  const pendingPOs = await db.purchaseOrder.count({
    where: { supplierId: id, status: { in: ['DRAFT', 'SENT', 'CONFIRMED'] } },
  });

  const { purchaseOrders, ...supplierData } = supplier;

  return Response.json({
    success: true,
    data: {
      ...supplierData,
      summary: {
        totalPOs,
        totalPOValue: totalPOValue._sum.totalAmount || 0,
        pendingPOs,
      },
      purchaseOrders: purchaseOrders.map((po) => {
        const { _count, ...poData } = po;
        return { ...poData, itemCount: _count.items };
      }),
    },
  });
}

async function updateSupplierHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.supplier.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Supplier not found.' },
      { status: 404 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'name', 'email', 'phone', 'address', 'city',
    'contactPerson', 'taxPin', 'paymentTerms', 'rating', 'isActive', 'notes',
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

  const supplier = await db.supplier.update({
    where: { id },
    data: updateData,
  });

  await systemLog({
    action: 'SUPPLIER_UPDATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Supplier "${supplier.name}" updated`,
    storeId: supplier.storeId,
    metadata: { supplierId: id, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: supplier });
}

async function deleteSupplierHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.supplier.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Supplier not found.' },
      { status: 404 }
    );
  }

  // Soft delete: set isActive = false
  const supplier = await db.supplier.update({
    where: { id },
    data: { isActive: false },
  });

  await systemLog({
    action: 'SUPPLIER_DEACTIVATED',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Supplier "${supplier.name}" deactivated`,
    storeId: supplier.storeId,
    metadata: { supplierId: id },
  });

  return Response.json({ success: true, data: supplier });
}

export const GET = withErrorBoundary(getSupplierHandler, 'SUPPLIER_DETAIL');
export const PUT = withErrorBoundary(updateSupplierHandler, 'SUPPLIER_UPDATE');
export const DELETE = withErrorBoundary(deleteSupplierHandler, 'SUPPLIER_DELETE');
