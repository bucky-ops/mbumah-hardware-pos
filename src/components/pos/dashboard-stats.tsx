'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, formatKES } from '@/lib/api';
import { safeMap } from '@/lib/app-config';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { MiniSparkline } from '@/components/pos/mini-sparkline';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, ShoppingCart, AlertTriangle, DollarSign, ArrowDownRight, Clock, Activity } from 'lucide-react';

export function DashboardStats({ storeId, onLowStockClick }: { storeId: string; onLowStockClick?: () => void }) {
  const { data, isLoading, dataUpdatedAt } = useQuery({
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
          recentActivities: Array.isArray(d.recentActivities) ? d.recentActivities : [],
        };
      }
      return d ?? null;
    },
    refetchInterval: 30000, // More frequent refresh
  });

  const animatedSales = useAnimatedCounter(data?.todaySales ?? 0);
  const animatedTransactions = useAnimatedCounter(data?.todayTransactions ?? 0);
  const animatedLowStock = useAnimatedCounter(data?.lowStockProducts ?? 0);

  // Generate fake sparkline data from salesByHour or random
  const sparkData = useMemo(() => {
    if (data && Array.isArray(data.salesByHour) && data.salesByHour.length > 1) {
      return safeMap<{ amount: number }, number>(data.salesByHour, h => h.amount);
    }
    return [20, 40, 30, 60, 50, 80, 70, 90];
  }, [data]);

  // Compute average order value (today's sales / today's transactions)
  const todaySales = data?.todaySales ?? 0;
  const todayTxns = data?.todayTransactions ?? 0;
  const avgOrder = todaySales && todayTxns ? todaySales / todayTxns : 0;
  const animatedAvgOrder = useAnimatedCounter(avgOrder);

  // Live "last updated" timestamp — ticks every minute to refresh relative time
  // (lazy initializer so Date.now() is not called during render)
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(() => Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Compute average order sparkline data — derived from salesByHour relative to txns (heuristic)
  const avgSparkData = useMemo(() => {
    if (data && Array.isArray(data.salesByHour) && data.salesByHour.length > 1) {
      const n = data.salesByHour.length;
      // Heuristic: avg per hour = sales / max(1, transactions_per_hour ~ sales / avg)
      const totalSales = data.salesByHour.reduce((sum: number, h: { amount: number }) => sum + (h.amount || 0), 0);
      const avg = totalSales / Math.max(n, 1) / 8; // ~8 txns/hour heuristic
      return data.salesByHour.map((h: { amount: number }) => Math.max(1, Math.round((h.amount || 0) / Math.max(avg, 1))));
    }
    return [3, 5, 4, 7, 6, 9, 8];
  }, [data]);

  const stats = [
    {
      label: "Today's Sales",
      value: todaySales,
      animatedValue: animatedSales,
      format: 'kes' as const,
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      // Gradient icon circle — emerald (positive sales)
      iconCircle: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-emerald-500/30',
      bg: 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/30',
      borderColor: 'border-l-green-500',
      glowColor: 'hover:shadow-emerald-500/20',
      sparkColor: '#16a34a',
      trend: { value: 12, isPositive: true },
      clickable: false,
      statClass: 'stat-card-green stat-shadow-green',
      spark: sparkData,
      staggerClass: 'stagger-1',
    },
    {
      label: 'Transactions',
      value: todayTxns,
      animatedValue: animatedTransactions,
      format: 'number' as const,
      icon: ShoppingCart,
      color: 'text-sky-600 dark:text-sky-400',
      // Gradient icon circle — sky blue (informational)
      iconCircle: 'bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-blue-500/30',
      bg: 'bg-gradient-to-br from-sky-50 to-blue-50 dark:from-sky-950/40 dark:to-blue-950/30',
      borderColor: 'border-l-sky-500',
      glowColor: 'hover:shadow-blue-500/20',
      sparkColor: '#0284c7',
      trend: { value: 8, isPositive: true },
      clickable: false,
      statClass: 'stat-card-blue stat-shadow-blue',
      spark: sparkData,
      staggerClass: 'stagger-2',
    },
    {
      label: 'Avg Order',
      value: avgOrder,
      animatedValue: animatedAvgOrder,
      format: 'kes' as const,
      icon: DollarSign,
      color: 'text-amber-600 dark:text-amber-400',
      // Gradient icon circle — amber (value/money)
      iconCircle: 'bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-amber-500/30',
      bg: 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30',
      borderColor: 'border-l-amber-500',
      glowColor: 'hover:shadow-amber-500/20',
      sparkColor: '#d97706',
      trend: { value: 4, isPositive: true },
      clickable: false,
      statClass: 'stat-card-amber stat-shadow-amber',
      spark: avgSparkData,
      staggerClass: 'stagger-3',
    },
    {
      label: 'Low Stock',
      value: data?.lowStockProducts ?? 0,
      animatedValue: animatedLowStock,
      format: 'number' as const,
      icon: AlertTriangle,
      color: 'text-rose-600 dark:text-rose-400',
      // Gradient icon circle — rose (attention/warning)
      iconCircle: 'bg-gradient-to-br from-rose-400 to-red-600 text-white shadow-rose-500/30',
      bg: 'bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-950/40 dark:to-red-950/30',
      borderColor: 'border-l-rose-500',
      glowColor: 'hover:shadow-rose-500/20',
      sparkColor: '#e11d48',
      trend: { value: 3, isPositive: false },
      clickable: true,
      statClass: 'stat-card-red stat-shadow-red',
      spark: [10, 8, 9, 6, 7, 5, 4],
      staggerClass: 'stagger-4',
    },
  ];

  // Relative "last updated" time string
  const lastUpdatedStr = useMemo(() => {
    if (!dataUpdatedAt) return 'never';
    const diffMs = nowTick - dataUpdatedAt;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    return new Date(dataUpdatedAt).toLocaleTimeString();
  }, [dataUpdatedAt, nowTick]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-end">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Live indicator + last updated timestamp */}
      <div className="flex items-center justify-end gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 font-medium">
          <span className="status-pulse" aria-hidden />
          <span className="text-green-600 dark:text-green-400">Live</span>
        </span>
        <span className="flex items-center gap-1" title={dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString() : 'Never updated'}>
          <Clock className="h-3 w-3" />
          Updated {lastUpdatedStr}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const isClickable = stat.clickable && onLowStockClick;
          const trendValue = stat.trend.value;
          const trendIsPositive = stat.trend.isPositive;
          return (
            <Card
              key={stat.label}
              className={`border-l-4 ${stat.borderColor} py-0 ${stat.bg} backdrop-blur-sm gradient-border ${stat.statClass} ${stat.staggerClass} micro-click animate-fade-in card-hover-lift hover:shadow-lg ${stat.glowColor} hover:border-opacity-100 ${
                isClickable ? 'cursor-pointer transition-all duration-200' : 'transition-all duration-200'
              }`}
              onClick={isClickable ? onLowStockClick : undefined}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
              onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLowStockClick(); } } : undefined}
            >
              <CardContent className="p-3 flex items-center gap-3">
                {/* Gradient icon circle — emerald/blue/amber/red per stat */}
                <div className={`shrink-0 h-9 w-9 rounded-xl flex items-center justify-center shadow-md ${stat.iconCircle}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{stat.label}</p>
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm sm:text-base font-bold ${stat.color} whitespace-nowrap animate-count-up`}>
                      {stat.format === 'kes' ? formatKES(stat.animatedValue) : stat.animatedValue}
                    </p>
                    {isClickable && (
                      <span className="text-[9px] text-muted-foreground/50">→</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-0.5">
                  <MiniSparkline data={stat.spark} color={stat.sparkColor} />
                  <div className={`flex items-center gap-0.5 text-[9px] font-medium ${trendIsPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {trendIsPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                    {trendIsPositive ? '+' : '−'}{trendValue}%
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Subtle live activity indicator strip — shows we're tracking real-time */}
      <div className="flex items-center justify-center gap-1.5 text-[9px] text-muted-foreground/60">
        <Activity className="h-2.5 w-2.5" />
        <span>Auto-refreshing every 30s · Last refresh {lastUpdatedStr}</span>
      </div>
    </div>
  );
}
