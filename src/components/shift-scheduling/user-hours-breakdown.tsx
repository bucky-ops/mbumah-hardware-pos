'use client';

import React from 'react';
import { AlertTriangle, Clock, TrendingDown, TrendingUp } from 'lucide-react';

import type { ShiftScheduleStats } from '@/lib/api';
import { formatDuration } from '@/lib/shift-schedule-utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface UserHoursBreakdownProps {
  stats: ShiftScheduleStats | undefined;
  isLoading?: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}

export function UserHoursBreakdown({ stats, isLoading }: UserHoursBreakdownProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-emerald-500" />
            Per-Staff Hours
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const users = stats?.perUserHours ?? [];
  const maxHours = users.length > 0 ? Math.max(...users.map((u) => u.hours)) : 0;
  // Avg of scheduled staff — used to flag over/under-scheduled.
  const avgHours = stats?.avgHoursPerStaff ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <Clock className="h-4 w-4 text-emerald-500" />
          Per-Staff Hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No staff scheduled this week.
          </div>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {users.map((u) => {
              const pct = maxHours > 0 ? Math.min(100, (u.hours / maxHours) * 100) : 0;
              const overScheduled = avgHours > 0 && u.hours > avgHours * 1.4;
              const underScheduled = avgHours > 0 && u.hours < avgHours * 0.5;
              return (
                <div key={u.userId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={u.avatarUrl ?? undefined} alt={u.name} />
                        <AvatarFallback className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {getInitials(u.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {u.role} · {u.shiftCount} shift{u.shiftCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs font-bold">{formatDuration(u.hours)}</span>
                      {overScheduled && (
                        <TrendingUp
                          className="h-3 w-3 text-rose-500"
                          aria-label="Over-scheduled"
                        />
                      )}
                      {underScheduled && (
                        <TrendingDown
                          className="h-3 w-3 text-amber-500"
                          aria-label="Under-scheduled"
                        />
                      )}
                    </div>
                  </div>
                  <Progress
                    value={pct}
                    className={cn(
                      'h-1.5 bg-muted',
                      overScheduled && '[&>[data-slot=progress-indicator]]:bg-rose-500',
                      underScheduled && '[&>[data-slot=progress-indicator]]:bg-amber-500',
                      !overScheduled && !underScheduled && '[&>[data-slot=progress-indicator]]:bg-emerald-500',
                    )}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Normal
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> Under-scheduled
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" /> Over-scheduled
          </span>
        </div>

        {/* Coverage gaps alert */}
        {(stats?.coverageGaps?.length ?? 0) > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                Coverage Gaps
              </span>
            </div>
            <p className="text-[10px] text-amber-700 dark:text-amber-300">
              {stats?.coverageGaps
                ?.map((g) =>
                  new Date(g.date).toLocaleDateString('en-US', { weekday: 'short' }),
                )
                .join(', ')}
              {' — '}
              {stats?.coverageGaps?.length} day
              {(stats?.coverageGaps?.length ?? 0) === 1 ? '' : 's'} with no shifts.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
