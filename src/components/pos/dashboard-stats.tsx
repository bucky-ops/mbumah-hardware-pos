'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, formatKES } from '@/lib/api';
import { safeMap } from '@/lib/app-config';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { MiniSparkline } from '@/components/pos/mini-sparkline';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, ShoppingCart, AlertTriangle, DollarSign, ArrowDownRight } from 'lucide-react';

export function DashboardStats({ storeId, onLowStockClick }: { storeId: string; onLowStockClick?: () => void }) {
  const { data, isLoading } = useQuery({
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
  const animatedDebt = useAnimatedCounter(data?.outstandingDebt ?? 0);

  // Generate fake sparkline data from salesByHour or random
  const sparkData = useMemo(() => {
    if (data && Array.isArray(data.salesByHour) && data.salesByHour.length > 1) {
      return safeMap<{ amount: number }, number>(data.salesByHour, h => h.amount);
    }
    return [20, 40, 30, 60, 50, 80, 70, 90];
  }, [data]);

  const stats = [
    {
      label: "Today's Sales",
      value: data?.todaySales ?? 0,
      animatedValue: animatedSales,
      format: 'kes' as const,
      icon: TrendingUp,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/30',
      borderColor: 'border-l-green-500',
      sparkColor: '#16a34a',
      trend: '+12%',
      trendUp: true,
      clickable: false,
      statClass: 'stat-card-green stat-shadow-green',
    },
    {
      label: 'Transactions',
      value: data?.todayTransactions ?? 0,
      animatedValue: animatedTransactions,
      format: 'number' as const,
      icon: ShoppingCart,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/40 dark:to-sky-950/30',
      borderColor: 'border-l-blue-500',
      sparkColor: '#2563eb',
      trend: '+8%',
      trendUp: true,
      clickable: false,
      statClass: 'stat-card-blue stat-shadow-blue',
    },
    {
      label: 'Low Stock',
      value: data?.lowStockProducts ?? 0,
      animatedValue: animatedLowStock,
      format: 'number' as const,
      icon: AlertTriangle,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30',
      borderColor: 'border-l-amber-500',
      sparkColor: '#d97706',
      trend: '-3%',
      trendUp: false,
      clickable: true,
      statClass: 'stat-card-amber stat-shadow-amber',
    },
    {
      label: 'Outstanding Debt',
      value: data?.outstandingDebt ?? 0,
      animatedValue: animatedDebt,
      format: 'kes' as const,
      icon: DollarSign,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/40 dark:to-rose-950/30',
      borderColor: 'border-l-red-500',
      sparkColor: '#dc2626',
      trend: '+5%',
      trendUp: true,
      clickable: false,
      statClass: 'stat-card-red stat-shadow-red',
    },
  ];

  if (isLoading) {
    return (
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
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        const isClickable = stat.clickable && onLowStockClick;
        return (
          <Card
            key={stat.label}
            className={`border-l-4 ${stat.borderColor} py-0 ${stat.bg} backdrop-blur-sm gradient-border ${stat.statClass} micro-click animate-fade-in ${
              isClickable ? 'cursor-pointer hover:shadow-md transition-all duration-200 hover:-translate-y-0.5' : 'transition-all duration-200 hover:shadow-md'
            }`}
            style={{ animationDelay: `${index * 80}ms`, animationFillMode: 'both' }}
            onClick={isClickable ? onLowStockClick : undefined}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLowStockClick(); } } : undefined}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`shrink-0 p-2 rounded-lg bg-white/70 dark:bg-black/20 backdrop-blur-sm`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
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
                <MiniSparkline data={sparkData} color={stat.sparkColor} />
                <div className={`flex items-center gap-0.5 text-[9px] font-medium ${stat.trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {stat.trendUp ? <TrendingUp className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                  {stat.trend}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
