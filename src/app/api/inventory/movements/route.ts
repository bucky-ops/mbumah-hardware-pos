import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";

import { withErrorHandler } from "@/lib/api-error-handler";
import { assertTargetBranch, requireRole } from "@/lib/api/guard";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/movements — audited stock-movement ledger (StockAdjustment).
//
// MANAGER+ ONLY (requireRole): RESTOCK rows carry unitCost, i.e. the supplier
// BUYING price — exposing cost data to cashiers would leak supplier margins.
//
// Query params:
//   ?limit=     default 50, clamped to 1..200
//   ?productId= optional filter — movement history of a single SKU
//   ?branchId=  OWNER may target any branch; everyone else is either scoped to
//               their own branch or rejected (assertTargetBranch pattern —
//               same BOLA layer-2 dance as GET /api/products).
//
// Ordering is createdAt desc (most recent first) — this feeds the
// "Recent stock movements" panel, not an analytical export.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

type MovementRow = Prisma.StockAdjustmentGetPayload<{
  include: {
    product: { select: { name: true; sku: true; unit: true } };
    user: { select: { name: true } };
  };
}>;

/** Decimal serialization: Prisma Decimals go over the wire as strings. */
function serializeMovement(m: MovementRow) {
  return {
    id: m.id,
    type: m.type, // RESTOCK | SALE | WRITE_OFF | STOCK_COUNT | RETURN
    quantity: String(m.quantity ?? 0), // signed delta
    unitCost: m.unitCost === null ? null : String(m.unitCost ?? 0),
    reason: m.reason,
    reference: m.reference,
    createdAt: m.createdAt.toISOString(),
    product: { name: m.product.name, sku: m.product.sku, unit: m.product.unit },
    user: { name: m.user.name },
    branchId: m.branchId,
  };
}

export const GET = route(async (req) => {
  // Buying prices are visible in this log → MANAGER+ gate (defense layer 2).
  const user = await requireRole(req, "MANAGER");

  const sp = req.nextUrl.searchParams;
  const productId = sp.get("productId")?.trim() || undefined;

  const parsedLimit = Number.parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(parsedLimit, 1), 200);

  // BOLA layer 2 (authoritative): non-OWNERs passing a foreign ?branchId are
  // rejected outright; otherwise they are silently scoped to their own branch.
  const queryBranchId = sp.get("branchId");
  assertTargetBranch(user, queryBranchId);
  const branchId = user.role === "OWNER" ? (queryBranchId ?? undefined) : user.branchId;

  const where: Prisma.StockAdjustmentWhereInput = {
    ...(branchId ? { branchId } : {}),
    ...(productId ? { productId } : {}),
  };

  const rows = await db.stockAdjustment.findMany({
    where,
    include: {
      product: { select: { name: true, sku: true, unit: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ items: rows.map(serializeMovement) });
});
