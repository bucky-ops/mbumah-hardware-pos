// ─────────────────────────────────────────────────────────────────────────────
// src/app/api/v1/drawer/movement/route.ts — Float-in / payout on an OPEN drawer.
//
//   POST MANAGER+ — records a DrawerMovement against the branch's OPEN session
//       body { type: "FLOAT_IN" | "PAYOUT", amount, note?, sessionId?, branchId? }
//
//   • FLOAT_IN  — extra change-fund added to the till mid-shift.
//   • PAYOUT    — cash taken OUT (supplier paid in cash, petty cash, banking
//                 drop is recorded as a PAYOUT with a note).
//   • The live expected figure shifts immediately; the drawer card and the EOD
//     report both re-read it, so both stay on the same basis.
//   • Amounts are 2dp ROUND_HALF_UP via Decimal; note is REQUIRED for payouts
//     ≥ Ksh 50,000 (audit discipline for large cash removals).
//   • Audited as DRAWER_MOVEMENT.
//
//   RBAC/BOLA: MANAGER+; explicit sessionId is BOLA-checked, otherwise the
//   branch is resolved from body.branchId (OWNER scope) or the caller's branch.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertBranchAccess, assertTargetBranch } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { expectedForSession } from "@/lib/drawer";
import { D, round2 } from "@/lib/format";

export const dynamic = "force-dynamic";

const movementSchema = z
  .object({
    type: z.enum(["FLOAT_IN", "PAYOUT"], { message: "type must be FLOAT_IN or PAYOUT" }),
    amount: z
      .number({ message: "amount must be a number" })
      .min(0.01, "amount must be > 0")
      .max(5_000_000, "amount is implausibly large")
      .finite(),
    note: z.string().min(3).max(255).optional(),
    sessionId: z.string().min(1).max(64).optional(),
    branchId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const body = movementSchema.parse(await req.json().catch(() => null) ?? {});

  // Session resolution: explicit id (BOLA-checked) or the branch's open one.
  let session;
  if (body.sessionId) {
    session = await db.cashDrawerSession.findUnique({ where: { id: body.sessionId } });
    if (!session) throw ApiError.notFound("Drawer session not found");
  } else {
    assertTargetBranch(user, body.branchId);
    const branchId = body.branchId ?? user.branchId;
    session = await db.cashDrawerSession.findFirst({
      where: { branchId, status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    if (!session) throw ApiError.notFound("No open drawer session for this branch");
  }
  assertBranchAccess(user, session.branchId); // BOLA — persisted branch rules
  if (session.status !== "OPEN") {
    throw ApiError.badRequest("This drawer session is closed — movements are frozen");
  }

  const amount = D(body.amount).toDecimalPlaces(2);
  // Governance: large cash removals need a written reason.
  if (body.type === "PAYOUT" && amount.comparedTo(50_000) >= 0 && !body.note) {
    throw ApiError.badRequest("A note is required for payouts of Ksh 50,000 or more");
  }

  const movement = await db.drawerMovement.create({
    data: {
      sessionId: session.id,
      type: body.type,
      amount: amount.toFixed(2),
      note: body.note ?? null,
    },
  });

  void audit({
    userId: user.id,
    action: "DRAWER_MOVEMENT",
    entity: "DrawerMovement",
    entityId: movement.id,
    meta: {
      branchId: session.branchId,
      sessionId: session.id,
      type: body.type,
      amount: round2(amount.toNumber()),
      note: body.note ?? null,
    },
  });

  // Fresh live figures so the UI can repaint the ledger without a refetch.
  const live = await expectedForSession(session);

  return NextResponse.json(
    {
      movement: {
        id: movement.id,
        type: movement.type,
        amount: round2(amount.toNumber()),
        note: movement.note,
        createdAt: movement.createdAt.toISOString(),
      },
      summary: live,
    },
    { status: 201 },
  );
});
