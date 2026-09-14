// ─────────────────────────────────────────────────────────────────────────────
// src/app/api/v1/drawer/open/route.ts — Open a cash drawer session.
//
//   POST MANAGER+ — starts the branch's OPEN drawer session for a shift.
//       body { openingFloat, note?, branchId? }   (branchId: OWNER scope only)
//
//   • Rejects when the branch already has an OPEN session (409) — one drawer
//     per branch at a time; close the current one first.
//   • openingFloat is the physical cash counted INTO the till at open time.
//     (Governance: managers opening with > 200k KES float must provide a note.)
//   • Audited as DRAWER_OPEN.
//
//   RBAC/BOLA: MANAGER+; OWNER may target any branch (branchId in body),
//   managers are pinned to their own branch.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertBranchAccess, assertTargetBranch } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { D, round2 } from "@/lib/format";

export const dynamic = "force-dynamic";

const openSchema = z
  .object({
    openingFloat: z
      .number({ message: "openingFloat must be a number" })
      .min(0, "openingFloat must be ≥ 0")
      .max(1_000_000, "openingFloat is implausibly large")
      .finite(),
    note: z.string().min(3).max(255).optional(),
    branchId: z.string().min(1).max(64).optional(),
  })
  .strict();

export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const body = openSchema.parse(await req.json().catch(() => null) ?? {});

  // Branch resolution — OWNER may target a branch explicitly (header switcher).
  assertTargetBranch(user, body.branchId);
  const branchId = body.branchId ?? user.branchId;
  assertBranchAccess(user, branchId);

  // One open drawer per branch at a time.
  const existing = await db.cashDrawerSession.findFirst({
    where: { branchId, status: "OPEN" },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict("This branch already has an open drawer session — close it first");
  }

  const openingFloat = D(body.openingFloat).toDecimalPlaces(2);
  // Governance: a very large float deserves a written reason.
  if (openingFloat.comparedTo(200_000) > 0 && !body.note) {
    throw ApiError.badRequest("A note is required when opening with more than Ksh 200,000 float");
  }

  const session = await db.cashDrawerSession.create({
    data: {
      branchId,
      userId: user.id,
      openingFloat: openingFloat.toFixed(2),
      status: "OPEN",
    },
  });

  void audit({
    userId: user.id,
    action: "DRAWER_OPEN",
    entity: "CashDrawerSession",
    entityId: session.id,
    meta: {
      branchId,
      openingFloat: round2(openingFloat.toNumber()),
      note: body.note ?? null,
    },
  });

  return NextResponse.json(
    {
      session: {
        id: session.id,
        branchId: session.branchId,
        status: session.status,
        openingFloat: round2(openingFloat.toNumber()),
        openedAt: session.openedAt.toISOString(),
        openedByName: user.name,
      },
      summary: { floatIn: 0, payouts: 0, cashReceived: 0, expectedDrawer: round2(openingFloat.toNumber()) },
    },
    { status: 201 },
  );
});
