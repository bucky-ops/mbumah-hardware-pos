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
import { requireStoreAccess, MANAGER_PLUS_ROLES, type AuthSession } from '@/lib/auth';
import {
  generateSalesCSV,
  formatISODate,
  type SalesSummaryData,
} from '@/lib/report-utils';
// AUDIT FIX (Task 3-f): unified, VAT-exclusive profit formulas (single source
// of truth). Replaces the ad-hoc "tax-inclusive totalAmount − COGS" grossProfit.
import {
  grossRevenue,
  netRevenue,
  grossProfit,
  vatExclusiveFromTaxInclusive,
  PROFIT_FORMULA_VERSION,
} from '@/lib/profit';
import { KES, Money } from '@/lib/money';

export const dynamic = 'force-dynamic';

// ── AUDIT FIX (Task 3-d): profit/margin redaction at the response boundary ──
// Task 3-f owns the aggregation above; this block ONLY redacts profit/margin
// fields (grossProfit, profitMargin, profit, margin, costOfGoods, per-product
// cost/profit) for callers below branch-manager level (e.g. CASHIER). JSON
// drops the keys; CSV keeps its column structure with the values blanked.
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
  // AUDIT FIX (Task 3-f): also sum taxAmount so the previous revenue is
  // compared on the SAME VAT-exclusive basis as the current period.
  const prevSummary = await db.salesTransaction.aggregate({
    where: prevWhere,
    _sum: { totalAmount: true, taxAmount: true },
    _count: true,
  });

  // ── Totals (AUDIT FIX Task 3-f — canonical profit chain, see src/lib/profit.ts)
  // Stored header fields (SalesTransaction):
  //   totalAmount    = Σ line (subtotal − lineDiscount + lineTax)  → TAX-INCLUSIVE,
  //                    ALREADY NET of discounts (helpers.calculateLineTotal)
  //   taxAmount      = Σ line VAT
  //   discountAmount = Σ line discounts (already embedded in totalAmount)
  //   subtotal       = Σ line price×qty (pre-discount, VAT-exclusive)
  const _totalSubtotal = KES(summary._sum.subtotal || 0).round().toNumber();
  const storedTenderTotal = KES(summary._sum.totalAmount || 0).round().toNumber();
  const totalTax = KES(summary._sum.taxAmount || 0).round().toNumber();
  const totalDiscount = KES(summary._sum.discountAmount || 0).round().toNumber();
  const transactionCount = summary._count;
  // Revenue is ALWAYS VAT-exclusive (totalAmount − taxAmount). Because the
  // stored totalAmount is already net of discounts, this value IS the net
  // revenue; applying netRevenue(..., totalDiscount) again would double-
  // subtract the discount, so the discount is intentionally NOT re-deducted
  // here. (Header identity: totalRevenue === netRevenue(_totalSubtotal, totalDiscount).)
  const totalRevenue = grossRevenue(storedTenderTotal, totalTax);
  const avgOrderValue = KES(summary._avg.totalAmount || 0).round().toNumber(); // avg tender per order (tax-inclusive), unchanged semantics

  // Cost of goods from SaleItem snapshots (costPrice stored at sale time).
  // Accumulated through Money (HALF_EVEN-safe) — no float dust.
  let cogsAccumulator = Money.zero('KES');
  for (const item of saleItems) {
    cogsAccumulator = cogsAccumulator.add(KES(item.costPrice).multiply(Number(item.quantity)));
  }
  const costOfGoods = cogsAccumulator.round().toNumber();

  // grossProfit = netRevenue − COGS. netRevenue here === totalRevenue (the
  // discount is already embedded in the stored total — see note above); the
  // canonical chain is expressed via netRevenue(grossRevenue, 0-discount) so
  // the formula lineage is explicit and version-tracked.
  const netRevenueValue = netRevenue(totalRevenue, 0);
  const grossProfitValue = grossProfit(netRevenueValue, costOfGoods);
  const profitMargin = netRevenueValue > 0 ? (grossProfitValue / netRevenueValue) * 100 : 0;

  // ── Payment-method breakdown ──
  // AUDIT FIX (Task 3-f): amounts remain TAX-INCLUSIVE — this is TENDER
  // collected (what actually entered the drawer), not revenue. The percent
  // denominator is now the tax-inclusive tender total so shares still sum to
  // 100% given `totals.revenue` is VAT-exclusive.
  const paymentMap: Record<string, { count: number; amount: number }> = {};
  let tenderCollected = Money.zero('KES');
  for (const tx of transactions) {
    const method = tx.paymentMethod || 'CASH';
    if (!paymentMap[method]) paymentMap[method] = { count: 0, amount: 0 };
    paymentMap[method].count += 1;
    paymentMap[method].amount += KES(tx.totalAmount).toNumber();
    tenderCollected = tenderCollected.add(KES(tx.totalAmount));
  }
  const tenderCollectedTotal = tenderCollected.round().toNumber();
  const paymentBreakdown = Object.entries(paymentMap).map(([method, v]) => ({
    method,
    count: v.count,
    amount: KES(v.amount).round().toNumber(),
    percent: tenderCollectedTotal > 0 ? (KES(v.amount).toNumber() / tenderCollectedTotal) * 100 : 0,
  }));

  // ── Top 10 products by revenue ──
  // AUDIT FIX (Task 3-f): SaleItem carries no per-line tax AMOUNT column (only
  // taxRate), so the VAT component of each tax-inclusive lineTotal is recovered
  // via vatExclusiveFromTaxInclusive(lineTotal, taxRate) — ±0.01/line round-trip
  // drift vs checkout math, exact for 0-rated lines. Product revenue is now on
  // the same VAT-exclusive basis as totals.revenue, and per-product profit uses
  // the canonical grossProfit(netRevenue − COGS) chain instead of a private
  // "revenue − cost" formula.
  const productMap: Record<string, {
    productId: string; productName: string; sku: string;
    quantity: number; revenue: Money; cost: Money;
  }> = {};
  for (const item of saleItems) {
    const key = item.productId;
    if (!productMap[key]) {
      productMap[key] = {
        productId: item.productId,
        productName: item.productName,
        sku: item.product?.sku || '',
        quantity: 0,
        revenue: Money.zero('KES'),
        cost: Money.zero('KES'),
      };
    }
    const qty = Number(item.quantity);
    const lineNetRevenue = KES(vatExclusiveFromTaxInclusive(item.lineTotal, item.taxRate));
    productMap[key].quantity += qty;
    productMap[key].revenue = productMap[key].revenue.add(lineNetRevenue);
    productMap[key].cost = productMap[key].cost.add(KES(item.costPrice).multiply(qty));
  }
  const topProducts = Object.values(productMap)
    .map((p) => {
      const revenue = p.revenue.round().toNumber();
      const cost = p.cost.round().toNumber();
      return {
        productId: p.productId,
        productName: p.productName,
        sku: p.sku,
        quantity: p.quantity,
        revenue,
        cost,
        profit: grossProfit(revenue, cost), // VAT-exclusive net revenue − COGS
      };
    })
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
    // AUDIT FIX (Task 3-f): hourly revenue is VAT-exclusive, same basis as totals.revenue.
    hourlyBuckets[hour].revenue += grossRevenue(tx.totalAmount, tx.taxAmount);
  }
  const hourlyDistribution = hourlyBuckets.map((h) => ({
    ...h,
    revenue: KES(h.revenue).round().toNumber(),
    label: `${String(h.hour).padStart(2, '0')}:00`,
  }));

  // ── Comparison ──
  // AUDIT FIX (Task 3-f): previous revenue now VAT-exclusive, same basis as totalRevenue.
  const prevRevenue = grossRevenue(prevSummary._sum.totalAmount, prevSummary._sum.taxAmount);
  const prevTransactions = prevSummary._count;
  const revenueChange = KES(totalRevenue).subtract(KES(prevRevenue)).toNumber();
  const revenueChangePercent = prevRevenue > 0 ? (revenueChange / prevRevenue) * 100 : null;
  const transactionsChange = transactionCount - prevTransactions;

  const report: SalesSummaryData = {
    period: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    store: store || { id: storeId, name: 'Unknown Store' },
    totals: {
      // AUDIT FIX (Task 3-f): `revenue` is now VAT-exclusive (and, per the
      // stored schema, net of discounts) — same keys, formula-consistent values.
      revenue: totalRevenue,
      transactions: transactionCount,
      avgOrderValue,
      taxCollected: totalTax,
      totalDiscount,
      costOfGoods,
      grossProfit: grossProfitValue,
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

  // AUDIT FIX (Task 3-d): strip profit/margin fields for below-manager callers
  // (response boundary only — the aggregation above was NOT restructured).
  const viewerIsManagerPlus = MANAGER_PLUS_ROLES.includes(session.role);
  const outbound = viewerIsManagerPlus ? report : redactProfitFields(report);

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
      profitFormulaVersion: PROFIT_FORMULA_VERSION, // AUDIT FIX (Task 3-f): lineage tracking
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      transactionCount,
      totalRevenue,
    },
  }).catch(() => {});

  // ── CSV response ──
  if (format === 'csv') {
    const csv = generateSalesCSV(outbound);
    const filename = `sales_summary_${formatISODate(startDate)}_to_${formatISODate(endDate)}.csv`;
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
  requireStoreAccess(getSalesSummaryHandler),
  'REPORTS_SALES_SUMMARY',
);
