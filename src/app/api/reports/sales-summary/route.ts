// GET /api/reports/sales-summary
//
// Comprehensive sales-summary report for an arbitrary date range. Returns:
//   • Total revenue, transactions, avg order value
//   • Payment-method breakdown (with % share)
//   • Top 10 products by revenue
//   • Hourly sales distribution (0–23h)
//   • Comparison vs the previous period of equal length
//
// Query params:
//   • startDate  — ISO date string (required)
//   • endDate    — ISO date string (required)
//   • storeId    — required (store-scoped via requireStoreAccess)
//   • format     — 'json' (default) | 'csv' — when 'csv' the response is a
//                  text/csv file download using generateSalesCSV()
//
// Auth: any authenticated user (requireStoreAccess — store-scoped).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import {
  generateSalesCSV,
  formatISODate,
  type SalesSummaryData,
} from '@/lib/report-utils';

export const dynamic = 'force-dynamic';

async function getSalesSummaryHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const startDateStr = searchParams.get('startDate') || searchParams.get('dateFrom');
  const endDateStr = searchParams.get('endDate') || searchParams.get('dateTo');
  if (!startDateStr || !endDateStr) {
    return Response.json(
      { success: false, error: 'startDate and endDate are required.' },
      { status: 400 },
    );
  }

  const startDate = new Date(startDateStr);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(endDateStr);
  endDate.setHours(23, 59, 59, 999);

  if (startDate > endDate) {
    return Response.json(
      { success: false, error: 'startDate must be on or before endDate.' },
      { status: 400 },
    );
  }

  // Previous comparison window — same length, immediately before startDate.
  const periodMs = endDate.getTime() - startDate.getTime() + 1; // inclusive
  const prevEndDate = new Date(startDate.getTime() - 1);
  const prevStartDate = new Date(prevEndDate.getTime() - periodMs + 1);

  const format = (searchParams.get('format') || 'json').toLowerCase();

  // ── Current period: transactions + items + aggregate ──
  const baseWhere = {
    storeId,
    createdAt: { gte: startDate, lte: endDate },
    transactionType: 'SALE' as const,
    paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
  };

  const [transactions, saleItems, summary, store] = await Promise.all([
    db.salesTransaction.findMany({
      where: baseWhere,
      include: {
        cashier: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.saleItem.findMany({
      where: {
        transaction: baseWhere,
      },
      include: {
        product: { select: { id: true, name: true, sku: true } },
      },
    }),
    db.salesTransaction.aggregate({
      where: baseWhere,
      _sum: {
        subtotal: true,
        taxAmount: true,
        discountAmount: true,
        totalAmount: true,
      },
      _count: true,
      _avg: { totalAmount: true },
    }),
    db.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    }),
  ]);

  // ── Previous-period aggregate (for comparison) ──
  const prevWhere = {
    storeId,
    createdAt: { gte: prevStartDate, lte: prevEndDate },
    transactionType: 'SALE' as const,
    paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
  };
  const prevSummary = await db.salesTransaction.aggregate({
    where: prevWhere,
    _sum: { totalAmount: true },
    _count: true,
  });

  // ── Totals ──
  // `totalSubtotal` is fetched for diagnostic purposes (gross sales before
  // discounts) but is not currently surfaced in the report — kept around so
  // it can be added to SalesSummaryData.totals without another DB round-trip
  // when the UI requests it. Prefix with underscore to silence the
  // unused-vars lint rule until then.
  const _totalSubtotal = Number(summary._sum.subtotal || 0);
  const totalRevenue = Number(summary._sum.totalAmount || 0);
  const totalTax = Number(summary._sum.taxAmount || 0);
  const totalDiscount = Number(summary._sum.discountAmount || 0);
  const transactionCount = summary._count;
  const avgOrderValue = Number(summary._avg.totalAmount || 0);

  // Cost of goods from SaleItem snapshots (costPrice stored at sale time).
  let costOfGoods = 0;
  for (const item of saleItems) {
    const qty = Number(item.quantity);
    const cost = Number(item.costPrice);
    if (Number.isFinite(qty) && Number.isFinite(cost)) {
      costOfGoods += qty * cost;
    }
  }
  const grossProfit = totalRevenue - costOfGoods;
  const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // ── Payment-method breakdown ──
  const paymentMap: Record<string, { count: number; amount: number }> = {};
  for (const tx of transactions) {
    const method = tx.paymentMethod || 'CASH';
    if (!paymentMap[method]) paymentMap[method] = { count: 0, amount: 0 };
    paymentMap[method].count += 1;
    paymentMap[method].amount += Number(tx.totalAmount);
  }
  const paymentBreakdown = Object.entries(paymentMap).map(([method, v]) => ({
    method,
    count: v.count,
    amount: v.amount,
    percent: totalRevenue > 0 ? (v.amount / totalRevenue) * 100 : 0,
  }));

  // ── Top 10 products by revenue ──
  const productMap: Record<string, {
    productId: string; productName: string; sku: string;
    quantity: number; revenue: number; cost: number;
  }> = {};
  for (const item of saleItems) {
    const key = item.productId;
    if (!productMap[key]) {
      productMap[key] = {
        productId: item.productId,
        productName: item.productName,
        sku: item.product?.sku || '',
        quantity: 0,
        revenue: 0,
        cost: 0,
      };
    }
    const qty = Number(item.quantity);
    const lineTotal = Number(item.lineTotal);
    const cost = Number(item.costPrice) * qty;
    productMap[key].quantity += qty;
    productMap[key].revenue += lineTotal;
    productMap[key].cost += cost;
  }
  const topProducts = Object.values(productMap)
    .map((p) => ({ ...p, profit: p.revenue - p.cost }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // ── Hourly distribution (0–23h) ──
  const hourlyBuckets: Array<{ hour: number; transactionCount: number; revenue: number }> = [];
  for (let h = 0; h < 24; h++) {
    hourlyBuckets.push({ hour: h, transactionCount: 0, revenue: 0 });
  }
  for (const tx of transactions) {
    const hour = new Date(tx.createdAt).getHours();
    hourlyBuckets[hour].transactionCount += 1;
    hourlyBuckets[hour].revenue += Number(tx.totalAmount);
  }
  const hourlyDistribution = hourlyBuckets.map((h) => ({
    ...h,
    label: `${String(h.hour).padStart(2, '0')}:00`,
  }));

  // ── Comparison ──
  const prevRevenue = Number(prevSummary._sum.totalAmount || 0);
  const prevTransactions = prevSummary._count;
  const revenueChange = totalRevenue - prevRevenue;
  const revenueChangePercent = prevRevenue > 0 ? (revenueChange / prevRevenue) * 100 : null;
  const transactionsChange = transactionCount - prevTransactions;

  const report: SalesSummaryData = {
    period: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    store: store || { id: storeId, name: 'Unknown Store' },
    totals: {
      revenue: totalRevenue,
      transactions: transactionCount,
      avgOrderValue,
      taxCollected: totalTax,
      totalDiscount,
      costOfGoods,
      grossProfit,
      profitMargin,
    },
    comparison: {
      previousRevenue: prevRevenue,
      revenueChange,
      revenueChangePercent,
      previousTransactions: prevTransactions,
      transactionsChange,
    },
    paymentBreakdown,
    topProducts,
    hourlyDistribution,
  };

  // ── Audit log ──
  await systemLog({
    action: 'REPORT_GENERATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Sales summary report generated (${format.toUpperCase()}) for ${formatISODate(startDate)} to ${formatISODate(endDate)}`,
    storeId,
    userId: session.userId,
    metadata: {
      reportType: 'SALES_SUMMARY',
      format,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      transactionCount,
      totalRevenue,
    },
  }).catch(() => {});

  // ── CSV response ──
  if (format === 'csv') {
    const csv = generateSalesCSV(report);
    const filename = `sales_summary_${formatISODate(startDate)}_to_${formatISODate(endDate)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return Response.json({ success: true, data: report });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getSalesSummaryHandler),
  'REPORTS_SALES_SUMMARY',
);
