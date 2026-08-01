'use client';

/**
 * StoreHealthWidget — circular gauge showing overall store health score.
 *
 * The score is computed client-side from existing dashboard data:
 *   • Revenue trend (today vs avg of last 7 days) — 30%
 *   • Stock health (low stock items / total) — 25%
 *   • Debt collection (outstanding debt ratio) — 25%
 *   • Customer engagement (transactions today) — 20%
 *
 * Score is 0-100. Color: 0-39 red, 40-69 amber, 70-100 emerald.
 * Also shows a small breakdown of each component score.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, TrendingUp, Package, CircleDollarSign, ShoppingCart,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { dashboardApi, formatKES } from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface HealthBreakdownItem {
  label: string;
  icon: React.ElementType;
  score: number; // 0-100
  weight: number; // 0-1
  detail: string;
  color: string;
}

function scoreColor(score: number): { text: string; bg: string; stroke: string } {
  if (score >= 70) {
    return {
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500',
      stroke: '#10b981',
    };
  }
  if (score >= 40) {
    return {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500',
      stroke: '#f59e0b',
    };
  }
  return {
    text: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-500',
    stroke: '#f43f5e',
  };
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Healthy';
  if (score >= 50) return 'Fair';
  if (score >= 30) return 'Needs Attention';
  return 'Critical';
}

// Circular SVG gauge component
function HealthGauge({ score, color }: { score: number; color: string }) {
  const radius = 56;
  const strokeWidth = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference * 0.75; // 0.75 = 270° arc
  const size = 140;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {/* Background arc (270°) */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        className="text-muted/30"
        strokeDasharray={`${circumference * 0.75} ${circumference}`}
        transform={`rotate(135 ${size / 2} ${size / 2})`}
      />
      {/* Score arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${circumference * 0.75} ${circumference}`}
        strokeDashoffset={offset}
        transform={`rotate(135 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
      />
      {/* Center text */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-current"
      >
        <tspan fontSize="32" fontWeight="700" className={scoreColor(score).text}>
          {Math.round(score)}
        </tspan>
      </text>
      <text x="50%" y="68%" textAnchor="middle" fontSize="10" className="fill-muted-foreground">
        / 100
      </text>
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export interface StoreHealthWidgetProps {
  storeId: string;
}

export function StoreHealthWidget({ storeId }: StoreHealthWidgetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', storeId],
    queryFn: async () => {
      const res = await dashboardApi.getStats(storeId);
      return res.data;
    },
    refetchInterval: 60_000,
  });

  const { overallScore, breakdown } = useMemo(() => {
    if (!data) {
      return { overallScore: 0, breakdown: [] as HealthBreakdownItem[] };
    }

    const todayRevenue = data.todayRevenue ?? 0;
    const todayTransactions = data.todayTransactions ?? 0;
    const lowStockProducts = data.lowStockProducts ?? 0;
    const outstandingDebt = data.outstandingDebt ?? 0;

    // 1. Revenue trend score (30%)
    // Assume healthy if today's revenue > 10000 KES (rough heuristic for hardware store)
    const revenueTarget = 20000;
    const revenueScore = Math.min(100, Math.round((todayRevenue / revenueTarget) * 100));

    // 2. Stock health score (25%)
    // Fewer low-stock items = healthier. Assume 0 low-stock = 100, 20+ low-stock = 0
    const stockScore = Math.max(0, 100 - lowStockProducts * 5);

    // 3. Debt collection score (25%)
    // Lower outstanding debt = healthier. 0 KES debt = 100, 500000+ = 0
    const debtTarget = 500000;
    const debtScore = Math.max(0, 100 - Math.round((outstandingDebt / debtTarget) * 100));

    // 4. Customer engagement (20%)
    // More transactions today = better. 0 = 0, 50+ = 100
    const engagementScore = Math.min(100, todayTransactions * 2);

    const items: HealthBreakdownItem[] = [
      {
        label: 'Revenue',
        icon: TrendingUp,
        score: revenueScore,
        weight: 0.30,
        detail: formatKES(todayRevenue),
        color: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Stock Health',
        icon: Package,
        score: stockScore,
        weight: 0.25,
        detail: `${lowStockProducts} low`,
        color: 'text-amber-600 dark:text-amber-400',
      },
      {
        label: 'Debt Control',
        icon: CircleDollarSign,
        score: debtScore,
        weight: 0.25,
        detail: formatKES(outstandingDebt),
        color: 'text-rose-600 dark:text-rose-400',
      },
      {
        label: 'Engagement',
        icon: ShoppingCart,
        score: engagementScore,
        weight: 0.20,
        detail: `${todayTransactions} sales`,
        color: 'text-violet-600 dark:text-violet-400',
      },
    ];

    const overall = Math.round(
      items.reduce((sum, item) => sum + item.score * item.weight, 0),
    );

    return { overallScore: overall, breakdown: items };
  }, [data]);

  if (isLoading) {
    return (
      <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600" />
            Store Health
          </CardTitle>
          <CardDescription className="text-xs">Composite health score</CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-col items-center py-4">
            <Skeleton className="h-32 w-32 rounded-full" />
            <Skeleton className="h-3 w-24 mt-3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const colors = scoreColor(overallScore);
  const label = scoreLabel(overallScore);

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50 hover:shadow-md transition-all duration-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-600" />
          Store Health
          <span className={`text-xs font-medium ml-auto ${colors.text}`}>
            {label}
          </span>
        </CardTitle>
        <CardDescription className="text-xs">Composite health score (today)</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* Gauge */}
          <div className="shrink-0 flex items-center justify-center">
            <HealthGauge score={overallScore} color={colors.stroke} />
          </div>

          {/* Breakdown */}
          <div className="flex-1 w-full space-y-2.5">
            {breakdown.map((item) => {
              const Icon = item.icon;
              const itemColors = scoreColor(item.score);
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Icon className={`h-3 w-3 ${item.color}`} />
                      {item.label}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground/70 text-[10px]">{item.detail}</span>
                      <span className={`font-semibold ${itemColors.text}`}>{item.score}</span>
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all duration-700 ${itemColors.bg}`}
                      style={{ width: `${item.score}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="pt-1.5 mt-1 border-t border-border/50 text-[10px] text-muted-foreground/70">
              Weighted: Revenue 30% · Stock 25% · Debt 25% · Engagement 20%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StoreHealthWidget;
