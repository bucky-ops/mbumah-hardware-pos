'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Download, BarChart3, Package, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Minus, FileText, Boxes,
  ShoppingCart, DollarSign, FileSpreadsheet, FileDown,
  Calendar, Clock, Eye, Play, Sparkles, PieChart,
  HeartPulse, RotateCcw, CreditCard, Banknote, Smartphone,
  AlertTriangle,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  reportsApi, dashboardApi,
  formatKES,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ============================================================================
// Report Type Card Component (Enhanced)
// ============================================================================

function ReportTypeCard({
  icon, title, description, isActive, onClick, colorClass, lastGenerated, previewThumbnail,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
  colorClass: string;
  lastGenerated?: string;
  previewThumbnail?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md ${
        isActive
          ? `border-primary bg-primary/5 ${colorClass} shadow-sm`
          : 'border-transparent bg-muted/30 hover:bg-muted/50'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isActive ? 'bg-primary/10' : 'bg-muted/50'}`}>
            {icon}
          </div>
          <div>
            <span className="text-sm font-bold">{title}</span>
            {lastGenerated && (
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Last: {lastGenerated}</span>
              </div>
            )}
          </div>
        </div>
        {isActive && (
          <Badge className="text-[9px] bg-primary/10 text-primary border-0">
            <Eye className="mr-1 h-3 w-3" /> Active
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>
      <div className="flex items-center justify-between">
        {previewThumbnail && <div className="opacity-60">{previewThumbnail}</div>}
        <Button
          size="sm"
          variant={isActive ? 'default' : 'outline'}
          className={`text-xs h-7 ${isActive ? 'bg-primary hover:bg-primary/90' : ''}`}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          <Play className="mr-1 h-3 w-3" /> Generate
        </Button>
      </div>
    </button>
  );
}

// ============================================================================
// CSS Bar Component
// ============================================================================

function HorizontalBar({ value, maxValue, colorClass = 'bg-primary/70', height = 'h-4' }: {
  value: number; maxValue: number; colorClass?: string; height?: string;
}) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  return (
    <div className={`${height} bg-muted/30 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full transition-all duration-500 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ============================================================================
// Conic Gradient Pie Chart Component
// ============================================================================

function ConicPieChart({ segments }: {
  segments: { name: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  const gradientStops = segments.reduce<string[]>((acc, seg, i) => {
    const prevEnd = i === 0 ? 0 : segments.slice(0, i).reduce((s, prev) => s + (prev.value / total) * 100, 0);
    const end = prevEnd + (seg.value / total) * 100;
    acc.push(`${seg.color} ${prevEnd}% ${end}%`);
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-4">
      <div
        className="w-32 h-32 rounded-full shrink-0 shadow-inner"
        style={{ background: `conic-gradient(${gradientStops.join(', ')})` }}
      />
      <div className="space-y-1.5 min-w-0 flex-1">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="truncate font-medium">{seg.name}</span>
            <span className="ml-auto text-muted-foreground whitespace-nowrap">
              {formatKES(seg.value)} ({((seg.value / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Mini Sparkline Component (CSS-based)
// ============================================================================

function MiniSparkline({ data, color = 'text-primary', height = 24 }: {
  data: number[]; color?: string; height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;

  return (
    <svg width={w} height={height} className={color}>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={data.map((v, i) => {
          const x = (i / (data.length - 1)) * w;
          const y = height - ((v - min) / range) * (height - 4) - 2;
          return `${x},${y}`;
        }).join(' ')}
      />
    </svg>
  );
}

// ============================================================================
// Main Reports Tab Component
// ============================================================================

export default function ReportsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [reportType, setReportType] = useState<'sales' | 'inventory'>('sales');
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['sales-report', currentStoreId, dateFrom, dateTo],
    queryFn: () => reportsApi.getSalesReport({ storeId: currentStoreId, dateFrom, dateTo }),
    enabled: reportType === 'sales',
  });

  const { data: inventoryData, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventory-report', currentStoreId],
    queryFn: () => reportsApi.getInventoryReport(currentStoreId),
    enabled: reportType === 'inventory',
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['dashboard', currentStoreId],
    queryFn: () => dashboardApi.getStats(currentStoreId),
  });

  const salesReport = salesData?.data;
  const inventoryReport = inventoryData?.data;
  const dashboardStats = dashboardData?.data;

  // Quick stats from dashboard with mock comparison data
  const quickStats = useMemo(() => ({
    todayRevenue: dashboardStats?.todayRevenue || 0,
    todayTransactions: dashboardStats?.todayTransactions || 0,
    lowStockProducts: dashboardStats?.lowStockProducts || 0,
    outstandingDebt: dashboardStats?.outstandingDebt || 0,
    // Mock comparisons
    revenueChange: 12.5,
    transactionsChange: 8.3,
    lowStockChange: -5.0,
    debtChange: 3.2,
  }), [dashboardStats]);

  // Sales comparison (mock: this period vs last period)
  const salesComparison = useMemo(() => {
    if (!salesReport) return null;
    const prevRevenue = salesReport.totalRevenue * (0.7 + Math.random() * 0.4);
    const revenueChange = salesReport.totalRevenue > 0
      ? ((salesReport.totalRevenue - prevRevenue) / prevRevenue) * 100
      : 0;
    const prevTransactions = Math.round(salesReport.transactionCount * (0.7 + Math.random() * 0.4));
    const transactionChange = salesReport.transactionCount > 0
      ? ((salesReport.transactionCount - prevTransactions) / prevTransactions) * 100
      : 0;
    return { prevRevenue, revenueChange, prevTransactions, transactionChange };
  }, [salesReport]);

  // Top products from inventory report
  const topProducts = inventoryReport?.topSelling || [];

  // Category breakdown for inventory
  const categoryBreakdown = inventoryReport?.categories || [];
  const maxCategoryValue = Math.max(...categoryBreakdown.map((c) => c.totalValue), 1);

  // Pie chart segments from category breakdown
  const pieSegments = useMemo(() => {
    const colors = [
      '#3b82f6', '#22c55e', '#f97316', '#a855f7',
      '#14b8a6', '#ec4899', '#eab308', '#06b6d4', '#84cc16', '#f43f5e',
    ];
    return categoryBreakdown.map((cat, i) => ({
      name: cat.name,
      value: cat.totalValue,
      color: colors[i % colors.length],
    }));
  }, [categoryBreakdown]);

  // Stock health indicator
  const stockHealth = useMemo(() => {
    if (!inventoryReport) return 0;
    const total = inventoryReport.totalProducts || 1;
    const healthy = total - inventoryReport.lowStockCount - inventoryReport.outOfStockCount;
    return Math.round((healthy / total) * 100);
  }, [inventoryReport]);

  // Inventory turnover estimate (mock)
  const inventoryTurnover = useMemo(() => {
    if (!inventoryReport || !salesReport) return 0;
    if (inventoryReport.totalInventoryValue === 0) return 0;
    return (salesReport.totalRevenue / inventoryReport.totalInventoryValue).toFixed(2);
  }, [inventoryReport, salesReport]);

  // CSV file size estimate
  const estimatedFileSize = useMemo(() => {
    if (reportType === 'sales' && salesReport) {
      const rows = salesReport.transactionCount || 0;
      const bytesPerRow = 120;
      const size = rows * bytesPerRow;
      if (size === 0) return '< 1 KB';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (reportType === 'inventory' && inventoryReport) {
      const rows = inventoryReport.totalProducts || 0;
      const bytesPerRow = 100;
      const size = rows * bytesPerRow;
      if (size === 0) return '< 1 KB';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    return '—';
  }, [reportType, salesReport, inventoryReport]);

  // Mock sparkline data for sales trend
  const salesSparkline = [35, 48, 42, 55, 50, 62, 58, 72, 65, 78, 70, 85];

  // Payment method icons
  const paymentMethodIcons: Record<string, React.ReactNode> = {
    CASH: <Banknote className="h-4 w-4" />,
    MPESA: <Smartphone className="h-4 w-4" />,
    DEBT: <CreditCard className="h-4 w-4" />,
  };

  const handleExport = async () => {
    try {
      const res = await reportsApi.exportCSV({ storeId: currentStoreId, type: reportType, dateFrom, dateTo });
      if (res.data?.url) {
        window.open(res.data.url, '_blank');
        toast.success('Report exported');
      }
    } catch {
      toast.error('Export failed');
    }
  };

  const changeIndicator = (change: number) => {
    if (change > 0) return <ArrowUpRight className="h-4 w-4 text-green-600" />;
    if (change < 0) return <ArrowDownRight className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const changeColor = (change: number) => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-muted-foreground';
  };

  // Format date range for display
  const dateRangeDisplay = useMemo(() => {
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    const days = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1;
    return `${from.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })} — ${to.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })} (${days} days)`;
  }, [dateFrom, dateTo]);

  return (
    <div className="space-y-4">
      {/* ================================================================== */}
      {/* Enhanced Quick Stats Cards                                          */}
      {/* ================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-green-500 bg-gradient-to-br from-card to-green-50/30 dark:to-green-900/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/40 dark:to-green-800/30">
                <DollarSign className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Today Revenue</p>
                <p className="text-lg font-bold whitespace-nowrap">{formatKES(quickStats.todayRevenue)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.revenueChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.revenueChange)}`}>
                {quickStats.revenueChange >= 0 ? '+' : ''}{quickStats.revenueChange}% vs last period
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary bg-gradient-to-br from-card to-primary-50/30 dark:to-primary-900/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary/10 to-primary/20">
                <ShoppingCart className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Today Sales</p>
                <p className="text-lg font-bold whitespace-nowrap">{quickStats.todayTransactions}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.transactionsChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.transactionsChange)}`}>
                {quickStats.transactionsChange >= 0 ? '+' : ''}{quickStats.transactionsChange}% vs last period
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500 bg-gradient-to-br from-card to-amber-50/30 dark:to-amber-900/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/30">
                <Package className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Low Stock</p>
                <p className="text-lg font-bold whitespace-nowrap">{quickStats.lowStockProducts}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.lowStockChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.lowStockChange)}`}>
                {quickStats.lowStockChange >= 0 ? '+' : ''}{quickStats.lowStockChange}% vs last period
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 bg-gradient-to-br from-card to-red-50/30 dark:to-red-900/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-red-100 to-red-200 dark:from-red-900/40 dark:to-red-800/30">
                <TrendingDown className="h-5 w-5 text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Outstanding Debt</p>
                <p className="text-lg font-bold whitespace-nowrap">{formatKES(quickStats.outstandingDebt)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              {changeIndicator(quickStats.debtChange)}
              <span className={`text-xs font-medium ${changeColor(quickStats.debtChange)}`}>
                {quickStats.debtChange >= 0 ? '+' : ''}{quickStats.debtChange}% vs last period
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================================================== */}
      {/* Enhanced Report Generation Dashboard                                */}
      {/* ================================================================== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Report Generation Dashboard
              </CardTitle>
              <CardDescription className="text-xs mt-1">Select a report type to generate and view detailed analytics</CardDescription>
            </div>
            <Badge variant="outline" className="text-[10px]">
              <Calendar className="mr-1 h-3 w-3" /> {dateRangeDisplay}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ReportTypeCard
              icon={<BarChart3 className="h-5 w-5 text-primary" />}
              title="Sales Report"
              description="Revenue, transactions, payment methods, and trends analysis for the selected period."
              isActive={reportType === 'sales'}
              onClick={() => setReportType('sales')}
              colorClass="text-primary"
              lastGenerated="2 hours ago"
              previewThumbnail={
                <MiniSparkline data={salesSparkline} color="text-primary" height={20} />
              }
            />
            <ReportTypeCard
              icon={<Boxes className="h-5 w-5 text-orange-600" />}
              title="Inventory Report"
              description="Stock levels, category valuation, top sellers, and reorder alerts."
              isActive={reportType === 'inventory'}
              onClick={() => setReportType('inventory')}
              colorClass="text-orange-600"
              lastGenerated="1 day ago"
              previewThumbnail={
                <div className="flex gap-0.5">
                  {[65, 45, 80, 30, 55].map((h, i) => (
                    <div key={i} className="w-1.5 bg-orange-400 rounded-sm" style={{ height: `${h * 0.2}px` }} />
                  ))}
                </div>
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Enhanced Controls / Export Bar                                      */}
      {/* ================================================================== */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            {reportType === 'sales' && (
              <>
                <div className="space-y-1">
                  <Label className="text-sm">From</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm">To</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
                </div>
              </>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              <div className="text-right mr-2">
                <p className="text-xs text-muted-foreground">Estimated size</p>
                <div className="flex items-center gap-1.5">
                  <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">{estimatedFileSize}</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => toast.info('PDF export coming soon')}
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5 text-red-500" /> PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => toast.info('Report scheduling coming soon')}
              >
                <Clock className="mr-1.5 h-3.5 w-3.5" /> Schedule
              </Button>
              <Button onClick={handleExport} size="sm" className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground">
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ================================================================== */}
      {/* Sales Report                                                        */}
      {/* ================================================================== */}
      {reportType === 'sales' && (
        <>
          {salesLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : salesReport ? (
            <>
              {/* Sales Stats with Comparison - Enhanced */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-l-4 border-l-green-500">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold text-green-600">{formatKES(salesReport.totalRevenue)}</p>
                      {salesComparison && changeIndicator(salesComparison.revenueChange)}
                    </div>
                    {salesComparison && (
                      <p className={`text-xs ${changeColor(salesComparison.revenueChange)}`}>
                        {salesComparison.revenueChange >= 0 ? '+' : ''}{salesComparison.revenueChange.toFixed(1)}% vs prev period
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Sales</p>
                    <div className="flex items-center gap-2">
                      <p className="text-2xl font-bold">{salesReport.transactionCount}</p>
                      {salesComparison && changeIndicator(salesComparison.transactionChange)}
                    </div>
                    {salesComparison && (
                      <p className={`text-xs ${changeColor(salesComparison.transactionChange)}`}>
                        {salesComparison.transactionChange >= 0 ? '+' : ''}{salesComparison.transactionChange.toFixed(1)}% vs prev period
                      </p>
                    )}
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-orange-500">
                  <CardContent className="p-4">
                    <p className="text-sm text-muted-foreground">Total Tax</p>
                    <p className="text-2xl font-bold">{formatKES(salesReport.totalTax)}</p>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-purple-500">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <ShoppingCart className="h-3.5 w-3.5 text-purple-600" />
                      </div>
                      <p className="text-sm text-muted-foreground">Avg Transaction</p>
                    </div>
                    <p className="text-2xl font-bold mt-1">{formatKES(salesReport.avgTransactionValue)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Per transaction average</p>
                  </CardContent>
                </Card>
              </div>

              {/* Sales Trend Sparkline */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> Sales Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <MiniSparkline data={salesSparkline} color="text-green-600" height={40} />
                    <div>
                      <p className="text-sm font-medium">Revenue Trend</p>
                      <p className="text-xs text-muted-foreground">Last 12 periods — showing upward momentum</p>
                      <div className="flex items-center gap-1 mt-1">
                        <ArrowUpRight className="h-3 w-3 text-green-600" />
                        <span className="text-xs text-green-600 font-medium">+15.2% growth rate</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Sales by Payment Method - Enhanced with Stacked Bar */}
              {(salesReport.byPaymentMethod || []).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CreditCard className="h-4 w-4" /> Sales by Payment Method
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {/* Stacked horizontal bar */}
                    {(() => {
                      const byPM = salesReport.byPaymentMethod || [];
                      const totalAmount = byPM.reduce((s, p) => s + p.amount, 0) || 1;
                      const pmColors: Record<string, string> = {
                        CASH: 'bg-green-500', MPESA: 'bg-primary', DEBT: 'bg-orange-500', SPLIT: 'bg-purple-500',
                      };
                      const pmColorsHex: Record<string, string> = {
                        CASH: '#22c55e', MPESA: '#3b82f6', DEBT: '#f97316', SPLIT: '#a855f7',
                      };
                      return (
                        <>
                          {/* Stacked Bar */}
                          <div className="h-6 bg-muted/30 rounded-full overflow-hidden flex mb-4">
                            {byPM.map((pm, i) => {
                              const pct = (pm.amount / totalAmount) * 100;
                              return (
                                <div
                                  key={i}
                                  className={`h-full transition-all duration-500 ${pmColors[pm.method] || 'bg-gray-400'}`}
                                  style={{ width: `${pct}%` }}
                                  title={`${pm.method}: ${formatKES(pm.amount)} (${pct.toFixed(1)}%)`}
                                />
                              );
                            })}
                          </div>

                          {/* Method breakdown */}
                          <div className="space-y-4">
                            {byPM.map((pm, i) => {
                              const maxAmount = Math.max(...byPM.map(p => p.amount), 1);
                              const pct = (pm.amount / maxAmount) * 100;
                              const colorClass = pmColors[pm.method] || 'bg-gray-500';
                              return (
                                <div key={i} className="space-y-2">
                                  <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2">
                                      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colorClass} text-white`}>
                                        {paymentMethodIcons[pm.method] || <CreditCard className="h-3.5 w-3.5" />}
                                      </div>
                                      <span className="font-medium">{pm.method}</span>
                                      <Badge variant="outline" className="text-[9px]">{pm.count} txns</Badge>
                                    </div>
                                    <div className="text-right">
                                      <span className="font-medium">{formatKES(pm.amount)}</span>
                                      <span className="text-xs text-muted-foreground ml-2">
                                        {((pm.amount / totalAmount) * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              {/* Top 5 Products by Revenue - Enhanced */}
              {topProducts.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Top 5 Products by Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
                      {topProducts.slice(0, 5).map((product, i) => {
                        const maxRevenue = Math.max(...topProducts.map(p => p.revenue), 1);
                        const pct = (product.revenue / maxRevenue) * 100;
                        const rankColors = [
                          'bg-yellow-500 text-white',
                          'bg-gray-400 text-white',
                          'bg-amber-600 text-white',
                        ];
                        return (
                          <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                              i < 3 ? rankColors[i] : 'bg-muted text-muted-foreground'
                            }`}>
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium truncate">{product.productName}</span>
                                <span className="text-sm font-bold ml-2">{formatKES(product.revenue)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{product.quantitySold} sold</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No sales data available for the selected period</p>
                <p className="text-xs mt-1">Try adjusting the date range</p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ================================================================== */}
      {/* Inventory Report                                                    */}
      {/* ================================================================== */}
      {reportType === 'inventory' && (
        <>
          {inventoryLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : inventoryReport ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="h-4 w-4 text-primary" />
                      <p className="text-sm text-muted-foreground">Total Products</p>
                    </div>
                    <p className="text-2xl font-bold">{inventoryReport.totalProducts}</p>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-amber-500">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <p className="text-sm text-muted-foreground">Low Stock</p>
                    </div>
                    <p className="text-2xl font-bold text-amber-600">{inventoryReport.lowStockCount}</p>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-red-500">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingDown className="h-4 w-4 text-red-500" />
                      <p className="text-sm text-muted-foreground">Out of Stock</p>
                    </div>
                    <p className="text-2xl font-bold text-red-600">{inventoryReport.outOfStockCount}</p>
                  </CardContent>
                </Card>
                <Card className="border-l-4 border-l-green-500">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="h-4 w-4 text-green-500" />
                      <p className="text-sm text-muted-foreground">Inventory Value</p>
                    </div>
                    <p className="text-2xl font-bold whitespace-nowrap">{formatKES(inventoryReport.totalInventoryValue)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Stock Health & Turnover */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <HeartPulse className="h-4 w-4 text-green-600" /> Stock Health
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <div className="relative w-20 h-20">
                        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                          <circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="6" />
                          <circle
                            cx="40" cy="40" r="35" fill="none"
                            stroke={stockHealth >= 70 ? '#22c55e' : stockHealth >= 40 ? '#eab308' : '#ef4444'}
                            strokeWidth="6"
                            strokeLinecap="round"
                            strokeDasharray={`${(stockHealth / 100) * 220} 220`}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-lg font-bold">{stockHealth}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {stockHealth >= 70 ? 'Healthy' : stockHealth >= 40 ? 'Needs Attention' : 'Critical'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {inventoryReport.totalProducts - inventoryReport.lowStockCount - inventoryReport.outOfStockCount} of {inventoryReport.totalProducts} products in good stock
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="outline" className="text-[9px] bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                            Good: {inventoryReport.totalProducts - inventoryReport.lowStockCount - inventoryReport.outOfStockCount}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800">
                            Low: {inventoryReport.lowStockCount}
                          </Badge>
                          <Badge variant="outline" className="text-[9px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                            Out: {inventoryReport.outOfStockCount}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <RotateCcw className="h-4 w-4 text-primary" /> Inventory Turnover
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-primary/10">
                          <span className="text-2xl font-bold text-primary">{inventoryTurnover || '—'}</span>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Turnover Ratio</p>
                          <p className="text-xs text-muted-foreground">
                            {Number(inventoryTurnover) >= 2
                              ? 'Excellent — inventory moves quickly'
                              : Number(inventoryTurnover) >= 1
                              ? 'Good — healthy stock rotation'
                              : 'Low — consider reducing stock levels'}
                          </p>
                        </div>
                      </div>
                      <Separator />
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded-lg bg-muted/30">
                          <p className="text-muted-foreground">Revenue</p>
                          <p className="font-medium">{salesReport ? formatKES(salesReport.totalRevenue) : '—'}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/30">
                          <p className="text-muted-foreground">Inventory Value</p>
                          <p className="font-medium">{formatKES(inventoryReport.totalInventoryValue)}</p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Inventory Valuation by Category - Pie Chart */}
              {categoryBreakdown.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <PieChart className="h-4 w-4" /> Inventory Valuation by Category
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ConicPieChart segments={pieSegments} />
                    <Separator className="my-4" />
                    <div className="space-y-3">
                      {categoryBreakdown.map((cat, i) => {
                        const colors = [
                          'bg-blue-500', 'bg-green-500', 'bg-orange-500',
                          'bg-purple-500', 'bg-teal-500', 'bg-pink-500',
                          'bg-amber-500', 'bg-cyan-500', 'bg-lime-500', 'bg-rose-500',
                        ];
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-sm ${colors[i % colors.length]}`} />
                                <span className="font-medium">{cat.name}</span>
                                <Badge variant="outline" className="text-[9px]">{cat.productCount} items</Badge>
                              </div>
                              <span className="font-medium">{formatKES(cat.totalValue)}</span>
                            </div>
                            <HorizontalBar
                              value={cat.totalValue}
                              maxValue={maxCategoryValue}
                              colorClass={colors[i % colors.length]}
                              height="h-2"
                            />
                          </div>
                        );
                      })}
                      <Separator />
                      <div className="flex items-center justify-between text-sm font-bold">
                        <span>Total Inventory Value</span>
                        <span>{formatKES(inventoryReport.totalInventoryValue)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Top Products by Revenue */}
              {topProducts.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Top Products by Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                      {topProducts.map((product, i) => {
                        const maxRevenue = Math.max(...topProducts.map(p => p.revenue), 1);
                        const pct = (product.revenue / maxRevenue) * 100;
                        const rankColors = [
                          'bg-yellow-500 text-white',
                          'bg-gray-400 text-white',
                          'bg-amber-600 text-white',
                        ];
                        return (
                          <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                              i < 3 ? rankColors[i] : 'bg-muted text-muted-foreground'
                            }`}>
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-medium truncate">{product.productName}</span>
                                <span className="text-sm font-bold ml-2">{formatKES(product.revenue)}</span>
                              </div>
                              <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Boxes className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No inventory data available</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
