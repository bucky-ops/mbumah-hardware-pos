'use client';

/**
 * StatCard — reusable metric / KPI card.
 *
 * Renders an icon + label + value + optional trend indicator. This pattern is
 * duplicated across dashboard, financial, reports, and other tabs, so we
 * centralize it here.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowUpRight, ArrowDownRight, Minus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  /** Icon component from lucide-react */
  icon: LucideIcon;
  /** Short label, e.g. "Today Revenue" */
  label: string;
  /** Pre-formatted value (string) or raw number */
  value: string | number;
  /** Optional percentage change vs previous period. Positive = up, negative = down. */
  trend?: number;
  /** Optional label shown next to the trend, e.g. "vs prev period" */
  trendLabel?: string;
  /** Background classes for the icon container, e.g. "bg-green-100" */
  iconBg?: string;
  /** Color classes for the icon, e.g. "text-green-600" */
  iconColor?: string;
  /** Tailwind border-left color class, e.g. "border-l-green-500" */
  borderLeftColor?: string;
  /** Optional click handler — when present the card becomes interactive */
  onClick?: () => void;
  /** Optional extra classes for the root Card */
  className?: string;
  /** Invert trend colors (e.g. for "debt" where up = bad). Defaults to false. */
  invertTrendColors?: boolean;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  trendLabel,
  iconBg = 'bg-primary/10',
  iconColor = 'text-primary',
  borderLeftColor,
  onClick,
  className,
  invertTrendColors = false,
}: StatCardProps) {
  const hasTrend = typeof trend === 'number' && isFinite(trend);
  const trendUp = hasTrend ? (trend as number) >= 0 : true;
  // By default: up = green (good), down = red (bad). Inverted for metrics like debt.
  const trendColorClass = !hasTrend
    ? 'text-muted-foreground'
    : invertTrendColors
      ? trendUp
        ? 'text-red-500'
        : 'text-green-500'
      : trendUp
        ? 'text-green-500'
        : 'text-red-500';

  const TrendIcon = !hasTrend ? Minus : trendUp ? ArrowUpRight : ArrowDownRight;

  return (
    <Card
      onClick={onClick}
      className={cn(
        'backdrop-blur-sm bg-card/80 transition-all',
        borderLeftColor && 'border-l-4',
        borderLeftColor,
        onClick && 'cursor-pointer hover:shadow-md hover:scale-[1.01]',
        className,
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={cn('p-2 rounded-lg', iconBg)}>
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground truncate">{label}</p>
            <p className="text-xl font-bold truncate">{value}</p>
            {hasTrend && (
              <div className="flex items-center gap-1 mt-0.5">
                <TrendIcon className={cn('h-3 w-3', trendColorClass)} />
                <span className={cn('text-[10px]', trendColorClass)}>
                  {Math.abs(trend as number).toFixed(1)}%
                </span>
                {trendLabel && (
                  <span className="text-[10px] text-muted-foreground">{trendLabel}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StatCard;
