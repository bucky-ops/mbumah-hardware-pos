import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch } from "@/lib/api/guard";
import { createStocktakeSchema } from "@/lib/validations/stocktake";
import { audit } from "@/lib/audit";
import { D } from "@/lib/format";

// src/app/api/v1/stocktake/route.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/stocktake — Stocktake (count-sheet) collection endpoint.
//
//   GET   MANAGER+  — list count sheets in scope (branch-fenced), newest first,
//                     with per-sheet progress + variance aggregates.
//   POST  MANAGER+  — create a count sheet: snapshots every in-scope product's
//                     current stockQty + buyingPrice into StocktakeItem rows
//                     inside ONE transaction. The snapshot is frozen at
//                     creation; on close the applied delta is recomputed
//                     against the THEN-CURRENT stock (see close route), so
//                     sales that happen while counting are never clobbered.
//
//   REF FORMAT: STK-<branchCode>-<YYYYMMDD>-<seq> (seq counts sheets created
//   for that branch+day, 1-based, 3dp). The unique constraint referees races;
//   on a P2002 collision the sequence is bumped and retried (≤5×).
//
//   SCOPE: `category` (optional) limits the snapshot to one category; the
//   chosen value is frozen on the sheet for the audit trail.
//
//   RBAC/BOLA: requireRole("MANAGER") gates both verbs; assertTargetBranch
//   fences non-OWNER sessions to their own branch (body.branchId is honored
//   only for OWNER).
//
//   MONEY/QTY over the wire: Decimal values are serialized as STRINGS.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const MAX_ITEMS_PER_SHEET = 5000;

/** Nairobi-day stamp for the ref (matches the +03:00 EOD convention). */
function nairobiDayStamp(now: Date): string {
  const nbo = new Date(now.getTime() + 3 * 3_600_000);
  const y = nbo.getUTCFullYear();
  const m = String(nbo.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nbo.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");

  // Branch scope — OWNER may filter to any branch or see all; others fenced.
  const requestedBranch = req.nextUrl.searchParams.get("branchId");
  assertTargetBranch(user, requestedBranch);
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;
  const scope = branchId ? { branchId } : {};

  const statusParam = req.nextUrl.searchParams.get("status");
  const status =
    statusParam && ["OPEN", "CLOSED", "CANCELLED"].includes(statusParam) ? statusParam : undefined;

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 100) : 20;

  const sheets = await db.stocktake.findMany({
    where: { ...scope, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      branch: { select: { code: true, name: true } },
      createdBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  // Progress + Σvariance aggregates via one grouped query, joined in memory.
  const ids = sheets.map((s) => s.id);
  const itemStats = ids.length
    ? await db.stocktakeItem.groupBy({
        by: ["stocktakeId"],
        where: { stocktakeId: { in: ids }, countedQty: { not: null } },
        _count: { stocktakeId: true },
        _sum: { varianceQty: true },
      })
    : [];
  const statsById = new Map(itemStats.map((s) => [s.stocktakeId, s]));

  // Variance VALUE (Σ|variance| × unitCost) needs a multiplication Prisma
  // aggregates can't express — one indexed SQLite query per request (N ≤ 100).
  // SQLite cannot bind a JS array as a single parameter (P2010 "Arrays are not
  // supported in SQLite") — Prisma.join(ids) expands into `?, ?, ?` slots so
  // the IN(...) list stays properly parameterized.
  const varianceValueById = new Map<string, string>();
  if (ids.length) {
    const rows = await db.$queryRaw<Array<{ stocktakeId: string; val: string }>>(
      Prisma.sql`SELECT "stocktakeId", COALESCE(SUM(ABS(COALESCE("varianceQty", 0)) * COALESCE("unitCost", 0)), 0) AS val
        FROM "StocktakeItem"
        WHERE "stocktakeId" IN (${Prisma.join(ids)}) AND "countedQty" IS NOT NULL
        GROUP BY "stocktakeId"`,
    );
    for (const r of rows) varianceValueById.set(r.stocktakeId, D(r.val).toFixed(2));
  }

  const sheetsOut = sheets.map((s) => {
    const st = statsById.get(s.id);
    const counted = st?._count.stocktakeId ?? 0;
    return {
      id: s.id,
      ref: s.ref,
      status: s.status,
      branchId: s.branchId,
      branchCode: s.branch.code,
      branchName: s.branch.name,
      note: s.note,
      category: s.category,
      createdByName: s.createdBy.name,
      createdAt: s.createdAt.toISOString(),
      closedByName: s.closedBy?.name ?? null,
      closedAt: s.closedAt?.toISOString() ?? null,
      totalItems: s._count.items,
      countedItems: counted,
      // Σ varianceQty across counted rows (string, 3dp) — signed shortfall
      // is negative. Decimal discipline: serialized as string.
      varianceQtySum: st?._sum.varianceQty != null ? D(st._sum.varianceQty).toFixed(3) : null,
      // Σ |variance| × unitCost (string, 2dp) — shrinkage/overage scale.
      varianceValue: varianceValueById.get(s.id) ?? "0.00",
    };
  });

  return NextResponse.json({ items: sheetsOut, total: sheetsOut.length });
});

export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");

  const body = createStocktakeSchema.parse(await req.json().catch(() => ({})));

  // Branch resolution: OWNER may target any branch (defaults to their own);
  // everyone else is hard-fenced to their session branch.
  const branchId = user.role === "OWNER" && body.branchId ? body.branchId : user.branchId;
  assertTargetBranch(user, branchId);

  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw ApiError.notFound("Branch not found");

  // Snapshot scope: whole branch or one category.
  const productWhere = {
    branchId,
    ...(body.category ? { category: body.category } : {}),
  };

  const products = await db.product.findMany({
    where: productWhere,
    select: { id: true, stockQty: true, buyingPrice: true },
    orderBy: { name: "asc" },
  });

  if (products.length === 0) {
    throw ApiError.badRequest(
      body.category
        ? `No products found in category "${body.category}" for this branch`
        : "Branch has no products to count",
    );
  }
  if (products.length > MAX_ITEMS_PER_SHEET) {
    throw ApiError.badRequest(
      `Scope too large (${products.length} SKUs) — split the count by category (max ${MAX_ITEMS_PER_SHEET} per sheet)`,
    );
  }

  const now = new Date();
  const dayStamp = nairobiDayStamp(now);

  // Ref generation with collision retry (unique constraint is the referee).
  // seq = (existing sheets for this branch+day prefix) + attempt, so parallel
  // creations converge on distinct refs instead of all fighting for slot 001.
  let created: { id: string; ref: string; totalItems: number } | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const priorCount = await db.stocktake.count({
      where: { branchId, ref: { startsWith: `STK-${branch.code}-${dayStamp}-` } },
    });
    const ref = `STK-${branch.code}-${dayStamp}-${String(priorCount + attempt + 1).padStart(3, "0")}`;
    try {
      const sheet = await db.$transaction(async (tx) => {
        const s = await tx.stocktake.create({
          data: {
            branchId,
            ref,
            status: "OPEN",
            note: body.note,
            category: body.category ?? null,
            createdById: user.id,
          },
        });
        // Frozen snapshot: systemQty (3dp) + unitCost (2dp) per in-scope SKU.
        await tx.stocktakeItem.createMany({
          data: products.map((p) => ({
            stocktakeId: s.id,
            productId: p.id,
            systemQty: D(p.stockQty).toFixed(3),
            unitCost: D(p.buyingPrice).toFixed(2),
          })),
        });
        return s;
      });
      created = { id: sheet.id, ref: sheet.ref, totalItems: products.length };
    } catch (err) {
      lastErr = err;
      // P2002 (ref collision) → bump seq and retry; anything else bubbles up
      // through the shared error mapper.
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") throw err;
    }
  }
  if (!created) {
    throw lastErr instanceof Error ? lastErr : ApiError.badRequest("Could not allocate a stocktake ref");
  }

  void audit({
    userId: user.id,
    action: "STOCKTAKE_CREATE",
    entity: "Stocktake",
    entityId: created.id,
    meta: { ref: created.ref, branchId, products: created.totalItems, category: body.category ?? null },
  });

  return NextResponse.json(
    {
      stocktake: {
        id: created.id,
        ref: created.ref,
        status: "OPEN",
        branchId,
        totalItems: created.totalItems,
        countedItems: 0,
      },
    },
    { status: 201 },
  );
});
