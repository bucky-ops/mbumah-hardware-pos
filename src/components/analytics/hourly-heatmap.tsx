'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Flame } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatKES } from '@/lib/api';
import {
  dayName,
  heatIntensity,
  hourLabel,
  type HeatmapMatrix,
  type PeakHour,
} from '@/lib/analytics-utils';

export interface HourlyHeatmapData {
  days: number;
  windowStart: string;
  matrix: HeatmapMatrix;
  peakHours: PeakHour[];
}

interface HourlyHeatmapProps {
  data: HourlyHeatmapData | null;
  loading?: boolean;
  className?: string;
}

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Tailwind-compatible bg classes by intensity (0–4).
// We use emerald for "hot" intensity, fading to muted for cold cells.
const INTENSITY_BG: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-muted/30',
  1: 'bg-emerald-200/50 dark:bg-emerald-900/20',
  2: 'bg-emerald-300/70 dark:bg-emerald-700/40',
  3: 'bg-emerald-400/80 dark:bg-emerald-600/60',
  4: 'bg-emerald-500 dark:bg-emerald-500',
};

const INTENSITY_TEXT: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'text-muted-foreground/40',
  1: 'text-emerald-900/70 dark:text-emerald-100/70',
  2: 'text-emerald-950 dark:text-emerald-50',
  3: 'text-white',
  4: 'text-white',
};

interface HoverCell {
  day: number;
  hour: number;
  revenue: number;
  transactions: number;
}

export function HourlyHeatmap({ data, loading, className }: HourlyHeatmapProps) {
  const [hover, setHover] = useState<HoverCell | null>(null);

  const matrix = data?.matrix;
  const peakHours = useMemo(() => data?.peakHours ?? [], [data]);
  const maxValue = matrix?.maxValue ?? 0;

  // Pre-compute peak-hour set for highlight border.
  const peakSet = useMemo(() => {
    const s = new Set<string>();
    for (const p of peakHours) s.add(`${p.day}-${p.hour}`);
    return s;
  }, [peakHours]);

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-sky-500" />
          Hourly Sales Heatmap
        </CardTitle>
        <CardDescription>
          Revenue intensity by day-of-week × hour-of-day
          {data?.days ? ` (last ${data.days} days)` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <Skeleton className="h-[260px] w-full rounded-md" />
        ) : !data || !matrix || matrix.totalRevenue === 0 ? (
          <div className="flex h-[260px] flex-col items-center justify-center text-center gap-2 text-muted-foreground">
            <Clock className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No heatmap data yet</p>
            <p className="text-xs">Peak sales hours will appear here once transactions are recorded.</p>
          </div>
        ) : (
          <>
            {/* Peak hours legend */}
            {peakHours.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                  <Flame className="h-3 w-3 text-orange-500" />
                  Peak hours:
                </span>
                {peakHours.map((p, i) => (
                  <Badge
                    key={`${p.day}-${p.hour}`}
                    variant="outline"
                    className="gap-1 text-[11px] font-medium bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900"
                  >
                    {i + 1}. {dayName(p.day)} {hourLabel(p.hour)}
                    <span className="text-[10px] font-normal opacity-70">
                      ({formatKES(p.revenue)})
                    </span>
                  </Badge>
                ))}
              </div>
            )}

            <div className="overflow-x-auto custom-scrollbar -mx-1">
              <div className="min-w-[640px] px-1">
                {/* Hour labels (top) */}
                <div className="grid grid-cols-[40px_repeat(24,1fr)] gap-px mb-1">
                  <div />
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div
                      key={h}
                      className="text-[9px] text-muted-foreground/70 text-center tabular-nums"
                    >
                      {h % 2 === 0 ? `${String(h).padStart(2, '0')}` : ''}
                    </div>
                  ))}
                </div>

                {/* Heatmap rows (7 days × 24 hours) */}
                {matrix.cells.map((dayRow, day) => (
                  <div
                    key={day}
                    className="grid grid-cols-[40px_repeat(24,1fr)] gap-px mb-1"
                  >
                    <div className="text-[10px] font-medium text-muted-foreground flex items-center pr-1 justify-end">
                      {DAYS_SHORT[day]}
                    </div>
                    {dayRow.map((cell, hour) => {
                      const intensity = heatIntensity(cell.revenue, maxValue);
                      const isPeak = peakSet.has(`${day}-${hour}`);
                      const isHovered = hover?.day === day && hover?.hour === hour;
                      return (
                        <motion.button
                          type="button"
                          key={hour}
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.15, delay: (day * 24 + hour) * 0.001 }}
                          onMouseEnter={() => setHover({ day, hour, revenue: cell.revenue, transactions: cell.transactions })}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover({ day, hour, revenue: cell.revenue, transactions: cell.transactions })}
                          onBlur={() => setHover(null)}
                          className={cn(
                            'relative h-6 rounded-sm transition-all',
                            INTENSITY_BG[intensity],
                            INTENSITY_TEXT[intensity],
                            isPeak && 'ring-2 ring-orange-400 ring-offset-1 ring-offset-background',
                            isHovered && 'scale-110 z-10 ring-2 ring-foreground/30',
                            cell.revenue === 0 && 'cursor-default',
                          )}
                          aria-label={`${dayName(day, true)} ${hourLabel(hour)}: ${formatKES(cell.revenue)} over ${cell.transactions} transactions`}
                          title={`${dayName(day, true)} ${hourLabel(hour)} — ${formatKES(cell.revenue)} (${cell.transactions} txns)`}
                        >
                          {intensity >= 3 && cell.transactions > 0 && (
                            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold tabular-nums leading-none">
                              {cell.transactions}
                            </span>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                ))}

                {/* Intensity legend */}
                <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                  <span>Less</span>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={cn('h-3 w-3 rounded-sm', INTENSITY_BG[i as 0 | 1 | 2 | 3 | 4])}
                    />
                  ))}
                  <span>More</span>
                </div>
              </div>
            </div>

            {/* Hover detail bar */}
            <div className="mt-3 min-h-[28px] flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-xs">
              {hover ? (
                <>
                  <span className="font-medium">
                    {dayName(hover.day, true)}, {hourLabel(hover.hour)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {hover.transactions.toLocaleString('en-KE')} transactions ·{' '}
                    <span className="font-semibold text-foreground">
                      {formatKES(hover.revenue)}
                    </span>
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground/60">
                  Hover over a cell to see detailed revenue and transaction count.
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default HourlyHeatmap;
