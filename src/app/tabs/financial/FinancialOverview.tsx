'use client';

/**
 * FinancialOverview — top-of-page banner + quick actions + date filter + stat cards.
 *
 * Extracted from `financial-tab.tsx` to slim down the orchestrator. Receives
 * all data and event handlers as props so the orchestrator remains the single
 * source of truth for state and mutations.
 */

import React from 'react';
import {
  TrendingUp, ShoppingBag, CircleDollarSign, KeyRound,
  CalendarDays, ArrowUpRight, ArrowDownRight, Minus,
  FileText, Download, Printer, CreditCard, Receipt, Plus,
  Landmark,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { formatKES } from '@/lib/api';
import type { DashboardStats } from '@/lib/types';

import { AnimatedCounter, formatRangeLabel } from './shared';

export interface FinancialOverviewProps {
  // Banner metrics
  totalRevenue: number;
  totalExpenses: number;
  grossProfit: number;
  accountsCount: number;
  revenueTrend: number;
  debtTrend: number;
  // Date range state
  dateRange: { from: string; to: string };
  datePreset: string;
  presetButtons: { key: string; label: string }[];
  onPresetChange: (preset: string) => void;
  onDateRangeChange: (range: { from: string; to: string }) => void;
  // Stat cards data
  stats?: DashboardStats;
  // Quick action handlers
  onRecordExpense: () => void;
  onRecordPayment: () => void;
  onAddJournal: () => void;
  onViewLedger: () => void;
  onExportCSV: () => void;
  onPrintReport: () => void;
  // Banner card click handlers (drilldowns)
  onRevenueDrilldown: () => void;
  onDebtDrilldown: () => void;
}

export function FinancialOverview({
  totalRevenue,
  totalExpenses,
  grossProfit,
  accountsCount,
  revenueTrend,
  debtTrend,
  dateRange,
  datePreset,
  presetButtons,
  onPresetChange,
  onDateRangeChange,
  stats,
  onRecordExpense,
  onRecordPayment,
  onAddJournal,
  onViewLedger,
  onExportCSV,
  onPrintReport,
  onRevenueDrilldown,
  onDebtDrilldown,
}: FinancialOverviewProps) {
  return (
    <>
      {/* ================================================================== */}
      {/* Gradient Accent Banner - Key Financial Metrics                     */}
      {/* ================================================================== */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800 p-4 text-white shadow-lg backdrop-blur-sm border border-white/5">
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-bold">Financial Overview</h2>
          <span className="text-xs text-slate-300 ml-auto">{formatRangeLabel(dateRange.from, dateRange.to)}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div
            className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 cursor-pointer hover:bg-white/15 transition-all hover:scale-[1.02]"
            onClick={onRevenueDrilldown}
            title="Click for revenue breakdown"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-emerald-500/20">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Revenue</span>
            </div>
            <p className="text-lg font-bold text-emerald-400">{formatKES(totalRevenue)}</p>
            <div className="flex items-center gap-1 mt-1">
              {revenueTrend >= 0 ? (
                <ArrowUpRight className="h-3 w-3 text-emerald-400" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-red-400" />
              )}
              <span className={`text-[10px] ${revenueTrend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {Math.abs(revenueTrend).toFixed(1)}% vs prev period
              </span>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:bg-white/15 transition-all hover:scale-[1.02]">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-orange-500/20">
                <ArrowDownRight className="h-3.5 w-3.5 text-orange-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Expenses</span>
            </div>
            <p className="text-lg font-bold text-orange-400">{formatKES(totalExpenses)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:bg-white/15 transition-all hover:scale-[1.02]">
            <div className="flex items-center gap-2 mb-1">
              <div className={`p-1 rounded ${grossProfit >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                {grossProfit >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-green-400" /> : <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />}
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Net Profit</span>
            </div>
            <p className={`text-lg font-bold ${grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatKES(grossProfit)}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/10 hover:bg-white/15 transition-all hover:scale-[1.02]">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1 rounded bg-blue-500/20">
                <FileText className="h-3.5 w-3.5 text-blue-400" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-slate-300">Total Accounts</span>
            </div>
            <p className="text-lg font-bold text-blue-400">{accountsCount}</p>
          </div>
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRecordExpense}>
          <Minus className="mr-1.5 h-3.5 w-3.5" /> Record Expense
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onRecordPayment}>
          <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Record Payment
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onAddJournal}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Journal Entry
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onViewLedger}>
          <Receipt className="mr-1.5 h-3.5 w-3.5" /> View Ledger
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onExportCSV}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onPrintReport}>
            <Printer className="mr-1.5 h-3.5 w-3.5" /> Print Report
          </Button>
        </div>
      </div>

      {/* Date Range Filter with Quick Presets */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
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
                  onClick={() => onPresetChange(p.key)}
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
                onChange={(e) => { onPresetChange('custom'); onDateRangeChange({ ...dateRange, from: e.target.value }); }}
                className="w-32 text-xs h-8"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateRange.to}
                onChange={(e) => { onPresetChange('custom'); onDateRangeChange({ ...dateRange, to: e.target.value }); }}
                className="w-32 text-xs h-8"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Showing data for: <span className="font-medium">{formatRangeLabel(dateRange.from, dateRange.to)}</span>
          </p>
        </CardContent>
      </Card>

      {/* Stats Cards with Gradient Backgrounds and Trend Arrows */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card
          className="border-l-4 border-l-green-500 cursor-pointer hover:shadow-md transition-all bg-gradient-to-br from-green-50 to-white dark:from-green-900/10 dark:to-card backdrop-blur-sm hover:scale-[1.01]"
          onClick={onRevenueDrilldown}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Today Revenue</p>
                <p className="text-xl font-bold text-green-600">
                  <AnimatedCounter value={stats?.todayRevenue || 0} prefix="Ksh " />
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {revenueTrend >= 0 ? (
                    <ArrowUpRight className="h-3 w-3 text-green-500" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 text-red-500" />
                  )}
                  <span className={`text-[10px] ${revenueTrend >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {Math.abs(revenueTrend).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-primary bg-gradient-to-br from-primary/5 to-white dark:from-primary/10 dark:to-card backdrop-blur-sm hover:scale-[1.01] transition-all">
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
        <Card
          className="border-l-4 border-l-red-500 cursor-pointer hover:shadow-md transition-all bg-gradient-to-br from-red-50 to-white dark:from-red-900/10 dark:to-card backdrop-blur-sm hover:scale-[1.01]"
          onClick={onDebtDrilldown}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/30 dark:to-red-800/30">
                <CircleDollarSign className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Outstanding Debt</p>
                <p className="text-xl font-bold text-red-600">
                  <AnimatedCounter value={stats?.outstandingDebt || 0} prefix="Ksh " />
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  {debtTrend >= 0 ? (
                    <ArrowUpRight className="h-3 w-3 text-red-500" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3 text-green-500" />
                  )}
                  <span className={`text-[10px] ${debtTrend >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {Math.abs(debtTrend).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/10 dark:to-card backdrop-blur-sm hover:scale-[1.01] transition-all">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/30 dark:to-amber-800/30">
                <KeyRound className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Rentals</p>
                <p className="text-xl font-bold text-amber-600">{stats?.activeRentals || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default FinancialOverview;
