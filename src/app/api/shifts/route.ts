// GET/POST /api/shifts

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getShiftsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    // Gracefully return an empty list during initial hydration / before a
    // store is selected, instead of a hard 400 that floods the console and
    // trips React Query error toasts ("failed to load shift").
    return Response.json({ success: true, data: [] });
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

  // Single-active enforcement (ISO 27001 data integrity): block a new shift
  // if ANY open shift exists for this user+store. We check `endedAt: null` as
  // the canonical "open" signal — more robust than `status` alone, which can
  // drift out of sync if a prior end-shift call crashed midway (ghost shift).
  // The `status: 'ACTIVE'` clause catches legacy rows with status set but
  // endedAt populated.
  const existingOpenShift = await db.shift.findFirst({
    where: {
      storeId,
      userId,
      OR: [
        { endedAt: null },
        { status: 'ACTIVE' },
      ],
    },
    select: { id: true, startedAt: true, status: true, endedAt: true },
  });

  if (existingOpenShift) {
    return Response.json(
      {
        success: false,
        error:
          'You already have an open shift for this store. Please end the current shift before starting a new one.',
        code: 'OPEN_SHIFT_EXISTS',
        openShiftId: existingOpenShift.id,
      },
      { status: 400 }
    );
  }

  // Wrap shift creation + opening cash-drawer log atomically so a "ghost"
  // shift can never exist without its corresponding drawer entry.
  const shift = await db.$transaction(async (tx) => {
    const newShift = await tx.shift.create({
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

    // Record opening balance in the cash drawer ledger.
    const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    const priorBalance = lastDrawerEntry?.balance ?? 0;

    await tx.cashDrawerLog.create({
      data: {
        storeId,
        userId,
        action: 'SHIFT_OPEN',
        amount: startingCash || 0,
        balance: priorBalance + (startingCash || 0),
        notes: `Opening cash for shift started by ${newShift.user.name}`,
      },
    });

    return newShift;
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
