'use client';

import React from 'react';
import {
  CalendarCheck,
  Clock,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { ShiftScheduleStats } from '@/lib/api';
import { formatDuration } from '@/lib/shift-schedule-utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ScheduleStatsCardsProps {
  stats: ShiftScheduleStats | undefined;
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

export function ScheduleStatsCards({ stats, isLoading }: ScheduleStatsCardsProps) {
  const cards: StatCardConfig[] = [
    {
      label: 'Total Hours This Week',
      value: formatDuration(stats?.totalScheduledHours ?? 0),
      icon: Clock,
      gradient: 'from-emerald-500 to-emerald-600',
      iconColor: 'text-emerald-500',
      trend: `${stats?.activeStaff ?? 0} active staff`,
    },
    {
      label: 'Active Staff',
      value: String(stats?.activeStaff ?? 0),
      icon: Users,
      gradient: 'from-teal-500 to-teal-600',
      iconColor: 'text-teal-500',
      trend: `${stats?.coverageDays ?? 0}/7 days covered`,
    },
    {
      label: 'Coverage Days',
      value: `${stats?.coverageDays ?? 0} / 7`,
      icon: CalendarCheck,
      gradient: 'from-amber-500 to-amber-600',
      iconColor: 'text-amber-500',
      trend:
        (stats?.coverageGaps?.length ?? 0) > 0
          ? `${stats?.coverageGaps?.length ?? 0} gap${(stats?.coverageGaps?.length ?? 0) === 1 ? '' : 's'}`
          : 'Full coverage',
    },
    {
      label: 'Avg Hours / Staff',
      value: formatDuration(stats?.avgHoursPerStaff ?? 0),
      icon: TrendingUp,
      gradient: 'from-violet-500 to-violet-600',
      iconColor: 'text-violet-500',
      trend: stats?.peakDay
        ? `Peak: ${new Date(stats.peakDay.date).toLocaleDateString('en-US', { weekday: 'short' })}`
        : 'No peak',
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
