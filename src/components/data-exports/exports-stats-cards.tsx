'use client';

/**
 * ExportsStatsCards — 4 glass-card stat cards for the Data Export Dashboard
 * header: Total Exports, Total Records, Storage Used, Success Rate.
 *
 * Mirrors the styling of `PlansStatsCards` (debt-plans) so the dashboards
 * share a consistent visual language across the app.
 */

import React from 'react';
import {
  CheckCircle2,
  Database,
  HardDrive,
  ListChecks,
  type LucideIcon,
} from 'lucide-react';

import type { DataExportsStats } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ExportsStatsCardsProps {
  stats: DataExportsStats | undefined;
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

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function ExportsStatsCards({ stats, isLoading }: ExportsStatsCardsProps) {
  const successRatePct = stats
    ? (stats.successRate * 100).toFixed(0)
    : '0';

  const cards: StatCardConfig[] = [
    {
      label: 'Total Exports',
      value: String(stats?.totalExports ?? 0),
      icon: Database,
      gradient: 'from-emerald-500 to-emerald-600',
      iconColor: 'text-emerald-500',
      trend: `${stats?.completedExports ?? 0} completed · ${stats?.failedExports ?? 0} failed`,
    },
    {
      label: 'Total Records',
      value: (stats?.totalRecordsExported ?? 0).toLocaleString(),
      icon: ListChecks,
      gradient: 'from-teal-500 to-teal-600',
      iconColor: 'text-teal-500',
      trend: 'Across all generated files',
    },
    {
      label: 'Storage Used',
      value: formatBytes(stats?.totalFileSizeBytes ?? 0),
      icon: HardDrive,
      gradient: 'from-amber-500 to-amber-600',
      iconColor: 'text-amber-500',
      trend: 'Files expire after 7 days',
    },
    {
      label: 'Success Rate',
      value: `${successRatePct}%`,
      icon: CheckCircle2,
      gradient: 'from-green-500 to-green-600',
      iconColor: 'text-green-500',
      trend: 'Completed vs. failed runs',
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

  // Static stagger classes so Tailwind's JIT can statically detect them.
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
                <p className="text-xs text-muted-foreground truncate">
                  {card.label}
                </p>
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
