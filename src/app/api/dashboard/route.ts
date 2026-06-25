// GET /api/dashboard

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env'; // Eager env validation — fails fast on missing DATABASE_URL
import { withErrorBoundary } from '@/lib/logger';

// Side-effect import: validates env at module load.
void env;

async function getDashboardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
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
      _sum: { totalAmount: true },
      _avg: { totalAmount: true },
    }),

    db.product.findMany({
      where: { storeId, isActive: true, quantityInStock: { lte: 10 } },
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
      _sum: { totalAmount: true },
    }),

    db.product.count({ where: { storeId, isActive: true } }),
    db.customer.count({ where: { storeId, isActive: true } }),
  ]);

  // Hourly sales + payment method breakdown
  const [salesByHourData, paymentMethodGrouped, recentActivities] = await Promise.all([
    db.salesTransaction.findMany({
      where: { storeId, createdAt: { gte: todayStart, lte: todayEnd }, transactionType: 'SALE', paymentStatus: { in: ['COMPLETED', 'PARTIAL'] } },
      select: { createdAt: true, totalAmount: true },
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

  // Compute hourly sales
  const hourlyData: Record<string, { amount: number; count: number }> = {};
  for (let h = 0; h < 24; h++) {
    hourlyData[String(h).padStart(2, '0')] = { amount: 0, count: 0 };
  }
  for (const tx of salesByHourData) {
    const key = String(new Date(tx.createdAt).getHours()).padStart(2, '0');
    hourlyData[key].amount += tx.totalAmount;
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
        productId: true, productName: true, quantity: true, lineTotal: true,
        product: { select: { categoryId: true, category: { select: { id: true, name: true, color: true, icon: true } } } },
      },
    });

    const topProductsMap = new Map<string, { productName: string; totalQuantity: number; totalRevenue: number }>();
    const categoryRevenueMap = new Map<string, { name: string; color: string | null; icon: string | null; revenue: number; quantitySold: number }>();

    for (const si of saleItems) {
      const pe = topProductsMap.get(si.productId);
      if (pe) { pe.totalQuantity += si.quantity; pe.totalRevenue += si.lineTotal; }
      else { topProductsMap.set(si.productId, { productName: si.productName, totalQuantity: si.quantity, totalRevenue: si.lineTotal }); }

      const category = si.product.category;
      const catId = category?.id || 'uncategorized';
      const ce = categoryRevenueMap.get(catId);
      if (ce) { ce.revenue += si.lineTotal; ce.quantitySold += si.quantity; }
      else { categoryRevenueMap.set(catId, { name: category?.name || 'Uncategorized', color: category?.color || null, icon: category?.icon || null, revenue: si.lineTotal, quantitySold: si.quantity }); }
    }

    topProductsResult = Array.from(topProductsMap.entries())
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10);

    topSellingCategoriesResult = Array.from(categoryRevenueMap.entries())
      .map(([categoryId, data]) => ({ categoryId, categoryName: data.name, color: data.color, icon: data.icon, revenue: Math.round(data.revenue * 100) / 100, quantitySold: data.quantitySold }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }

  // Inventory valuation
  const allProductsForInventory = await db.product.findMany({
    where: { storeId, isActive: true },
    select: { quantityInStock: true, costPrice: true, pricePerUnit: true },
  });

  const todayRev = todayRevenue._sum.totalAmount || 0;
  const yesterdayRev = yesterdayRevenue._sum.totalAmount || 0;
  const revenueChange = yesterdayRev > 0 ? ((todayRev - yesterdayRev) / yesterdayRev) * 100 : todayRev > 0 ? 100 : 0;

  return Response.json({
    success: true,
    data: {
      todaySales: todayTransactions,
      todayTransactions,
      todayRevenue: todayRev,
      averageTransactionValue: todayRevenue._avg.totalAmount || 0,
      revenueChangePercent: Math.round(revenueChange * 100) / 100,
      lowStockProducts: lowStockProducts.length,
      lowStockItems: lowStockProducts,
      activeRentals,
      outstandingDebt: outstandingDebt._sum.balance || 0,
      outstandingDebtCount: outstandingDebt._count,
      topProducts: topProductsResult,
      salesByHour: Object.entries(hourlyData).map(([hour, data]) => ({ hour, amount: data.amount })),
      paymentMethodBreakdown: paymentMethodGrouped.map((pm) => ({ method: pm.paymentMethod, count: pm._count, amount: pm._sum.totalAmount || 0 })),
      recentTransactions,
      totalProducts,
      totalCustomers,
      hourlySalesBreakdown: Object.entries(hourlyData).map(([hour, data]) => ({ hour, amount: Math.round(data.amount * 100) / 100, transactionCount: data.count })),
      topSellingCategories: topSellingCategoriesResult,
      inventoryValue: {
        costValue: allProductsForInventory.reduce((s, p) => s + p.quantityInStock * p.costPrice, 0),
        retailValue: allProductsForInventory.reduce((s, p) => s + p.quantityInStock * p.pricePerUnit, 0),
        totalItems: allProductsForInventory.length,
        totalQuantity: allProductsForInventory.reduce((s, p) => s + p.quantityInStock, 0),
      },
      recentActivities: recentActivities.map((log) => ({
        id: log.id, action: log.action, component: log.component, severity: log.severity,
        message: log.message, metadata: log.metadata ? (() => { try { return JSON.parse(log.metadata); } catch { return null; } })() : null,
        createdAt: log.createdAt, user: log.user,
      })),
    },
  });
}

export const GET = withErrorBoundary(getDashboardHandler, 'DASHBOARD');
