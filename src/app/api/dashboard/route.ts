// GET /api/dashboard

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env'; // Eager env validation — fails fast on missing DATABASE_URL
import { withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
// FINANCIAL MATH AUDIT (Task 12-b): Prisma Decimal valueOf() returns a STRING —
// `number + decimal` concatenates. All accumulation below flows through
// toDec()/round2() and emits plain numbers only at the JSON boundary.
import { toDec, round2 } from '@/lib/utils/financialMath';
// v2.12.0 (Task DASH-BE): server-only insight builders — every block is
// fault-isolated so the dashboard NEVER throws (see module header).
import { buildDashboardInsights, sanitizeActivity } from '@/lib/dashboard-insights';
// v2.12.2 (PR B — RBAC): revenue visibility gate for the limited dashboard.
import { hasFeaturePermission } from '@/lib/permissions';

/**
 * NET (VAT-exclusive) revenue for a sale line. `lineTotal` is VAT-inclusive
 * gross; extract the VAT component at the line's own rate:
 *   net = lineTotal − lineTotal × rate / (100 + rate)
 * (≡ lineTotal × 100 / (100 + rate)). Rate 0 (exempt) → the line as-is.
 * VAT is money owed to KRA — never counted as revenue.
 */
const lineNetRevenue = (lineTotal: Parameters<typeof toDec>[0], taxRate: Parameters<typeof toDec>[0]) => {
  const gross = toDec(lineTotal);
  const rate = toDec(taxRate);
  if (rate.lte(0)) return gross;
  return gross.minus(gross.mul(rate).div(rate.plus(100)));
};

// Force this route to be dynamically rendered at request time.
// This prevents Next.js from attempting to collect page data / statically
// pre-render this route during `next build`, which would trigger the eager
// env validation (and crash the Vercel build when runtime secrets aren't
// injected at build time). The dashboard is per-store, per-request by nature.
export const dynamic = 'force-dynamic';

// Side-effect import: validates env at module load.
void env;

async function getDashboardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const session = args[1] as AuthSession | undefined;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // ── v2.12.2 (PR B — RBAC): LIMITED DASHBOARD for revenue-denied roles ───
  // A role without 'dashboard.view.revenue' (today: CASHIER,
  // INVENTORY_MANAGER) gets ONLY: own-activity KPIs, stock counts and their
  // own last 10 sales. Deliberately NOT computed, NOT shipped: revenue
  // trends, revenueChange, debt totals/aging (debtCrisis), alerts carrying
  // debt amounts, topCustomers/topProducts revenue, payment-method amounts,
  // inventoryValue, profit/margin inputs and the full recentActivities feed.
  // This is an EARLY RETURN — the debt/insight queries never even run for
  // these roles, so the restricted payload cannot leak by construction.
  //
  // v2.13.1: the two KPI aggregates are SCOPED TO THE CALLER (cashierId =
  // session.userId) — "Today's Sales", "Transactions" and "Avg Order" on
  // the limited dashboard now count the cashier's OWN sales, matching the
  // RBAC spec ('My Sales', not the branch total). Low-stock stays a
  // store-level signal (stock health is a shared operational concern and
  // leaks no revenue).
  if (session && !hasFeaturePermission(session.role, 'dashboard.view.revenue')) {
    const [limitedTodayTxns, limitedTodayRev, limitedLowStock, limitedOutOfStock, mySales] =
      await Promise.all([
        db.salesTransaction.count({
          where: {
            storeId,
            cashierId: session.userId,
            createdAt: { gte: todayStart, lte: todayEnd },
            transactionType: 'SALE',
            paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
          },
        }),
        db.salesTransaction.aggregate({
          where: {
            storeId,
            cashierId: session.userId,
            createdAt: { gte: todayStart, lte: todayEnd },
            transactionType: 'SALE',
            paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
          },
          _sum: { totalAmount: true, taxAmount: true },
        }),
        // Healthy = qty > reorderLevel (same rule as the full dashboard's
        // store-health stock score).
        db.product.count({
          where: {
            storeId,
            isActive: true,
            quantityInStock: { gt: 0, lte: db.product.fields.reorderLevel },
          },
        }),
        db.product.count({
          where: { storeId, isActive: true, quantityInStock: { lte: 0 } },
        }),
        // My Sales: the caller's own last 10 sales only — receipt shell
        // fields (no customer names, no cost/profit columns).
        db.salesTransaction.findMany({
          where: { storeId, cashierId: session.userId, transactionType: 'SALE' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            receiptNumber: true,
            paymentMethod: true,
            paymentStatus: true,
            totalAmount: true,
            createdAt: true,
          },
        }),
      ]);

    const limitedTodayRevNet = toDec(limitedTodayRev._sum.totalAmount)
      .minus(toDec(limitedTodayRev._sum.taxAmount))
      .toNumber();
    const limitedAverageTxnValue =
      limitedTodayTxns > 0 ? round2(limitedTodayRevNet / limitedTodayTxns) : 0;

    return Response.json({
      success: true,
      data: {
        limitedView: true,
        // v2.13.2 HOTFIX: "Today's Sales" is a MONEY card ("net of VAT ·
        // your sales") — it must carry the net revenue figure (same
        // semantic as the full dashboard's todaySales), not the
        // transaction count. The count-as-money bug made the card show
        // "Ksh 1.00" after a single sale while the true revenue only
        // surfaced via Avg Order.
        todaySales: limitedTodayRevNet,
        transactions: { count: limitedTodayTxns },
        averageTransactionValue: limitedAverageTxnValue,
        lowStock: {
          count: limitedLowStock + limitedOutOfStock,
          low: limitedLowStock,
          outOfStock: limitedOutOfStock,
        },
        mySales: mySales.map((tx) => ({
          id: tx.id,
          receiptNumber: tx.receiptNumber,
          paymentMethod: tx.paymentMethod,
          paymentStatus: tx.paymentStatus,
          totalAmount: toDec(tx.totalAmount).toNumber(),
          createdAt: tx.createdAt,
        })),
      },
    });
  }

  // Core metrics - all lightweight queries
  const [
    todayTransactions,
    todayRevenue,
    lowStockProducts,
    activeRentals,
    outstandingDebt,
    recentTransactions,
    yesterdayRevenue,
    totalProducts,
    totalCustomers,
  ] = await Promise.all([
    db.salesTransaction.count({
      where: {
        storeId,
        createdAt: { gte: todayStart, lte: todayEnd },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
    }),

    db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: { gte: todayStart, lte: todayEnd },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      // Task 12-b: taxAmount summed so todayRevenue can be reported NET of VAT.
      _sum: { totalAmount: true, taxAmount: true },
    }),

    db.product.findMany({
      // v2.5.8 FIX: the KPI used a hardcoded `lte: 10` cutoff that ignored
      // each product's own reorderLevel — healthy items with reorderLevel 50
      // were flagged while items with reorderLevel 5 were missed. Compare
      // against the per-product reorder level instead (Prisma field
      // reference, same pattern as email-service.ts low-stock alerts).
      where: { storeId, isActive: true, quantityInStock: { lte: db.product.fields.reorderLevel } },
      select: { id: true, name: true, sku: true, quantityInStock: true, reorderLevel: true, unitType: true },
      orderBy: { quantityInStock: 'asc' },
      take: 20,
    }),

    db.equipmentRental.count({
      where: { storeId, status: { in: ['ACTIVE', 'OVERDUE'] } },
    }),

    db.debtLedger.aggregate({
      where: { storeId, status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] } },
      _sum: { balance: true },
      _count: true,
    }),

    db.salesTransaction.findMany({
      where: { storeId, transactionType: 'SALE' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, receiptNumber: true, totalAmount: true,
        paymentMethod: true, paymentStatus: true, createdAt: true,
        customer: { select: { name: true } },
        cashier: { select: { name: true } },
      },
    }),

    db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: { gte: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000), lt: todayStart },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      _sum: { totalAmount: true, taxAmount: true },
    }),

    db.product.count({ where: { storeId, isActive: true } }),
    db.customer.count({ where: { storeId, isActive: true } }),
  ]);

  // Hourly sales + payment method breakdown
  const [salesByHourData, paymentMethodGrouped, recentActivities] = await Promise.all([
    db.salesTransaction.findMany({
      where: { storeId, createdAt: { gte: todayStart, lte: todayEnd }, transactionType: 'SALE', paymentStatus: { in: ['COMPLETED', 'PARTIAL'] } },
      // Task 12-b: taxAmount needed for the VAT-exclusive hourly series.
      // v2.12.0 (DASH-BE): paymentMethod added so today's debt-tender share
      // (debtRatioToday) is computed from the SAME rows — no second query.
      select: { createdAt: true, totalAmount: true, taxAmount: true, paymentMethod: true },
    }),
    db.salesTransaction.groupBy({
      by: ['paymentMethod'],
      where: { storeId, createdAt: { gte: todayStart, lte: todayEnd }, transactionType: 'SALE', paymentStatus: { in: ['COMPLETED', 'PARTIAL'] } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    db.systemLog.findMany({
      where: { storeId, severity: { in: ['INFO', 'WARN', 'ERROR'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, action: true, component: true, severity: true, message: true, metadata: true, createdAt: true, user: { select: { id: true, name: true, role: true } } },
    }),
  ]);

  // Compute hourly sales — accumulated in Decimal (was: `amount += tx.totalAmount`
  // which STRING-CONCATENATED because Prisma Decimal.valueOf() returns a string).
  // Amount basis: NET revenue (totalAmount − taxAmount) per the uniform revenue
  // policy; the field name stays `amount`.
  const hourlyData: Record<string, { amount: ReturnType<typeof toDec>; count: number }> = {};
  for (let h = 0; h < 24; h++) {
    hourlyData[String(h).padStart(2, '0')] = { amount: toDec(0), count: 0 };
  }
  for (const tx of salesByHourData) {
    const key = String(new Date(tx.createdAt).getHours()).padStart(2, '0');
    hourlyData[key].amount = hourlyData[key].amount.plus(toDec(tx.totalAmount)).minus(toDec(tx.taxAmount));
    hourlyData[key].count += 1;
  }

  // Top products - two-step approach to avoid expensive relation filters on SQLite
  const recentSalesTx = await db.salesTransaction.findMany({
    where: { storeId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, transactionType: 'SALE', paymentStatus: { in: ['COMPLETED', 'PARTIAL'] } },
    select: { id: true },
    take: 50,
  });
  const recentTxIds = recentSalesTx.map((t) => t.id);

  let topProductsResult: Array<{ productId: string; productName: string; totalQuantity: number; totalRevenue: number }> = [];
  let topSellingCategoriesResult: Array<{ categoryId: string; categoryName: string; color: string | null; icon: string | null; revenue: number; quantitySold: number }> = [];

  if (recentTxIds.length > 0) {
    const saleItems = await db.saleItem.findMany({
      where: { transactionId: { in: recentTxIds } },
      select: {
        productId: true, productName: true, quantity: true, lineTotal: true, taxRate: true,
        product: { select: { categoryId: true, category: { select: { id: true, name: true, color: true, icon: true } } } },
      },
    });

    const topProductsMap = new Map<string, { productName: string; totalQuantity: ReturnType<typeof toDec>; totalRevenue: ReturnType<typeof toDec> }>();
    const categoryRevenueMap = new Map<string, { name: string; color: string | null; icon: string | null; revenue: ReturnType<typeof toDec>; quantitySold: ReturnType<typeof toDec> }>();

    for (const si of saleItems) {
      // Task 12-b: Decimal-safe accumulation; revenue is the VAT-exclusive
      // net of the line (lineTotal − VAT component at the line's rate).
      const net = lineNetRevenue(si.lineTotal, si.taxRate);
      const qty = toDec(si.quantity);
      const pe = topProductsMap.get(si.productId);
      if (pe) { pe.totalQuantity = pe.totalQuantity.plus(qty); pe.totalRevenue = pe.totalRevenue.plus(net); }
      else { topProductsMap.set(si.productId, { productName: si.productName, totalQuantity: qty, totalRevenue: net }); }

      const category = si.product.category;
      const catId = category?.id || 'uncategorized';
      const ce = categoryRevenueMap.get(catId);
      if (ce) { ce.revenue = ce.revenue.plus(net); ce.quantitySold = ce.quantitySold.plus(qty); }
      else { categoryRevenueMap.set(catId, { name: category?.name || 'Uncategorized', color: category?.color || null, icon: category?.icon || null, revenue: net, quantitySold: qty }); }
    }

    topProductsResult = Array.from(topProductsMap.entries())
      .map(([productId, data]) => ({ productId, productName: data.productName, totalQuantity: data.totalQuantity.toNumber(), totalRevenue: round2(data.totalRevenue) }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    topSellingCategoriesResult = Array.from(categoryRevenueMap.entries())
      .map(([categoryId, data]) => ({ categoryId, categoryName: data.name, color: data.color, icon: data.icon, revenue: round2(data.revenue), quantitySold: data.quantitySold.toNumber() }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }

  // Inventory valuation
  const allProductsForInventory = await db.product.findMany({
    where: { storeId, isActive: true },
    // v2.12.0 (DASH-BE): reorderLevel added so the store-health stock score
    // (healthy = qty > reorderLevel) reuses these rows — no second scan.
    select: { quantityInStock: true, costPrice: true, pricePerUnit: true, reorderLevel: true },
  });

  // Task 12-b: revenue KPIs are NET of VAT (totalAmount − taxAmount) — VAT is
  // owed to KRA, not revenue. Plain numbers emitted here (JSON boundary).
  const todayRev = toDec(todayRevenue._sum.totalAmount).minus(toDec(todayRevenue._sum.taxAmount)).toNumber();
  const yesterdayRev = toDec(yesterdayRevenue._sum.totalAmount).minus(toDec(yesterdayRevenue._sum.taxAmount)).toNumber();
  const revenueChange = yesterdayRev > 0 ? ((todayRev - yesterdayRev) / yesterdayRev) * 100 : todayRev > 0 ? 100 : 0;

  // ── v2.12.0 (Task DASH-BE) derived figures shared with the insights ──
  // Today's NET debt-tender revenue from the SAME rows as the hourly series.
  const todayDebtSales = round2(
    salesByHourData
      .filter((tx) => tx.paymentMethod === 'DEBT')
      .reduce((acc, tx) => acc.plus(toDec(tx.totalAmount)).minus(toDec(tx.taxAmount)), toDec(0)),
  );
  const averageTransactionValue = todayTransactions > 0 ? round2(todayRev / todayTransactions) : 0;
  const salesByHour = Object.entries(hourlyData).map(([hour, data]) => ({ hour, amount: round2(data.amount) }));

  // Stock health inputs (healthy = quantity above the per-product reorder
  // level) computed from the already-fetched inventory rows.
  const stockHealthy = allProductsForInventory.filter(
    (p) => toDec(p.quantityInStock).gt(toDec(p.reorderLevel)),
  ).length;

  // ── v2.12.0 insight blocks (shift / debtCrisis / alerts / storeHealth /
  //    revenueTrend7d / precise stock counts). Fault-isolated internally. ──
  const insights = await buildDashboardInsights(storeId, {
    todayRevenue: todayRev,
    todayTransactions,
    averageTransactionValue,
    todayDebtSales,
    hourly: salesByHour,
    stockHealthy,
    stockTotal: allProductsForInventory.length,
  });

  // v2.12.0 (DASH-BE) low-stock fix: the precise out-of-stock / low counts
  // replace the capped findMany-length; the split lists (numeric fields per
  // the DECIMAL-STRING AUDIT precedent) come from the existing display list.
  const toStockItem = (p: (typeof lowStockProducts)[number]) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    quantityInStock: toDec(p.quantityInStock).toNumber(),
    reorderLevel: toDec(p.reorderLevel).toNumber(),
    unitType: p.unitType,
  });
  const lowStockItems = lowStockProducts.map(toStockItem);
  const outOfStockItems = lowStockItems.filter((item) => item.quantityInStock <= 0);
  const lowStockOnlyItems = lowStockItems.filter((item) => item.quantityInStock > 0);

  return Response.json({
    success: true,
    data: {
      todaySales: todayTransactions,
      todayTransactions,
      todayRevenue: todayRev,
      // Net-revenue AOV (was tax-inclusive _avg.totalAmount) — consistent with
      // the net revenue basis above.
      averageTransactionValue,
      revenueChangePercent: Math.round(revenueChange * 100) / 100,
      // v2.12.0 (DASH-BE): precise combined count (was the capped list length).
      lowStockProducts: insights.outOfStockCount + insights.lowStockCount,
      lowStockItems,
      activeRentals,
      outstandingDebt: toDec(outstandingDebt._sum.balance).toNumber(),
      outstandingDebtCount: outstandingDebt._count,
      topProducts: topProductsResult,
      salesByHour,
      // TENDER by method (tax-inclusive) by design — labelled by payment method,
      // this is money collected, not revenue. Decimal-safe conversion only.
      paymentMethodBreakdown: paymentMethodGrouped.map((pm) => ({ method: pm.paymentMethod, count: pm._count, amount: toDec(pm._sum.totalAmount).toNumber() })),
      recentTransactions,
      totalProducts,
      totalCustomers,
      hourlySalesBreakdown: Object.entries(hourlyData).map(([hour, data]) => ({ hour, amount: round2(data.amount), transactionCount: data.count })),
      topSellingCategories: topSellingCategoriesResult,
      inventoryValue: {
        // Task 12-b: Σ qty×price accumulated in Decimal (was string-concat via
        // `0 + Decimal`). Cost valuation uses costPrice; retail uses pricePerUnit.
        costValue: round2(allProductsForInventory.reduce((acc, p) => acc.plus(toDec(p.quantityInStock).mul(toDec(p.costPrice))), toDec(0))),
        retailValue: round2(allProductsForInventory.reduce((acc, p) => acc.plus(toDec(p.quantityInStock).mul(toDec(p.pricePerUnit))), toDec(0))),
        totalItems: allProductsForInventory.length,
        totalQuantity: allProductsForInventory.reduce((acc, p) => acc.plus(toDec(p.quantityInStock)), toDec(0)).toNumber(),
      },
      // v2.12.0 (DASH-BE) ACTIVITY SANITIZATION: rows mapped through the
      // leak-free sanitizer — ids stripped, displayMessage humanized,
      // metadata gated, actor id dropped.
      recentActivities: recentActivities.map(sanitizeActivity),

      // ══ v2.12.0 (Task DASH-BE) NEW insight fields ══
      // Active-shift snapshot with the user's expected-cash formula.
      shift: insights.shift,
      // Debt aging + ratio + high-risk customers.
      debtCrisis: insights.debtCrisis,
      // Deduplicated, actionable alert feed.
      alerts: insights.alerts,
      alertsCount: insights.alertsCount,
      // Transparent weighted store-health score.
      storeHealth: insights.storeHealth,
      // 7-day net revenue trend + median forecast + peak-hour note.
      revenueTrend7d: insights.revenueTrend7d,
      // Precise stock-count split (lowStockProducts above = their sum).
      outOfStockCount: insights.outOfStockCount,
      lowStockCount: insights.lowStockCount,
      outOfStockItems,
      lowStockOnlyItems,
    },
  });
}

// AUDIT FIX (Task 3-d): session-validated + storeId-param scoping
// (requireStoreAccess). Any store role.
export const GET = withErrorBoundary(
  requireStoreAccess(getDashboardHandler),
  'DASHBOARD',
);
