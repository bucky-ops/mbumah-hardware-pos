import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertBranchAccess, assertTargetBranch } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { expectedForSession } from "@/lib/drawer";
import { D, round2 } from "@/lib/format";

// src/app/api/v1/drawer/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/drawer — Cash drawer session inspection + counted close.
//
//   GET  MANAGER+ — the branch's OPEN session (if any) with a LIVE expected
//                  drawer figure, plus the last few closed sessions' variances.
//
//   POST MANAGER+ — COUNT & CLOSE the open session.
//       body { sessionId?, countedAmount, note? }
//       The expected drawer is recomputed AT CLOSE TIME over the session's
//       lifetime window [openedAt → now], so the variance reflects every cash
//       sale / float-in / payout up to the moment of counting:
//
//         expected = openingFloat + Σ FLOAT_IN + Σ CASH payments − Σ PAYOUT
//
//       (Mirrors the EOD basis exactly: only Payment rows with method=CASH,
//       status=COMPLETED count toward the drawer — M-Pesa / bank / card /
//       store-credit are settled to the bank and NEVER sit in the drawer.)
//
//       variance = countedAmount − expected  (Decimal, 2dp ROUND_HALF_UP)
//       Both figures are frozen on the session row; the EOD report reads them.
//
//   RBAC/BOLA: MANAGER+; explicit sessionId is BOLA-checked, otherwise the
//   open session is looked up inside the caller's branch scope.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const closeSchema = z
  .object({
    sessionId: z.string().min(1).max(64).optional(),
    countedAmount: z
      .number({ message: "countedAmount must be a number" })
      .min(0, "countedAmount must be ≥ 0")
      .max(100_000_000, "countedAmount is implausibly large")
      .finite(),
    note: z.string().min(3).max(255).optional(),
  })
  .strict();

// Live drawer math moved to src/lib/drawer.ts — shared with the open and
// movement endpoints so every surface reconciles on the same basis.

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");

  const requestedBranch = req.nextUrl.searchParams.get("branchId");
  assertTargetBranch(user, requestedBranch);
  const branchId = user.role === "OWNER" ? requestedBranch ?? user.branchId : user.branchId;

  const openSession = await db.cashDrawerSession.findFirst({
    where: { branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    include: { user: { select: { name: true } } },
  });

  const live = openSession ? await expectedForSession(openSession) : null;

  const recentClosed = await db.cashDrawerSession.findMany({
    where: { branchId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 5,
    select: {
      id: true,
      countedAmount: true,
      variance: true,
      openedAt: true,
      closedAt: true,
      user: { select: { name: true } },
    },
  });

  return NextResponse.json({
    active: openSession
      ? {
          id: openSession.id,
          branchId: openSession.branchId,
          openedAt: openSession.openedAt.toISOString(),
          openedByName: openSession.user.name,
          openingFloat: round2(D(openSession.openingFloat).toNumber()),
          ...live,
        }
      : null,
    recentClosed: recentClosed.map((s) => ({
      id: s.id,
      countedAmount: round2(D(s.countedAmount ?? 0).toNumber()),
      variance: s.variance != null ? round2(D(s.variance).toNumber()) : null,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
      closedByName: s.user.name,
    })),
  });
});

export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");

  const body = closeSchema.parse(await req.json().catch(() => null) ?? {});

  // Session resolution: explicit id (BOLA-checked) or the branch's open one.
  const session = body.sessionId
    ? await db.cashDrawerSession.findUnique({ where: { id: body.sessionId } })
    : await db.cashDrawerSession.findFirst({
        where: { branchId: user.branchId, status: "OPEN" },
        orderBy: { openedAt: "desc" },
      });
  if (!session) throw ApiError.notFound("No open cash drawer session found");
  assertBranchAccess(user, session.branchId); // BOLA — persisted branch rules
  if (session.status !== "OPEN") throw ApiError.badRequest("This drawer session is already closed");

  // Recompute expected AT the close moment (see header contract).
  const live = await expectedForSession(session);
  const counted = D(body.countedAmount).toDecimalPlaces(2);
  const variance = counted.minus(live.expectedDrawer);

  // Governance: a material variance must carry a written explanation — it is
  // frozen on the session and surfaced in the EOD report / audit trail.
  if (variance.abs().comparedTo(1_000) > 0 && !body.note) {
    throw ApiError.badRequest("A note is required when the variance exceeds Ksh 1,000");
  }

  const closed = await db.cashDrawerSession.update({
    where: { id: session.id },
    data: {
      status: "CLOSED",
      countedAmount: counted.toFixed(2),
      variance: variance.toFixed(2),
      closedAt: new Date(),
    },
  });

  void audit({
    userId: user.id,
    action: "DRAWER_CLOSE",
    entity: "CashDrawerSession",
    entityId: closed.id,
    meta: {
      branchId: session.branchId,
      expected: live.expectedDrawer,
      counted: counted.toNumber(),
      variance: round2(variance.toNumber()),
      note: body.note ?? null,
    },
  });

  return NextResponse.json({
    session: {
      id: closed.id,
      status: closed.status,
      closedAt: closed.closedAt?.toISOString() ?? null,
      countedAmount: counted.toFixed(2),
    },
    summary: {
      expectedDrawer: live.expectedDrawer,
      countedAmount: round2(counted.toNumber()),
      variance: round2(variance.toNumber()),
      // Interpretation hints for the UI toast/insight chip.
      state:
        variance.comparedTo(0) === 0
          ? "BALANCED"
          : variance.comparedTo(0) > 0
            ? "OVER"
            : "SHORT",
    },
  });
});
