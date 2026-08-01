'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TrendingUp } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { formatKES } from '@/lib/api';
import type { AnalyticsPeriod } from '@/lib/analytics-utils';

export interface SalesTrendBucket {
  key: string;
  label: string;
  revenue: number;
  transactions: number;
  avgOrderValue: number;
  itemsSold: number;
  date: string;
}

export interface SalesTrendData {
  period: AnalyticsPeriod;
  buckets: SalesTrendBucket[];
  previousSeries: Array<{ label: string; value: number }>;
  summary: {
    totalRevenue: number;
    totalTransactions: number;
    totalItemsSold: number;
    avgOrderValue: number;
    previousTotalRevenue: number;
    previousTotalTransactions: number;
    previousAvgOrderValue: number;
    revenueChangePct: number;
    transactionsChangePct: number;
    aovChangePct: number;
  };
}

interface SalesTrendChartProps {
  data: SalesTrendData | null;
  loading?: boolean;
  period: AnalyticsPeriod;
  onPeriodChange: (p: AnalyticsPeriod) => void;
  className?: string;
}

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  today: 'Today',
  week: 'Week',
  month: 'Month',
  year: 'Year',
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const current = payload.find((p) => p.dataKey === 'revenue');
  const previous = payload.find((p) => p.dataKey === 'previous');
  const tx = payload.find((p) => p.dataKey === 'transactions');

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg text-xs space-y-1.5">
      <p className="font-semibold">{label}</p>
      {current && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: current.color }} />
            Revenue
          </span>
          <span className="font-semibold tabular-nums">{formatKES(current.value ?? 0)}</span>
        </div>
      )}
      {previous && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: previous.color }} />
            Prev. period
          </span>
          <span className="font-semibold tabular-nums text-muted-foreground">
            {formatKES(previous.value ?? 0)}
          </span>
        </div>
      )}
      {tx && typeof tx.value === 'number' && (
        <div className="flex items-center justify-between gap-3 pt-1 border-t">
          <span className="text-muted-foreground">Transactions</span>
          <span className="font-medium tabular-nums">{tx.value.toLocaleString('en-KE')}</span>
        </div>
      )}
    </div>
  );
}

export function SalesTrendChart({
  data,
  loading,
  period,
  onPeriodChange,
  className,
}: SalesTrendChartProps) {
  const [hovered, setHovered] = useState(false);

  const chartData = useMemo(() => {
    if (!data?.buckets) return [];
    return data.buckets.map((b, i) => ({
      label: b.label,
      revenue: Math.round(b.revenue * 100) / 100,
      previous: data.previousSeries[i]?.value ?? 0,
      transactions: b.transactions,
      avgOrderValue: Math.round(b.avgOrderValue * 100) / 100,
      itemsSold: b.itemsSold,
    }));
  }, [data]);

  const summary = data?.summary;

  const changePct = summary?.revenueChangePct ?? 0;
  const trendUp = changePct >= 0;

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            Sales Trend
          </CardTitle>
          <CardDescription className="mt-0.5">
            Revenue over time with previous-period comparison
          </CardDescription>
        </div>
        <Tabs value={period} onValueChange={(v) => onPeriodChange(v as AnalyticsPeriod)}>
          <TabsList className="h-8">
            {(Object.keys(PERIOD_LABELS) as AnalyticsPeriod[]).map((p) => (
              <TabsTrigger key={p} value={p} className="text-xs px-2.5 h-6">
                {PERIOD_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="flex-1">
        {loading ? (
          <Skeleton className="h-[280px] w-full rounded-md" />
        ) : !data || chartData.length === 0 ? (
          <div className="flex h-[280px] flex-col items-center justify-center text-center gap-2 text-muted-foreground">
            <TrendingUp className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No sales data for this period</p>
            <p className="text-xs">Try selecting a different range or check back later.</p>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-1"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
            >
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total Revenue</p>
                <p className="text-2xl font-bold tabular-nums">{formatKES(summary?.totalRevenue ?? 0)}</p>
              </div>
              <div className={cn(
                'flex items-center gap-1 text-sm font-medium rounded-full px-2 py-0.5',
                trendUp
                  ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300',
              )}>
                <span>{trendUp ? '▲' : '▼'}</span>
                <span>{Math.abs(changePct).toFixed(1)}%</span>
                <span className="text-muted-foreground font-normal text-xs ml-1">vs prev. period</span>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Transactions</p>
                <p className="text-lg font-semibold tabular-nums">{summary?.totalTransactions ?? 0}</p>
              </div>
            </motion.div>

            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.08} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    tickLine={false}
                    axisLine={{ stroke: 'currentColor', strokeOpacity: 0.1 }}
                    minTickGap={12}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    tickFormatter={(v: number) => {
                      if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                      if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
                      return `${v}`;
                    }}
                  />
                  <RechartsTooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: '#10b981', strokeOpacity: hovered ? 0.4 : 0.2, strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#salesGrad)"
                    isAnimationActive
                    animationDuration={600}
                  />
                  <Line
                    type="monotone"
                    dataKey="previous"
                    name="Prev. period"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    dot={false}
                    isAnimationActive
                    animationDuration={600}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SalesTrendChart;
