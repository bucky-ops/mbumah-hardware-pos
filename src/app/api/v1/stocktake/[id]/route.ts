import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertBranchAccess } from "@/lib/api/guard";
import { patchStocktakeSchema } from "@/lib/validations/stocktake";
import { audit } from "@/lib/audit";
import { D } from "@/lib/format";

// src/app/api/v1/stocktake/[id]/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/stocktake/[id] — single count sheet.
//
//   GET   MANAGER+ — full sheet: header + every item with product info,
//                    system snapshot, counted value, variance and who counted.
//
//   PATCH MANAGER+ — two actions (validated by patchStocktakeSchema):
//     • SAVE_COUNTS — batch-write counted quantities onto an OPEN sheet.
//         − Per row: varianceQty = counted − systemQty (Decimal, 3dp,
//           ROUND_HALF_UP), countedBy/countedAt stamped server-side.
//         − Rows not present in the batch keep their previous values, so a
//           partial save is always safe.
//         − All writes run in ONE transaction; a sheet's countedAt header
//           stamp (informational) is refreshed to the latest counted row.
//     • CANCEL      — CLOSE-without-apply. Only OPEN sheets can be cancelled;
//                      CANCELLED sheets keep their counts for the record but
//                      never touch stock.
//
//   BOLA: the persisted sheet's branchId is checked with assertBranchAccess —
//   the URL id is untrusted client input.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

/** Next.js 16: route params arrive as a Promise. */
type Ctx = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (raw: Request, ctx: Ctx) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const { id } = await ctx.params;

  const sheet = await db.stocktake.findUnique({
    where: { id },
    include: {
      branch: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });
  if (!sheet) throw ApiError.notFound("Stocktake not found");
  assertBranchAccess(user, sheet.branchId); // BOLA — persisted branch is authoritative

  const items = await db.stocktakeItem.findMany({
    where: { stocktakeId: sheet.id },
    // Counting workflow order: not-yet-counted rows first, then alphabetical.
    orderBy: [{ countedQty: { sort: "asc", nulls: "first" } }, { product: { name: "asc" } }],
    include: {
      product: { select: { name: true, sku: true, unit: true, category: true } },
      countedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    stocktake: {
      id: sheet.id,
      ref: sheet.ref,
      status: sheet.status,
      branchId: sheet.branchId,
      branchCode: sheet.branch.code,
      branchName: sheet.branch.name,
      note: sheet.note,
      category: sheet.category,
      createdByName: sheet.createdBy.name,
      createdAt: sheet.createdAt.toISOString(),
      closedByName: sheet.closedBy?.name ?? null,
      closedAt: sheet.closedAt?.toISOString() ?? null,
      countedAt: sheet.countedAt?.toISOString() ?? null,
    },
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      name: it.product.name,
      sku: it.product.sku,
      unit: it.product.unit,
      category: it.product.category,
      systemQty: D(it.systemQty).toFixed(3),
      countedQty: it.countedQty != null ? D(it.countedQty).toFixed(3) : null,
      varianceQty: it.varianceQty != null ? D(it.varianceQty).toFixed(3) : null,
      unitCost: D(it.unitCost ?? 0).toFixed(2),
      countedByName: it.countedBy?.name ?? null,
      countedAt: it.countedAt?.toISOString() ?? null,
      note: it.note,
      applied: it.applied,
    })),
  });
});

export const PATCH = withErrorHandler(async (raw: Request, ctx: Ctx) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const { id } = await ctx.params;

  const body = patchStocktakeSchema.parse(await req.json().catch(() => ({})));

  const sheet = await db.stocktake.findUnique({ where: { id } });
  if (!sheet) throw ApiError.notFound("Stocktake not found");
  assertBranchAccess(user, sheet.branchId); // BOLA

  if (body.action === "CANCEL") {
    if (sheet.status !== "OPEN") {
      throw ApiError.badRequest(`Only OPEN sheets can be cancelled (current: ${sheet.status})`);
    }
    const cancelled = await db.stocktake.update({
      where: { id: sheet.id },
      data: { status: "CANCELLED", closedById: user.id, closedAt: new Date() },
    });
    void audit({
      userId: user.id,
      action: "STOCKTAKE_CANCEL",
      entity: "Stocktake",
      entityId: sheet.id,
      meta: { ref: sheet.ref },
    });
    return NextResponse.json({ stocktake: { id: cancelled.id, ref: cancelled.ref, status: cancelled.status } });
  }

  // ── SAVE_COUNTS ────────────────────────────────────────────────────────────
  if (sheet.status !== "OPEN") {
    throw ApiError.badRequest(`Counts can only be saved on OPEN sheets (current: ${sheet.status})`);
  }
  if (body.items.length === 0) {
    return NextResponse.json({ saved: 0, countedAt: sheet.countedAt?.toISOString() ?? null });
  }

  // Load only the rows named by the batch, scoped to THIS sheet (a mismatched
  // itemId from another sheet must 404, not silently cross-write).
  const itemIds = body.items.map((l) => l.itemId);
  const rows = await db.stocktakeItem.findMany({
    where: { stocktakeId: sheet.id, id: { in: itemIds } },
    select: { id: true, systemQty: true },
  });
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const missing = itemIds.filter((itemId) => !rowsById.has(itemId));
  if (missing.length > 0) {
    throw ApiError.notFound(`${missing.length} count line(s) do not belong to sheet ${sheet.ref}`);
  }

  const now = new Date();
  let latestCountedAt = sheet.countedAt ?? now;

  await db.$transaction(async (tx) => {
    for (const line of body.items) {
      const row = rowsById.get(line.itemId);
      if (!row) continue; // schema guarantees presence; kept for type narrowing
      const counted = D(line.countedQty).toDecimalPlaces(3);
      const variance = counted.minus(D(row.systemQty));
      latestCountedAt = now;
      await tx.stocktakeItem.update({
        where: { id: row.id },
        data: {
          countedQty: counted.toFixed(3),
          varianceQty: variance.toFixed(3),
          countedById: user.id,
          countedAt: now,
          note: line.note ?? null,
        },
      });
    }
    await tx.stocktake.update({
      where: { id: sheet.id },
      data: { countedAt: latestCountedAt },
    });
  });

  void audit({
    userId: user.id,
    action: "STOCKTAKE_SAVE_COUNTS",
    entity: "Stocktake",
    entityId: sheet.id,
    meta: { ref: sheet.ref, lines: body.items.length },
  });

  return NextResponse.json({
    saved: body.items.length,
    countedAt: latestCountedAt.toISOString(),
  });
});
