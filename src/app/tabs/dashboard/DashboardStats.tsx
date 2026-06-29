'use client';

/**
 * DashboardStats — top KPI cards row.
 *
 * Extracted from `dashboard-tab.tsx` to slim down the orchestrator. Renders
 * four animated KPI cards (Revenue, Transactions, Low Stock, Outstanding Debt)
 * and emits a click event with the full KpiDetail payload when a card is
 * clicked.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, ShoppingCart, AlertTriangle,
  CircleDollarSign, ArrowRight,
} from 'lucide-react';

import { dashboardApi, formatKES } from '@/lib/api';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import type { KpiDetail, KpiMetricKey } from './types';

// --- Local helpers (kept here because only this component uses them) ---------

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

  const areaPoints = points + ` ${width},${height} 0,${height}`;

  return (
    <svg width={width} height={height} className="opacity-60 shrink-0" aria-hidden="true">
      <polygon fill={color} fillOpacity={0.1} points={areaPoints} />
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

// --- Component ---------------------------------------------------------------

export interface DashboardStatsProps {
  storeId: string;
  onCardClick: (kpi: KpiDetail) => void;
}

export function DashboardStats({ storeId, onCardClick }: DashboardStatsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      const d = res.data;
      // Defensive: ensure all array fields are actually arrays
      if (d && typeof d === 'object' && !Array.isArray(d)) {
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

export default DashboardStats;
