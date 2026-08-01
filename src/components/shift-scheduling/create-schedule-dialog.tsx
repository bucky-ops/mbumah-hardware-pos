'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  Check,
  Clock,
  Loader2,
  Palette,
  Repeat,
  Sparkles,
  User as UserIcon,
} from 'lucide-react';

import {
  shiftSchedulesApi,
  usersApi,
  type CreateShiftSchedulePayload,
  type ShiftScheduleColor,
  type UserItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import {
  COLOR_PALETTE,
  DAY_NAMES,
  combineDateAndTime,
  dateToDateInputValue,
  dateToTimeInputValue,
  formatDuration,
  formatTimeRange,
} from '@/lib/shift-schedule-utils';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type ScheduleType = 'recurring' | 'one-off';

interface CreateScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** Pre-selected date (ISO) for a one-off shift when launched from a calendar slot. */
  presetDate?: string | null;
  /** Optional userId to pre-select (e.g. when launched from a user's row). */
  presetUserId?: string | null;
  onCreated?: () => void;
}

const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

export function CreateScheduleDialog({
  open,
  onOpenChange,
  storeId,
  presetDate,
  presetUserId,
  onCreated,
}: CreateScheduleDialogProps) {
  const queryClient = useQueryClient();

  // ── Form state ───────────────────────────────────────────────────────────
  const [staffSearch, setStaffSearch] = useState('');
  const [userId, setUserId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('recurring');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1); // Monday by default
  const [specificDate, setSpecificDate] = useState<string>('');
  const [startTime, setStartTime] = useState<string>(DEFAULT_START);
  const [endTime, setEndTime] = useState<string>(DEFAULT_END);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string>('');
  const [color, setColor] = useState<ShiftScheduleColor>('emerald');
  const [notes, setNotes] = useState<string>('');

  // ── Staff search query ─────────────────────────────────────────────────
  const { data: staffData, isLoading: isLoadingStaff } = useQuery({
    queryKey: ['users-search', 'shift-schedules', staffSearch, storeId],
    queryFn: async () => {
      const res = await usersApi.list({
        storeId,
        isActive: true,
        search: staffSearch || undefined,
        limit: 30,
      });
      return res.data ?? [];
    },
    enabled: open,
    staleTime: 15_000,
  });

  const staffOptions: UserItem[] = useMemo(() => {
    if (!Array.isArray(staffData)) return [];
    return staffData;
  }, [staffData]);

  // ── Reset form on close, pre-fill on open (event-driven, not effect-driven)
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setStaffSearch('');
      setUserId('');
      setTitle('');
      setScheduleType('recurring');
      setDayOfWeek(1);
      setSpecificDate('');
      setStartTime(DEFAULT_START);
      setEndTime(DEFAULT_END);
      setRecurrenceEndDate('');
      setColor('emerald');
      setNotes('');
    } else {
      // Pre-fill from props when opening.
      if (presetDate) {
        setSpecificDate(presetDate.slice(0, 10));
        setScheduleType('one-off');
      }
      if (presetUserId) {
        setUserId(presetUserId);
      }
    }
    onOpenChange(next);
  };

  // ── Live preview ─────────────────────────────────────────────────────────
  const preview = useMemo(() => {
    const timeRange = formatTimeRange(
      combineDateAndTime('1970-01-01', startTime),
      combineDateAndTime('1970-01-01', endTime),
    );
    // Duration: compute via Date diff (overnight aware).
    const [sh, sm] = startTime.split(':').map((x) => parseInt(x, 10));
    const [eh, em] = endTime.split(':').map((x) => parseInt(x, 10));
    let diffMin: number;
    if (eh * 60 + em >= sh * 60 + sm) {
      diffMin = eh * 60 + em - (sh * 60 + sm);
    } else {
      diffMin = 24 * 60 - (sh * 60 + sm) + (eh * 60 + em);
    }
    const hours = Math.round((diffMin / 60) * 100) / 100;

    let when = '';
    if (scheduleType === 'recurring') {
      when = DAY_NAMES[dayOfWeek] ?? '';
    } else if (specificDate) {
      const d = new Date(specificDate);
      when = d.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    }

    return { timeRange, hours, when };
  }, [startTime, endTime, scheduleType, dayOfWeek, specificDate]);

  // ── Validation ──────────────────────────────────────────────────────────
  const validationError = useMemo<string | null>(() => {
    if (!userId) return 'Please select a staff member.';
    if (!title.trim()) return 'Title is required (e.g. "Morning").';
    if (!startTime || !endTime) return 'Start and end times are required.';
    if (startTime === endTime) return 'Start and end times cannot be identical.';

    if (scheduleType === 'one-off') {
      if (!specificDate) return 'Specific date is required for a one-off shift.';
      // No overnight for one-off shifts.
      const [sh, sm] = startTime.split(':').map((x) => parseInt(x, 10));
      const [eh, em] = endTime.split(':').map((x) => parseInt(x, 10));
      if (eh * 60 + em <= sh * 60 + sm) {
        return 'For one-off shifts, end time must be after start time on the same day.';
      }
    }

    if (recurrenceEndDate) {
      const end = new Date(recurrenceEndDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (end.getTime() < today.getTime()) {
        return 'Recurrence end date cannot be in the past.';
      }
    }

    return null;
  }, [userId, title, startTime, endTime, scheduleType, specificDate, recurrenceEndDate]);

  // ── Create mutation ────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (payload: CreateShiftSchedulePayload) =>
      shiftSchedulesApi.create(payload),
    onSuccess: () => {
      toast.success('Shift schedule created', {
        description: preview.when
          ? `${preview.when} · ${preview.timeRange}`
          : preview.timeRange,
      });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-weekly'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-stats'] });
      onCreated?.();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Create shift schedule');
      toast.error('Failed to create schedule', { description: msg });
    },
  });

  const handleSubmit = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }

    // Combine date + time. Use the epoch as the date portion so the value
    // round-trips as a pure time-of-day; the API persists it as DateTime.
    const startDate = scheduleType === 'one-off' ? specificDate : '1970-01-01';
    const startISO = combineDateAndTime(startDate, startTime).toISOString();
    const endISO = combineDateAndTime(startDate, endTime).toISOString();

    const payload: CreateShiftSchedulePayload = {
      storeId,
      userId,
      title: title.trim(),
      startTime: startISO,
      endTime: endISO,
      color,
      notes: notes.trim() || undefined,
    };

    if (scheduleType === 'recurring') {
      payload.dayOfWeek = dayOfWeek;
      payload.recurrenceEndDate = recurrenceEndDate
        ? new Date(recurrenceEndDate).toISOString()
        : null;
    } else {
      payload.specificDate = new Date(specificDate).toISOString();
    }

    createMutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-emerald-500" />
            Create Shift Schedule
          </DialogTitle>
          <DialogDescription>
            Assign a recurring weekly shift or a one-off shift to a staff member.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4 px-1 pb-2">
            {/* Staff search + select */}
            <div className="space-y-1.5">
              <Label htmlFor="staff-search">Staff Member</Label>
              <Input
                id="staff-search"
                placeholder="Search by name or email…"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
              />
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoadingStaff
                        ? 'Loading staff…'
                        : staffOptions.length === 0
                          ? 'No staff found'
                          : 'Select a staff member'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-60">
                    {staffOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        <div className="flex flex-col">
                          <span className="font-medium flex items-center gap-1.5">
                            <UserIcon className="h-3 w-3 text-muted-foreground" />
                            {u.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {u.role} · {u.email}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="title">Shift Title</Label>
              <Input
                id="title"
                placeholder="e.g. Morning, Evening, Weekend"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
              />
            </div>

            {/* Type toggle */}
            <div className="space-y-1.5">
              <Label>Schedule Type</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleType('recurring')}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all',
                    scheduleType === 'recurring'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500'
                      : 'border-border hover:border-emerald-300',
                  )}
                >
                  <Repeat
                    className={cn(
                      'h-4 w-4',
                      scheduleType === 'recurring' ? 'text-emerald-600' : 'text-muted-foreground',
                    )}
                  />
                  <div>
                    <p className="text-xs font-semibold">Recurring (weekly)</p>
                    <p className="text-[10px] text-muted-foreground">Repeats every week</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleType('one-off')}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all',
                    scheduleType === 'one-off'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500'
                      : 'border-border hover:border-emerald-300',
                  )}
                >
                  <CalendarDays
                    className={cn(
                      'h-4 w-4',
                      scheduleType === 'one-off' ? 'text-emerald-600' : 'text-muted-foreground',
                    )}
                  />
                  <div>
                    <p className="text-xs font-semibold">One-off</p>
                    <p className="text-[10px] text-muted-foreground">Single date</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Conditional: recurring — dayOfWeek + recurrenceEndDate */}
            {scheduleType === 'recurring' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Day of Week</Label>
                  <Select
                    value={String(dayOfWeek)}
                    onValueChange={(v) => setDayOfWeek(parseInt(v, 10))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_NAMES.map((name, idx) => (
                        <SelectItem key={idx} value={String(idx)}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="recurrence-end" className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Recurrence End (optional)
                  </Label>
                  <Input
                    id="recurrence-end"
                    type="date"
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Conditional: one-off — specificDate */}
            {scheduleType === 'one-off' && (
              <div className="space-y-1.5">
                <Label htmlFor="specific-date" className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Specific Date
                </Label>
                <Input
                  id="specific-date"
                  type="date"
                  value={specificDate}
                  onChange={(e) => setSpecificDate(e.target.value)}
                />
              </div>
            )}

            {/* Times */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="start-time" className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Start Time
                </Label>
                <Input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="end-time" className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  End Time
                </Label>
                <Input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-2">
              For recurring shifts, an end time earlier than the start time is
              treated as an overnight shift (e.g. 22:00 → 06:00).
            </p>

            {/* Color picker */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                <Palette className="h-3.5 w-3.5" />
                Color Label
              </Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.name}
                    onClick={() => setColor(c.value as ShiftScheduleColor)}
                    className={cn(
                      'relative h-8 w-8 rounded-full transition-all hover:scale-110',
                      c.dot,
                      color === c.value
                        ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground'
                        : '',
                    )}
                  >
                    {color === c.value && (
                      <Check className="absolute inset-0 m-auto h-4 w-4 text-white" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Optional notes about this shift (e.g. training, key holder)…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            {/* Live preview */}
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Schedule Preview
                </span>
              </div>
              <p className="text-xs text-emerald-800 dark:text-emerald-200">
                <span className="font-semibold">{preview.when || '—'}</span>
                {' · '}
                <span>{preview.timeRange}</span>
                {' · '}
                <span className="font-semibold">{formatDuration(preview.hours)}</span>
              </p>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 pt-2 border-t">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending || Boolean(validationError)}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <CalendarDays className="h-4 w-4 mr-1" />
            )}
            Create Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Helpers re-exported so the edit dialog can reuse the form layout if needed.
export {
  dateToDateInputValue,
  dateToTimeInputValue,
  DEFAULT_START,
  DEFAULT_END,
};
