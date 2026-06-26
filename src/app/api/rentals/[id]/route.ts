// PUT/DELETE /api/rentals/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent, RentalStatus, StockMovementType } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function updateRentalHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const rental = await db.equipmentRental.findUnique({ where: { id } });

  if (!rental) {
    return Response.json(
      { success: false, error: 'Rental not found.' },
      { status: 404 }
    );
  }

  if (rental.status !== RentalStatus.ACTIVE && rental.status !== RentalStatus.OVERDUE) {
    return Response.json(
      { success: false, error: 'Cannot update a rental that is not active or overdue.' },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};

  if (body.expectedReturnDate !== undefined) {
    updateData.expectedReturnDate = new Date(body.expectedReturnDate);
  }
  if (body.securityDeposit !== undefined) {
    updateData.securityDeposit = parseFloat(String(body.securityDeposit));
  }
  if (body.ratePerDay !== undefined) {
    updateData.ratePerDay = parseFloat(String(body.ratePerDay));
  }
  if (body.ratePerWeek !== undefined) {
    updateData.ratePerWeek = body.ratePerWeek ? parseFloat(String(body.ratePerWeek)) : null;
  }
  if (body.ratePerMonth !== undefined) {
    updateData.ratePerMonth = body.ratePerMonth ? parseFloat(String(body.ratePerMonth)) : null;
  }
  if (body.notes !== undefined) {
    updateData.notes = body.notes || null;
  }

  const updated = await db.equipmentRental.update({
    where: { id },
    data: updateData,
    include: {
      product: { select: { id: true, name: true, sku: true, imageUrl: true } },
      customer: { select: { id: true, name: true, phone: true, email: true } },
    },
  });

  await systemLog({
    action: 'RENTAL_UPDATED',
    component: LogComponent.RENTAL,
    severity: LogSeverity.INFO,
    message: `Rental updated: ${updated.product?.name || id}`,
    storeId: rental.storeId,
    metadata: { rentalId: id, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: updated });
}

async function deleteRentalHandler(...args: unknown[]): Promise<Response> {
  const _request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const rental = await db.equipmentRental.findUnique({
    where: { id },
    include: {
      product: { select: { id: true, name: true, sku: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  if (!rental) {
    return Response.json(
      { success: false, error: 'Rental not found.' },
      { status: 404 }
    );
  }

  // Only allow deletion of active or overdue rentals
  if (rental.status !== RentalStatus.ACTIVE && rental.status !== RentalStatus.OVERDUE) {
    return Response.json(
      { success: false, error: 'Cannot delete a rental that has already been returned or is in damaged state.' },
      { status: 400 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    // Restore product stock
    await tx.product.update({
      where: { id: rental.productId },
      data: { quantityInStock: { increment: 1 } },
    });

    // Create stock movement record
    await tx.stockMovement.create({
      data: {
        storeId: rental.storeId,
        productId: rental.productId,
        movementType: StockMovementType.RENTAL_RETURN,
        quantity: 1,
        referenceId: rental.id,
        notes: `Rental deleted - ${rental.product?.name || 'Equipment'}`,
        performedBy: null,
      },
    });

    // Delete the rental
    const deleted = await tx.equipmentRental.delete({
      where: { id },
    });

    return deleted;
  });

  await systemLog({
    action: 'RENTAL_DELETED',
    component: LogComponent.RENTAL,
    severity: LogSeverity.WARNING,
    message: `Rental deleted: ${rental.product?.name || id} for ${rental.customer?.name || 'Customer'}`,
    storeId: rental.storeId,
    metadata: { rentalId: id, productId: rental.productId, customerId: rental.customerId },
  });

  return Response.json({ success: true, data: result });
}

export const PUT = withErrorBoundary(updateRentalHandler, 'RENTALS_UPDATE');
export const DELETE = withErrorBoundary(deleteRentalHandler, 'RENTALS_DELETE');
