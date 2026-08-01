'use client';

import React from 'react';
import { Plus } from 'lucide-react';

import type { ShiftScheduleItem, WeeklyDaySchedule } from '@/lib/api';
import {
  DAY_NAMES_SHORT,
  formatDayLabel,
} from '@/lib/shift-schedule-utils';

import { Skeleton } from '@/components/ui/skeleton';
import { ShiftCard } from './shift-card';
import { cn } from '@/lib/utils';

interface WeeklyCalendarProps {
  weekDays: WeeklyDaySchedule[] | undefined;
  isLoading: boolean;
  onSlotClick: (date: string) => void;
  onShiftClick: (schedule: ShiftScheduleItem) => void;
}

export function WeeklyCalendar({
  weekDays,
  isLoading,
  onSlotClick,
  onShiftClick,
}: WeeklyCalendarProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  const days = weekDays ?? [];

  return (
    <div className="space-y-3">
      {/* Day headers — 7 columns on sm+, stack vertically on mobile */}
      <div className="hidden sm:grid grid-cols-7 gap-2">
        {days.map((d) => {
          const date = new Date(d.date);
          return (
            <div
              key={d.date}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-center',
                d.isToday
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                  : 'border-border bg-muted/30',
              )}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {DAY_NAMES_SHORT[d.dayOfWeek]}
              </div>
              <div
                className={cn(
                  'text-sm font-bold',
                  d.isToday ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground',
                )}
              >
                {formatDayLabel(date)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Calendar grid — 7 columns on sm+, vertical stack on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
        {days.map((d) => {
          const date = new Date(d.date);
          return (
            <div
              key={d.date}
              className={cn(
                'rounded-lg border min-h-[180px] flex flex-col',
                d.isToday
                  ? 'border-emerald-400/70 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-border bg-card/50',
              )}
            >
              {/* Mobile-only inline header */}
              <div className="sm:hidden flex items-center justify-between border-b px-2 py-1.5">
                <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {DAY_NAMES_SHORT[d.dayOfWeek]}
                </span>
                <span
                  className={cn(
                    'text-xs font-bold',
                    d.isToday ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground',
                  )}
                >
                  {formatDayLabel(date)}
                </span>
              </div>

              {/* Schedule list */}
              <div className="flex-1 p-1.5 space-y-1.5 overflow-y-auto max-h-[260px] custom-scrollbar">
                {d.schedules.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onSlotClick(d.date)}
                    className="w-full h-full min-h-[100px] flex flex-col items-center justify-center gap-1 rounded-md text-[10px] text-muted-foreground/60 hover:text-emerald-600 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400 transition-colors border border-dashed border-transparent hover:border-emerald-300"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add shift</span>
                  </button>
                ) : (
                  <>
                    {d.schedules.map((s) => (
                      <ShiftCard
                        key={s.id}
                        schedule={s}
                        onClick={onShiftClick}
                        variant="default"
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => onSlotClick(d.date)}
                      className="w-full flex items-center justify-center gap-1 py-1 rounded-md text-[10px] text-muted-foreground/60 hover:text-emerald-600 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400 transition-colors border border-dashed border-transparent hover:border-emerald-300"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
