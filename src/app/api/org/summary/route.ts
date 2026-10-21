// GET /api/org/summary (v2.16.0 subdomain workspaces)
//
// Organization console data: all active stores with today's KPIs, plus
// organization-wide alerts (low stock, overdue rentals, debt aging, pending
// M-Pesa payments) and the most recent audit events.
//
// AUTHORIZATION: SUPER_ADMIN and STORE_OWNER only (ACCOUNTANT gets the
// financial KPI view too; the response contains no customer PII, only
// aggregates). Branch-only roles must never see organization-wide data
// (spec: "Do not expose organization-wide data to branch-only users").

import { rawDb, runWithoutTenant } from '@/lib/db';
import { requireAuth, getSessionFromRequest } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { hrSummaryForOrgConsole, hrPerStoreForOrgConsole } from '@/lib/hr/reports';
import { isHrModuleEnabled } from '@/lib/hr/feature-flag';
import { hasHrPermission } from '@/lib/hr/permissions';
import { TREND_DAYS, trendWindows, variancePct, sparkBuckets, countBuckets, topMover, storeSparks } from '@/lib/org/summary-trend';
import { round2 } from '@/lib/utils/financialMath';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function orgSummaryHandler(request: NextRequest): Promise<Response> {
  // v2.58.0: the org console aggregates ALL stores by contract — every read
// below is org-wide (per-store loops / cross-store groupBys) guarded to
// ORG_ROLES. The reads go through rawDb (the un-intercepted client) so the
// v2.57.0 leak class (a runWithoutTenant bypass silently ignored inside a
// Next.js request, AND-narrowing the query to the browsing store) can never
// shrink an org total to one branch's numbers for a store-scoped viewer.
// Read-only route: rawDb's missing immutability guard is irrelevant here.

  return runWithoutTenant(async () => {
    const today = startOfToday();

    const stores = await rawDb.store.findMany({
      where: { status: { not: 'ARCHIVED' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        slug: true,
        subdomain: true,
        location: true,
        phone: true,
        status: true,
        brandingColor: true,
      },
    });

    const windows = trendWindows(today);
    const TREND_WHERE = {
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    };

    const [salesByStore, lowStockByStore, overdueRentalsByStore, debtByStore, pendingMpesaByStore, recentAudit, trendWeek, trendPrior, trendRowsRaw, trendWeekByStore, trendPriorByStore] =
      await Promise.all([
        // Today's revenue per store (SALE type, settled payment statuses)
        rawDb.salesTransaction.groupBy({
          by: ['storeId'],
          where: {
            createdAt: { gte: today },
            transactionType: 'SALE',
            paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
          },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        // Low stock per store (at or below reorder level)
        rawDb.product.groupBy({
          by: ['storeId'],
          where: { quantityInStock: { lte: rawDb.product.fields.reorderLevel }, isActive: true },
          _count: { _all: true },
        }),
        // Overdue rentals per store
        rawDb.equipmentRental.groupBy({
          by: ['storeId'],
          where: { status: { in: ['ACTIVE', 'OVERDUE'] }, expectedReturnDate: { lt: new Date() } },
          _count: { _all: true },
        }),
        // Outstanding debt balances per store
        rawDb.debtLedger.groupBy({
          by: ['storeId'],
          where: { status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] }, balance: { gt: 0 } },
          _sum: { balance: true },
          _count: { _all: true },
        }),
        // Pending M-Pesa payments per store
        rawDb.mpesaTransaction.groupBy({
          by: ['storeId'],
          where: { status: 'PENDING' },
          _count: { _all: true },
        }),
        // Recent audit events (org-wide, latest 10; AuditLog orders by timestamp)
        rawDb.auditLog.findMany({
          orderBy: { timestamp: 'desc' },
          take: 10,
          select: {
            id: true,
            storeId: true,
            entityType: true,
            entityId: true,
            action: true,
            userId: true,
            timestamp: true,
          },
        }),
        // v2.173.0: the 7-day trend — current-week totals (gross).
        rawDb.salesTransaction.aggregate({
          where: { ...TREND_WHERE, createdAt: { gte: windows.weekAgo } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        // v2.173.0: the prior-week totals the variance compares against.
        rawDb.salesTransaction.aggregate({
          where: { ...TREND_WHERE, createdAt: { gte: windows.twoWeeksAgo, lt: windows.weekAgo } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        // v2.173.0: the per-day rows both sparklines bucket (revenue sums
        // gross totalAmount; transactions count the same rows 1 each).
        // v2.175.0: the select gains storeId — the SAME rows feed the
        // per-branch table sparks, so no second findMany is spent.
        rawDb.salesTransaction.findMany({
          where: { ...TREND_WHERE, createdAt: { gte: windows.weekAgo } },
          select: { createdAt: true, totalAmount: true, storeId: true },
        }),
        // v2.174.0: per-store CURRENT-week slices — BOTH mover metrics
        // (gross amount + count) come from this ONE groupBy.
        rawDb.salesTransaction.groupBy({
          by: ['storeId'],
          where: { ...TREND_WHERE, createdAt: { gte: windows.weekAgo } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
        // v2.174.0: per-store PRIOR-week slices — the comparison side,
        // the exact window the prior-week aggregate above uses.
        rawDb.salesTransaction.groupBy({
          by: ['storeId'],
          where: { ...TREND_WHERE, createdAt: { gte: windows.twoWeeksAgo, lt: windows.weekAgo } },
          _sum: { totalAmount: true },
          _count: { _all: true },
        }),
      ]);

    const revenueMap = new Map(
      salesByStore.map((r) => [r.storeId, { sum: r._sum?.totalAmount ?? 0, count: r._count?._all ?? 0 }]),
    );
    const lowStockMap = new Map(lowStockByStore.map((r) => [r.storeId, r._count._all]));
    const rentalsMap = new Map(overdueRentalsByStore.map((r) => [r.storeId, r._count._all]));
    const debtMap = new Map(debtByStore.map((r) => [r.storeId, { balance: r._sum.balance ?? 0, count: r._count._all }]));
    const mpesaMap = new Map(pendingMpesaByStore.map((r) => [r.storeId, r._count._all]));

    const storeRows = stores.map((s) => {
      const sales = revenueMap.get(s.id);
      const debt = debtMap.get(s.id);
      return {
        ...s,
        todayRevenue: Number(sales?.sum ?? 0),
        todayTransactions: sales?.count ?? 0,
        lowStockCount: lowStockMap.get(s.id) ?? 0,
        overdueRentals: rentalsMap.get(s.id) ?? 0,
        debtOutstanding: Number(debt?.balance ?? 0),
        debtCount: debt?.count ?? 0,
        pendingMpesa: mpesaMap.get(s.id) ?? 0,
      };
    });

    const totals = storeRows.reduce(
      (acc, s) => ({
        revenue: acc.revenue + s.todayRevenue,
        transactions: acc.transactions + s.todayTransactions,
        lowStock: acc.lowStock + s.lowStockCount,
        overdueRentals: acc.overdueRentals + s.overdueRentals,
        debtOutstanding: acc.debtOutstanding + s.debtOutstanding,
        pendingMpesa: acc.pendingMpesa + s.pendingMpesa,
      }),
      { revenue: 0, transactions: 0, lowStock: 0, overdueRentals: 0, debtOutstanding: 0, pendingMpesa: 0 },
    );

    // v2.173.0: the 7-day trend block — GROSS by contract. The trend
    // decorates the "Revenue today" StatCard on THIS surface, whose value
    // is the gross `_sum.totalAmount` above; a net-of-tax spark under a
    // gross headline would be a lying adjacency. (The expert console's
    // kpi-summary computed revenue NET of tax — a cross-surface divergence
    // between the two "Revenue" labels, recorded in v2.173.0 and
    // RECONCILED in v2.185.0: kpi-summary now speaks this same gross till
    // face, with its VAT lens riding additively under its own label.) The
    // card hides the variance badge when priorWeekTotal is 0 — no prior
    // data means NO comparison, never a fabricated "+0%".
    const trendRows = trendRowsRaw.map((r) => ({
      createdAt: r.createdAt,
      amount: Number(r.totalAmount),
      storeId: r.storeId,
    }));
    const revenueWeek = round2(Number(trendWeek._sum.totalAmount ?? 0));
    const revenuePrior = round2(Number(trendPrior._sum.totalAmount ?? 0));
    const txWeek = trendWeek._count._all;
    const txPrior = trendPrior._count._all;
    // v2.174.0: the top mover — per-store slices named through the ACTIVE
    // store list (a sale whose store has no active name is counted in the
    // totals above but can never be spoken by the mover line). Both metrics
    // come from the same two groupBys; the lib owns every honesty rule.
    const curMap = new Map(
      trendWeekByStore.map((r) => [r.storeId, { amount: Number(r._sum?.totalAmount ?? 0), count: r._count?._all ?? 0 }]),
    );
    const priMap = new Map(
      trendPriorByStore.map((r) => [r.storeId, { amount: Number(r._sum?.totalAmount ?? 0), count: r._count?._all ?? 0 }]),
    );
    const revSlices = stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      current: curMap.get(s.id)?.amount ?? 0,
      prior: priMap.get(s.id)?.amount ?? 0,
      // v2.175.0: identity pass-throughs — the winner rides them so the
      // card can deep-link through the SAME safe resolver the branches
      // table speaks. A null slug flows through and the card falls back
      // to plain text (the safe-builder contract: no safe URL, no link).
      slug: s.slug,
      subdomain: s.subdomain,
      isActive: s.status === 'ACTIVE',
    }));
    const txSlices = stores.map((s) => ({
      storeId: s.id,
      storeName: s.name,
      current: curMap.get(s.id)?.count ?? 0,
      prior: priMap.get(s.id)?.count ?? 0,
      slug: s.slug,
      subdomain: s.subdomain,
      isActive: s.status === 'ACTIVE',
    }));
    const revenueMover = topMover(revSlices);
    const txMover = topMover(txSlices);
    const trend = {
      revenue: {
        spark: sparkBuckets(trendRows, windows.startToday, TREND_DAYS),
        weekTotal: revenueWeek,
        priorWeekTotal: revenuePrior,
        variancePct: variancePct(revenueWeek, revenuePrior),
        topMover: revenueMover
          ? { ...revenueMover, variancePct: variancePct(revenueMover.current, revenueMover.prior) }
          : null,
      },
      transactions: {
        spark: countBuckets(trendRows, windows.startToday, TREND_DAYS),
        weekTotal: txWeek,
        priorWeekTotal: txPrior,
        variancePct: variancePct(txWeek, txPrior),
        topMover: txMover
          ? { ...txMover, variancePct: variancePct(txMover.current, txMover.prior) }
          : null,
      },
    };

    // v2.175.0: the branches table learns the week's shape — one revenue
    // spark PER branch, bucketed from the SAME row set the header sparks
    // speak (the findMany above gained storeId in its select; no second
    // read). Additive: `perStoreTrend` keys by storeId so the card can
    // join it against summary.stores without relying on row order, and a
    // branch with an empty week draws the honest flat line (zeros).
    // v2.177.0: each entry gains `priorWeekTotal` — the SAME per-store
    // prior-week slice the v2.174.0 top mover already computed (priMap;
    // still ZERO new queries). The client's delta chips compare through
    // the lib's weekDelta, which returns null when a branch has no prior
    // week — the chip hides, the shape stays, nothing is fabricated.
    const perStoreTrend = stores.map((s) => ({
      storeId: s.id,
      spark: storeSparks(trendRows, s.id, windows.startToday, TREND_DAYS),
      weekTotal: round2(curMap.get(s.id)?.amount ?? 0),
      priorWeekTotal: round2(priMap.get(s.id)?.amount ?? 0),
      // v2.195.0: the branch's settled COUNT and its prior — the SAME two
      // groupBys' `_count._all` (fetched for the top mover since v2.174.0),
      // mapped for the expert console's transactions drill-down rows. Zero
      // new queries: the counts were already in memory, waiting.
      txWeek: curMap.get(s.id)?.count ?? 0,
      txPrior: priMap.get(s.id)?.count ?? 0,
    }));

    // EMS v2.20.0 (spec Phase 4.8): HR tiles for the organization console —
    // headcount, month employment cost, absence rate, payroll status, expiry
    // alerts. Computed only when the HR module is on and the caller holds an
    // hr report permission; otherwise the block is omitted (tiles hidden).
    let hr: Awaited<ReturnType<typeof hrSummaryForOrgConsole>> = null;
    // v2.23.0: per-branch drill-down rows (ORG scope only; null for branch
    // callers). Additive — a failure never breaks the console payload.
    let hrPerStore: Awaited<ReturnType<typeof hrPerStoreForOrgConsole>> = null;
    try {
      const session = await getSessionFromRequest(request);
      if (
        session &&
        (await isHrModuleEnabled(session.organizationId)) &&
        (hasHrPermission(session.role, 'hr.report.branch') || hasHrPermission(session.role, 'hr.report.all'))
      ) {
        hr = await hrSummaryForOrgConsole(session);
        hrPerStore = await hrPerStoreForOrgConsole(session);
      }
    } catch {
      hr = null; // tiles are additive — never break the console payload
      hrPerStore = null;
    }

    return Response.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        totals,
        trend,
        perStoreTrend,
        hr,
        hrPerStore,
        stores: storeRows,
        recentAudit,
      },
    });
  });
}

export const GET = withErrorBoundary(
  requireAuth(orgSummaryHandler, { roles: ORG_ROLES }),
  'ORG_SUMMARY',
);
