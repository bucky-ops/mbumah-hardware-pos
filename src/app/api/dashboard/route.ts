/**
 * MBUMAH HARDWARE POS - Dashboard Stats API
 * GET /api/dashboard - Aggregated dashboard statistics
 *
 * Returns today's sales, revenue, low stock alerts, active rentals, outstanding debt,
 * top products, sales by hour, and payment method breakdown.
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

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

  // Today's date range
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // Run all queries in parallel for performance
  const [
    todayTransactions,
    todayRevenue,
    lowStockProducts,
    activeRentals,
    outstandingDebt,
    topProducts,
    salesByHour,
    paymentMethodBreakdown,
    recentTransactions,
    yesterdayRevenue,
    totalProducts,
    totalCustomers,
  ] = await Promise.all([
    // Today's transaction count
    db.salesTransaction.count({
      where: {
        storeId,
        createdAt: { gte: todayStart, lte: todayEnd },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
    }),

    // Today's total revenue
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

    // Low stock products (stock <= reorder level)
    db.product.findMany({
      where: {
        storeId,
        isActive: true,
        quantityInStock: { lte: 10 }, // Use a fixed threshold for SQLite compatibility
      },
      select: {
        id: true,
        name: true,
        sku: true,
        quantityInStock: true,
        reorderLevel: true,
        unitType: true,
      },
      orderBy: { quantityInStock: 'asc' },
      take: 20,
    }),

    // Active and overdue rentals count
    db.equipmentRental.count({
      where: {
        storeId,
        status: { in: ['ACTIVE', 'OVERDUE'] },
      },
    }),

    // Outstanding debt total
    db.debtLedger.aggregate({
      where: {
        storeId,
        status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] },
      },
      _sum: { balance: true },
      _count: true,
    }),

    // Top selling products (last 30 days)
    db.saleItem.groupBy({
      by: ['productId', 'productName'],
      where: {
        transaction: {
          storeId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          transactionType: 'SALE',
          paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
        },
      },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: 10,
    }),

    // Sales by hour today
    db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: todayStart, lte: todayEnd },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      select: { createdAt: true, totalAmount: true },
    }),

    // Payment method breakdown today
    db.salesTransaction.groupBy({
      by: ['paymentMethod'],
      where: {
        storeId,
        createdAt: { gte: todayStart, lte: todayEnd },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      _sum: { totalAmount: true },
      _count: true,
    }),

    // Recent transactions
    db.salesTransaction.findMany({
      where: {
        storeId,
        transactionType: 'SALE',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        receiptNumber: true,
        totalAmount: true,
        paymentMethod: true,
        paymentStatus: true,
        createdAt: true,
        customer: { select: { name: true } },
        cashier: { select: { name: true } },
      },
    }),

    // Yesterday's revenue for comparison
    db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: {
          gte: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000),
          lt: todayStart,
        },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      _sum: { totalAmount: true },
    }),

    // Total products
    db.product.count({
      where: { storeId, isActive: true },
    }),

    // Total customers
    db.customer.count({
      where: { storeId, isActive: true },
    }),
  ]);

  // Process sales by hour
  const hourlyData: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    hourlyData[String(h).padStart(2, '0')] = 0;
  }

  for (const tx of salesByHour) {
    const hour = new Date(tx.createdAt).getHours();
    const key = String(hour).padStart(2, '0');
    hourlyData[key] = (hourlyData[key] || 0) + tx.totalAmount;
  }

  const salesByHourResult = Object.entries(hourlyData).map(([hour, amount]) => ({
    hour,
    amount,
  }));

  // Process payment method breakdown
  const paymentMethodBreakdownResult = paymentMethodBreakdown.map((pm) => ({
    method: pm.paymentMethod,
    count: pm._count,
    amount: pm._sum.totalAmount || 0,
  }));

  // Calculate revenue change percentage
  const todayRev = todayRevenue._sum.totalAmount || 0;
  const yesterdayRev = yesterdayRevenue._sum.totalAmount || 0;
  const revenueChange = yesterdayRev > 0
    ? ((todayRev - yesterdayRev) / yesterdayRev) * 100
    : todayRev > 0 ? 100 : 0;

  // Format top products
  const topProductsResult = topProducts.map((tp) => ({
    productId: tp.productId,
    productName: tp.productName,
    totalQuantity: tp._sum.quantity || 0,
    totalRevenue: tp._sum.lineTotal || 0,
  }));

  const dashboardData = {
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
    salesByHour: salesByHourResult,
    paymentMethodBreakdown: paymentMethodBreakdownResult,
    recentTransactions,
    totalProducts,
    totalCustomers,
  };

  return Response.json({ success: true, data: dashboardData });
}

export const GET = withErrorBoundary(getDashboardHandler, 'DASHBOARD');
