// src/app/api/v1/reports/reorder/route.ts
import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { withErrorHandler } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch } from "@/lib/api/guard";
import { D } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/reports/reorder — Reorder & restock intelligence (MANAGER+).
//
//   GET → purchase-requisition suggestions for every product in scope whose
//   stockQty is at/below its reorderLevel (zero-velocity items included).
//
//   VELOCITY: TransactionItems of the LAST 14 days joined to Transactions with
//   status in (COMPLETED, CREDIT, PARTIAL) — quotes/HELD never count as demand.
//   avgDailySales = Σ qty / 14 (Decimal, 3dp half-up).
//
//   METRICS PER CANDIDATE
//   • daysOfCover  = stockQty / avgDailySales (1dp), null when there is no
//     demand in the window — the row still shows (urgency LOW while stocked).
//   • suggestedQty = max(ceil(avgDailySales × 14 + reorderLevel − stockQty), 1)
//     — a two-week cover target topped back up to the reorder level. Zero-
//     demand items fall back to max(ceil(reorderLevel − stockQty), 1) so the
//     requisition always tops up to the reorder level. Both branches are
//     ceiled so suggested quantities are always orderable whole units.
//   • estCost      = suggestedQty × buyingPrice (2dp half-up).
//   • urgency      = OUT (stockQty ≤ 0) → CRITICAL (cover ≤ 3) → LOW (≤ 7 or
//     no demand while stocked) → WATCH. Zero-stock items are always OUT: OUT
//     is the strictly more urgent bucket (supersedes the zero-stock/no-demand
//     CRITICAL case) and sorts first.
//
//   SORT: OUT first, then daysOfCover ascending (nulls last), then name.
//
//   MONEY/QTY over the wire: Decimal values are serialized as STRINGS
//   (estCost, stockQty, reorderLevel, avgDailySales, estTotalCost); counts are
//   numbers. Branch scoping mirrors /api/v1/reports/eod: OWNER may pass any
//   ?branchId= (or none = all branches); other roles are BOLA-fenced to their
//   own branch by assertTargetBranch.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14; // velocity window AND cover target
const SELLING_STATUSES = ["COMPLETED", "CREDIT", "PARTIAL"];

type Urgency = "OUT" | "CRITICAL" | "LOW" | "WATCH";

interface ReorderRow {
  productId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stockQty: Decimal;
  reorderLevel: Decimal;
  avgDailySales: Decimal;
  daysOfCover: Decimal | null;
  suggestedQty: number;
  estCost: Decimal;
  urgency: Urgency;
}

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");

  // Branch scope — EXACTLY like /api/v1/reports/eod.
  const requestedBranch = req.nextUrl.searchParams.get("branchId");
  assertTargetBranch(user, requestedBranch); // OWNER cross-branch; others no-op/fenced
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;
  const branchScope = branchId ? { branchId } : {};

  // Rolling 14-day demand window ending now.
  const start = new Date(Date.now() - WINDOW_DAYS * DAY_MS);

  // ── 1) Candidates: every product at/below its reorder level (incl. items
  //      with zero sales velocity). Column-vs-column comparison is done in JS —
  //      catalogs are small (hundreds of SKUs) and this keeps the query plan
  //      index-friendly.
  const products = await db.product.findMany({
    where: branchScope,
    select: {
      id: true,
      sku: true,
      name: true,
      category: true,
      unit: true,
      buyingPrice: true,
      stockQty: true,
      reorderLevel: true,
    },
  });
  const candidates = products.filter((p) => D(p.stockQty).lte(D(p.reorderLevel)));

  // ── 2) 14-day sales velocity per product (COMPLETED / CREDIT / PARTIAL
  //      transactions only — a quote is not demand). Items with productId=null
  //      (ad-hoc receipt lines) are excluded at the query level.
  const soldItems = await db.transactionItem.findMany({
    where: {
      productId: { not: null },
      transaction: {
        ...branchScope,
        createdAt: { gte: start },
        status: { in: SELLING_STATUSES },
      },
    },
    select: { productId: true, qty: true },
  });
  const soldTotals = new Map<string, Decimal>();
  for (const item of soldItems) {
    if (!item.productId) continue; // narrowed by the where clause; TS still sees null
    const prev = soldTotals.get(item.productId) ?? new Decimal(0);
    soldTotals.set(item.productId, prev.add(D(item.qty)));
  }

  // ── 3) Per-candidate metrics. ────────────────────────────────────────────
  const rows: ReorderRow[] = candidates.map((p) => {
    const stockQty = D(p.stockQty);
    const reorderLevel = D(p.reorderLevel);
    const sold = soldTotals.get(p.id) ?? new Decimal(0);
    const avgDailySales = sold.div(WINDOW_DAYS).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
    const hasDemand = avgDailySales.gt(0);

    const daysOfCover = hasDemand
      ? stockQty.div(avgDailySales).toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
      : null;

    // Two-week cover target, topped back up to the reorder level. Zero-demand
    // items: plain top-up to the reorder level. Ceil on both branches keeps
    // requisition quantities orderable (whole units), min 1.
    const suggestedQty = hasDemand
      ? Math.max(
          avgDailySales.mul(WINDOW_DAYS).add(reorderLevel).sub(stockQty).ceil().toNumber(),
          1
        )
      : Math.max(reorderLevel.sub(stockQty).ceil().toNumber(), 1);

    const estCost = D(suggestedQty)
      .mul(D(p.buyingPrice))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    let urgency: Urgency;
    if (stockQty.lte(0)) urgency = "OUT";
    else if (daysOfCover === null) urgency = "LOW"; // stocked, but no demand in window
    else if (daysOfCover.lte(3)) urgency = "CRITICAL";
    else if (daysOfCover.lte(7)) urgency = "LOW";
    else urgency = "WATCH";

    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      unit: p.unit,
      stockQty,
      reorderLevel,
      avgDailySales,
      daysOfCover,
      suggestedQty,
      estCost,
      urgency,
    };
  });

  // ── 4) Sort: OUT first, then daysOfCover ascending (nulls last), then name. ─
  rows.sort((a, b) => {
    const aOut = a.urgency === "OUT" ? 0 : 1;
    const bOut = b.urgency === "OUT" ? 0 : 1;
    if (aOut !== bOut) return aOut - bOut;
    const aCover = a.daysOfCover?.toNumber() ?? Number.POSITIVE_INFINITY;
    const bCover = b.daysOfCover?.toNumber() ?? Number.POSITIVE_INFINITY;
    if (aCover !== bCover) return aCover - bCover;
    return a.name.localeCompare(b.name);
  });

  // ── 5) Totals + wire shape (Decimals → strings, counts → numbers). ───────
  const estTotal = rows.reduce((sum, r) => sum.add(r.estCost), new Decimal(0));
  const outCount = rows.filter((r) => r.urgency === "OUT").length;

  return NextResponse.json({
    asOf: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    items: rows.map((r) => ({
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      category: r.category,
      unit: r.unit,
      stockQty: r.stockQty.toString(),
      reorderLevel: r.reorderLevel.toString(),
      avgDailySales: r.avgDailySales.toFixed(3),
      daysOfCover: r.daysOfCover === null ? null : r.daysOfCover.toFixed(1),
      suggestedQty: r.suggestedQty,
      estCost: r.estCost.toFixed(2),
      urgency: r.urgency,
    })),
    totals: {
      count: rows.length,
      outCount,
      estTotalCost: estTotal.toFixed(2),
    },
  });
});
