import { NextResponse, type NextRequest } from "next/server";

import { ApiError, withErrorHandler } from "@/lib/api-error-handler";
import { assertTargetBranch, requireAuth } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/auth-utils";
import { db } from "@/lib/db";
import { D, weightedAverageCost } from "@/lib/format";
import { roleAtLeast } from "@/lib/types";
import { adjustSchema } from "@/lib/validations/inventory";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/inventory/adjust — stock correction (zod-validated, transactional).
//
// Mapping to the StockAdjustment ledger:
//   INCREMENT → type RESTOCK  (+qty, unitCost required → moving-average-cost
//                               update via weightedAverageCost)
//   DECREMENT → type WRITE_OFF (−qty, reason REQUIRED, MANAGER+ ONLY —
//                               segregation of duties: the person allowed to
//                               destroy stock value is not the casual cashier)
//
// CONCURRENCY: the decrement uses an atomic conditional `updateMany`
// (stockQty >= magnitude) instead of read-then-write, so two simultaneous
// write-offs can never race the balance below zero. SQLite serializes writes,
// but this guard keeps the invariant portable to Postgres.
// ─────────────────────────────────────────────────────────────────────────────

function route(handler: (req: NextRequest) => Promise<Response>) {
  return withErrorHandler(async (req: Request) => handler(req as NextRequest));
}

export const POST = route(async (req) => {
  const user = await requireAuth(req);

  const parsed = adjustSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw parsed.error; // ZodError → 400 {error, issues}
  const input = parsed.data;

  const product = await db.product.findUnique({ where: { id: input.productId } });
  if (!product) throw ApiError.notFound("Product not found");

  // BOLA layer 2 (authoritative): compare against the PERSISTED row's branch.
  assertTargetBranch(user, product.branchId);

  // Direction comes from `type`, never from the sign of `quantity`.
  const magnitude = Math.abs(input.quantity);
  const delta = input.type === "INCREMENT" ? magnitude : -magnitude;

  if (input.type === "DECREMENT" && !roleAtLeast(user.role, "MANAGER")) {
    throw ApiError.forbidden("WRITE_OFF adjustments require MANAGER role (segregation of duties)");
  }

  // Friendly pre-check before opening a transaction; the atomic guard inside
  // the transaction below remains the race-proof authority.
  if (input.type === "DECREMENT" && D(product.stockQty).minus(magnitude).lessThan(0)) {
    throw ApiError.conflict("Insufficient stock for adjustment");
  }

  // Moving-average cost: only restocks carry a unitCost to blend in.
  const newMac =
    input.type === "INCREMENT" && input.unitCost !== undefined
      ? weightedAverageCost(product.stockQty, product.buyingPrice, magnitude, input.unitCost)
      : null;

  const adjustment = await db.$transaction(async (tx) => {
    if (input.type === "INCREMENT") {
      await tx.product.update({
        where: { id: product.id },
        data: {
          stockQty: { increment: magnitude },
          ...(newMac !== null ? { buyingPrice: newMac } : {}),
        },
      });
    } else {
      // Atomic guard: the row is only decremented when it still holds enough
      // stock; count === 0 means somebody else already drained it.
      const updated = await tx.product.updateMany({
        where: { id: product.id, stockQty: { gte: magnitude } },
        data: { stockQty: { decrement: magnitude } },
      });
      if (updated.count === 0) {
        throw ApiError.conflict("Insufficient stock for adjustment");
      }
    }

    return tx.stockAdjustment.create({
      data: {
        productId: product.id,
        branchId: product.branchId,
        type: input.type === "INCREMENT" ? "RESTOCK" : "WRITE_OFF",
        quantity: delta, // signed ledger entry
        unitCost: input.unitCost ?? null,
        reason: input.reason ?? null,
        reference: input.reference ?? null,
        userId: user.id,
      },
    });
  });

  const newStockQty = D(product.stockQty).add(delta);

  await audit({
    userId: user.id,
    action: "INVENTORY_ADJUST",
    entity: "Product",
    entityId: product.id,
    meta: { sku: product.sku, delta, type: input.type, reason: input.reason ?? null },
    ip: clientIp(req),
  });

  return NextResponse.json({
    id: adjustment.id,
    newStockQty: String(newStockQty),
    mac: String(newMac ?? D(product.buyingPrice)),
  });
});
