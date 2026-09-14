// ─────────────────────────────────────────────────────────────────────────────
// src/lib/drawer.ts — Shared cash-drawer session math.
//
// The LIVE expected-drawer figure is the single source of truth for the
// drawer card, the open/movement endpoints and the counted close:
//
//   expected = openingFloat + Σ FLOAT_IN + Σ CASH payments (in window) − Σ PAYOUT
//
// Only Payment rows with method=CASH, status=COMPLETED inside the session's
// lifetime window count — M-Pesa / bank / card / store-credit settle to the
// bank and NEVER sit in the drawer (mirrors the EOD report basis exactly).
//
// All money math goes through Decimal (D) and is returned 2dp ROUND_HALF_UP.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { D, round2 } from "@/lib/format";

export interface DrawerSessionMathInput {
  id: string;
  branchId: string;
  openingFloat: unknown; // Prisma Decimal — treated opaquely via D()
  openedAt: Date;
  /** Window end — defaults to now; the counted close passes its own moment. */
  asOf?: Date;
}

export interface DrawerLiveFigures {
  floatIn: number;
  payouts: number;
  cashReceived: number;
  expectedDrawer: number;
}

/** Live drawer math for one session (shared by GET / POST across drawer routes). */
export async function expectedForSession(
  session: DrawerSessionMathInput,
  asOf: Date = new Date(),
): Promise<DrawerLiveFigures> {
  const movements = await db.drawerMovement.findMany({
    where: { sessionId: session.id },
    select: { type: true, amount: true },
  });
  const floatIn = movements
    .filter((m) => m.type === "FLOAT_IN")
    .reduce((acc, m) => acc.plus(D(m.amount)), D(0));
  const payouts = movements
    .filter((m) => m.type === "PAYOUT")
    .reduce((acc, m) => acc.plus(D(m.amount)), D(0));

  const cashAgg = await db.payment.aggregate({
    where: {
      branchId: session.branchId,
      method: "CASH",
      status: "COMPLETED",
      receivedAt: { gte: session.openedAt, lte: asOf },
    },
    _sum: { amount: true },
  });
  const cashReceived = D(cashAgg._sum.amount ?? 0);

  const expected = D(session.openingFloat).plus(floatIn).plus(cashReceived).minus(payouts);
  return {
    floatIn: round2(floatIn.toNumber()),
    payouts: round2(payouts.toNumber()),
    cashReceived: round2(cashReceived.toNumber()),
    expectedDrawer: round2(expected.toNumber()),
  };
}
