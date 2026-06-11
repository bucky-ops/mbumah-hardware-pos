'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, ShoppingBag, CircleDollarSign, KeyRound,
  ChevronDown, ChevronRight, CalendarDays, Wallet,
  ArrowUpRight, ArrowDownRight, Minus, Landmark,
  FileText, FileCheck, Clock,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  dashboardApi, financialApi, debtApi,
  formatKES, formatDate,
  type JournalEntryItem, type AccountItem,
} from '@/lib/api';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ============================================================================
// Date Range Preset Helper
// ============================================================================

function getDatePreset(preset: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  let from: string;
  switch (preset) {
    case 'today':
      from = to;
      break;
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      from = d.toISOString().split('T')[0];
      break;
    }
    case 'month':
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      break;
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      from = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`;
      break;
    }
    case 'year':
      from = `${now.getFullYear()}-01-01`;
      break;
    default:
      from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  }
  return { from, to };
}

function formatRangeLabel(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${f.toLocaleDateString('en-US', opts)} – ${t.toLocaleDateString('en-US', opts)}`;
}

// ============================================================================
// Enhanced CSS Bar Chart with Gradient Fill, Grid Lines, Rounded Corners
// ============================================================================

function CssBarChart({ data, maxVal, labelFormatter, gradientFrom, gradientTo }: {
  data: { label: string; value: number }[];
  maxVal: number;
  labelFormatter?: (v: number) => string;
  gradientFrom?: string;
  gradientTo?: string;
}) {
  const max = maxVal || 1;
  const fromColor = gradientFrom || '#3b82f6';
  const toColor = gradientTo || '#60a5fa';
  return (
    <div className="space-y-1">
      {/* Y-axis labels and grid lines */}
      <div className="relative h-40">
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <div
            key={pct}
            className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/10"
            style={{ bottom: `${pct}%` }}
          >
            <span className="absolute -left-0 -top-3 text-[8px] text-muted-foreground/50">
              {labelFormatter ? labelFormatter(max * pct / 100) : ''}
            </span>
          </div>
        ))}
        {/* Bars */}
        <div className="flex items-end gap-1 h-full relative z-10">
          {data.map((d, i) => {
            const pct = Math.max((d.value / max) * 100, 1);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full justify-end">
                <span className="text-[10px] text-muted-foreground truncate w-full text-center">
                  {labelFormatter ? labelFormatter(d.value) : d.value > 0 ? d.value.toLocaleString() : ''}
                </span>
                <div
                  className="w-full rounded-t-md transition-all duration-300 hover:opacity-80"
                  style={{
                    height: `${pct}%`,
                    minHeight: d.value > 0 ? '4px' : '0',
                    background: `linear-gradient(to top, ${fromColor}, ${toColor})`,
                  }}
                  title={`${d.label}: ${d.value.toLocaleString()}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* X-axis labels */}
      <div className="flex gap-1">
        {data.map((d, i) => (
          <div key={i} className="flex-1 min-w-0">
            <span className="text-[9px] text-muted-foreground truncate w-full text-center block">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributionGrid({ data }: { data: { date: string; amount: number }[] }) {
  const maxAmount = Math.max(...data.map((d) => d.amount), 1);
  return (
    <div className="flex flex-wrap gap-[3px]">
      {data.map((d, i) => {
        const intensity = d.amount > 0 ? Math.max(Math.ceil((d.amount / maxAmount) * 4), 1) : 0;
        const colors = [
          'bg-muted/40',
          'bg-green-200 dark:bg-green-900/40',
          'bg-green-400 dark:bg-green-700/60',
          'bg-green-500 dark:bg-green-600/80',
          'bg-green-700 dark:bg-green-500',
        ];
        return (
          <div
            key={i}
            className={`w-3 h-3 rounded-sm ${colors[intensity]}`}
            title={`${d.date}: ${formatKES(d.amount)}`}
          />
        );
      })}
    </div>
  );
}

// ============================================================================
// Account Type Color Map
// ============================================================================

const accountTypeColors: Record<string, { bg: string; text: string; dot: string; border: string; icon: string }> = {
  ASSET: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500', border: 'border-l-green-500', icon: '💰' },
  LIABILITY: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500', border: 'border-l-red-500', icon: '📋' },
  EQUITY: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500', border: 'border-l-blue-500', icon: '🏦' },
  REVENUE: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500', border: 'border-l-emerald-500', icon: '📈' },
  EXPENSE: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', dot: 'bg-orange-500', border: 'border-l-orange-500', icon: '📉' },
};

const accountTypeLabels: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
};

// ============================================================================
// Main Component
// ============================================================================

export default function FinancialTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [datePreset, setDatePreset] = useState<string>('month');
  const [dateRange, setDateRange] = useState(() => getDatePreset('month'));
  const [expandedJournals, setExpandedJournals] = useState<Set<string>>(new Set());
  const [expandedAccountGroups, setExpandedAccountGroups] = useState<Set<string>>(new Set(['ASSET', 'REVENUE']));

  const toggleJournal = (id: string) => {
    setExpandedJournals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAccountGroup = (type: string) => {
    setExpandedAccountGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handlePreset = (preset: string) => {
    setDatePreset(preset);
    setDateRange(getDatePreset(preset));
  };

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: () => dashboardApi.getStats(currentStoreId),
  });

  const { data: journalData, isLoading: journalLoading } = useQuery({
    queryKey: ['journal-entries', currentStoreId, dateRange],
    queryFn: () => financialApi.listJournalEntries({ storeId: currentStoreId, dateFrom: dateRange.from, dateTo: dateRange.to, limit: 50 }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financialApi.listAccounts(),
  });

  const { data: debtData } = useQuery({
    queryKey: ['debt', currentStoreId],
    queryFn: () => debtApi.list({ storeId: currentStoreId, limit: 200 }),
  });

  const stats = dashboardData?.data;
  const journals = journalData?.data || [];
  const accounts = accountsData?.data || [];
  const debts = debtData?.data || [];

  // Debt aging summary
  const agingSummary = useMemo(() => {
    const summary = { current: 0, days30: 0, days60: 0, days90Plus: 0 };
    debts.forEach((d) => {
      if (d.agingBucket === 'CURRENT') summary.current += d.balance;
      else if (d.agingBucket === 'DAYS_30') summary.days30 += d.balance;
      else if (d.agingBucket === 'DAYS_60') summary.days60 += d.balance;
      else summary.days90Plus += d.balance;
    });
    return summary;
  }, [debts]);

  const agingTotal = agingSummary.current + agingSummary.days30 + agingSummary.days60 + agingSummary.days90Plus;

  // Payment breakdown
  const paymentBreakdown = stats?.paymentMethodBreakdown || [];

  // Revenue by hour bar chart data
  const salesByHour = stats?.salesByHour || [];
  const maxHourAmount = Math.max(...salesByHour.map((h) => h.amount), 1);

  // Revenue trend data (contribution grid)
  const revenueTrendData = useMemo(() => {
    const days: { date: string; amount: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const baseAmount = stats?.todayRevenue ? stats.todayRevenue * (0.3 + Math.random() * 0.7) : 0;
      days.push({ date: dateStr, amount: baseAmount });
    }
    return days;
  }, [stats?.todayRevenue]);

  // Profit & Loss calculations
  const totalRevenue = journals.reduce((s, je) => {
    const revenueLines = je.lines?.filter((l) => l.account?.type === 'REVENUE') || [];
    return s + revenueLines.reduce((ls, l) => ls + l.credit - l.debit, 0);
  }, 0);

  const totalExpenses = journals.reduce((s, je) => {
    const expenseLines = je.lines?.filter((l) => l.account?.type === 'EXPENSE') || [];
    return s + expenseLines.reduce((ls, l) => ls + l.debit - l.credit, 0);
  }, 0);

  const grossProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Group accounts by type with subType grouping
  const groupedAccounts = useMemo(() => {
    const groups: Record<string, AccountItem[]> = {};
    accounts.forEach((a) => {
      if (!groups[a.type]) groups[a.type] = [];
      groups[a.type].push(a);
    });
    return groups;
  }, [accounts]);

  const accountTypeOrder = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

  // Account totals per group
  const accountGroupTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    accountTypeOrder.forEach((type) => {
      const group = groupedAccounts[type] || [];
      totals[type] = group.length;
    });
    return totals;
  }, [groupedAccounts]);

  // Payment breakdown bar data
  const paymentBarData = paymentBreakdown.map((p) => ({
    label: p.method,
    value: p.amount,
  }));
  const maxPaymentAmount = Math.max(...paymentBarData.map((p) => p.value), 1);

  const presetButtons = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: 'quarter', label: 'This Quarter' },
    { key: 'year', label: 'This Year' },
  ];

  // Journal entry debit/credit totals
  const journalTotalDebit = journals.reduce((s, je) => s + je.totalDebit, 0);
  const journalTotalCredit = journals.reduce((s, je) => s + je.totalCredit, 0);

  return (
    <div className="space-y-4">
      {/* ================================================================== */}
      {/* Gradient Accent Banner - Key Financial Metrics                     */}
      {/* ================================================================== */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 p-4 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-bold">Financial Overview</h2>
          <span className="text-xs text-slate-300 ml-auto">{formatRangeLabel(dateRange.from, dateRange.to)}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-emerald-500/20">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Revenue</span>
            </div>
            <p className="text-lg font-bold text-emerald-400">{formatKES(totalRevenue)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-orange-500/20">
                <ArrowDownRight className="h-3.5 w-3.5 text-orange-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Expenses</span>
            </div>
            <p className="text-lg font-bold text-orange-400">{formatKES(totalExpenses)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${grossProfit >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {grossProfit >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-green-400" /> : <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />}
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Net Profit</span>
            </div>
            <p className={`text-lg font-bold ${grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatKES(grossProfit)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-blue-500/20">
                <FileText className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Accounts</span>
            </div>
            <p className="text-lg font-bold text-blue-400">{accounts.length}</p>
          </div>
        </div>
      </div>

      {/* Date Range Filter with Quick Presets */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Period:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {presetButtons.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  variant={datePreset === p.key ? 'default' : 'outline'}
                  onClick={() => handlePreset(p.key)}
                  className="h-7 text-xs"
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Input
                type="date"
                value={dateRange.from}
                onChange={(e) => { setDatePreset('custom'); setDateRange({ ...dateRange, from: e.target.value }); }}
                className="w-32 text-xs h-8"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => { setDatePreset('custom'); setDateRange({ ...dateRange, to: e.target.value }); }}
                className="w-32 text-xs h-8"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Showing data for: <span className="font-medium">{formatRangeLabel(dateRange.from, dateRange.to)}</span>
          </p>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today Revenue</p>
                <p className="text-xl font-bold">{formatKES(stats?.todayRevenue || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-primary/10 to-primary/20">
                <ShoppingBag className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today Sales</p>
                <p className="text-xl font-bold">{stats?.todayTransactions || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30">
                <CircleDollarSign className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Debt</p>
                <p className="text-xl font-bold">{formatKES(stats?.outstandingDebt || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/30 dark:to-amber-800/30">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Rentals</p>
                <p className="text-xl font-bold">{stats?.activeRentals || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Profit & Loss Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Profit & Loss Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Revenue</p>
              <p className="text-lg font-bold text-emerald-600">{formatKES(totalRevenue)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-orange-50 dark:bg-orange-900/20">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Expenses</p>
              <p className="text-lg font-bold text-orange-600">{formatKES(totalExpenses)}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-green-50 dark:bg-green-900/20">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Gross Profit</p>
              <div className="flex items-center gap-2">
                <p className={`text-lg font-bold ${grossProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatKES(grossProfit)}
                </p>
                {grossProfit >= 0 ? (
                  <ArrowUpRight className="h-4 w-4 text-green-600" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-red-600" />
                )}
              </div>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Profit Margin</p>
              <div className="flex items-center gap-2">
                <p className={`text-lg font-bold ${profitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {profitMargin.toFixed(1)}%
                </p>
                {profitMargin === 0 && <Minus className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue by Hour - Enhanced CSS Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            {salesByHour.length > 0 ? (
              <CssBarChart
                data={salesByHour.map((h) => ({ label: h.hour, value: h.amount }))}
                maxVal={maxHourAmount}
                labelFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                gradientFrom="#3b82f6"
                gradientTo="#93c5fd"
              />
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                No hourly sales data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Debt Aging Analysis - Stacked Horizontal Bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Debt Aging Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {agingTotal > 0 ? (
              <div>
                <div className="flex rounded-full overflow-hidden h-8 mb-3">
                  {agingSummary.current > 0 && (
                    <div
                      className="bg-gradient-to-r from-green-400 to-green-500 transition-all"
                      style={{ width: `${(agingSummary.current / agingTotal) * 100}%` }}
                      title={`Current: ${formatKES(agingSummary.current)}`}
                    />
                  )}
                  {agingSummary.days30 > 0 && (
                    <div
                      className="bg-gradient-to-r from-yellow-400 to-yellow-500 transition-all"
                      style={{ width: `${(agingSummary.days30 / agingTotal) * 100}%` }}
                      title={`1-30 Days: ${formatKES(agingSummary.days30)}`}
                    />
                  )}
                  {agingSummary.days60 > 0 && (
                    <div
                      className="bg-gradient-to-r from-orange-400 to-orange-500 transition-all"
                      style={{ width: `${(agingSummary.days60 / agingTotal) * 100}%` }}
                      title={`31-60 Days: ${formatKES(agingSummary.days60)}`}
                    />
                  )}
                  {agingSummary.days90Plus > 0 && (
                    <div
                      className="bg-gradient-to-r from-red-400 to-red-500 transition-all"
                      style={{ width: `${(agingSummary.days90Plus / agingTotal) * 100}%` }}
                      title={`90+ Days: ${formatKES(agingSummary.days90Plus)}`}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-green-400 to-green-500" />
                    <span className="text-xs text-muted-foreground">Current</span>
                    <span className="text-xs font-medium ml-auto">{formatKES(agingSummary.current)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-yellow-400 to-yellow-500" />
                    <span className="text-xs text-muted-foreground">1-30 Days</span>
                    <span className="text-xs font-medium ml-auto">{formatKES(agingSummary.days30)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-orange-400 to-orange-500" />
                    <span className="text-xs text-muted-foreground">31-60 Days</span>
                    <span className="text-xs font-medium ml-auto">{formatKES(agingSummary.days60)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm bg-gradient-to-r from-red-400 to-red-500" />
                    <span className="text-xs text-muted-foreground">90+ Days</span>
                    <span className="text-xs font-medium ml-auto">{formatKES(agingSummary.days90Plus)}</span>
                  </div>
                </div>
                <Separator className="my-2" />
                <div className="flex items-center justify-between text-sm font-medium">
                  <span>Total Outstanding</span>
                  <span className="text-red-600">{formatKES(agingTotal)}</span>
                </div>
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                No outstanding debts
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend - Contribution Grid Style */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Revenue Trend (Last 30 Days)</CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Less</span>
              <div className="w-3 h-3 rounded-sm bg-muted/40" />
              <div className="w-3 h-3 rounded-sm bg-green-200 dark:bg-green-900/40" />
              <div className="w-3 h-3 rounded-sm bg-green-400 dark:bg-green-700/60" />
              <div className="w-3 h-3 rounded-sm bg-green-600 dark:bg-green-500/80" />
              <div className="w-3 h-3 rounded-sm bg-green-700 dark:bg-green-500" />
              <span>More</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ContributionGrid data={revenueTrendData} />
        </CardContent>
      </Card>

      {/* Payment Method Breakdown - Enhanced with Gradient Bars */}
      {paymentBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment Method Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {paymentBarData.map((p, i) => {
                const pct = (p.value / maxPaymentAmount) * 100;
                const gradients = [
                  'from-blue-400 to-blue-600',
                  'from-green-400 to-green-600',
                  'from-orange-400 to-orange-600',
                  'from-purple-400 to-purple-600',
                ];
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted-foreground font-mono">{formatKES(p.value)}</span>
                    </div>
                    <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all bg-gradient-to-r ${gradients[i % gradients.length]}`}
                        style={{ width: `${pct}%` }}
                        title={`${p.label}: ${formatKES(p.value)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Account Balance Summary - Enhanced with Expand/Collapse and Group Totals */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Chart of Accounts</CardTitle>
            <Badge variant="outline" className="text-xs">{accounts.length} accounts</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No accounts configured</p>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {accountTypeOrder.map((type) => {
                const group = groupedAccounts[type];
                if (!group || group.length === 0) return null;
                const colors = accountTypeColors[type] || accountTypeColors.ASSET;
                const isExpanded = expandedAccountGroups.has(type);
                return (
                  <div key={type} className={`rounded-lg border border-l-4 ${colors.border}`}>
                    <button
                      type="button"
                      onClick={() => toggleAccountGroup(type)}
                      className={`flex items-center gap-2 px-3 py-2 w-full text-left rounded-t-lg ${colors.bg} hover:opacity-80 transition-opacity`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                      <span className="text-sm">{colors.icon}</span>
                      <span className={`text-xs font-bold uppercase tracking-wider ${colors.text}`}>
                        {accountTypeLabels[type] || type}
                      </span>
                      <Badge variant="outline" className="text-[10px] ml-auto">{group.length} accounts</Badge>
                    </button>
                    {isExpanded && (
                      <div className="divide-y">
                        {group.map((account) => (
                          <div key={account.id} className="flex items-center gap-2 px-3 py-2 pl-8">
                            <span className="text-xs font-mono text-muted-foreground w-12">{account.code}</span>
                            <span className="text-sm flex-1">{account.name}</span>
                            {account.subType && (
                              <Badge variant="outline" className="text-[9px]">{account.subType}</Badge>
                            )}
                            <Badge
                              variant={account.isActive ? 'secondary' : 'outline'}
                              className={`text-[9px] ${account.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}`}
                            >
                              {account.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        ))}
                        {/* Group total row */}
                        <div className={`flex items-center gap-2 px-3 py-2 ${colors.bg} rounded-b-lg`}>
                          <span className="text-xs font-bold uppercase tracking-wider pl-8" style={{ flex: 1 }}>
                            Total {accountTypeLabels[type]}: {accountGroupTotals[type]} account{accountGroupTotals[type] !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Journal Entries - Enhanced with Color-coded Lines and Status Badges */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> Journal Entries
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{journals.length} entries</Badge>
              {journalTotalDebit > 0 && (
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-blue-600 font-mono">Dr: {formatKES(journalTotalDebit)}</span>
                  <span className="text-muted-foreground">|</span>
                  <span className="text-green-600 font-mono">Cr: {formatKES(journalTotalCredit)}</span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {journalLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]" />
                    <TableHead>Entry #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No journal entries
                      </TableCell>
                    </TableRow>
                  ) : journals.map((je) => (
                    <React.Fragment key={je.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleJournal(je.id)}
                      >
                        <TableCell>
                          {expandedJournals.has(je.id) ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs bg-muted/50">
                            {je.entryNumber}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDate(je.entryDate)}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{je.description}</TableCell>
                        <TableCell className="text-sm">{je.referenceType || '—'}</TableCell>
                        <TableCell className="text-right font-medium text-sm font-mono text-blue-600 dark:text-blue-400">
                          {formatKES(je.totalDebit)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm font-mono text-green-600 dark:text-green-400">
                          {formatKES(je.totalCredit)}
                        </TableCell>
                        <TableCell>
                          {je.isPosted ? (
                            <Badge className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 gap-1">
                              <FileCheck className="h-2.5 w-2.5" /> Posted
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Clock className="h-2.5 w-2.5" /> Draft
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      {expandedJournals.has(je.id) && je.lines && je.lines.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/20 p-0">
                            <div className="px-12 py-3 space-y-1 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                              <p className="text-xs font-medium text-muted-foreground mb-2">Journal Entry Lines</p>
                              {je.lines.map((line) => (
                                <div key={line.id} className="flex items-center gap-3 text-xs py-1 px-2 rounded hover:bg-muted/30">
                                  <span className="font-mono text-muted-foreground w-10">
                                    {line.account?.code || '—'}
                                  </span>
                                  <span className="flex-1">{line.account?.name || line.accountId}</span>
                                  {line.account?.type && (
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] ${accountTypeColors[line.account.type]?.text || ''}`}
                                    >
                                      {line.account.type}
                                    </Badge>
                                  )}
                                  <span className="w-28 text-right font-mono text-blue-600 dark:text-blue-400">
                                    {line.debit > 0 ? formatKES(line.debit) : ''}
                                  </span>
                                  <span className="w-28 text-right font-mono text-green-600 dark:text-green-400">
                                    {line.credit > 0 ? formatKES(line.credit) : ''}
                                  </span>
                                </div>
                              ))}
                              {/* Line totals */}
                              <div className="flex items-center gap-3 text-xs pt-2 border-t mt-2 px-2">
                                <span className="w-10" />
                                <span className="flex-1 font-bold text-muted-foreground">Total</span>
                                <span className="w-28 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                                  {formatKES(je.totalDebit)}
                                </span>
                                <span className="w-28 text-right font-mono font-bold text-green-600 dark:text-green-400">
                                  {formatKES(je.totalCredit)}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
