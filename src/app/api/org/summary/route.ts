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

    const [salesByStore, lowStockByStore, overdueRentalsByStore, debtByStore, pendingMpesaByStore, recentAudit] =
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
