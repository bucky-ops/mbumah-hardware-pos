/**
 * MBUMAH HARDWARE - Shifts API
 * GET /api/shifts - List shifts with filtering
 * POST /api/shifts - Start a new shift (clock in)
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getShiftsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const status = searchParams.get('status') || '';
  const userId = searchParams.get('userId') || '';

  const where: Record<string, unknown> = { storeId };

  if (status) {
    where.status = status;
  }

  if (userId) {
    where.userId = userId;
  }

  const shifts = await db.shift.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 100,
  });

  const data = shifts.map((shift) => ({
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
  }));

  return Response.json({ success: true, data });
}

async function createShiftHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, userId, startingCash } = body;

  if (!storeId || !userId) {
    return Response.json(
      { success: false, error: 'storeId and userId are required.' },
      { status: 400 }
    );
  }

  // Check if user already has an ACTIVE shift
  const existingActiveShift = await db.shift.findFirst({
    where: { userId, status: 'ACTIVE' },
  });

  if (existingActiveShift) {
    return Response.json(
      { success: false, error: 'You already have an active shift. Please end it before starting a new one.' },
      { status: 400 }
    );
  }

  const shift = await db.shift.create({
    data: {
      userId,
      storeId,
      startingCash: startingCash || 0,
      status: 'ACTIVE',
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
  });

  await systemLog({
    action: 'SHIFT_START',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Shift started by ${shift.user.name} with starting cash KES ${(startingCash || 0).toLocaleString()}`,
    storeId,
    userId,
    metadata: {
      shiftId: shift.id,
      startingCash: startingCash || 0,
    },
  });

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

  return Response.json({ success: true, data }, { status: 201 });
}

export const GET = withErrorBoundary(getShiftsHandler, 'SHIFTS_LIST');
export const POST = withErrorBoundary(createShiftHandler, 'SHIFTS_CREATE');
