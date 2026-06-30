// GET /api/financial/revenue-trend (daily revenue, generates demo data if empty)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';

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
  const includeDemo = searchParams.get('demo') !== 'false'; // default true

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

    let hasRealData = false;
  for (const tx of transactions) {
    const key = new Date(tx.createdAt).toISOString().split('T')[0];
    if (dailyRevenue[key]) {
      hasRealData = true;
      dailyRevenue[key].revenue += tx.totalAmount;
      dailyRevenue[key].transactions += 1;
      dailyRevenue[key].byMethod[tx.paymentMethod] = (dailyRevenue[key].byMethod[tx.paymentMethod] || 0) + tx.totalAmount;
    }
  }

    for (const line of expenseLines) {
    const key = new Date(line.journalEntry.entryDate).toISOString().split('T')[0];
    if (dailyRevenue[key]) {
      dailyRevenue[key].expenses += line.debit;
    }
  }

  // If no real data and demo is allowed, generate realistic demo data
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
      const margin = data.revenue > 0 ? ((data.revenue - data.expenses) / data.revenue) * 100 : 0;
      return {
        date,
        label,
        revenue: Math.round(data.revenue),
        expenses: Math.round(data.expenses),
        transactions: data.transactions,
        margin: Math.round(margin * 10) / 10,
        byMethod: data.byMethod,
      };
    });

    const totalRevenue = result.reduce((s, d) => s + d.revenue, 0);
  const totalExpenses = result.reduce((s, d) => s + d.expenses, 0);
  const totalTransactions = result.reduce((s, d) => s + d.transactions, 0);
  const avgRevenue = totalRevenue / days;
  const peakDay = result.reduce((max, d) => d.revenue > max.revenue ? d : max, result[0]);
  const isDemo = !hasRealData && includeDemo;

  return Response.json({
    success: true,
    data: {
      daily: result,
      summary: {
        totalRevenue,
        totalExpenses,
        grossProfit: totalRevenue - totalExpenses,
        profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0,
        avgDailyRevenue: Math.round(avgRevenue),
        peakDayRevenue: peakDay?.revenue || 0,
        peakDayLabel: peakDay?.label || '',
        totalTransactions,
        isDemo,
      },
    },
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getRevenueTrendHandler, FINANCIAL_ROLES.READ),
  'REVENUE_TREND',
);
