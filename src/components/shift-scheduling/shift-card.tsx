'use client';

import React from 'react';
import { Clock, User as UserIcon } from 'lucide-react';

import type { ShiftScheduleItem } from '@/lib/api';
import {
  formatDuration,
  formatTimeRange,
  getColor,
} from '@/lib/shift-schedule-utils';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ShiftCardProps {
  schedule: ShiftScheduleItem;
  onClick?: (schedule: ShiftScheduleItem) => void;
  /** Compact variant stacks content vertically (used in the calendar cells). */
  variant?: 'compact' | 'default';
}

export function ShiftCard({ schedule, onClick, variant = 'default' }: ShiftCardProps) {
  const color = getColor(schedule.color);
  const timeRange = formatTimeRange(schedule.startTime, schedule.endTime);
  const durationLabel = formatDuration(schedule.durationHours);

  const userName = schedule.user?.name ?? 'Unassigned';

  return (
    <button
      type="button"
      onClick={() => onClick?.(schedule)}
      title={schedule.notes ?? undefined}
      className={cn(
        'group relative w-full text-left rounded-lg border-l-4 px-2.5 py-2 transition-all',
        'hover:shadow-md hover:-translate-y-0.5',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-emerald-500/40',
        color.bg,
        color.border,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', color.dot)} />
            <p className={cn('text-xs font-semibold truncate', color.text)}>
              {schedule.title}
            </p>
          </div>
          {variant === 'default' && (
            <p className="text-[11px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
              <UserIcon className="h-2.5 w-2.5 shrink-0" />
              {userName}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{timeRange}</span>
          </p>
        </div>
        <Badge
          variant="secondary"
          className={cn(
            'text-[9px] px-1.5 py-0 h-4 shrink-0 font-semibold',
            color.text,
            'bg-white/70 dark:bg-black/20',
          )}
        >
          {durationLabel}
        </Badge>
      </div>

      {variant === 'default' && schedule.status !== 'ACTIVE' && (
        <span className="absolute top-1 right-1 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          {schedule.status === 'PAUSED' ? '⏸' : '✓'}
        </span>
      )}
    </button>
  );
}
