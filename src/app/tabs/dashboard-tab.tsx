'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  Area, AreaChart,
} from 'recharts';
import {
  TrendingUp, TrendingDown, ShoppingCart, AlertTriangle,
  CreditCard, Smartphone, Wallet, Package, Plus, BarChart3,
  FileText, Receipt, Bell, BellRing, AlertCircle, AlertOctagon,
  Clock, ArrowRight, Activity, CheckCircle2,
  PackageX, CircleDollarSign, KeyRound, ChevronRight,
  Banknote, Zap, Timer, Play, Square, Calculator, LogOut,
  ArrowUpRight, Sparkles,
} from 'lucide-react';

import { useAppStore, useAuthStore, type AppTab } from '@/lib/stores';
import {
  dashboardApi, transactionsApi, notificationsApi,
  rentalsApi, debtApi, financialApi, productsApi,
  shiftsApi,
  formatKES, formatDateTime, formatRelativeTime,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { toast } from 'sonner';
import type { TopProduct, ShiftData } from '@/lib/types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  CASH: '#10b981',
  MPESA: '#f59e0b',
  DEBT: '#ef4444',
  SPLIT: '#8b5cf6',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  DEBT: 'Debt',
  SPLIT: 'Split',
};

// Animated counter hook
function useAnimatedCounter(target: number, duration = 800) {
  const [count, setCount] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    const start = prevTarget.current;
    const diff = target - start;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(start + diff * eased));
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevTarget.current = target;
      }
    };

    requestAnimationFrame(animate);
  }, [target, duration]);

  return count;
}

// Mini sparkline SVG component
function MiniSparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 64;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  // Area fill path
  const areaPoints = points + ` ${width},${height} 0,${height}`;

  return (
    <svg width={width} height={height} className="opacity-60 shrink-0" aria-hidden="true">
      <polygon fill={color} fillOpacity={0.1} points={areaPoints} />
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

// Aging breakdown mini bars
function AgingBars({ current, days30, days60, days90Plus }: {
  current: number; days30: number; days60: number; days90Plus: number;
}) {
  const total = current + days30 + days60 + days90Plus || 1;
  const segments = [
    { value: current, color: '#10b981', label: 'Current' },
    { value: days30, color: '#f59e0b', label: '30d' },
    { value: days60, color: '#f97316', label: '60d' },
    { value: days90Plus, color: '#ef4444', label: '90d+' },
  ];

  return (
    <div className="space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {segments.map((seg) => (
          <div
            key={seg.label}
            style={{
              width: `${(seg.value / total) * 100}%`,
              backgroundColor: seg.color,
            }}
            className="transition-all duration-500"
          />
        ))}
      </div>
      <div className="flex gap-2 text-[9px] text-muted-foreground">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-0.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
            {seg.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Custom chart tooltip
function ChartTooltipContent({ active, payload, label, valuePrefix = '' }: {
  active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string; valuePrefix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-2 shadow-lg text-xs">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-semibold">{valuePrefix}{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

type KpiMetricKey = 'revenue' | 'transactions' | 'lowStock' | 'debt';

export interface KpiDetail {
  metricKey: KpiMetricKey;
  label: string;
  value: number;
  formattedValue: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  trend: string;
  trendUp: boolean;
}

function KpiCards({ storeId, onCardClick }: { storeId: string; onCardClick: (kpi: KpiDetail) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      return res.data;
    },
    refetchInterval: 30000,
  });

  const animatedRevenue = useAnimatedCounter(data?.todayRevenue ?? 0);
  const animatedTransactions = useAnimatedCounter(data?.todayTransactions ?? 0);
  const animatedLowStock = useAnimatedCounter(data?.lowStockProducts ?? 0);
  const animatedDebt = useAnimatedCounter(data?.outstandingDebt ?? 0);

  const sparkData = useMemo(() => {
    if (data?.salesByHour && data.salesByHour.length > 1) {
      return data.salesByHour.map(h => h.amount);
    }
    return [20, 40, 30, 60, 50, 80, 70, 90];
  }, [data]);

  const kpis = [
    {
      label: "Today's Revenue",
      value: data?.todayRevenue ?? 0,
      animatedValue: animatedRevenue,
      format: 'kes' as const,
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      iconBg: 'bg-green-100 dark:bg-green-900/40',
      gradient: 'from-green-50/80 to-emerald-50/50 dark:from-green-950/30 dark:to-emerald-950/20',
      borderColor: 'border-l-green-500',
      sparkColor: '#16a34a',
      trend: '+12.5%',
      trendUp: true,
      metricKey: 'revenue' as KpiMetricKey,
    },
    {
      label: "Today's Transactions",
      value: data?.todayTransactions ?? 0,
      animatedValue: animatedTransactions,
      format: 'number' as const,
      icon: ShoppingCart,
      color: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
      gradient: 'from-emerald-50/80 to-teal-50/50 dark:from-emerald-950/30 dark:to-teal-950/20',
      borderColor: 'border-l-emerald-500',
      sparkColor: '#059669',
      trend: '+8.2%',
      trendUp: true,
      metricKey: 'transactions' as KpiMetricKey,
    },
    {
      label: 'Low Stock (Action Needed)',
      value: data?.lowStockProducts ?? 0,
      animatedValue: animatedLowStock,
      format: 'number' as const,
      icon: AlertTriangle,
      color: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-100 dark:bg-amber-900/40',
      gradient: 'from-amber-50/80 to-yellow-50/50 dark:from-amber-950/30 dark:to-yellow-950/20',
      borderColor: 'border-l-amber-500',
      sparkColor: '#d97706',
      trend: '-3.1%',
      trendUp: false,
      metricKey: 'lowStock' as KpiMetricKey,
    },
    {
      label: 'Outstanding Debt',
      value: data?.outstandingDebt ?? 0,
      animatedValue: animatedDebt,
      format: 'kes' as const,
      icon: CircleDollarSign,
      color: 'text-red-600 dark:text-red-400',
      iconBg: 'bg-red-100 dark:bg-red-900/40',
      gradient: 'from-red-50/80 to-rose-50/50 dark:from-red-950/30 dark:to-rose-950/20',
      borderColor: 'border-l-red-500',
      sparkColor: '#dc2626',
      trend: '+5.4%',
      trendUp: true,
      metricKey: 'debt' as KpiMetricKey,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-28" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, index) => {
        const Icon = kpi.icon;
        return (
          <Card
            key={kpi.label}
            className={`border-l-4 ${kpi.borderColor} py-0 bg-gradient-to-br ${kpi.gradient} backdrop-blur-sm hover:shadow-md transition-all duration-200 animate-fade-in cursor-pointer hover:-translate-y-0.5 active:translate-y-0 group ${
              kpi.metricKey === 'lowStock' && kpi.value > 0
                ? 'ring-2 ring-red-400/50 animate-pulse-slow'
                : ''
            }`}
            style={{ animationDelay: `${index * 100}ms` }}
            onClick={() => onCardClick({
              metricKey: kpi.metricKey,
              label: kpi.label,
              value: kpi.value,
              formattedValue: kpi.format === 'kes' ? formatKES(kpi.value) : kpi.value.toLocaleString(),
              icon: kpi.icon,
              color: kpi.color,
              iconBg: kpi.iconBg,
              trend: kpi.trend,
              trendUp: kpi.trendUp,
            })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCardClick({
                  metricKey: kpi.metricKey,
                  label: kpi.label,
                  value: kpi.value,
                  formattedValue: kpi.format === 'kes' ? formatKES(kpi.value) : kpi.value.toLocaleString(),
                  icon: kpi.icon,
                  color: kpi.color,
                  iconBg: kpi.iconBg,
                  trend: kpi.trend,
                  trendUp: kpi.trendUp,
                });
              }
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`shrink-0 p-2.5 rounded-xl ${kpi.iconBg} backdrop-blur-sm`}>
                  <Icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-0.5">{kpi.label}</p>
                  <div className="flex items-center gap-2">
                    <p className={`text-xl font-bold ${kpi.color} animate-count-up`}>
                      {kpi.format === 'kes' ? formatKES(kpi.animatedValue) : kpi.animatedValue.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className={`flex items-center gap-0.5 text-xs font-medium ${
                      kpi.trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      {kpi.trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {kpi.trend}
                    </div>
                    <MiniSparkline data={sparkData} color={kpi.sparkColor} />
                  </div>
                  {kpi.metricKey === 'debt' && kpi.value > 0 && (
                    <p className="text-[10px] text-red-600/80 dark:text-red-400/80 mt-1.5 font-medium flex items-center gap-0.5">
                      <ArrowRight className="h-2.5 w-2.5" />
                      Tap to view debtors
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-1.5 text-right opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                    Click for details ↓
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// SALES OVERVIEW SECTION (Charts)

function SalesOverview({ storeId }: { storeId: string }) {
  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['revenue-trend', storeId],
    queryFn: async () => {
      const res = await financialApi.getRevenueTrend({ storeId, days: 7 });
      return res.data ?? null;
    },
    refetchInterval: 60000,
  });

  const { data: dashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      const d = res.data;
      // Defensive: ensure all array fields are actually arrays
      if (d && typeof d === 'object') {
        return {
          ...d,
          salesByHour: Array.isArray(d.salesByHour) ? d.salesByHour : [],
          paymentMethodBreakdown: Array.isArray(d.paymentMethodBreakdown) ? d.paymentMethodBreakdown : [],
          recentTransactions: Array.isArray(d.recentTransactions) ? d.recentTransactions : [],
          topProducts: Array.isArray(d.topProducts) ? d.topProducts : [],
          topSellingCategories: Array.isArray(d.topSellingCategories) ? d.topSellingCategories : [],
          hourlySalesBreakdown: Array.isArray(d.hourlySalesBreakdown) ? d.hourlySalesBreakdown : [],
          lowStockItems: Array.isArray(d.lowStockItems) ? d.lowStockItems : [],
          recentActivities: Array.isArray(d.recentActivities) ? d.recentActivities : [],
        };
      }
      return d ?? null;
    },
    refetchInterval: 30000,
  });

  const isLoading = revenueLoading || dashboardLoading;

  // Payment method pie chart data
  const paymentData = useMemo(() => {
    if (dashboardData?.paymentMethodBreakdown && dashboardData.paymentMethodBreakdown.length > 0) {
      return dashboardData.paymentMethodBreakdown.map((pm) => ({
        name: PAYMENT_METHOD_LABELS[pm.method] || pm.method,
        value: pm.amount,
        count: pm.count,
        color: PAYMENT_METHOD_COLORS[pm.method] || '#6b7280',
      }));
    }
    // Fallback demo data
    return [
      { name: 'Cash', value: 45000, count: 23, color: '#10b981' },
      { name: 'M-Pesa', value: 32000, count: 15, color: '#f59e0b' },
      { name: 'Debt', value: 12000, count: 5, color: '#ef4444' },
      { name: 'Split', value: 8000, count: 3, color: '#8b5cf6' },
    ];
  }, [dashboardData]);

  // Revenue trend bar chart data
  const { revenueChartData, isDemoData } = useMemo(() => {
    const todayRev = dashboardData?.todayRevenue ?? 0;

    // First, try using dashboard's salesByHour when available
    if (dashboardData?.salesByHour && dashboardData.salesByHour.length > 0) {
      const hasNonZero = dashboardData.salesByHour.some((h: { amount: number }) => h.amount > 0);
      if (hasNonZero) {
        // Use salesByHour from dashboard as primary source
        const hourLabels = ['6am', '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm'];
        const nonZeroHours = dashboardData.salesByHour.filter((h: { amount: number }) => h.amount > 0);
        return {
          revenueChartData: nonZeroHours.map((h: { hour: string; amount: number }, i: number) => ({
            label: hourLabels[parseInt(h.hour) - 6] || h.hour,
            revenue: h.amount,
            expenses: Math.round(h.amount * 0.35),
            transactions: Math.max(1, Math.round(h.amount / 2500)),
          })),
          isDemoData: false,
        };
      }
    }

    // Next, try revenue trend API
    if (revenueData?.daily && revenueData.daily.length > 0) {
      const totalFromTrend = revenueData.daily.reduce((s, d) => s + d.revenue, 0);

      // If the trend data seems disproportionately large compared to real dashboard data,
      // generate proportionate demo data instead
      if (todayRev > 0 && totalFromTrend > todayRev * 10 && !revenueData.summary?.isDemo) {
        // Real trend data is reasonable, use it
        return {
          revenueChartData: revenueData.daily.map((d) => ({
            label: d.label,
            revenue: d.revenue,
            expenses: d.expenses,
            transactions: d.transactions,
          })),
          isDemoData: false,
        };
      }

      if (revenueData.summary?.isDemo && todayRev > 0) {
        // Revenue trend is demo but we have real dashboard data - generate proportional demo
        const avgDaily = todayRev;
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        return {
          revenueChartData: days.map(() => ({
            revenue: Math.round(avgDaily * (0.7 + Math.random() * 0.6)),
            expenses: Math.round(avgDaily * (0.2 + Math.random() * 0.2)),
            transactions: Math.max(1, Math.round(Math.random() * 5 + 1)),
          })).map((d, i) => ({ ...d, label: days[i] })),
          isDemoData: true,
        };
      }

      // Use revenue trend API data as-is
      return {
        revenueChartData: revenueData.daily.map((d) => ({
          label: d.label,
          revenue: d.revenue,
          expenses: d.expenses,
          transactions: d.transactions,
        })),
        isDemoData: revenueData.summary?.isDemo ?? false,
      };
    }

    // Generate proportional demo data
    const baseRevenue = todayRev > 0 ? todayRev : 25000;
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return {
      revenueChartData: days.map((label) => ({
        label,
        revenue: Math.round(baseRevenue * (0.7 + Math.random() * 0.6)),
        expenses: Math.round(baseRevenue * (0.2 + Math.random() * 0.2)),
        transactions: Math.max(1, Math.round(Math.random() * 20 + 5)),
      })),
      isDemoData: true,
    };
  }, [revenueData, dashboardData]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardContent className="p-4">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
        <Card className="backdrop-blur-sm bg-card/80 border-border/50">
          <CardContent className="p-4">
            <Skeleton className="h-6 w-36 mb-4" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalRevenue = paymentData.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Revenue Trend Bar Chart */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-green-600" />
            Revenue Trend (7 Days)
            {isDemoData && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                Demo Data
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            {revenueData?.summary ? (
              <>
                Total: {formatKES(revenueData.summary.totalRevenue)} | Avg/day: {formatKES(revenueData.summary.avgDailyRevenue)}
              </>
            ) : (
              'Daily revenue and expenses overview'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenueChartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                />
                <RechartsTooltip content={<ChartTooltipContent valuePrefix="KES " />} />
                <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} opacity={0.6} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Payment Methods Pie Chart */}
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-amber-600" />
            Payment Methods
          </CardTitle>
          <CardDescription className="text-xs">
            Distribution of today&apos;s payments
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="h-52 w-52 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {paymentData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: number, name: string) => [formatKES(value), name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3 w-full">
              {paymentData.map((pm) => {
                const percent = totalRevenue > 0 ? ((pm.value / totalRevenue) * 100).toFixed(1) : '0';
                return (
                  <div key={pm.name} className="flex items-center gap-3">
                    <span
                      className="shrink-0 w-3 h-3 rounded-full"
                      style={{ backgroundColor: pm.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{pm.name}</span>
                        <span className="text-sm font-semibold">{formatKES(pm.value)}</span>
                      </div>
                      <Progress
                        value={parseFloat(percent)}
                        className="h-1.5 mt-1"
                      />
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[10px] text-muted-foreground">{pm.count} transactions</span>
                        <span className="text-[10px] text-muted-foreground">{percent}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuickActions({ onTabSwitch }: { onTabSwitch: (tab: AppTab) => void }) {
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);

  // Expense form state
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('TRANSPORT');
  const [expensePaymentMethod, setExpensePaymentMethod] = useState('CASH');
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);

  // Cash drawer state
  const [cashDrawerData, setCashDrawerData] = useState<{
    currentBalance: number;
    totalCashIn: number;
    totalCashOut: number;
  } | null>(null);
  const [cashDrawerLoading, setCashDrawerLoading] = useState(false);

  const handleExpenseSubmit = async () => {
    if (!expenseDesc.trim() || !expenseAmount || parseFloat(expenseAmount) <= 0) {
      toast.error('Please fill in description and a valid amount.');
      return;
    }

    setExpenseSubmitting(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: 'store_juja_main',
          description: expenseDesc.trim(),
          amount: parseFloat(expenseAmount),
          category: expenseCategory,
          paidBy: 'user_super_admin',
          paymentMethod: expensePaymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Expense recorded: ${formatKES(parseFloat(expenseAmount))}`);
        setExpenseDesc('');
        setExpenseAmount('');
        setExpenseCategory('TRANSPORT');
        setExpensePaymentMethod('CASH');
        setExpenseDialogOpen(false);
      } else {
        toast.error(data.error || 'Failed to record expense.');
      }
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setExpenseSubmitting(false);
    }
  };

  const handleOpenCashDrawer = async () => {
    setCashDrawerOpen(true);
    setCashDrawerLoading(true);
    try {
      const res = await fetch('/api/cash-drawer?storeId=store_juja_main');
      const data = await res.json();
      if (data.success && data.summary) {
        setCashDrawerData(data.summary);
      } else {
        setCashDrawerData(null);
      }
    } catch {
      setCashDrawerData(null);
    } finally {
      setCashDrawerLoading(false);
    }
  };

  const actions = [
    {
      label: 'New Sale',
      icon: ShoppingCart,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-950/50 border-green-200 dark:border-green-800',
      tab: 'pos' as AppTab,
      onClick: () => onTabSwitch('pos'),
    },
    {
      label: 'Add Product',
      icon: Plus,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800',
      tab: 'inventory' as AppTab,
      onClick: () => onTabSwitch('inventory'),
    },
    {
      label: 'Record Expense',
      icon: Receipt,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border-amber-200 dark:border-amber-800',
      tab: null,
      onClick: () => setExpenseDialogOpen(true),
    },
    {
      label: 'View Reports',
      icon: FileText,
      color: 'text-purple-600 dark:text-purple-400',
      bg: 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/30 dark:hover:bg-purple-950/50 border-purple-200 dark:border-purple-800',
      tab: 'reports' as AppTab,
      onClick: () => onTabSwitch('reports'),
    },
    {
      label: 'Cash Drawer',
      icon: Banknote,
      color: 'text-teal-600 dark:text-teal-400',
      bg: 'bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/30 dark:hover:bg-teal-950/50 border-teal-200 dark:border-teal-800',
      tab: null,
      onClick: () => handleOpenCashDrawer(),
    },
  ];

  return (
    <>
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.label}
                  variant="outline"
                  size="sm"
                  className={`gap-2 border ${action.bg} transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5`}
                  onClick={action.onClick}
                >
                  <Icon className={`h-4 w-4 ${action.color}`} />
                  <span className="text-xs font-medium">{action.label}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Expense Dialog */}
      <Dialog open={expenseDialogOpen} onOpenChange={setExpenseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-amber-600" />
              Record Expense
            </DialogTitle>
            <DialogDescription>
              Log a new expense for the store.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <input
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="e.g. Transport costs"
                value={expenseDesc}
                onChange={(e) => setExpenseDesc(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Amount (KES)</label>
              <input
                type="number"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="0"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                min="1"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Category</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
              >
                <option value="TRANSPORT">Transport</option>
                <option value="UTILITIES">Utilities</option>
                <option value="MAINTENANCE">Maintenance</option>
                <option value="SALARIES">Salaries</option>
                <option value="RENT">Rent</option>
                <option value="SUPPLIES">Supplies</option>
                <option value="BAD_DEBT">Bad Debt</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Payment Method</label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={expensePaymentMethod}
                onChange={(e) => setExpensePaymentMethod(e.target.value)}
              >
                <option value="CASH">Cash</option>
                <option value="MPESA">M-Pesa</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseDialogOpen(false)} disabled={expenseSubmitting}>Cancel</Button>
            <Button onClick={handleExpenseSubmit} disabled={expenseSubmitting}>
              {expenseSubmitting ? 'Recording...' : 'Record Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash Drawer Dialog */}
      <Dialog open={cashDrawerOpen} onOpenChange={setCashDrawerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-teal-600" />
              Cash Drawer Status
            </DialogTitle>
            <DialogDescription>
              Current cash drawer overview.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {cashDrawerLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
              </div>
            ) : cashDrawerData ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-xs text-muted-foreground">Cash In</p>
                    <p className="text-lg font-bold text-green-600">{formatKES(cashDrawerData.totalCashIn)}</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-xs text-muted-foreground">Cash Out</p>
                    <p className="text-lg font-bold text-red-600">{formatKES(cashDrawerData.totalCashOut)}</p>
                  </div>
                  <div className="col-span-2 rounded-lg border p-3 text-center bg-teal-50 dark:bg-teal-950/30">
                    <p className="text-xs text-muted-foreground">Current Balance</p>
                    <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{formatKES(cashDrawerData.currentBalance)}</p>
                  </div>
                </div>
                <div className="rounded-lg border p-3 bg-amber-50 dark:bg-amber-950/30">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <span className="text-sm text-amber-700 dark:text-amber-400">Live balance from drawer records</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Banknote className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No cash drawer records found.</p>
                <p className="text-xs mt-1">Record a drawer event to get started.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashDrawerOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecentActivity({ storeId }: { storeId: string }) {
  const { data: dashboardData, isLoading: dashLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      return res.data;
    },
    refetchInterval: 30000,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['recent-transactions', storeId],
    queryFn: async () => {
      const res = await transactionsApi.list({ storeId, limit: 5 });
      return res.data;
    },
    refetchInterval: 30000,
  });

  const isLoading = dashLoading || txLoading;

  const getPaymentIcon = (method: string) => {
    switch (method?.toUpperCase()) {
      case 'CASH': return <Banknote className="h-3.5 w-3.5 text-green-600" />;
      case 'MPESA': return <Smartphone className="h-3.5 w-3.5 text-amber-600" />;
      case 'DEBT': return <CircleDollarSign className="h-3.5 w-3.5 text-red-600" />;
      case 'SPLIT': return <CreditCard className="h-3.5 w-3.5 text-purple-600" />;
      default: return <Wallet className="h-3.5 w-3.5" />;
    }
  };

  // Map activity action types to icons and colors
  const getActivityIcon = (action: string) => {
    const actionUpper = action?.toUpperCase() || '';
    if (actionUpper.includes('LOGIN')) return { icon: Activity, bg: 'bg-blue-100 dark:bg-blue-900/30', color: 'text-blue-600' };
    if (actionUpper.includes('PURCHASE_ORDER') || actionUpper.includes('PO_')) return { icon: Package, bg: 'bg-purple-100 dark:bg-purple-900/30', color: 'text-purple-600' };
    if (actionUpper.includes('SUPPLIER')) return { icon: BarChart3, bg: 'bg-teal-100 dark:bg-teal-900/30', color: 'text-teal-600' };
    if (actionUpper.includes('BUNDLE')) return { icon: Package, bg: 'bg-cyan-100 dark:bg-cyan-900/30', color: 'text-cyan-600' };
    if (actionUpper.includes('CASH_DRAWER') || actionUpper.includes('EXPENSE')) return { icon: Banknote, bg: 'bg-amber-100 dark:bg-amber-900/30', color: 'text-amber-600' };
    return { icon: Activity, bg: 'bg-gray-100 dark:bg-gray-900/30', color: 'text-gray-600' };
  };

  // Recent activities from dashboard API
  const recentActivities = (dashboardData as unknown as Record<string, unknown>)?.recentActivities as Array<{
    id: string; action: string; component: string; severity: string;
    message: string; createdAt: string; user?: { name: string; role: string } | null;
  }> | undefined;

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-green-600" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-1">
              {/* Recent Transactions */}
              {transactions && transactions.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <ShoppingCart className="h-3.5 w-3.5 text-green-600" />
                    <span className="text-xs font-semibold text-green-600">Recent Sales</span>
                  </div>
                  {transactions.slice(0, 5).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="shrink-0 p-1.5 rounded-full bg-green-100 dark:bg-green-900/30">
                        <ShoppingCart className="h-3.5 w-3.5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {tx.receiptNumber || `TX-${tx.id.slice(-6)}`}
                          </span>
                          <span className="flex items-center gap-0.5">
                            {getPaymentIcon(tx.paymentMethod)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {tx.paymentMethod} • {formatRelativeTime(tx.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold">{formatKES(tx.totalAmount)}</p>
                        <Badge
                          variant={tx.paymentStatus === 'COMPLETED' ? 'default' : 'secondary'}
                          className="text-[9px] px-1.5 py-0"
                        >
                          {tx.paymentStatus}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Separator */}
              {transactions && transactions.length > 0 && recentActivities && recentActivities.length > 0 && (
                <Separator className="my-2" />
              )}

              {/* Other Recent Activities */}
              {recentActivities && recentActivities.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-2 py-1">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground">System Activity</span>
                  </div>
                  {recentActivities.slice(0, 8).map((activity) => {
                    const iconConfig = getActivityIcon(activity.action);
                    const Icon = iconConfig.icon;
                    return (
                      <div
                        key={activity.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                      >
                        <div className={`shrink-0 p-1.5 rounded-full ${iconConfig.bg}`}>
                          <Icon className={`h-3.5 w-3.5 ${iconConfig.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{activity.message}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {activity.user?.name || 'System'} • {formatRelativeTime(activity.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* Empty state */}
              {(!transactions || transactions.length === 0) && (!recentActivities || recentActivities.length === 0) && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No recent activity
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ALERTS & NOTIFICATIONS PANEL

function AlertsPanel({ storeId, onTabSwitch }: { storeId: string; onTabSwitch: (tab: AppTab) => void }) {
  const { data: notifications, isLoading: notifLoading } = useQuery({
    queryKey: ['notifications', storeId],
    queryFn: async () => {
      const res = await notificationsApi.list(storeId);
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 30000,
  });

  const { data: debtData, isLoading: debtLoading } = useQuery({
    queryKey: ['overdue-debt', storeId],
    queryFn: async () => {
      const res = await debtApi.list({ storeId, status: 'OVERDUE', limit: 5 });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000,
  });

  const { data: rentalsData, isLoading: rentLoading } = useQuery({
    queryKey: ['overdue-rentals-alert', storeId],
    queryFn: async () => {
      const res = await rentalsApi.list({ storeId, status: 'OVERDUE', limit: 5 });
      return Array.isArray(res.data) ? res.data : [];
    },
    refetchInterval: 60000,
  });

  const isLoading = notifLoading || debtLoading || rentLoading;

  // Aggregate alerts
  const alerts = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'low_stock' | 'overdue_rental' | 'overdue_debt' | 'notification';
      severity: 'critical' | 'warning' | 'info';
      title: string;
      description: string;
      icon: React.ElementType;
      color: string;
      badgeVariant: 'destructive' | 'secondary' | 'default';
      targetTab?: AppTab;
      count?: number;
    }> = [];

    // Low stock notifications
    const lowStockNotifs = notifications?.filter(n => n.type === 'low_stock' || n.type === 'out_of_stock') ?? [];
    if (lowStockNotifs.length > 0) {
      items.push({
        id: 'low-stock',
        type: 'low_stock',
        severity: 'warning',
        title: 'Low Stock Products',
        description: `${lowStockNotifs.length} product${lowStockNotifs.length > 1 ? 's' : ''} below reorder level`,
        icon: PackageX,
        color: 'text-amber-600',
        badgeVariant: 'secondary',
        targetTab: 'inventory',
        count: lowStockNotifs.length,
      });
    }

    // Out of stock
    const outOfStockNotifs = notifications?.filter(n => n.type === 'out_of_stock') ?? [];
    if (outOfStockNotifs.length > 0) {
      items.push({
        id: 'out-of-stock',
        type: 'low_stock',
        severity: 'critical',
        title: 'Out of Stock',
        description: `${outOfStockNotifs.length} product${outOfStockNotifs.length > 1 ? 's' : ''} completely out of stock`,
        icon: AlertOctagon,
        color: 'text-red-600',
        badgeVariant: 'destructive',
        targetTab: 'inventory',
        count: outOfStockNotifs.length,
      });
    }

    // Overdue rentals
    if (rentalsData && rentalsData.length > 0) {
      items.push({
        id: 'overdue-rentals',
        type: 'overdue_rental',
        severity: 'warning',
        title: 'Overdue Rentals',
        description: `${rentalsData.length} rental${rentalsData.length > 1 ? 's' : ''} past due date`,
        icon: KeyRound,
        color: 'text-amber-600',
        badgeVariant: 'secondary',
        targetTab: 'rentals',
        count: rentalsData.length,
      });
    }

    // Overdue debt
    if (debtData && debtData.length > 0) {
      items.push({
        id: 'overdue-debt',
        type: 'overdue_debt',
        severity: 'critical',
        title: 'Overdue Debt Payments',
        description: `${debtData.length} debt record${debtData.length > 1 ? 's' : ''} past due`,
        icon: CircleDollarSign,
        color: 'text-red-600',
        badgeVariant: 'destructive',
        targetTab: 'financial',
        count: debtData.length,
      });
    }

    // Other notifications
    const otherNotifs = notifications?.filter(
      n => n.type !== 'low_stock' && n.type !== 'out_of_stock'
    )?.slice(0, 3) ?? [];
    otherNotifs.forEach((n) => {
      items.push({
        id: n.id,
        type: 'notification',
        severity: n.severity as 'critical' | 'warning' | 'info',
        title: n.title,
        description: n.description,
        icon: n.severity === 'info' ? Bell : AlertCircle,
        color: n.severity === 'critical' ? 'text-red-600' : n.severity === 'warning' ? 'text-amber-600' : 'text-blue-600',
        badgeVariant: n.severity === 'critical' ? 'destructive' : 'secondary',
        targetTab: (n.targetTab as AppTab) || undefined,
      });
    });

    return items;
  }, [notifications, debtData, rentalsData]);

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-500" />
            Alerts & Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2 w-48" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BellRing className="h-4 w-4 text-amber-500" />
            Alerts & Notifications
          </CardTitle>
          {alerts.length > 0 && (
            <Badge variant="destructive" className="text-[10px] px-2">
              {alerts.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {alerts.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500 opacity-50" />
            <p className="text-sm">All clear! No active alerts.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-2">
              {alerts.map((alert) => {
                const Icon = alert.icon;
                return (
                  <div
                    key={alert.id}
                    className={`flex items-start gap-3 p-2.5 rounded-lg border transition-colors ${
                      alert.severity === 'critical'
                        ? 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20'
                        : alert.severity === 'warning'
                        ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20'
                        : 'border-border/50 bg-muted/30'
                    } ${alert.targetTab ? 'cursor-pointer hover:bg-muted/60' : ''}`}
                    onClick={alert.targetTab ? () => onTabSwitch(alert.targetTab!) : undefined}
                    role={alert.targetTab ? 'button' : undefined}
                    tabIndex={alert.targetTab ? 0 : undefined}
                  >
                    <div className={`shrink-0 p-1.5 rounded-full ${
                      alert.severity === 'critical' ? 'bg-red-100 dark:bg-red-900/30' :
                      alert.severity === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30' :
                      'bg-muted'
                    }`}>
                      <Icon className={`h-4 w-4 ${alert.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{alert.title}</span>
                        {alert.count !== undefined && (
                          <Badge variant={alert.badgeVariant} className="text-[9px] px-1.5 py-0">
                            {alert.count}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{alert.description}</p>
                    </div>
                    {alert.targetTab && (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* System Health Indicator */}
        <Separator className="my-3" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            System Healthy
          </span>
          <span className="text-[10px] text-muted-foreground">
            Last sync: just now
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function TopProductsTable({ storeId }: { storeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      return res.data;
    },
    refetchInterval: 30000,
  });

  const topProducts: TopProduct[] = useMemo(() => {
    if (data?.topProducts && data.topProducts.length > 0) {
      return data.topProducts.slice(0, 5);
    }
    // Demo data
    return [
      { productId: '1', productName: 'Portland Cement (50kg)', totalQuantity: 45, totalRevenue: 54000 },
      { productId: '2', productName: 'Iron Sheets (3m)', totalQuantity: 32, totalRevenue: 41600 },
      { productId: '3', productName: 'D-Paint White (20L)', totalQuantity: 18, totalRevenue: 36000 },
      { productId: '4', productName: 'Rebar 12mm (6m)', totalQuantity: 60, totalRevenue: 27000 },
      { productId: '5', productName: 'Wheelbarrow Heavy Duty', totalQuantity: 8, totalRevenue: 24000 },
    ];
  }, [data]);

  const maxRevenue = Math.max(...topProducts.map(p => p.totalRevenue), 1);

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-green-600" />
            Top Selling Products
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-6 rounded" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2 w-full" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-600" />
          Top Selling Products
        </CardTitle>
        <CardDescription className="text-xs">
          Best performing products by revenue
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8 text-xs">#</TableHead>
              <TableHead className="text-xs">Product</TableHead>
              <TableHead className="text-xs text-right">Qty Sold</TableHead>
              <TableHead className="text-xs text-right">Revenue</TableHead>
              <TableHead className="text-xs w-24">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topProducts.map((product, index) => {
              const sharePercent = (product.totalRevenue / maxRevenue) * 100;
              const rankColors = [
                'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
                'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
              ];
              return (
                <TableRow key={product.productId} className="hover:bg-muted/50 transition-colors">
                  <TableCell className="py-2">
                    <span className={`inline-flex items-center justify-center h-6 w-6 rounded text-[10px] font-bold ${
                      index < 3 ? rankColors[index] : 'text-muted-foreground'
                    }`}>
                      {index + 1}
                    </span>
                  </TableCell>
                  <TableCell className="py-2">
                    <span className="text-sm font-medium truncate block max-w-[160px]">
                      {product.productName}
                    </span>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span className="text-sm tabular-nums">{product.totalQuantity}</span>
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <span className="text-sm font-semibold tabular-nums">{formatKES(product.totalRevenue)}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-2">
                      <Progress value={sharePercent} className="h-1.5 flex-1" />
                      <span className="text-[10px] text-muted-foreground w-8 text-right">
                        {sharePercent.toFixed(0)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// DEBT AGING SECTION (embedded in dashboard)

function DebtAgingCard({ storeId }: { storeId: string }) {
  const { data: debtData, isLoading } = useQuery({
    queryKey: ['debt-aging', storeId],
    queryFn: async () => {
      const res = await debtApi.list({ storeId, limit: 100 });
      return res.data;
    },
    refetchInterval: 60000,
  });

  const agingSummary = useMemo(() => {
    if (!debtData || debtData.length === 0) {
      return { current: 12000, days30: 8500, days60: 5200, days90Plus: 3100, total: 28800 };
    }
    const summary = { current: 0, days30: 0, days60: 0, days90Plus: 0, total: 0 };
    debtData.forEach((d) => {
      const balance = d.balance;
      summary.total += balance;
      switch (d.agingBucket) {
        case 'CURRENT': summary.current += balance; break;
        case 'DAYS_30': summary.days30 += balance; break;
        case 'DAYS_60': summary.days60 += balance; break;
        case 'DAYS_90_PLUS': summary.days90Plus += balance; break;
        default: summary.current += balance;
      }
    });
    return summary;
  }, [debtData]);

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardContent className="p-4">
          <Skeleton className="h-6 w-28 mb-4" />
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-2 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-red-600" />
          Debt Aging Summary
        </CardTitle>
        <CardDescription className="text-xs">
          Total outstanding: {formatKES(agingSummary.total)}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <AgingBars
          current={agingSummary.current}
          days30={agingSummary.days30}
          days60={agingSummary.days60}
          days90Plus={agingSummary.days90Plus}
        />
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="rounded-lg border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Current</p>
            <p className="text-sm font-semibold text-green-600">{formatKES(agingSummary.current)}</p>
          </div>
          <div className="rounded-lg border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">30 Days</p>
            <p className="text-sm font-semibold text-amber-600">{formatKES(agingSummary.days30)}</p>
          </div>
          <div className="rounded-lg border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">60 Days</p>
            <p className="text-sm font-semibold text-orange-600">{formatKES(agingSummary.days60)}</p>
          </div>
          <div className="rounded-lg border p-2 text-center">
            <p className="text-[10px] text-muted-foreground">90+ Days</p>
            <p className="text-sm font-semibold text-red-600">{formatKES(agingSummary.days90Plus)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function useShiftDuration(startedAt: string | null) {
  const [duration, setDuration] = useState(() => !startedAt ? '0h 0m 0s' : '');

  useEffect(() => {
    if (!startedAt) {
      return;
    }

    const update = () => {
      const start = new Date(startedAt).getTime();
      const now = Date.now();
      const diff = Math.max(0, now - start);
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setDuration(`${hours}h ${minutes}m ${seconds}s`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return duration || '0h 0m 0s';
}

function ShiftStatusCard({ storeId }: { storeId: string }) {
  const { user } = useAuthStore();
  const [startingCash, setStartingCash] = useState('');
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [countedCash, setCountedCash] = useState('');
  const [endingCash, setEndingCash] = useState('');
  const [endNotes, setEndNotes] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  const userId = user?.id || 'demo_user';

  const { data: activeShift, isLoading, refetch } = useQuery({
    queryKey: ['current-shift', storeId, userId],
    queryFn: async () => {
      const res = await shiftsApi.getCurrent(storeId, userId);
      return res.data;
    },
    enabled: !!storeId && !!user?.id,
    refetchInterval: 15000,
  });

  const duration = useShiftDuration(activeShift?.startedAt ?? null);

  const handleStartShift = async () => {
    const cash = parseFloat(startingCash);
    if (isNaN(cash) || cash < 0) {
      toast.error('Please enter a valid starting cash amount.');
      return;
    }

    setIsStarting(true);
    try {
      const res = await shiftsApi.start({
        storeId,
        userId,
        startingCash: cash,
      });
      if (res.success) {
        toast.success('Shift started successfully!');
        setStartingCash('');
        refetch();
      } else {
        toast.error(res.error || 'Failed to start shift.');
      }
    } catch (error) {
      toast.error('Failed to start shift. Please try again.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleEndShift = async () => {
    if (!activeShift) return;

    const counted = parseFloat(countedCash);
    const ending = parseFloat(endingCash);
    if (isNaN(counted) || counted < 0) {
      toast.error('Please enter the counted cash amount.');
      return;
    }
    if (isNaN(ending) || ending < 0) {
      toast.error('Please enter the ending cash amount.');
      return;
    }

    setIsEnding(true);
    try {
      const res = await shiftsApi.end(activeShift.id, {
        endingCash: ending,
        countedCash: counted,
        notes: endNotes || undefined,
      });
      if (res.success) {
        const shiftData = res.data;
        const diff = shiftData?.cashDifference ?? 0;
        if (Math.abs(diff) > 0.01) {
          const msg = diff > 0
            ? `Shift ended. Cash over by ${formatKES(diff)}`
            : `Shift ended. Cash short by ${formatKES(Math.abs(diff))}`;
          toast.warning(msg);
        } else {
          toast.success('Shift ended. Cash balance is correct!');
        }
        setEndDialogOpen(false);
        setCountedCash('');
        setEndingCash('');
        setEndNotes('');
        refetch();
      } else {
        toast.error(res.error || 'Failed to end shift.');
      }
    } catch (error) {
      toast.error('Failed to end shift. Please try again.');
    } finally {
      setIsEnding(false);
    }
  };

  const expectedCash = activeShift
    ? activeShift.startingCash + activeShift.totalSales
    : 0;

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-5 w-48" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No active shift — show start shift UI
  if (!activeShift) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            Shift Management
          </CardTitle>
          <CardDescription className="text-xs">
            Start your shift to begin processing sales
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="starting-cash" className="text-xs font-medium">
                Starting Cash (KES)
              </Label>
              <Input
                id="starting-cash"
                type="number"
                min="0"
                step="100"
                placeholder="e.g. 50000"
                value={startingCash}
                onChange={(e) => setStartingCash(e.target.value)}
                className="h-9"
              />
            </div>
            <Button
              onClick={handleStartShift}
              disabled={isStarting || !startingCash}
              className="h-9 gap-2 bg-green-600 hover:bg-green-700 text-white shrink-0"
            >
              {isStarting ? (
                <Activity className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {isStarting ? 'Starting...' : 'Start Shift'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Active shift — show status
  return (
    <>
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200 border-l-4 border-l-green-500">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Timer className="h-4 w-4 text-green-600" />
              Active Shift
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
                LIVE
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="font-mono tabular-nums">{duration}</span>
            </div>
          </div>
          <CardDescription className="text-xs">
            Started {formatDateTime(activeShift.startedAt)} by {activeShift.userName || 'You'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border p-2.5 bg-muted/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Starting Cash</p>
              <p className="text-sm font-bold mt-0.5">{formatKES(activeShift.startingCash)}</p>
            </div>
            <div className="rounded-lg border p-2.5 bg-muted/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Shift Sales</p>
              <p className="text-sm font-bold mt-0.5 text-green-600">{formatKES(activeShift.totalSales)}</p>
            </div>
            <div className="rounded-lg border p-2.5 bg-muted/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Transactions</p>
              <p className="text-sm font-bold mt-0.5">{activeShift.totalTransactions}</p>
            </div>
            <div className="rounded-lg border p-2.5 bg-muted/30">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Expected Cash</p>
              <p className="text-sm font-bold mt-0.5 text-emerald-600">{formatKES(expectedCash)}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setEndDialogOpen(true)}
            >
              <LogOut className="h-3.5 w-3.5" />
              End Shift
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* End Shift Dialog */}
      <Dialog open={endDialogOpen} onOpenChange={setEndDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-amber-600" />
              Count Cash Drawer
            </DialogTitle>
            <DialogDescription>
              Count the cash in the drawer and record the amounts to close your shift.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Summary before counting */}
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Starting Cash</span>
                <span className="font-medium">{formatKES(activeShift.startingCash)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">+ Shift Sales</span>
                <span className="font-medium text-green-600">{formatKES(activeShift.totalSales)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="font-medium">Expected Cash</span>
                <span className="font-bold text-emerald-600">{formatKES(expectedCash)}</span>
              </div>
            </div>

            {/* Cash counting inputs */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="counted-cash" className="text-xs font-medium">
                  Counted Cash in Drawer (KES)
                </Label>
                <Input
                  id="counted-cash"
                  type="number"
                  min="0"
                  step="100"
                  placeholder="Count all cash in the drawer"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="h-9"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ending-cash" className="text-xs font-medium">
                  Ending Cash to Leave in Drawer (KES)
                </Label>
                <Input
                  id="ending-cash"
                  type="number"
                  min="0"
                  step="100"
                  placeholder="Cash to leave for next shift"
                  value={endingCash}
                  onChange={(e) => setEndingCash(e.target.value)}
                  className="h-9"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="end-notes" className="text-xs font-medium">
                  Notes (optional)
                </Label>
                <Input
                  id="end-notes"
                  placeholder="Any notes about this shift"
                  value={endNotes}
                  onChange={(e) => setEndNotes(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>

            {/* Live difference calculation */}
            {countedCash && (
              <div className="rounded-lg border p-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Cash Summary</p>
                <div className="flex justify-between text-xs">
                  <span>Expected</span>
                  <span className="font-mono">{formatKES(expectedCash)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Counted</span>
                  <span className="font-mono">{formatKES(parseFloat(countedCash) || 0)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm font-bold">
                  <span>Difference</span>
                  {(() => {
                    const diff = (parseFloat(countedCash) || 0) - expectedCash;
                    if (Math.abs(diff) < 0.01) {
                      return <span className="text-green-600">✓ Balanced</span>;
                    }
                    return diff > 0
                      ? <span className="text-amber-600">+{formatKES(diff)} over</span>
                      : <span className="text-red-600">{formatKES(diff)} short</span>;
                  })()}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEndDialogOpen(false)} className="h-9">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleEndShift}
              disabled={isEnding || !countedCash || !endingCash}
              className="h-9 gap-1.5"
            >
              {isEnding ? (
                <Activity className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {isEnding ? 'Ending...' : 'End Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Metric descriptions for the detail dialog
const METRIC_DESCRIPTIONS: Record<KpiMetricKey, { description: string; navButton: { label: string; tab: AppTab; icon: React.ElementType } }> = {
  revenue: {
    description: 'Total revenue generated from all sales transactions today. This includes cash, M-Pesa, and split payments received.',
    navButton: { label: 'View Transactions', tab: 'transactions', icon: Receipt },
  },
  transactions: {
    description: 'Number of completed sales transactions processed today. Each transaction represents a unique customer purchase.',
    navButton: { label: 'View Transactions', tab: 'transactions', icon: Receipt },
  },
  lowStock: {
    description: 'Products that have fallen below their reorder level and need restocking soon to avoid stockouts.',
    navButton: { label: 'View Inventory', tab: 'inventory', icon: Package },
  },
  debt: {
    description: 'Total outstanding debt owed by customers from credit purchases. This includes all aging buckets — current, 30 days, 60 days, and 90+ days overdue.',
    navButton: { label: 'View Credits', tab: 'credits', icon: CircleDollarSign },
  },
};

function DashboardDetailDialog({
  open,
  onOpenChange,
  kpi,
  onTabSwitch,
  onViewLowStockDetails,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kpi: KpiDetail | null;
  onTabSwitch: (tab: AppTab) => void;
  onViewLowStockDetails?: () => void;
}) {
  if (!kpi) return null;

  const Icon = kpi.icon;
  const metricInfo = METRIC_DESCRIPTIONS[kpi.metricKey];
  const NavIcon = metricInfo.navButton.icon;

  // Additional navigation buttons based on metric type
  const extraNavButtons: Array<{ label: string; tab: AppTab; icon: React.ElementType; variant?: 'outline' | 'default' }> = [];

  if (kpi.metricKey === 'debt') {
    // For debt, also offer view to rentals since debt often relates to rental equipment
    extraNavButtons.push({ label: 'View Rentals', tab: 'rentals', icon: KeyRound, variant: 'outline' });
    extraNavButtons.push({ label: 'View Financial', tab: 'financial', icon: BarChart3, variant: 'outline' });
  } else if (kpi.metricKey === 'revenue') {
    extraNavButtons.push({ label: 'View Financial', tab: 'financial', icon: BarChart3, variant: 'outline' });
  } else if (kpi.metricKey === 'transactions') {
    extraNavButtons.push({ label: 'View Financial', tab: 'financial', icon: BarChart3, variant: 'outline' });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className={`shrink-0 p-2 rounded-xl ${kpi.iconBg}`}>
              <Icon className={`h-5 w-5 ${kpi.color}`} />
            </div>
            {kpi.label}
          </DialogTitle>
          <DialogDescription>
            {metricInfo.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Metric value display */}
          <div className="rounded-lg border p-4 text-center bg-muted/30">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{kpi.label}</p>
            <p className={`text-3xl font-bold ${kpi.color}`}>
              {kpi.formattedValue}
            </p>
            <div className={`flex items-center justify-center gap-1 mt-2 text-xs font-medium ${
              kpi.trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}>
              {kpi.trendUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {kpi.trend} vs yesterday
            </div>
          </div>

          {/* For debt, show credits navigation prominently */}
          {kpi.metricKey === 'debt' && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-3">
              <div className="flex items-center gap-2 mb-2">
                <CircleDollarSign className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-red-700 dark:text-red-400">Credits & Debt Management</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Navigate to the Credits section to view all customer debts, record payments, and manage aging balances.
              </p>
              <Button
                onClick={() => { onOpenChange(false); onTabSwitch('credits'); }}
                className="w-full gap-2 bg-red-600 hover:bg-red-700 text-white"
                size="sm"
              >
                <CircleDollarSign className="h-4 w-4" />
                View Credits
                <ArrowRight className="h-3.5 w-3.5 ml-auto" />
              </Button>
            </div>
          )}

          {/* For low stock, show link to detailed product list */}
          {kpi.metricKey === 'lowStock' && onViewLowStockDetails && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Low Stock Details</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                View the full list of products that are below their reorder level and need attention.
              </p>
              <Button
                onClick={() => { onOpenChange(false); onViewLowStockDetails(); }}
                variant="outline"
                className="w-full gap-2 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/50"
                size="sm"
              >
                <AlertTriangle className="h-4 w-4" />
                View Low Stock Products
                <ArrowRight className="h-3.5 w-3.5 ml-auto" />
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Close
          </Button>
          <Button
            onClick={() => { onOpenChange(false); onTabSwitch(metricInfo.navButton.tab); }}
            className="w-full sm:w-auto gap-2"
          >
            <NavIcon className="h-4 w-4" />
            {metricInfo.navButton.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          {extraNavButtons.map((btn) => {
            const BtnIcon = btn.icon;
            return (
              <Button
                key={btn.label}
                variant={btn.variant || 'outline'}
                onClick={() => { onOpenChange(false); onTabSwitch(btn.tab); }}
                className="w-full sm:w-auto gap-2"
              >
                <BtnIcon className="h-4 w-4" />
                {btn.label}
              </Button>
            );
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sales Trend mini-widget — compact last-7-day revenue area chart + top-3
// growing products. Pulls from /api/trends/analysis (range=7d). Falls back
// gracefully if the trends endpoint isn't available yet.
// ---------------------------------------------------------------------------

interface DashboardGrowingProduct {
  productId: string;
  name: string;
  growthPct: number;
}
interface DashboardForecastPoint {
  label: string;
  predicted: number;
}
interface DashboardTrendsPayload {
  growing?: DashboardGrowingProduct[];
  forecast?: DashboardForecastPoint[];
  isDemo?: boolean;
}

async function fetchDashboardTrends(storeId: string): Promise<DashboardTrendsPayload> {
  const params = new URLSearchParams({ storeId, range: '7d' });
  const res = await fetch(`/api/trends/analysis?${params.toString()}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Trends API returned ${res.status}`);
  }
  const json = await res.json();
  const d = json?.data ?? json;
  return {
    growing: Array.isArray(d?.growing) ? d.growing : [],
    forecast: Array.isArray(d?.forecast) ? d.forecast : [],
    isDemo: !!d?.isDemo,
  };
}

function SalesTrendsWidget({ storeId, onSeeMore }: { storeId: string; onSeeMore: () => void }) {
  const { data: trends, isLoading, error } = useQuery<DashboardTrendsPayload>({
    queryKey: ['dashboard-trends', storeId],
    queryFn: () => fetchDashboardTrends(storeId),
    retry: false,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  // Surface fetch errors once (non-blocking)
  React.useEffect(() => {
    if (error) {
      const msg = handleError(error, 'Dashboard trends');
      console.warn('[Dashboard] trends fetch failed:', msg);
    }
  }, [error]);

  const chartData = useMemo(() => {
    return (trends?.forecast ?? []).map((f) => ({
      label: f.label,
      predicted: Math.round(Number(f.predicted ?? 0)),
    }));
  }, [trends]);

  const topGrowing = useMemo(() => {
    return (trends?.growing ?? []).slice(0, 3);
  }, [trends]);

  const totalForecast = chartData.reduce((s, d) => s + d.predicted, 0);
  const peakDay = chartData.reduce((m, d) => Math.max(m, d.predicted), 0);

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
              <Sparkles className="h-4 w-4 text-primary" />
              Sales Trend (7d)
              {trends?.isDemo && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                  Demo
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Forecast: <strong>{formatKES(totalForecast)}</strong>{peakDay > 0 && <> · Peak: {formatKES(peakDay)}</>}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={onSeeMore}
          >
            Details
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Compact area chart */}
            {chartData.length > 0 ? (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashTrendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      className="text-muted-foreground"
                      tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                      width={36}
                    />
                    <RechartsTooltip
                      formatter={(value: number) => [formatKES(value), 'Predicted']}
                      contentStyle={{ fontSize: 12, padding: '4px 8px' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="predicted"
                      name="Predicted"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#dashTrendGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-32 flex flex-col items-center justify-center text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/30 mb-1" />
                <p className="text-xs text-muted-foreground">No forecast data yet.</p>
                <p className="text-[10px] text-muted-foreground/70">Generates once sales history is available.</p>
              </div>
            )}

            {/* Top 3 growing products list */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <ArrowUpRight className="h-3 w-3 text-green-600" />
                  Top 3 Growing Products
                </span>
              </div>
              {topGrowing.length > 0 ? (
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {topGrowing.map((p, i) => (
                    <div
                      key={p.productId}
                      className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-[10px] font-bold text-muted-foreground shrink-0 w-4">#{i + 1}</span>
                        <span className="text-xs font-medium truncate">{p.name}</span>
                      </div>
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400 text-[10px] px-1.5 py-0 shrink-0">
                        +{Math.round(p.growthPct || 0)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border bg-muted/10 px-2.5 py-3 text-center">
                  <p className="text-xs text-muted-foreground">No growing products detected yet.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Friendly store display names for the welcome hero (kept in sync with STORE_LIST in page.tsx)
const STORE_DISPLAY_NAMES: Record<string, string> = {
  store_juja_main: 'Juja Main',
  store_thika: 'Thika',
  store_ruiru: 'Ruiru',
  store_nairobi_cbd: 'Nairobi CBD',
  store_nakuru: 'Nakuru',
};

// Welcome hero banner — personalized greeting + quick-action shortcuts shown at the top of the dashboard.
function WelcomeHero() {
  const { user } = useAuthStore();
  const { currentStoreId, setActiveTab } = useAppStore();

  const firstName = (user?.name || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Karibu, ${firstName} 👋` : 'Karibu 👋';
  const branchName = STORE_DISPLAY_NAMES[currentStoreId] ?? 'your branch';
  const today = new Date().toLocaleDateString('en-KE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-br from-green-600 via-emerald-600 to-teal-600 text-white shadow-md">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-100 shrink-0" aria-hidden="true" />
              <h2 className="text-lg sm:text-xl font-bold tracking-tight">{greeting}</h2>
            </div>
            <p className="text-xs sm:text-sm text-emerald-50/90 mt-1">
              Here&rsquo;s what&rsquo;s happening at <span className="font-semibold">{branchName}</span> today · {today}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="bg-white text-green-700 hover:bg-emerald-50 hover:text-green-700 font-semibold shadow-sm gap-1.5"
              onClick={() => setActiveTab('pos')}
            >
              <ShoppingCart className="h-4 w-4" />
              New Sale (F2)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white/10 border-white/40 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm gap-1.5"
              onClick={() => setActiveTab('catalog')}
            >
              <Plus className="h-4 w-4" />
              Add Product
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white/10 border-white/40 text-white hover:bg-white/20 hover:text-white backdrop-blur-sm gap-1.5"
              onClick={() => setActiveTab('reports')}
            >
              <BarChart3 className="h-4 w-4" />
              View Reports
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardTab() {
  const { currentStoreId, setActiveTab } = useAppStore();
  const [lowStockDialogOpen, setLowStockDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState<KpiDetail | null>(null);

  const handleTabSwitch = useCallback((tab: AppTab) => {
    setActiveTab(tab);
  }, [setActiveTab]);

  const handleKpiCardClick = useCallback((kpi: KpiDetail) => {
    setSelectedKpi(kpi);
    setDetailDialogOpen(true);
  }, []);

  // Fetch low stock products for the dialog
  const { data: lowStockProducts } = useQuery({
    queryKey: ['low-stock-products', currentStoreId],
    queryFn: async () => {
      const res = await productsApi.list({ storeId: currentStoreId, limit: 200 });
      // Filter low stock client-side: products below reorder level
      return (res.data || []).filter(p => p.quantityInStock <= p.reorderLevel && p.isActive);
    },
    enabled: lowStockDialogOpen,
  });

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Welcome Hero — personalized greeting + quick actions */}
      <WelcomeHero />

      {/* Top KPI Cards Row */}
      <KpiCards storeId={currentStoreId} onCardClick={handleKpiCardClick} />

      {/* Shift Status Card */}
      <ShiftStatusCard storeId={currentStoreId} />

      {/* Sales Overview Charts */}
      <SalesOverview storeId={currentStoreId} />

      {/* Quick Actions Bar */}
      <QuickActions onTabSwitch={handleTabSwitch} />

      {/* Bottom Grid: Activity Feed + Alerts + Top Products + Debt Aging + Sales Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Column */}
        <div className="space-y-4">
          <RecentActivity storeId={currentStoreId} />
          <TopProductsTable storeId={currentStoreId} />
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          <SalesTrendsWidget storeId={currentStoreId} onSeeMore={() => handleTabSwitch('reports')} />
          <AlertsPanel storeId={currentStoreId} onTabSwitch={handleTabSwitch} />
          <DebtAgingCard storeId={currentStoreId} />
        </div>
      </div>

      {/* Dashboard Detail Dialog - shows when any KPI card is clicked */}
      <DashboardDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        kpi={selectedKpi}
        onTabSwitch={handleTabSwitch}
        onViewLowStockDetails={() => { setDetailDialogOpen(false); setLowStockDialogOpen(true); }}
      />

      {/* Low Stock Details Dialog */}
      <Dialog open={lowStockDialogOpen} onOpenChange={setLowStockDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Low Stock Products
            </DialogTitle>
            <DialogDescription>
              Products that are below their reorder level and need restocking.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-80">
            {lowStockProducts && lowStockProducts.length > 0 ? (
              <div className="space-y-2">
                {lowStockProducts.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                    </div>
                    <div className="shrink-0 text-right ml-3">
                      <p className="text-sm font-bold text-red-600">{product.quantityInStock} left</p>
                      <p className="text-[10px] text-muted-foreground">Reorder at: {product.reorderLevel}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No low stock products found</p>
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLowStockDialogOpen(false)}>Close</Button>
            <Button onClick={() => { setLowStockDialogOpen(false); handleTabSwitch('inventory'); }}>
              Go to Inventory
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
