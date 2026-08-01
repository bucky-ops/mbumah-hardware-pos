'use client';

/**
 * Shift Scheduling Tab — main UI for the planned shift roster feature.
 *
 * Layout:
 *   1. Header with title + week navigation (prev/next/today) + "Add Shift"
 *   2. Stats cards row (ScheduleStatsCards)
 *   3. Two-column layout on desktop:
 *        - Left (2/3): WeeklyCalendar
 *        - Right (1/3): UserHoursBreakdown + color legend
 *   4. Mobile: stacked
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  shiftSchedulesApi,
  type ShiftScheduleItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import {
  COLOR_PALETTE,
  getWeekStart,
  formatWeekRange,
  dateToDateInputValue,
} from '@/lib/shift-schedule-utils';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { WeeklyCalendar } from '@/components/shift-scheduling/weekly-calendar';
import { ScheduleStatsCards } from '@/components/shift-scheduling/schedule-stats-cards';
import { UserHoursBreakdown } from '@/components/shift-scheduling/user-hours-breakdown';
import { CreateScheduleDialog } from '@/components/shift-scheduling/create-schedule-dialog';
import { EditScheduleDialog } from '@/components/shift-scheduling/edit-schedule-dialog';

function todayWeekStart(): string {
  return dateToDateInputValue(getWeekStart(new Date()));
}

export function ShiftSchedulingTab() {
  const { currentStoreId } = useAppStore();
  const [weekStartStr, setWeekStartStr] = useState<string>(todayWeekStart());
  const [createOpen, setCreateOpen] = useState(false);
  const [presetDate, setPresetDate] = useState<string | null>(null);
  const [editSchedule, setEditSchedule] = useState<ShiftScheduleItem | null>(null);

  // ── Week navigation ──────────────────────────────────────────────────────
  const handlePrevWeek = () => {
    const d = new Date(weekStartStr);
    d.setDate(d.getDate() - 7);
    setWeekStartStr(dateToDateInputValue(d));
  };

  const handleNextWeek = () => {
    const d = new Date(weekStartStr);
    d.setDate(d.getDate() + 7);
    setWeekStartStr(dateToDateInputValue(d));
  };

  const handleToday = () => {
    setWeekStartStr(todayWeekStart());
  };

  const weekRangeLabel = useMemo(() => {
    return formatWeekRange(new Date(weekStartStr));
  }, [weekStartStr]);

  // ── Data: weekly schedules ────────────────────────────────────────────────
  const weeklyQueryKey = useMemo(
    () => ['shift-schedules-weekly', currentStoreId, weekStartStr] as const,
    [currentStoreId, weekStartStr],
  );

  const {
    data: weekDays,
    isLoading: weeklyLoading,
    error: weeklyError,
    refetch: refetchWeekly,
    isFetching,
  } = useQuery({
    queryKey: weeklyQueryKey,
    queryFn: async () => {
      const res = await shiftSchedulesApi.weekly(currentStoreId, weekStartStr);
      return res.data ?? [];
    },
    enabled: Boolean(currentStoreId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (weeklyError) {
      const msg = handleError(weeklyError, 'Load weekly shift schedules');
      toast.error('Failed to load weekly schedules', { description: msg });
    }
  }, [weeklyError]);

  // ── Data: stats ─────────────────────────────────────────────────────────
  const statsQueryKey = useMemo(
    () => ['shift-schedules-stats', currentStoreId, weekStartStr] as const,
    [currentStoreId, weekStartStr],
  );

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: statsQueryKey,
    queryFn: async () => {
      const res = await shiftSchedulesApi.stats(currentStoreId, weekStartStr);
      return res.data;
    },
    enabled: Boolean(currentStoreId),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (statsError) {
      const msg = handleError(statsError, 'Load shift schedule stats');
      toast.error('Failed to load stats', { description: msg });
    }
  }, [statsError]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleRefresh = () => {
    refetchWeekly();
    refetchStats();
  };

  const handleSlotClick = (dateISO: string) => {
    setPresetDate(dateISO);
    setCreateOpen(true);
  };

  const handleAddShift = () => {
    setPresetDate(null);
    setCreateOpen(true);
  };

  const handleCreateOpenChange = (next: boolean) => {
    setCreateOpen(next);
    if (!next) setPresetDate(null);
  };

  const handleEditOpenChange = (next: boolean) => {
    if (!next) setEditSchedule(null);
  };

  const totalShifts = useMemo(() => {
    if (!Array.isArray(weekDays)) return 0;
    return weekDays.reduce((sum, d) => sum + d.schedules.length, 0);
  }, [weekDays]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-emerald-500" />
            Shift Scheduling
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan recurring and one-off shift schedules for your staff.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleAddShift}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Shift
          </Button>
        </div>
      </div>

      {/* Stats */}
      <ScheduleStatsCards stats={stats} isLoading={statsLoading} />

      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handlePrevWeek} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleToday}
            className="h-7"
          >
            Today
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleNextWeek} aria-label="Next week">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold ml-2">{weekRangeLabel}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {totalShifts} shift{totalShifts === 1 ? '' : 's'} scheduled
        </div>
      </div>

      {/* Main content: two columns on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Calendar — 2/3 width */}
        <div className="lg:col-span-2">
          <WeeklyCalendar
            weekDays={weekDays}
            isLoading={weeklyLoading}
            onSlotClick={handleSlotClick}
            onShiftClick={setEditSchedule}
          />
        </div>

        {/* Right column — hours breakdown + legend */}
        <div className="space-y-4">
          <UserHoursBreakdown stats={stats} isLoading={statsLoading} />

          {/* Color legend */}
          <div className="rounded-lg border bg-card/50 p-3">
            <p className="text-xs font-semibold mb-2">Color Legend</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {COLOR_PALETTE.map((c) => (
                <div key={c.value} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                  <span className="text-[11px] text-muted-foreground">{c.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Loading skeleton */}
          {weeklyLoading && (
            <Skeleton className="h-32" />
          )}

          {/* Empty state for the week */}
          {!weeklyLoading && totalShifts === 0 && (
            <div className="rounded-lg border-2 border-dashed p-4 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-xs font-semibold">No shifts this week</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Click an empty slot or use &ldquo;Add Shift&rdquo; to schedule staff.
              </p>
              <Button
                size="sm"
                onClick={handleAddShift}
                className="mt-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Shift
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Floating loading indicator */}
      {isFetching && !weeklyLoading && (
        <div className="fixed bottom-4 right-4 bg-background/90 backdrop-blur-sm border rounded-full px-3 py-1.5 text-xs text-muted-foreground shadow-md flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Syncing…
        </div>
      )}

      {/* Dialogs */}
      <CreateScheduleDialog
        open={createOpen}
        onOpenChange={handleCreateOpenChange}
        storeId={currentStoreId}
        presetDate={presetDate}
      />

      <EditScheduleDialog
        open={Boolean(editSchedule)}
        onOpenChange={handleEditOpenChange}
        schedule={editSchedule}
      />
    </div>
  );
}

export default ShiftSchedulingTab;
