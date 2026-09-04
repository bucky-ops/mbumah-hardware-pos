'use client';

/**
 * HourlySalesWidget — compact 24-cell heatmap of today's sales by hour.
 *
 * Uses dashboard's `salesByHour` data. Shows a horizontal bar of 24 cells
 * colored by revenue intensity. Below: peak hour + quiet hour + total transactions.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Zap, SunMoon, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { dashboardApi, formatKES } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface HourPoint {
  hour: string;
  amount: number;
  transactions?: number;
}

function hourLabel(hourNum: number): string {
  const h = ((hourNum + 11) % 12) + 1;
  const period = hourNum < 12 ? 'AM' : 'PM';
  return `${h}${period}`;
}

function getIntensity(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, value / max);
}

// Color scale: 0 → muted, low → emerald, mid → amber, high → rose (heat)
function heatColor(intensity: number): string {
  if (intensity === 0) return 'bg-muted/40';
  if (intensity < 0.25) return 'bg-emerald-300 dark:bg-emerald-800/60';
  if (intensity < 0.5) return 'bg-emerald-400 dark:bg-emerald-700/70';
  if (intensity < 0.75) return 'bg-amber-400 dark:bg-amber-700/70';
  return 'bg-rose-500 dark:bg-rose-600/80';
}

// ── Component ────────────────────────────────────────────────────────────────

export interface HourlySalesWidgetProps {
  storeId: string;
}

export function HourlySalesWidget({ storeId }: HourlySalesWidgetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      const d = res.data;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        return {
          ...d,
          salesByHour: Array.isArray(d.salesByHour) ? d.salesByHour : [],
        };
      }
      return d ?? null;
    },
    refetchInterval: 60_000,
  });

  const { hours, peakHour, quietHour, totalToday, totalTransactions, maxAmount } = useMemo(() => {
    const salesByHour = (data?.salesByHour ?? []) as HourPoint[];
    // Build a 24-cell array (00:00 → 23:00), defaulting to 0
    const full24: HourPoint[] = Array.from({ length: 24 }, (_, h) => {
      const hourStr = String(h);
      const found = salesByHour.find((s) => String(s.hour) === hourStr);
      return {
        hour: hourStr,
        amount: found?.amount ?? 0,
        transactions: found?.transactions ?? 0,
      };
    });

    // Filter to operating hours (6 AM - 9 PM) for display compactness
    const operatingHours = full24.filter((_, i) => i >= 6 && i <= 21);

    const max = Math.max(...operatingHours.map((h) => h.amount), 0);
    const totalToday = operatingHours.reduce((s, h) => s + h.amount, 0);
    const totalTransactions = operatingHours.reduce((s, h) => s + (h.transactions ?? 0), 0);

    let peak = operatingHours[0];
    let quiet: HourPoint | null = null;
    operatingHours.forEach((h) => {
      if (h.amount > peak.amount) peak = h;
      if (h.amount > 0 && (quiet === null || h.amount < quiet.amount)) quiet = h;
    });

    return {
      hours: operatingHours,
      peakHour: peak,
      quietHour: quiet,
      totalToday,
      totalTransactions,
      maxAmount: max,
    };
  }, [data]);

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-600" />
            Hourly Sales Heatmap
          </CardTitle>
          <CardDescription className="text-xs">Today&apos;s revenue by hour</CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <Skeleton className="h-20 w-full mb-3" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-cyan-600" />
              Hourly Sales Heatmap
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Today&apos;s revenue by hour (6 AM – 9 PM)
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-cyan-300 text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/30">
            <TrendingUp className="h-3 w-3 mr-1" />
            {totalTransactions} txns
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {/* Heatmap grid */}
        <div className="grid grid-cols-8 sm:grid-cols-16 gap-1 mb-3" role="img" aria-label="Hourly sales intensity">
          {hours.map((h, i) => {
            const hourNum = parseInt(h.hour, 10);
            const intensity = getIntensity(h.amount, maxAmount);
            return (
              <div
                key={h.hour}
                className={`aspect-square rounded-sm ${heatColor(intensity)} hover:ring-2 hover:ring-cyan-400 hover:ring-offset-1 transition-all duration-200 cursor-default group relative`}
                title={`${hourLabel(hourNum)}: ${formatKES(h.amount)} (${h.transactions ?? 0} txns)`}
              >
                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-background border shadow-sm text-[9px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  {hourLabel(hourNum)}
                </div>
                {i === 0 || hourNum % 3 === 0 ? (
                  <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground/70 whitespace-nowrap">
                    {hourLabel(hourNum).replace('AM', '').replace('PM', '')}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between mt-5 mb-3 text-[9px] text-muted-foreground">
          <span>Less</span>
          <div className="flex items-center gap-0.5">
            <div className="w-3 h-2 rounded-sm bg-muted/40" />
            <div className="w-3 h-2 rounded-sm bg-emerald-300 dark:bg-emerald-800/60" />
            <div className="w-3 h-2 rounded-sm bg-emerald-400 dark:bg-emerald-700/70" />
            <div className="w-3 h-2 rounded-sm bg-amber-400 dark:bg-amber-700/70" />
            <div className="w-3 h-2 rounded-sm bg-rose-500 dark:bg-rose-600/80" />
          </div>
          <span>More</span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border p-2 text-center bg-muted/20">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <Zap className="h-3 w-3 text-amber-500" />
              Peak Hour
            </div>
            <p className="text-sm font-bold mt-0.5 text-amber-700 dark:text-amber-400">
              {peakHour && peakHour.amount > 0 ? hourLabel(parseInt(peakHour.hour, 10)) : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground tabular-nums">
              {peakHour && peakHour.amount > 0 ? formatKES(peakHour.amount) : 'No data'}
            </p>
          </div>

          <div className="rounded-lg border p-2 text-center bg-muted/20">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <SunMoon className="h-3 w-3 text-cyan-500" />
              Quiet Hour
            </div>
            <p className="text-sm font-bold mt-0.5 text-cyan-700 dark:text-cyan-400">
              {quietHour ? hourLabel(parseInt(quietHour.hour, 10)) : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground tabular-nums">
              {quietHour ? formatKES(quietHour.amount) : 'No data'}
            </p>
          </div>

          <div className="rounded-lg border p-2 text-center bg-muted/20">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              Today Total
            </div>
            <p className="text-sm font-bold mt-0.5 text-emerald-700 dark:text-emerald-400">
              {formatKES(totalToday)}
            </p>
            <p className="text-[9px] text-muted-foreground tabular-nums">
              {totalTransactions} transactions
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default HourlySalesWidget;
