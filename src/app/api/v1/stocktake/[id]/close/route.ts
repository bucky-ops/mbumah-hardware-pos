import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertBranchAccess } from "@/lib/api/guard";
import { closeStocktakeSchema } from "@/lib/validations/stocktake";
import { audit } from "@/lib/audit";
import { D, round2 } from "@/lib/format";

// src/app/api/v1/stocktake/[id]/close/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/stocktake/[id]/close — POST, MANAGER+. Applies a finished count.
//
//   INVENTORY SAFETY MODEL (read before changing):
//   The sheet holds a snapshot of stock at creation (systemQty). Sales may
//   have happened while staff were counting, so the APPLIED delta is always
//   recomputed against the CURRENT stock at close time:
//
//       delta = countedQty − product.stockQty(now)      ← applied to stock
//       item.varianceQty = countedQty − systemQty       ← reporting vs snapshot
//
//   • delta ≠ 0  → product.stockQty is SET to the counted value and a signed
//     StockAdjustment (type STOCK_COUNT, reason "Stocktake <ref>", reference
//     = sheet ref) is written so the movement ledger explains the jump.
//   • delta = 0  → item counted, nothing to apply (applied = true, no row).
//   • Rows never counted (countedQty null) are left untouched — a partial
//     count can be closed deliberately; the response reports how many SKUs
//     were skipped so the manager can own that decision.
//
//   EVERYTHING (stock updates + adjustment rows + item applied flags + sheet
//   status) happens in ONE $transaction: a failed close leaves zero residue.
//
//   RBAC/BOLA: MANAGER+; the persisted sheet's branchId is checked with
//   assertBranchAccess (URL id is untrusted).
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (raw: Request, ctx: Ctx) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const { id } = await ctx.params;

  // Body is an intentional no-op object — parsed for strictness (rejects
  // stray fields so callers notice contract drift early).
  closeStocktakeSchema.parse(await req.json().catch(() => ({})));

  const sheet = await db.stocktake.findUnique({ where: { id } });
  if (!sheet) throw ApiError.notFound("Stocktake not found");
  assertBranchAccess(user, sheet.branchId); // BOLA

  if (sheet.status !== "OPEN") {
    throw ApiError.badRequest(`Only OPEN sheets can be closed (current: ${sheet.status})`);
  }

  const items = await db.stocktakeItem.findMany({
    where: { stocktakeId: sheet.id },
    select: { id: true, productId: true, countedQty: true, varianceQty: true, systemQty: true },
  });
  const countedItems = items.filter((it) => it.countedQty != null);
  if (countedItems.length === 0) {
    throw ApiError.badRequest("Nothing has been counted yet — save at least one count before closing");
  }
  // Current stock for the counted products only.
  const productIds = countedItems.map((it) => it.productId);
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stockQty: true },
  });
  const stockById = new Map(products.map((p) => [p.id, p]));

  let appliedCount = 0; // SKUs whose stock actually moved
  const skippedUncounted = items.length - countedItems.length;

  const result = await db.$transaction(async (tx) => {
    for (const it of countedItems) {
      const counted = D(it.countedQty); // narrowed non-null by the filter above
      const current = stockById.get(it.productId);
      if (!current) continue; // product deleted mid-count — nothing to update
      const delta = counted.minus(D(current.stockQty));
      if (!delta.isZero()) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stockQty: counted.toFixed(3) },
        });
        await tx.stockAdjustment.create({
          data: {
            productId: it.productId,
            branchId: sheet.branchId,
            type: "STOCK_COUNT",
            quantity: delta.toFixed(3), // signed
            unitCost: null, // cost is unchanged by a count; see StocktakeItem.unitCost
            reason: `Stocktake ${sheet.ref}`,
            reference: sheet.ref,
            userId: user.id,
          },
        });
        appliedCount += 1;
      }
      await tx.stocktakeItem.update({
        where: { id: it.id },
        data: { applied: true },
      });
    }

    const closed = await tx.stocktake.update({
      where: { id: sheet.id },
      data: { status: "CLOSED", closedById: user.id, closedAt: new Date() },
    });
    return closed;
  });

  // Reporting aggregates (snapshot-based) — Decimal, 2dp half-up.
  // Snapshot variance value needs unitCost — fetch it for the counted items.
  let shrinkageValue = D(0); // Σ over negative variances: |variance| × cost
  let overageValue = D(0); // Σ over positive variances: variance × cost
  let varianceSnapshotValue = D(0); // Σ|counted − system| × cost (report view)
  const costRows = await db.stocktakeItem.findMany({
    where: { stocktakeId: sheet.id, countedQty: { not: null } },
    select: { varianceQty: true, unitCost: true },
  });
  for (const row of costRows) {
    const v = D(row.varianceQty ?? 0);
    const c = D(row.unitCost ?? 0);
    varianceSnapshotValue = varianceSnapshotValue.plus(v.abs().times(c));
    const deltaSign = v.comparedTo(0);
    if (deltaSign < 0) shrinkageValue = shrinkageValue.plus(v.abs().times(c));
    else if (deltaSign > 0) overageValue = overageValue.plus(v.times(c));
  }

  void audit({
    userId: user.id,
    action: "STOCKTAKE_CLOSE",
    entity: "Stocktake",
    entityId: sheet.id,
    meta: {
      ref: sheet.ref,
      counted: countedItems.length,
      applied: appliedCount,
      skippedUncounted,
      snapshotVarianceValue: round2(varianceSnapshotValue).toFixed(2),
    },
  });

  return NextResponse.json({
    stocktake: { id: result.id, ref: result.ref, status: result.status, closedAt: result.closedAt?.toISOString() ?? null },
    summary: {
      totalItems: items.length,
      countedItems: countedItems.length,
      skippedUncounted,
      appliedCount,
      // Reporting view: |counted − snapshot| × cost (string, 2dp).
      snapshotVarianceValue: round2(varianceSnapshotValue).toFixed(2),
      shrinkageValue: round2(shrinkageValue).toFixed(2),
      overageValue: round2(overageValue).toFixed(2),
    },
  });
});
