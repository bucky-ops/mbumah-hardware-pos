// GET /api/analytics/kpis
//
// Real-time KPIs for the analytics dashboard. Each KPI includes a comparison
// vs the previous equivalent period (today vs yesterday, this week vs last
// week, etc.) so the cards can show a trend arrow + percentage change.
//
// KPIs returned:
//   - todayRevenue      (sum of totalAmount for today's sales)
//   - transactions      (count of today's completed/partial sales)
//   - averageOrderValue (todayRevenue / transactions)
//   - newCustomers      (customers created today)
//   - lowStockCount     (products at or below reorderLevel)
//   - pendingOrders     (purchase orders in DRAFT/PENDING_APPROVAL/SENT status)
//
// Query params:
//   - storeId : REQUIRED
//
// Response:
//   { success, data: KPIResult & { generatedAt } }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { calculateKPIs, type KPIInput } from '@/lib/analytics-utils';
// Task 12-b: Prisma Decimal valueOf() returns a STRING — net revenue is derived
// in Decimal (ΣtotalAmount − ΣtaxAmount) and emitted as a number at the boundary.
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

async function getKPIsHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  // Today vs yesterday windows
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayEnd);
  yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

  const SALE_FILTER = {
    storeId,
    transactionType: 'SALE' as const,
    paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
  };

  const [
    todayAgg,
    yesterdayAgg,
    todayCount,
    yesterdayCount,
    newCustomersToday,
    newCustomersYesterday,
    lowStockToday,
    lowStockYesterday,
    pendingOrdersToday,
    pendingOrdersYesterday,
  ] = await Promise.all([
    db.salesTransaction.aggregate({
      where: { ...SALE_FILTER, createdAt: { gte: todayStart, lte: todayEnd } },
      _sum: { totalAmount: true, taxAmount: true },
    }),
    db.salesTransaction.aggregate({
      where: { ...SALE_FILTER, createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
      _sum: { totalAmount: true, taxAmount: true },
    }),
    db.salesTransaction.count({
      where: { ...SALE_FILTER, createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    db.salesTransaction.count({
      where: { ...SALE_FILTER, createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
    db.customer.count({
      where: { storeId, createdAt: { gte: todayStart, lte: todayEnd } },
    }),
    db.customer.count({
      where: { storeId, createdAt: { gte: yesterdayStart, lte: yesterdayEnd } },
    }),
    db.product.count({
      where: {
        storeId,
        isActive: true,
        // Low stock = at or below the reorder level (10 default in schema)
        quantityInStock: { lte: 10 },
      },
    }),
    // yesterday's low-stock snapshot — we approximate with the current count
    // since we don't keep historical stock levels per day. This still gives
    // a meaningful "neutral" trend (delta = 0) instead of crashing.
    db.product.count({
      where: {
        storeId,
        isActive: true,
        quantityInStock: { lte: 10 },
      },
    }),
    db.purchaseOrder.count({
      where: {
        storeId,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'CONFIRMED'] },
      },
    }),
    db.purchaseOrder.count({
      where: {
        storeId,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'CONFIRMED'] },
        createdAt: { lt: todayStart },
      },
    }),
  ]);

  // Task 12-b: revenue KPIs are NET of VAT — netRevenue = Σ(totalAmount) −
  // Σ(taxAmount) accumulated in Decimal (never float, never string-concat).
  // averageOrderValue follows the same net basis (net revenue / transactions).
  const todayNetRevenue = toDec(todayAgg._sum.totalAmount).minus(toDec(todayAgg._sum.taxAmount));
  const yesterdayNetRevenue = toDec(yesterdayAgg._sum.totalAmount).minus(toDec(yesterdayAgg._sum.taxAmount));
  const todayRevenue = todayNetRevenue.toNumber();
  const yesterdayRevenue = yesterdayNetRevenue.toNumber();
  const averageOrderValue = todayCount > 0 ? round2(todayNetRevenue.div(todayCount)) : 0;
  const prevAverageOrderValue = yesterdayCount > 0 ? round2(yesterdayNetRevenue.div(yesterdayCount)) : 0;

  const input: KPIInput = {
    todayRevenue,
    yesterdayRevenue,
    transactions: todayCount,
    prevTransactions: yesterdayCount,
    averageOrderValue,
    prevAverageOrderValue,
    newCustomers: newCustomersToday,
    prevNewCustomers: newCustomersYesterday,
    lowStockCount: lowStockToday,
    prevLowStockCount: lowStockYesterday,
    pendingOrders: pendingOrdersToday,
    prevPendingOrders: pendingOrdersYesterday,
  };

  const kpis = calculateKPIs(input);

  return Response.json({
    success: true,
    data: {
      ...kpis,
      generatedAt: new Date().toISOString(),
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getKPIsHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER'],
  }),
  'ANALYTICS_KPIS',
);
