// GET /api/shifts/current

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

async function getCurrentShiftHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  const userId = searchParams.get('userId');

  if (!storeId || !userId) {
    // Graceful no-op during initial hydration instead of a console-flooding 400.
    return Response.json({ success: true, data: null });
  }

  const shift = await db.shift.findFirst({
    where: { storeId, userId, status: 'ACTIVE' },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (!shift) {
    return Response.json({ success: true, data: null });
  }

  const data = {
    id: shift.id,
    userId: shift.userId,
    userName: shift.user.name,
    storeId: shift.storeId,
    startedAt: shift.startedAt.toISOString(),
    endedAt: shift.endedAt ? shift.endedAt.toISOString() : null,
    startingCash: shift.startingCash,
    endingCash: shift.endingCash,
    countedCash: shift.countedCash,
    cashDifference: shift.cashDifference,
    totalSales: shift.totalSales,
    totalTransactions: shift.totalTransactions,
    status: shift.status,
    notes: shift.notes,
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
  };

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(getCurrentShiftHandler, 'SHIFT_CURRENT');
