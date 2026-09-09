'use client';

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HandCoins,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import type { DebtPaymentPlanStats } from '@/lib/api';
import { formatKES } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface PlansStatsCardsProps {
  stats: DebtPaymentPlanStats | undefined;
  isLoading?: boolean;
}

interface StatCardConfig {
  label: string;
  value: string;
  icon: LucideIcon;
  gradient: string;
  iconColor: string;
  trend?: string;
}

export function PlansStatsCards({ stats, isLoading }: PlansStatsCardsProps) {
  // Task 12-d: DEFAULTED exposure is now tracked by the stats endpoint and
  // surfaced here — it was previously invisible (Outstanding only counts
  // ACTIVE/PAUSED plans, so defaulted balances vanished from the dashboard).
  const defaultedOutstanding = stats?.totalDefaultedOutstanding ?? 0;
  const cards: StatCardConfig[] = [
    {
      label: 'Active Plans',
      value: String(stats?.totalActivePlans ?? 0),
      icon: TrendingUp,
      gradient: 'from-emerald-500 to-emerald-600',
      iconColor: 'text-emerald-500',
      trend: `${stats?.totalPendingApproval ?? 0} pending approval`,
    },
    {
      label: 'Outstanding Balance',
      value: formatKES(stats?.totalOutstandingBalance ?? 0),
      icon: HandCoins,
      gradient: 'from-amber-500 to-amber-600',
      iconColor: 'text-amber-500',
      trend:
        defaultedOutstanding > 0
          ? `${formatKES(defaultedOutstanding)} in defaulted plans`
          : undefined,
    },
    {
      label: 'Overdue Plans',
      value: String(stats?.plansWithOverdueInstallments ?? 0),
      icon: AlertTriangle,
      gradient: 'from-rose-500 to-rose-600',
      iconColor: 'text-rose-500',
    },
    {
      label: 'Collected This Month',
      value: formatKES(stats?.totalCollectedThisMonth ?? 0),
      icon: CheckCircle2,
      gradient: 'from-teal-500 to-teal-600',
      iconColor: 'text-teal-500',
      trend: `${stats?.completedThisMonth ?? 0} completed`,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  // Static stagger class lookup so Tailwind can statically detect them.
  const STAGGER_CLASSES = ['stagger-1', 'stagger-2', 'stagger-3', 'stagger-4'];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card, idx) => (
        <Card
          key={card.label}
          className={`glass-card ${STAGGER_CLASSES[idx] ?? 'stagger-1'} hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-default`}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl bg-gradient-to-br ${card.gradient} text-white shadow-sm shrink-0`}
              >
                <card.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground truncate">{card.label}</p>
                <p className="text-xl font-bold truncate">{card.value}</p>
                {card.trend && (
                  <p className="text-[10px] text-muted-foreground/70 truncate">
                    {card.trend}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
