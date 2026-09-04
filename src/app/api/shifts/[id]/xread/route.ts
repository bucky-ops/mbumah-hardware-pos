// GET /api/shifts/[id]/xread
//
// X-READ vs Z-READ:
//   X = NON-RESETTING inquiry — this endpoint is a read-only snapshot of a
//       shift's cash position. It NEVER mutates the shift, the drawer ledger,
//       or anything else.
//   Z = close + snapshot — POST /api/shifts/[id]/end closes the shift,
//       persists counted vs expected cash, and freezes the final numbers.
//
// Response breakdown: startingCash, salesCash, cashIn, cashOut, expectedCash
// (plus countedCash/cashDifference when the shift has already been ended).

import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { UserRole } from '@/lib/types';
import { withSessionAuth } from '@/lib/auth';
// Task 12-c: canonical financial math (HALF_UP 2dp). The expected-cash chain
// previously mixed Number()-coerced Prisma Decimals in float arithmetic; now
// every leg is an exact Decimal accumulator. FORMULA UNCHANGED:
//   expectedCash = startingCash + SUM(SALE) + SUM(CASH_IN) - SUM(CASH_OUT)
// (REFUND rows remain intentionally excluded per the audit spec.)
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

// AUDIT FIX (companion to the shifts auth fix): any store role from
// PERMISSION_MATRIX may view an X-read — it is a non-destructive inquiry.
const STORE_ROLES: string[] = Object.values(UserRole);

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Same drawer-window math as the Z-read in src/app/api/shifts/[id]/end/route.ts:
 * CashDrawerLog has no shiftId, so the shift's drawer contribution is windowed
 * by storeId + createdAt within [shift.startedAt, windowEnd]:
 *   expectedCash = startingCash + SUM(SALE) + SUM(CASH_IN) - SUM(CASH_OUT)
 * (REFUND rows are intentionally excluded per the audit spec.)
 */
async function xreadShiftHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id: shiftId } = await context.params;

  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      storeId: true,
      startedAt: true,
      endedAt: true,
      startingCash: true,
      countedCash: true,
      cashDifference: true,
      totalSales: true,
      status: true,
    },
  });

  if (!shift) {
    return Response.json(
      { success: false, error: 'Shift not found.' },
      { status: 404 }
    );
  }

  // Task 12-c: Decimal coercion + HALF_UP 2dp emit.
  const startingCash = round2(toDec(shift.startingCash));
  // X-read window end: "now" for an open shift; the frozen end time for an
  // already-closed (Z-read) shift so the snapshot is stable.
  const windowEnd = shift.endedAt ?? new Date();

  const drawerSums = await db.cashDrawerLog.groupBy({
    by: ['action'],
    where: {
      storeId: shift.storeId,
      createdAt: { gte: shift.startedAt, lte: windowEnd },
      action: { in: ['SALE', 'CASH_IN', 'CASH_OUT'] },
    },
    _sum: { amount: true },
  });

  const sumFor = (action: string): ReturnType<typeof toDec> =>
    toDec(drawerSums.find((row) => row.action === action)?._sum.amount ?? 0);

  // Task 12-c: Decimal accumulators (was Number()-coerced floats).
  const salesCash = round2(sumFor('SALE'));
  const cashIn = round2(sumFor('CASH_IN'));
  const cashOut = round2(sumFor('CASH_OUT'));
  const expectedCash = round2(
    toDec(startingCash).plus(sumFor('SALE')).plus(sumFor('CASH_IN')).minus(sumFor('CASH_OUT'))
  );

  return Response.json({
    success: true,
    data: {
      documentType: 'X_READ',
      note: 'X-read is a non-resetting inquiry; Z-read (shift end) closes and snapshots.',
      shiftId: shift.id,
      storeId: shift.storeId,
      status: shift.status,
      startedAt: shift.startedAt.toISOString(),
      windowEnd: windowEnd.toISOString(),
      startingCash,
      salesCash,
      cashIn,
      cashOut,
      expectedCash,
      // Only present once the Z-read (shift end) has been performed.
      // Task 12-c: Decimal-coerced, rounded emits (was Number()).
      countedCash: shift.countedCash === null ? null : round2(toDec(shift.countedCash)),
      difference: shift.cashDifference === null ? null : round2(toDec(shift.cashDifference)),
      generatedAt: new Date().toISOString(),
    },
  });
}

export const GET = withErrorBoundary(
  withSessionAuth(xreadShiftHandler, STORE_ROLES),
  'SHIFT_XREAD'
);
