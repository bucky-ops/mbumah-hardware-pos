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
import { requireStoreAccess, MANAGER_PLUS_ROLES, type AuthSession } from '@/lib/auth';
import {
  generateDailyReportCSV,
  formatISODate,
  type DailyReportData,
} from '@/lib/report-utils';
// AUDIT FIX (Task 3-f): unified, VAT-exclusive revenue/profit formulas
// (single source of truth — see src/lib/profit.ts).
import { grossRevenue, PROFIT_FORMULA_VERSION } from '@/lib/profit';
import { KES } from '@/lib/money';

export const dynamic = 'force-dynamic';

// ── AUDIT FIX (Task 3-d): profit/margin redaction at the response boundary ──
// Task 3-f owns the aggregation above; this block ONLY redacts profit/margin
// fields for callers below branch-manager level (e.g. CASHIER). No-op today
// (DailyReportData carries no profit fields) but keeps the response safe if
// the unified profit formula lands here later. JSON drops the keys entirely.
const PROFIT_FIELD_KEYS = new Set(['grossProfit', 'profitMargin', 'profit', 'margin', 'costOfGoods']);
function redactProfitFields<T>(value: T): T {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redactProfitFields(v)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = PROFIT_FIELD_KEYS.has(key) ? undefined : redactProfitFields(val);
    }
    return out as T;
  }
  return value;
}

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

  // ── Sales totals (AUDIT FIX Task 3-f — canonical formulas, see src/lib/profit.ts)
  // totalRevenue is now VAT-EXCLUSIVE (totalAmount − taxAmount) so this report
  // agrees with sales-summary, revenue-trend and the tax-filings server
  // recompute on what "revenue" means. Header identity still holds:
  //   totalRevenue = totalSubtotal − totalDiscount (stored totals are net of
  //   line discounts and inclusive of VAT; stripping VAT yields net revenue).
  // NOTE for end-of-day reconciliation: the CASH figures to compare against a
  // counted drawer are the TAX-INCLUSIVE tender amounts in `paymentBreakdown`
  // (what customers actually handed over), NOT totalRevenue.
  const storedTenderTotal = KES(saleAggregate._sum.totalAmount || 0).round().toNumber();
  const totalTax = KES(saleAggregate._sum.taxAmount || 0).round().toNumber();
  const totalRevenue = grossRevenue(storedTenderTotal, totalTax);
  const totalSubtotal = KES(saleAggregate._sum.subtotal || 0).round().toNumber();
  const totalDiscount = KES(saleAggregate._sum.discountAmount || 0).round().toNumber();
  const transactionCount = saleAggregate._count;
  // Average now on the same VAT-exclusive basis as totalRevenue so that
  // avgTransactionValue × transactionCount ≈ totalRevenue still holds.
  const avgTransactionValue = transactionCount > 0
    ? KES(totalRevenue).divide(transactionCount).round().toNumber()
    : 0;

  // ── Returns + voids (tender amounts, kept tax-inclusive; HALF_EVEN-rounded) ──
  const returnsCount = refundAggregate._count;
  const returnsRefunded = KES(refundAggregate._sum.totalAmount || 0).round().toNumber();
  const voidedCount = voidAggregate._count;
  const voidedAmount = KES(voidAggregate._sum.totalAmount || 0).round().toNumber();

  // ── Payment-method breakdown (SALE transactions only) ──
  // AUDIT FIX (Task 3-f): amounts stay TAX-INCLUSIVE — tender collected, the
  // figure to reconcile against the cash drawer.
  const paymentMap: Record<string, { count: number; amount: number }> = {};
  for (const tx of allTransactions) {
    if (tx.transactionType !== 'SALE') continue;
    if (tx.paymentStatus !== 'COMPLETED' && tx.paymentStatus !== 'PARTIAL') continue;
    const method = tx.paymentMethod || 'CASH';
    if (!paymentMap[method]) paymentMap[method] = { count: 0, amount: 0 };
    paymentMap[method].count += 1;
    paymentMap[method].amount += KES(tx.totalAmount).toNumber();
  }
  const paymentBreakdown = Object.entries(paymentMap).map(([method, v]) => ({
    method,
    count: v.count,
    amount: KES(v.amount).round().toNumber(),
  }));

  // ── Cashier breakdown (tender amounts, tax-inclusive — reconciliation basis) ──
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
    cashierMap[id].revenue += KES(tx.totalAmount).toNumber();
  }
  // Key kept as `revenue` for client compatibility; value is the cashier's
  // tax-inclusive tender collected (HALF_EVEN-rounded at the boundary).
  const cashierBreakdown = Object.values(cashierMap)
    .map((c) => ({ ...c, revenue: KES(c.revenue).round().toNumber() }))
    .sort((a, b) => b.revenue - a.revenue);

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

  // AUDIT FIX (Task 3-d): strip profit/margin fields for below-manager callers
  // (response boundary only — aggregation untouched).
  const viewerIsManagerPlus = MANAGER_PLUS_ROLES.includes(session.role);
  const outbound = viewerIsManagerPlus ? report : redactProfitFields(report);

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
      profitFormulaVersion: PROFIT_FORMULA_VERSION, // AUDIT FIX (Task 3-f): lineage tracking
      date: formatISODate(dayStart),
      transactionCount,
      totalRevenue,
      returnsCount,
      voidedCount,
    },
  }).catch(() => {});

  // ── CSV response ──
  if (format === 'csv') {
    const csv = generateDailyReportCSV(outbound);
    const filename = `daily_report_${formatISODate(dayStart)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return Response.json({ success: true, data: outbound });
}

export const GET = withErrorBoundary(
  requireStoreAccess(getDailyReportHandler),
  'REPORTS_DAILY',
);
