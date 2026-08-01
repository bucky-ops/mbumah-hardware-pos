'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Wallet,
  ShoppingCart,
  Receipt,
  Users,
  AlertTriangle,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { cn } from '@/lib/utils';
import { formatKES } from '@/lib/api';
import type { KPIDelta } from '@/lib/analytics-utils';

export interface KpiCardConfig {
  key: string;
  label: string;
  icon: LucideIcon;
  value: number;
  delta: KPIDelta;
  sparkline: number[];
  format: 'currency' | 'number';
  /** Tailwind gradient classes for the card background. */
  gradient: string;
  /** Accent color (matches the gradient's primary hue). */
  accent: string;
  /** For low-stock and pending-orders KPIs, "up" is bad — invert the trend color. */
  invertTrend?: boolean;
}

interface KpiGridProps {
  kpis: {
    todayRevenue: KPIDelta;
    transactions: KPIDelta;
    averageOrderValue: KPIDelta;
    newCustomers: KPIDelta;
    lowStockCount: KPIDelta;
    pendingOrders: KPIDelta;
  } | null;
  /** Sparkline data (7 points each) keyed by KPI field name. */
  sparklines?: Partial<Record<keyof KpiGridProps['kpis'] | string, number[]>>;
  loading?: boolean;
  className?: string;
}

/** Build the 6-card config array from the KPI response. */
function buildCardConfigs(
  kpis: NonNullable<KpiGridProps['kpis']>,
  sparklines: KpiGridProps['sparklines'] = {},
): KpiCardConfig[] {
  return [
    {
      key: 'todayRevenue',
      label: "Today's Revenue",
      icon: Wallet,
      value: kpis.todayRevenue.current,
      delta: kpis.todayRevenue,
      sparkline: sparklines.todayRevenue || [],
      format: 'currency',
      gradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
      accent: '#10b981',
    },
    {
      key: 'transactions',
      label: 'Transactions',
      icon: ShoppingCart,
      value: kpis.transactions.current,
      delta: kpis.transactions,
      sparkline: sparklines.transactions || [],
      format: 'number',
      gradient: 'from-sky-500/10 via-sky-500/5 to-transparent',
      accent: '#0ea5e9',
    },
    {
      key: 'averageOrderValue',
      label: 'Avg Order Value',
      icon: Receipt,
      value: kpis.averageOrderValue.current,
      delta: kpis.averageOrderValue,
      sparkline: sparklines.averageOrderValue || [],
      format: 'currency',
      gradient: 'from-violet-500/10 via-violet-500/5 to-transparent',
      accent: '#8b5cf6',
    },
    {
      key: 'newCustomers',
      label: 'New Customers',
      icon: Users,
      value: kpis.newCustomers.current,
      delta: kpis.newCustomers,
      sparkline: sparklines.newCustomers || [],
      format: 'number',
      gradient: 'from-pink-500/10 via-pink-500/5 to-transparent',
      accent: '#ec4899',
    },
    {
      key: 'lowStockCount',
      label: 'Low Stock Items',
      icon: AlertTriangle,
      value: kpis.lowStockCount.current,
      delta: kpis.lowStockCount,
      sparkline: sparklines.lowStockCount || [],
      format: 'number',
      gradient: 'from-amber-500/10 via-amber-500/5 to-transparent',
      accent: '#f59e0b',
      invertTrend: true,
    },
    {
      key: 'pendingOrders',
      label: 'Pending Orders',
      icon: ClipboardList,
      value: kpis.pendingOrders.current,
      delta: kpis.pendingOrders,
      sparkline: sparklines.pendingOrders || [],
      format: 'number',
      gradient: 'from-orange-500/10 via-orange-500/5 to-transparent',
      accent: '#f97316',
      invertTrend: true,
    },
  ];
}

/** Decide whether the trend should display as "good" (green) or "bad" (red). */
function trendIsPositive(delta: KPIDelta, invertTrend?: boolean): boolean | null {
  if (delta.direction === 'neutral' || delta.changePercent === null) return null;
  const isUp = delta.direction === 'up';
  return invertTrend ? !isUp : isUp;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) {
    return (
      <div className="h-8 w-full flex items-center justify-center text-[10px] text-muted-foreground/40">
        No trend data
      </div>
    );
  }
  const chartData = data.map((value, i) => ({ i, value }));
  return (
    <ResponsiveContainer width="100%" height={32}>
      <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function KpiCard({ config, index }: { config: KpiCardConfig; index: number }) {
  const { label, icon: Icon, value, delta, sparkline, format, gradient, accent, invertTrend } = config;
  const animated = useAnimatedCounter(value, 800);
  const displayValue =
    format === 'currency' ? formatKES(animated) : animated.toLocaleString('en-KE');

  const positive = trendIsPositive(delta, invertTrend);
  const TrendIcon =
    delta.direction === 'up' ? TrendingUp : delta.direction === 'down' ? TrendingDown : Minus;

  const trendColor =
    positive === null
      ? 'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300'
      : positive
        ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300'
        : 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300';

  const pctLabel =
    delta.changePercent === null
      ? '—'
      : `${delta.changePercent > 0 ? '+' : ''}${delta.changePercent.toFixed(1)}%`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -4 }}
    >
      <Card
        className={cn(
          'relative overflow-hidden border-border/60 shadow-sm transition-shadow hover:shadow-lg',
          'bg-gradient-to-br',
          gradient,
        )}
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums truncate">
                {displayValue}
              </p>
            </div>
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${accent}1a`, color: accent }}
            >
              <Icon className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                trendColor,
              )}
            >
              <TrendIcon className="h-3 w-3" />
              <span>{pctLabel}</span>
              <span className="hidden sm:inline text-muted-foreground/70 font-normal">
                vs yesterday
              </span>
            </div>
            <div className="h-8 w-20 sm:w-24">
              <MiniSparkline data={sparkline} color={accent} />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function KpiSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <Skeleton className="h-7 w-32" />
        <div className="flex justify-between items-center">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-8 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

export function KpiGrid({ kpis, sparklines, loading, className }: KpiGridProps) {
  if (loading || !kpis) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6', className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
    );
  }

  const configs = buildCardConfigs(kpis, sparklines);

  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6', className)}>
      {configs.map((c, i) => (
        <KpiCard key={c.key} config={c} index={i} />
      ))}
    </div>
  );
}

export default KpiGrid;
