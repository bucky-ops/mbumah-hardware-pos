// src/app/api/v1/reports/sales-insights/route.ts — GET /api/v1/reports/sales-insights
// Analytics feed for the "Sales Insights" dashboard (MANAGER+; cashiers → 403).
// Returns window KPIs, a daily revenue trend, top products, payment-method
// split, an hourly profile, a cashier leaderboard and — for the OWNER
// all-branches view — a per-branch comparison table over the last N days.
//
// CONVENTIONS (mirrors /api/v1/reports/eod):
//  • Decimal discipline via D()/round2() from @/lib/format — money is serialized
//    as STRINGS with 2dp ("1234.50"); counts are numbers.
//  • Nairobi = UTC+3 fixed (no DST): day buckets and hours use wall-clock math.
//  • Branch scoping: assertTargetBranch() then
//    `branchId = OWNER ? requestedBranch : user.branchId` (null = all branches).
//  • `days` must be 7 | 30 | 90 (default 30) — anything else → 400.
//
// WINDOW SEMANTICS: the last `days` Nairobi wall-clock days ENDING now — today
// counts as the final, in-progress day and `start` is anchored at the
// 00:00+03:00 day boundary, so `daily[]` is exactly `days` continuous buckets.
//
// ONE CONSISTENT SOURCE PER METRIC (per brief):
//  • kpis.revenue / methods[]  → Payment rows (receivedAt, status COMPLETED):
//    money actually received.
//  • daily[] / hourly[] / kpis.transactions / cashiers[] → Transaction rows
//    (createdAt, status COMPLETED | CREDIT | PARTIAL): ticket value + counts.
//  • kpis.estMargin → Σ TransactionItem.qty × unitCost — TRUE margin from the
//    sale-time WAC snapshot (rows written before the snapshot shipped fall back
//    to Product.buyingPrice and are flagged: kpis.marginBasis is "snapshot"
//    when every line has a cost snapshot, "estimate" when none do, "mixed"
//    otherwise, with kpis.costCoverage = % of COGS lines that carry a snapshot).
//  • kpis.creditOutstanding → Transaction.balanceDue > 0 with status
//    CREDIT | PARTIAL, issued inside the window (window-scoped like the EOD
//    report's credit figure).
//  • perBranch[] (OWNER all-branches view; always [] when a branch was scoped —
//    a single-branch view has nothing to compare) → one row per branch that had
//    a ticket or received money in the current window: revenue = Payment
//    groupBy by branchId, orders = distinct transaction ids on item rows,
//    avgBasket = revenue ÷ orders, estMargin = Σ qty×(unitCost snapshot ||
//    product.buyingPrice) for that branch's items. No collection-rate column —
//    deliberately out of scope for this pass.
//
// PERIOD-OVER-PERIOD: `comparison` mirrors the 5 KPIs for the immediately
// preceding window of the same length ([start − days, start)), plus pct-change
// deltas (null when the previous value is 0 — a pct off zero is meaningless).

import { NextRequest, NextResponse } from "next/server";
import Decimal from "decimal.js";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch } from "@/lib/api/guard";
import { D, round2 } from "@/lib/format";

export const dynamic = "force-dynamic";

const METHODS = ["CASH", "MPESA", "BANK_TRANSFER", "CARD", "STORE_CREDIT"] as const;
type Method = (typeof METHODS)[number];
const SALE_STATUSES = ["COMPLETED", "CREDIT", "PARTIAL"] as const;
const DAY_MS = 86_400_000;
const NAIROBI_OFFSET_MS = 3 * 3_600_000;

/** YYYY-MM-DD of instant `ms` on the Nairobi wall clock (UTC+3 fixed, no DST). */
function nairobiDate(ms: number): string {
  return new Date(ms + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Serialize a Decimal as a 2dp money string (half-up). */
function money(d: Decimal): string {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** One per-branch comparison row (all-branches view; money = 2dp strings). */
interface PerBranchRow {
  branchId: string;
  branchName: string;
  revenue: string; // payments received by this branch
  orders: number; // distinct tickets with items in this branch
  avgBasket: string; // revenue ÷ orders ("0.00" when orders = 0)
  estMargin: string; // Σ qty × (unitCost snapshot || product.buyingPrice)
}

export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER"); // cashiers → 403
  const sp = req.nextUrl.searchParams;

  const daysRaw = sp.get("days") ?? "30";
  if (daysRaw !== "7" && daysRaw !== "30" && daysRaw !== "90") {
    throw ApiError.badRequest("days must be 7, 30 or 90");
  }
  const days = Number(daysRaw);

  const requestedBranch = sp.get("branchId");
  assertTargetBranch(user, requestedBranch); // OWNER cross-branch; others fenced
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;

  const now = Date.now();
  const today = nairobiDate(now);
  const firstDay = nairobiDate(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS);
  const start = new Date(`${firstDay}T00:00:00+03:00`); // Nairobi day boundary
  const end = new Date(now);

  const branchScope = branchId ? { branchId } : {};

  // ── Previous comparison window of identical length, ending where this one
  // starts: [start − days, start). KPI-only reads (no charts needed). ────────
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - days * DAY_MS);
  const prevSaleWhere = {
    ...branchScope,
    createdAt: { gte: prevStart, lt: prevEnd },
    status: { in: [...SALE_STATUSES] },
  };

  // ── Zero-filled buckets so the charts get a continuous series. ────────────
  const dates: string[] = [];
  for (let t = Date.parse(`${firstDay}T00:00:00Z`); t <= Date.parse(`${today}T00:00:00Z`); t += DAY_MS) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  const dayIndex = new Map(dates.map((d, i) => [d, i]));
  const dailyRevenue = dates.map(() => new Decimal(0));
  const dailyOrders = dates.map(() => 0);
  const hourlyRevenue = Array.from({ length: 24 }, () => new Decimal(0));
  const hourlyOrders = new Array<number>(24).fill(0);

  const saleWhere = {
    ...branchScope,
    createdAt: { gte: start, lt: end },
    status: { in: [...SALE_STATUSES] },
  };

  // ── Reads: current window (transactions, items, tenders, cashiers) + the
  // three previous-window KPI reads, all in parallel. ────────────────────────
  const [
    txns,
    itemRows,
    methodGroups,
    cashierGroups,
    prevTxns,
    prevMethodGroups,
    prevItemRows,
    branchPaymentGroups,
  ] = await Promise.all([
      db.transaction.findMany({
        where: saleWhere,
        select: { createdAt: true, totalAmount: true, status: true, balanceDue: true },
      }),
      db.transactionItem.findMany({
        where: { transaction: saleWhere },
        select: {
          productId: true,
          description: true,
          qty: true,
          lineNet: true,
          unitCost: true, // sale-time WAC snapshot — the COGS basis
          product: { select: { buyingPrice: true } }, // fallback for legacy rows
          transaction: { select: { id: true, branchId: true } }, // scope trail + distinct-ticket counting for perBranch
        },
      }),
      db.payment.groupBy({
        by: ["method"],
        where: { ...branchScope, receivedAt: { gte: start, lt: end }, status: "COMPLETED" },
        _sum: { amount: true },
        _count: true,
      }),
      db.transaction.groupBy({
        by: ["userId"],
        where: saleWhere,
        _sum: { totalAmount: true },
        _count: true,
      }),
      db.transaction.findMany({
        where: prevSaleWhere,
        select: { status: true, balanceDue: true },
      }),
      db.payment.groupBy({
        by: ["method"],
        where: { ...branchScope, receivedAt: { gte: prevStart, lt: prevEnd }, status: "COMPLETED" },
        _sum: { amount: true },
      }),
      // Previous-window margin basis: qty × (unitCost snapshot ?? current cost).
      db.transactionItem.findMany({
        where: { transaction: prevSaleWhere },
        select: { qty: true, unitCost: true, product: { select: { buyingPrice: true } } },
      }),
      // perBranch revenue basis: money received per branch — same window/where
      // as methodGroups, grouped by branch instead of tender.
      db.payment.groupBy({
        by: ["branchId"],
        where: { ...branchScope, receivedAt: { gte: start, lt: end }, status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

  // ── Daily + hourly buckets (Transaction source) + credit outstanding. ─────
  let creditOutstanding = new Decimal(0);
  for (const t of txns) {
    const di = dayIndex.get(nairobiDate(t.createdAt.getTime()));
    if (di !== undefined) {
      dailyRevenue[di] = dailyRevenue[di].add(D(t.totalAmount));
      dailyOrders[di] += 1;
    }
    const hour = (t.createdAt.getUTCHours() + 3) % 24; // Nairobi wall-clock hour
    hourlyRevenue[hour] = hourlyRevenue[hour].add(D(t.totalAmount));
    hourlyOrders[hour] += 1;
    if ((t.status === "CREDIT" || t.status === "PARTIAL") && D(t.balanceDue).gt(0)) {
      creditOutstanding = creditOutstanding.add(D(t.balanceDue));
    }
  }
  const daily = dates.map((date, i) => ({
    date,
    revenue: round2(dailyRevenue[i].toNumber()),
    orders: dailyOrders[i],
  }));
  const hourly = hourlyRevenue.map((rev, hour) => ({
    hour,
    revenue: round2(rev.toNumber()),
    orders: hourlyOrders[hour],
  }));

  // ── Top products (single item read → JS aggregation with Decimal). ────────
  const byProduct = new Map<string, { productId: string | null; name: string; qty: Decimal; revenue: Decimal }>();
  let estMargin = new Decimal(0);
  let snapshotLines = 0; // lines whose COGS comes from the sale-time snapshot
  let totalCostLines = 0; // lines that contribute a cost at all
  for (const it of itemRows) {
    const key = it.productId ?? `desc:${it.description}`;
    const entry = byProduct.get(key) ?? {
      productId: it.productId,
      name: it.description,
      qty: new Decimal(0),
      revenue: new Decimal(0),
    };
    const qty = D(it.qty);
    entry.qty = entry.qty.add(qty);
    entry.revenue = entry.revenue.add(D(it.lineNet));
    byProduct.set(key, entry);
    const hasSnapshot = D(it.unitCost).gt(0);
    const cost = hasSnapshot ? D(it.unitCost) : it.product ? D(it.product.buyingPrice) : null;
    if (cost !== null) {
      totalCostLines += 1;
      if (hasSnapshot) snapshotLines += 1;
      estMargin = estMargin.add(qty.mul(cost));
    }
  }
  const marginBasis: "snapshot" | "estimate" | "mixed" | "none" =
    totalCostLines === 0
      ? "none"
      : snapshotLines === totalCostLines
        ? "snapshot"
        : snapshotLines === 0
          ? "estimate"
          : "mixed";
  const costCoverage = totalCostLines === 0 ? 100 : round2((snapshotLines / totalCostLines) * 100);
  const topProducts = [...byProduct.values()]
    .sort((a, b) => b.revenue.minus(a.revenue).toNumber())
    .slice(0, 8)
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      qtySold: round2(p.qty.toNumber()),
      revenue: money(p.revenue),
    }));

  // ── Payment methods (zero-filled) + revenue KPI = Σ completed payments. ───
  const methods = METHODS.map((m) => ({ method: m, total: "0.00", count: 0 }));
  const methodIndex = new Map<Method, number>(methods.map((m, i) => [m.method, i]));
  let revenue = new Decimal(0);
  for (const g of methodGroups) {
    const sum = D(g._sum.amount);
    revenue = revenue.add(sum); // unknown methods still count toward revenue
    const i = methodIndex.get(g.method as Method);
    if (i === undefined) continue;
    methods[i].total = money(sum);
    methods[i].count = g._count;
  }

  const transactions = txns.length;
  const kpis = {
    revenue: money(revenue),
    transactions,
    avgBasket: money(transactions > 0 ? revenue.div(transactions) : new Decimal(0)),
    estMargin: money(estMargin),
    creditOutstanding: money(creditOutstanding),
    marginBasis,
    costCoverage,
  } as {
    revenue: string;
    transactions: number;
    avgBasket: string;
    estMargin: string;
    creditOutstanding: string;
    marginBasis: "snapshot" | "estimate" | "mixed" | "none";
    costCoverage: number;
  };

  // ── Period-over-period: mirror the 5 KPIs for the previous window. ────────
  let prevRevenue = new Decimal(0);
  for (const g of prevMethodGroups) prevRevenue = prevRevenue.add(D(g._sum.amount));
  let prevCreditOutstanding = new Decimal(0);
  for (const t of prevTxns) {
    if ((t.status === "CREDIT" || t.status === "PARTIAL") && D(t.balanceDue).gt(0)) {
      prevCreditOutstanding = prevCreditOutstanding.add(D(t.balanceDue));
    }
  }
  let prevEstMargin = new Decimal(0);
  for (const it of prevItemRows) {
    const cost = D(it.unitCost).gt(0) ? D(it.unitCost) : it.product ? D(it.product.buyingPrice) : null;
    if (cost !== null) prevEstMargin = prevEstMargin.add(D(it.qty).mul(cost));
  }
  const prevTransactions = prevTxns.length;
  const prevKpis = {
    revenue: prevRevenue,
    transactions: prevTransactions,
    avgBasket: prevTransactions > 0 ? prevRevenue.div(prevTransactions) : new Decimal(0),
    estMargin: prevEstMargin,
    creditOutstanding: prevCreditOutstanding,
  };

  /** pct change cur vs prev — null when prev is 0 (pct off zero is noise). */
  function pctChange(cur: Decimal, prev: Decimal): number | null {
    if (prev.lte(0)) return null;
    return round2(cur.minus(prev).div(prev).mul(100).toNumber());
  }
  const comparison = {
    window: { days, start: prevStart.toISOString(), end: prevEnd.toISOString() },
    kpis: {
      revenue: money(prevKpis.revenue),
      transactions: prevKpis.transactions,
      avgBasket: money(prevKpis.avgBasket),
      estMargin: money(prevKpis.estMargin),
      creditOutstanding: money(prevKpis.creditOutstanding),
    },
    deltas: {
      revenue: { change: money(revenue.minus(prevRevenue)), pct: pctChange(revenue, prevRevenue) },
      transactions: {
        change: transactions - prevTransactions,
        pct: pctChange(new Decimal(transactions), new Decimal(prevTransactions)),
      },
      avgBasket: {
        change: money(
          (transactions > 0 ? revenue.div(transactions) : new Decimal(0)).minus(prevKpis.avgBasket)
        ),
        pct: pctChange(
          transactions > 0 ? revenue.div(transactions) : new Decimal(0),
          prevKpis.avgBasket
        ),
      },
      estMargin: { change: money(estMargin.minus(prevEstMargin)), pct: pctChange(estMargin, prevEstMargin) },
      creditOutstanding: {
        change: money(creditOutstanding.minus(prevCreditOutstanding)),
        pct: pctChange(creditOutstanding, prevCreditOutstanding),
      },
    },
  };

  // ── Cashier leaderboard (top 5 by ticket revenue, display names resolved). ─
  const topCashiers = [...cashierGroups]
    .sort((a, b) => D(b._sum.totalAmount).minus(D(a._sum.totalAmount)).toNumber())
    .slice(0, 5);
  const users = topCashiers.length
    ? await db.user.findMany({
        where: { id: { in: topCashiers.map((g) => g.userId) } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const cashiers = topCashiers.map((g) => ({
    userId: g.userId,
    userName: nameById.get(g.userId) ?? "Unknown user",
    revenue: money(D(g._sum.totalAmount)),
    orders: g._count,
  }));

  // ── Per-branch comparison (OWNER all-branches view only). Branch set = every
  // branch that had a ticket (item rows) or received money (payments) in the
  // window; when a specific branch is scoped there is nothing to compare and
  // perBranch stays [] — no cross-branch margin/data ever leaves scoped calls.
  let perBranch: PerBranchRow[] = [];
  if (!branchId) {
    const ticketIdsByBranch = new Map<string, Set<string>>();
    const marginByBranch = new Map<string, Decimal>();
    for (const it of itemRows) {
      const bId = it.transaction.branchId;
      const tickets = ticketIdsByBranch.get(bId) ?? new Set<string>();
      tickets.add(it.transaction.id);
      ticketIdsByBranch.set(bId, tickets);
      const hasSnapshot = D(it.unitCost).gt(0);
      const cost = hasSnapshot ? D(it.unitCost) : it.product ? D(it.product.buyingPrice) : null;
      if (cost !== null) {
        const cogs = D(it.qty).mul(cost);
        marginByBranch.set(bId, (marginByBranch.get(bId) ?? new Decimal(0)).add(cogs));
      }
    }
    const revenueByBranch = new Map<string, Decimal>();
    for (const g of branchPaymentGroups) revenueByBranch.set(g.branchId, D(g._sum.amount));

    const branchIds = [
      ...new Set<string>([...ticketIdsByBranch.keys(), ...revenueByBranch.keys()]),
    ];
    const branchRecs = branchIds.length
      ? await db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } })
      : [];
    const branchNameById = new Map(branchRecs.map((b) => [b.id, b.name]));
    perBranch = branchIds
      .map((bId) => {
        const orders = ticketIdsByBranch.get(bId)?.size ?? 0;
        const branchRevenue = revenueByBranch.get(bId) ?? new Decimal(0);
        return {
          branchId: bId,
          branchName: branchNameById.get(bId) ?? "Unknown branch",
          revenue: money(branchRevenue),
          orders,
          avgBasket: money(orders > 0 ? branchRevenue.div(orders) : new Decimal(0)),
          estMargin: money(marginByBranch.get(bId) ?? new Decimal(0)),
        };
      })
      .sort(
        (a, b) =>
          D(b.revenue).minus(D(a.revenue)).toNumber() || a.branchName.localeCompare(b.branchName)
      );
  }

  return NextResponse.json({
    window: { days, start: start.toISOString(), end: end.toISOString() },
    branchId: branchId ?? null,
    kpis,
    comparison,
    daily,
    topProducts,
    methods,
    hourly,
    cashiers,
    perBranch,
  });
});
