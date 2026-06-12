// POST /api/shifts/[id]/end

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function endShiftHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const id = args[1] as { params: Promise<{ id: string }> };
  const { id: shiftId } = await id.params;

  const body = await request.json();
  const { endingCash, countedCash, notes } = body;

  if (endingCash === undefined || countedCash === undefined) {
    return Response.json(
      { success: false, error: 'endingCash and countedCash are required.' },
      { status: 400 }
    );
  }

    const shift = await db.shift.findUnique({
    where: { id: shiftId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  if (!shift) {
    return Response.json(
      { success: false, error: 'Shift not found.' },
      { status: 404 }
    );
  }

  if (shift.status !== 'ACTIVE') {
    return Response.json(
      { success: false, error: 'This shift has already been ended.' },
      { status: 400 }
    );
  }

    const expectedCash = shift.startingCash + shift.totalSales;
  const cashDifference = countedCash - expectedCash;

  const updatedShift = await db.shift.update({
    where: { id: shiftId },
    data: {
      endedAt: new Date(),
      status: 'ENDED',
      endingCash,
      countedCash,
      cashDifference,
      notes: notes || null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
  });

  await systemLog({
    action: 'SHIFT_END',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Shift ended by ${updatedShift.user.name}. Expected: KES ${expectedCash.toLocaleString()}, Counted: KES ${countedCash.toLocaleString()}, Difference: KES ${cashDifference.toLocaleString()}`,
    storeId: shift.storeId,
    userId: shift.userId,
    metadata: {
      shiftId,
      startingCash: shift.startingCash,
      totalSales: shift.totalSales,
      expectedCash,
      countedCash,
      cashDifference,
    },
  });

  const data = {
    id: updatedShift.id,
    userId: updatedShift.userId,
    userName: updatedShift.user.name,
    storeId: updatedShift.storeId,
    startedAt: updatedShift.startedAt.toISOString(),
    endedAt: updatedShift.endedAt ? updatedShift.endedAt.toISOString() : null,
    startingCash: updatedShift.startingCash,
    endingCash: updatedShift.endingCash,
    countedCash: updatedShift.countedCash,
    cashDifference: updatedShift.cashDifference,
    totalSales: updatedShift.totalSales,
    totalTransactions: updatedShift.totalTransactions,
    status: updatedShift.status,
    notes: updatedShift.notes,
    createdAt: updatedShift.createdAt.toISOString(),
    updatedAt: updatedShift.updatedAt.toISOString(),
  };

  return Response.json({ success: true, data });
}

export const POST = withErrorBoundary(endShiftHandler, 'SHIFT_END');
