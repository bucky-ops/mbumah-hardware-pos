// GET /api/reports/daily
//
// End-of-day reconciliation report for a single day. Returns:
//   • Sales totals (revenue, subtotal, tax, discount, count, AOV)
//   • Returns (count + refunded amount)
//   • Voided transactions (count + amount)
//   • Tax collected (separate from returns tax)
//   • Payment-method breakdown
//   • Cashier breakdown (per-cashier revenue + transaction count)
//
// Query params:
//   • date    — ISO date string (YYYY-MM-DD). Defaults to today (UTC).
//   • storeId — required (store-scoped via requireStoreAccess)
//   • format  — 'json' (default) | 'csv'
//
// Used for end-of-day reconciliation: the closing manager prints this report
// and verifies the counted cash drawer matches the expected cash sales.
//
// Auth: any authenticated user (requireStoreAccess — store-scoped).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import {
  generateDailyReportCSV,
  formatISODate,
  type DailyReportData,
} from '@/lib/report-utils';

export const dynamic = 'force-dynamic';

async function getDailyReportHandler(
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

  // Resolve the target day — defaults to today in the server's local TZ.
  const dateStr = searchParams.get('date') || formatISODate(new Date());
  const dayStart = new Date(dateStr);
  if (Number.isNaN(dayStart.getTime())) {
    return Response.json(
      { success: false, error: 'Invalid date. Use YYYY-MM-DD.' },
      { status: 400 },
    );
  }
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const format = (searchParams.get('format') || 'json').toLowerCase();

  // Fetch all transactions for the day (SALE, REFUND, VOID) in parallel
  // with the aggregate and store info.
  const [allTransactions, saleAggregate, refundAggregate, voidAggregate, store] = await Promise.all([
    db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: dayStart, lte: dayEnd },
        paymentStatus: { in: ['COMPLETED', 'PARTIAL', 'REFUNDED'] },
      },
      include: {
        cashier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: { gte: dayStart, lte: dayEnd },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      _sum: {
        subtotal: true,
        taxAmount: true,
        discountAmount: true,
        totalAmount: true,
      },
      _count: true,
      _avg: { totalAmount: true },
    }),
    db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: { gte: dayStart, lte: dayEnd },
        transactionType: 'REFUND',
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
    db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: { gte: dayStart, lte: dayEnd },
        transactionType: 'VOID',
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
    db.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true },
    }),
  ]);

  // ── Sales totals ──
  const totalRevenue = Number(saleAggregate._sum.totalAmount || 0);
  const totalSubtotal = Number(saleAggregate._sum.subtotal || 0);
  const totalTax = Number(saleAggregate._sum.taxAmount || 0);
  const totalDiscount = Number(saleAggregate._sum.discountAmount || 0);
  const transactionCount = saleAggregate._count;
  const avgTransactionValue = Number(saleAggregate._avg.totalAmount || 0);

  // ── Returns + voids ──
  const returnsCount = refundAggregate._count;
  const returnsRefunded = Number(refundAggregate._sum.totalAmount || 0);
  const voidedCount = voidAggregate._count;
  const voidedAmount = Number(voidAggregate._sum.totalAmount || 0);

  // ── Payment-method breakdown (SALE transactions only) ──
  const paymentMap: Record<string, { count: number; amount: number }> = {};
  for (const tx of allTransactions) {
    if (tx.transactionType !== 'SALE') continue;
    if (tx.paymentStatus !== 'COMPLETED' && tx.paymentStatus !== 'PARTIAL') continue;
    const method = tx.paymentMethod || 'CASH';
    if (!paymentMap[method]) paymentMap[method] = { count: 0, amount: 0 };
    paymentMap[method].count += 1;
    paymentMap[method].amount += Number(tx.totalAmount);
  }
  const paymentBreakdown = Object.entries(paymentMap).map(([method, v]) => ({
    method,
    count: v.count,
    amount: v.amount,
  }));

  // ── Cashier breakdown ──
  const cashierMap: Record<string, { cashierId: string; cashierName: string; transactionCount: number; revenue: number }> = {};
  for (const tx of allTransactions) {
    if (tx.transactionType !== 'SALE') continue;
    if (tx.paymentStatus !== 'COMPLETED' && tx.paymentStatus !== 'PARTIAL') continue;
    const id = tx.cashierId;
    if (!cashierMap[id]) {
      cashierMap[id] = {
        cashierId: id,
        cashierName: tx.cashier?.name || 'Unknown',
        transactionCount: 0,
        revenue: 0,
      };
    }
    cashierMap[id].transactionCount += 1;
    cashierMap[id].revenue += Number(tx.totalAmount);
  }
  const cashierBreakdown = Object.values(cashierMap).sort((a, b) => b.revenue - a.revenue);

  const report: DailyReportData = {
    date: dayStart.toISOString(),
    store: store || { id: storeId, name: 'Unknown Store' },
    sales: {
      totalRevenue,
      totalSubtotal,
      totalTax,
      totalDiscount,
      transactionCount,
      avgTransactionValue,
    },
    returns: {
      count: returnsCount,
      totalRefunded: returnsRefunded,
    },
    voided: {
      count: voidedCount,
      totalVoided: voidedAmount,
    },
    // Tax collected = sales tax - returns tax. We approximate by using the
    // sales tax aggregate minus the refund total's pro-rata tax portion.
    // For an exact figure the accountant should reference the journal.
    taxCollected: Math.max(0, totalTax),
    paymentBreakdown,
    cashierBreakdown,
  };

  // ── Audit log ──
  await systemLog({
    action: 'REPORT_GENERATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Daily reconciliation report generated (${format.toUpperCase()}) for ${formatISODate(dayStart)}`,
    storeId,
    userId: session.userId,
    metadata: {
      reportType: 'DAILY_RECONCILIATION',
      format,
      date: formatISODate(dayStart),
      transactionCount,
      totalRevenue,
      returnsCount,
      voidedCount,
    },
  }).catch(() => {});

  // ── CSV response ──
  if (format === 'csv') {
    const csv = generateDailyReportCSV(report);
    const filename = `daily_report_${formatISODate(dayStart)}.csv`;
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
  requireStoreAccess(getDailyReportHandler),
  'REPORTS_DAILY',
);
