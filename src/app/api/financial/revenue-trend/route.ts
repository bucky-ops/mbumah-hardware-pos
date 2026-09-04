// GET /api/financial/revenue-trend (daily revenue, generates demo data only if explicitly requested)
//
// AUDIT FIX (Task 3-f): the `revenue` series (and the summary built on it) is
// now VAT-EXCLUSIVE via the canonical grossRevenue(totalAmount, taxAmount)
// helper (src/lib/profit.ts) — previously it summed the tax-inclusive
// totalAmount. Chart series KEYS are unchanged (client-safe); only values
// changed basis. `expenses` remain ALL EXPENSE-type journal debits (which
// include account 5000 COGS), so the figure exposed under the legacy
// `grossProfit` key is a net-profit-style number — see the summary block.
// DIVERGENCE NOTE: `byMethod` stays TAX-INCLUSIVE — it is tender collected
// per payment method, not revenue.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { grossRevenue, grossProfit, netProfit, PROFIT_FORMULA_VERSION } from '@/lib/profit';
import { KES } from '@/lib/money';

export const dynamic = 'force-dynamic';

async function getRevenueTrendHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const days = parseInt(searchParams.get('days') || '30');
  const includeDemo = searchParams.get('demo') === 'true'; // default false — demo data only on explicit request

  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (days - 1));

  // Query real transactions grouped by date
  const transactions = await db.salesTransaction.findMany({
    where: {
      storeId,
      createdAt: { gte: startDate },
      transactionType: 'SALE',
      paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
    },
    select: {
      createdAt: true,
      totalAmount: true,
      taxAmount: true, // AUDIT FIX (Task 3-f): needed to derive VAT-exclusive revenue
      paymentMethod: true,
    },
  });

  // Query expense transactions from journal entries for the same period
  const expenseLines = await db.journalEntryLine.findMany({
    where: {
      journalEntry: {
        storeId,
        entryDate: { gte: startDate },
      },
      account: {
        type: 'EXPENSE',
      },
      debit: { gt: 0 },
    },
    select: {
      debit: true,
      journalEntry: {
        select: {
          entryDate: true,
        },
      },
    },
  });

    const dailyRevenue: Record<string, { revenue: number; expenses: number; transactions: number; byMethod: Record<string, number> }> = {};

    for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().split('T')[0];
    dailyRevenue[key] = { revenue: 0, expenses: 0, transactions: 0, byMethod: {} };
  }

  // AUDIT FIX (Task 3-f): the old accumulators did `number += tx.totalAmount`
  // where totalAmount is a Prisma Decimal — Decimal.valueOf() returns a STRING,
  // so `0 + Decimal` string-concatenated ("0123.45", then "0123.45123.46"…).
  // Math.round downstream masked it for revenue/expenses, but `byMethod` leaked
  // the corrupted strings straight into the JSON. All accumulation is now
  // explicit numeric conversion + HALF_EVEN rounding at the output boundary.
  let hasRealData = false;
  for (const tx of transactions) {
    const key = new Date(tx.createdAt).toISOString().split('T')[0];
    if (dailyRevenue[key]) {
      hasRealData = true;
      // VAT-exclusive revenue per transaction (canonical basis).
      dailyRevenue[key].revenue += grossRevenue(tx.totalAmount, tx.taxAmount);
      dailyRevenue[key].transactions += 1;
      // Tender per method stays TAX-INCLUSIVE (see header divergence note).
      const tender = KES(tx.totalAmount).toNumber();
      dailyRevenue[key].byMethod[tx.paymentMethod] = (dailyRevenue[key].byMethod[tx.paymentMethod] || 0) + tender;
    }
  }

  for (const line of expenseLines) {
    const key = new Date(line.journalEntry.entryDate).toISOString().split('T')[0];
    if (dailyRevenue[key]) {
      dailyRevenue[key].expenses += KES(line.debit).toNumber();
    }
  }

  // If no real data and demo is allowed, generate realistic demo data
  // (NOTE: the demo series is SYNTHETIC — it is not governed by the unified
  // profit formulas and only appears when ?demo=true is explicitly passed).
  if (!hasRealData && includeDemo) {
    // Seed a deterministic but varied pattern based on storeId
    const seed = storeId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();

      const weekendMultiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.4 : 1.0;
      const midweekDip = dayOfWeek === 3 ? 0.7 : 1.0;

      // Deterministic pseudo-random variation per store+day
      const pseudoRandom = Math.sin(seed * (i + 1) * 9301 + 49297) % 233280;
      const variation = 0.5 + Math.abs(pseudoRandom) / 233280;

      const baseRevenue = 8000 + variation * 37000;
      const revenue = Math.round(baseRevenue * weekendMultiplier * midweekDip);

      const expenseRatio = 0.5 + Math.abs(Math.sin(seed * (i + 2) * 7919)) * 0.3;
      const expenses = Math.round(revenue * expenseRatio);

      dailyRevenue[key] = {
        revenue,
        expenses,
        transactions: Math.max(1, Math.round(revenue / 2500)),
        byMethod: {
          CASH: Math.round(revenue * (0.4 + Math.abs(Math.sin(seed * i * 3571)) * 0.2)),
          MPESA: Math.round(revenue * (0.2 + Math.abs(Math.sin(seed * i * 5113)) * 0.15)),
          DEBT: Math.round(revenue * (0.1 + Math.abs(Math.sin(seed * i * 7907)) * 0.1)),
        },
      };
    }
  }

    const result = Object.entries(dailyRevenue)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => {
      const d = new Date(date);
      const label = d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
      // Keys unchanged; revenue is now VAT-exclusive. `margin` remains
      // (revenue − expenses) / revenue — a NET-margin style figure because
      // `expenses` includes COGS (see summary note below).
      const revenue = KES(data.revenue).round().toNumber();
      const expenses = KES(data.expenses).round().toNumber();
      const margin = revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0;
      const byMethod: Record<string, number> = {};
      for (const [method, amount] of Object.entries(data.byMethod)) {
        byMethod[method] = KES(amount || 0).round().toNumber();
      }
      return {
        date,
        label,
        revenue,
        expenses,
        transactions: data.transactions,
        margin: Math.round(margin * 10) / 10,
        byMethod,
      };
    });

    const totalRevenue = result.reduce((s, d) => s + d.revenue, 0);
  const totalExpenses = result.reduce((s, d) => s + d.expenses, 0);
  const totalTransactions = result.reduce((s, d) => s + d.transactions, 0);
  const avgRevenue = totalRevenue / days;
  const peakDay = result.reduce((max, d) => d.revenue > max.revenue ? d : max, result[0]);
  const isDemo = !hasRealData && includeDemo;

  // AUDIT FIX (Task 3-f): the legacy `grossProfit` key previously held
  // totalRevenue − totalExpenses where totalRevenue was tax-inclusive. The
  // key is kept for client compatibility, but the value is now composed
  // through the canonical chain: because `expenses` already bundles COGS
  // (EXPENSE account 5000) with operating expenses, there is no separate COGS
  // input — grossProfit(netRevenue, 0) is netRevenue, and
  // netProfit(grossProfit, allExpenses) yields netRevenue − allExpenses
  // (net-profit-style) with version-tracked lineage and no double-counted COGS.
  const revenueGrossProfit = grossProfit(totalRevenue, 0);
  const summaryNetProfit = netProfit(revenueGrossProfit, totalExpenses);

  return Response.json({
    success: true,
    data: {
      daily: result,
      summary: {
        totalRevenue,
        totalExpenses,
        // Legacy key — value is netRevenue − allExpenses (see composition note).
        grossProfit: summaryNetProfit,
        profitMargin: totalRevenue > 0 ? (summaryNetProfit / totalRevenue) * 100 : 0,
        avgDailyRevenue: Math.round(avgRevenue),
        peakDayRevenue: peakDay?.revenue || 0,
        peakDayLabel: peakDay?.label || '',
        totalTransactions,
        isDemo,
        // AUDIT FIX (Task 3-f): formula lineage marker (additive field).
        profitFormulaVersion: PROFIT_FORMULA_VERSION,
      },
    },
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getRevenueTrendHandler, FINANCIAL_ROLES.READ),
  'REVENUE_TREND',
);
