'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Package, TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatKES } from '@/lib/api';

export interface TopProductRow {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  categoryId: string | null;
  quantitySold: number;
  revenue: number;
  avgPrice: number;
  transactionsCount: number;
  trend: 'up' | 'down' | 'stable' | 'new';
}

export interface TopProductsData {
  period: string;
  products: TopProductRow[];
  totalRevenue: number;
  totalQty: number;
}

interface TopProductsChartProps {
  data: TopProductsData | null;
  loading?: boolean;
  className?: string;
}

// Stable per-category color palette (no indigo/blue).
const CATEGORY_PALETTE = [
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#eab308', // yellow
  '#a855f7', // purple
];

function trendBadge(trend: TopProductRow['trend']) {
  switch (trend) {
    case 'up':
      return {
        icon: TrendingUp,
        label: 'Rising',
        className: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300',
      };
    case 'down':
      return {
        icon: TrendingDown,
        label: 'Falling',
        className: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300',
      };
    case 'new':
      return {
        icon: Sparkles,
        label: 'New',
        className: 'text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300',
      };
    case 'stable':
    default:
      return {
        icon: Minus,
        label: 'Stable',
        className: 'text-slate-500 bg-slate-100 dark:bg-slate-800/40 dark:text-slate-300',
      };
  }
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TopProductRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg text-xs max-w-[240px]">
      <p className="font-semibold leading-tight">{row.productName}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">SKU: {row.sku || '—'}</p>
      {row.categoryName && (
        <p className="text-[10px] text-muted-foreground">Category: {row.categoryName}</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span className="text-muted-foreground">Revenue:</span>
        <span className="font-semibold tabular-nums text-right">{formatKES(row.revenue)}</span>
        <span className="text-muted-foreground">Qty sold:</span>
        <span className="font-semibold tabular-nums text-right">{row.quantitySold.toLocaleString('en-KE')}</span>
        <span className="text-muted-foreground">Avg price:</span>
        <span className="font-semibold tabular-nums text-right">{formatKES(row.avgPrice)}</span>
        <span className="text-muted-foreground">Transactions:</span>
        <span className="font-semibold tabular-nums text-right">{row.transactionsCount}</span>
      </div>
    </div>
  );
}

export function TopProductsChart({ data, loading, className }: TopProductsChartProps) {
  const rows = useMemo(() => {
    if (!data?.products) return [];
    const max = Math.max(...data.products.map((p) => p.revenue), 1);
    return data.products
      .map((p, i) => ({
        ...p,
        // Truncate long product names for the y-axis labels.
        shortName: p.productName.length > 22 ? `${p.productName.slice(0, 22)}…` : p.productName,
        fill: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length],
        pct: max > 0 ? (p.revenue / max) * 100 : 0,
      }))
      .reverse(); // reverse so highest revenue appears at the top
  }, [data]);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4 text-violet-500" />
          Top Products
        </CardTitle>
        <CardDescription>Best sellers by revenue for the selected period</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : !data || rows.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center text-center gap-2 text-muted-foreground">
            <Package className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No product sales yet</p>
            <p className="text-xs">Top sellers will appear here once transactions are recorded.</p>
          </div>
        ) : (
          <>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
                  barCategoryGap={6}
                >
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="shortName"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    tickLine={false}
                    axisLine={false}
                    width={130}
                  />
                  <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'currentColor', fillOpacity: 0.05 }} />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={600}>
                    {rows.map((r) => (
                      <Cell key={r.productId} fill={r.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 max-h-40 overflow-y-auto custom-scrollbar border-t pt-3 space-y-2">
              {rows
                .slice()
                .reverse()
                .map((r, i) => {
                  const t = trendBadge(r.trend);
                  const TIcon = t.icon;
                  return (
                    <motion.div
                      key={r.productId}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                        style={{ backgroundColor: r.fill }}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate flex-1 font-medium">{r.productName}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {r.quantitySold.toLocaleString('en-KE')} sold
                      </span>
                      <span className="font-semibold tabular-nums w-24 text-right">
                        {formatKES(r.revenue)}
                      </span>
                      <Badge variant="outline" className={cn('gap-1 px-1.5 py-0 h-5 text-[10px] font-medium', t.className)}>
                        <TIcon className="h-2.5 w-2.5" />
                        {t.label}
                      </Badge>
                    </motion.div>
                  );
                })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default TopProductsChart;
