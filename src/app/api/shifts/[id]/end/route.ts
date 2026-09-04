// POST /api/shifts/[id]/end

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent, UserRole } from '@/lib/types';
import { withSessionAuth } from '@/lib/auth';
// Task 12-c: canonical financial math (HALF_UP 2dp). The expected-cash chain
// previously mixed Number()-coerced Prisma Decimals in float arithmetic;
// now every leg is an exact Decimal accumulator. FORMULA UNCHANGED:
//   expectedCash = startingCash + Σ cash sale payments + Σ CASH_IN − Σ CASH_OUT
// (REFUND rows remain intentionally excluded per the audit spec).
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

// AUDIT FIX: shift end (Z-read) is a destructive/close operation — restricted
// to manager-or-above per PERMISSION_MATRIX (SUPER_ADMIN, STORE_OWNER,
// BRANCH_MANAGER). Viewing remains open to any store role (see xread route).
const MANAGER_UP_ROLES: string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.STORE_OWNER,
  UserRole.BRANCH_MANAGER,
];

// Marker used to persist the machine-readable cash breakdown on the Shift row
// without a schema change (Shift.notes is the only free-form field).
const BREAKDOWN_MARKER = 'SHIFT_CASH_BREAKDOWN:';

interface ShiftCashBreakdown {
  startingCash: number;
  salesCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  windowEnd: string;
}

/**
 * AUDIT FIX: shift.totalSales was never written anywhere, so the old
 * `expected = startingCash + totalSales (= 0)` made cashDifference fiction.
 * CashDrawerLog has no shiftId (schema ~803-809) — the drawer contribution of
 * a shift is derived by windowing on storeId + createdAt within
 * [shift.startedAt, now], using the audit-approved formula:
 *   expectedCash = startingCash + SUM(SALE) + SUM(CASH_IN) - SUM(CASH_OUT)
 * (REFUND rows are intentionally excluded per the audit spec.)
 * Shared with the X-read endpoint (src/app/api/shifts/[id]/xread/route.ts).
 */
async function computeShiftCashBreakdown(
  storeId: string,
  startingCash: number,
  windowEnd: Date,
  windowStart: Date
): Promise<ShiftCashBreakdown> {
  const drawerSums = await db.cashDrawerLog.groupBy({
    by: ['action'],
    where: {
      storeId,
      createdAt: { gte: windowStart, lte: windowEnd },
      action: { in: ['SALE', 'CASH_IN', 'CASH_OUT'] },
    },
    _sum: { amount: true },
  });

  const sumFor = (action: string): ReturnType<typeof toDec> =>
    toDec(drawerSums.find((row) => row.action === action)?._sum.amount ?? 0);

  // Task 12-c: Decimal accumulators (was Number()-coerced floats).
  const salesCashDec = sumFor('SALE');
  const cashInDec = sumFor('CASH_IN');
  const cashOutDec = sumFor('CASH_OUT');
  const startingCashDec = toDec(startingCash);
  const expectedCashDec = startingCashDec.plus(salesCashDec).plus(cashInDec).minus(cashOutDec);

  return {
    startingCash: round2(startingCashDec),
    salesCash: round2(salesCashDec),
    cashIn: round2(cashInDec),
    cashOut: round2(cashOutDec),
    expectedCash: round2(expectedCashDec),
    countedCash: 0,
    difference: 0,
    windowEnd: windowEnd.toISOString(),
  };
}

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

  // AUDIT FIX: numeric coercion + NaN guard so the persisted decimals and the
  // difference math can never be polluted by string/NaN body values.
  // Task 12-c: toDec maps garbage → 0 (downstream of the finite check) and
  // the counted cash is rounded HALF_UP to 2dp like every money value.
  const endingCashRaw = Number(endingCash);
  const countedCashRaw = Number(countedCash);
  if (!Number.isFinite(endingCashRaw) || !Number.isFinite(countedCashRaw)) {
    return Response.json(
      { success: false, error: 'endingCash and countedCash must be finite numbers.' },
      { status: 400 }
    );
  }
  const endingCashNum = round2(endingCashRaw);
  const countedValueDec = toDec(countedCashRaw);

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

  // ── Z-READ computation (close + snapshot; X-read counterpart never mutates) ──
  // AUDIT FIX: real expected cash from the drawer ledger instead of the
  // never-written shift.totalSales (was always 0).
  const endedAt = new Date();
  // Task 12-c: money coerced + rounded via Decimal (HALF_UP 2dp).
  const startingCashValue = round2(toDec(shift.startingCash));
  const breakdown = await computeShiftCashBreakdown(
    shift.storeId,
    startingCashValue,
    endedAt,
    shift.startedAt
  );
  const expectedCash = breakdown.expectedCash;
  const countedValue = round2(countedValueDec);
  breakdown.countedCash = countedValue;
  // Task 12-c: exact Decimal difference (was `countedValue - expectedCash`).
  breakdown.difference = round2(countedValueDec.minus(expectedCash));
  const cashDifference = breakdown.difference;

  // Persist the breakdown on the existing free-form notes column (NO schema
  // change): user notes first, then the machine-readable marker line.
  const persistedNotes = `${notes ? `${notes}\n` : ''}${BREAKDOWN_MARKER}${JSON.stringify(breakdown)}`;

  const updatedShift = await db.shift.update({
    where: { id: shiftId },
    data: {
      endedAt,
      status: 'ENDED',
      endingCash: endingCashNum,
      countedCash: countedValue,
      cashDifference,
      // AUDIT FIX: totalSales was never written anywhere; store the
      // drawer-derived cash sales for the shift window so legacy readers of
      // shift.totalSales see a real value. Expected-cash math above no longer
      // depends on it.
      totalSales: breakdown.salesCash,
      notes: persistedNotes,
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
    message: `Shift ended by ${updatedShift.user.name}. Expected: KES ${expectedCash.toLocaleString()}, Counted: KES ${countedValue.toLocaleString()}, Difference: KES ${cashDifference.toLocaleString()}`,
    storeId: shift.storeId,
    userId: shift.userId,
    metadata: {
      shiftId,
      startingCash: startingCashValue,
      // AUDIT FIX: full drawer-derived breakdown now logged (was totalSales=0).
      salesCash: breakdown.salesCash,
      cashIn: breakdown.cashIn,
      cashOut: breakdown.cashOut,
      expectedCash,
      countedCash: countedValue,
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
    // AUDIT FIX: full Z-read breakdown in the response (startingCash,
    // salesCash, cashIn, cashOut, expectedCash, countedCash, difference).
    cashBreakdown: breakdown,
    createdAt: updatedShift.createdAt.toISOString(),
    updatedAt: updatedShift.updatedAt.toISOString(),
  };

  return Response.json({ success: true, data });
}

// AUDIT FIX: session auth + manager-or-above role gate (was unauthenticated).
export const POST = withErrorBoundary(withSessionAuth(endShiftHandler, MANAGER_UP_ROLES), 'SHIFT_END');
