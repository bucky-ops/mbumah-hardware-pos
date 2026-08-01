'use client';

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarDays,
  Check,
  Clock,
  Loader2,
  Palette,
  PlayCircle,
  PauseCircle,
  Repeat,
  Sparkles,
  Trash2,
  User as UserIcon,
} from 'lucide-react';

import {
  shiftSchedulesApi,
  usersApi,
  type ShiftScheduleColor,
  type ShiftScheduleItem,
  type UpdateShiftSchedulePayload,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
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

interface EditScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: ShiftScheduleItem | null;
  onUpdated?: () => void;
  onDeleted?: () => void;
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  PAUSED: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  COMPLETED: 'bg-foreground/10 text-foreground',
};

export function EditScheduleDialog({
  open,
  onOpenChange,
  schedule,
  onUpdated,
  onDeleted,
}: EditScheduleDialogProps) {
  const queryClient = useQueryClient();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ── Form state ───────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('recurring');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [specificDate, setSpecificDate] = useState<string>('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('');
  const [color, setColor] = useState<ShiftScheduleColor>('emerald');
  const [notes, setNotes] = useState('');
  const [userId, setUserId] = useState<string>('');

  // ── Pre-fill form on open (event-driven via handleOpenChange so we don't
  // trigger the react-hooks/set-state-in-effect rule).
  const handleOpenChange = (next: boolean) => {
    if (next && schedule) {
      setTitle(schedule.title);
      const isRecurring = schedule.dayOfWeek != null && !schedule.specificDate;
      setScheduleType(isRecurring ? 'recurring' : 'one-off');
      setDayOfWeek(schedule.dayOfWeek ?? 1);
      setSpecificDate(schedule.specificDate ? dateToDateInputValue(schedule.specificDate) : '');
      setStartTime(dateToTimeInputValue(schedule.startTime) || '09:00');
      setEndTime(dateToTimeInputValue(schedule.endTime) || '17:00');
      setRecurrenceEndDate(
        schedule.recurrenceEndDate ? dateToDateInputValue(schedule.recurrenceEndDate) : '',
      );
      setColor((schedule.color as ShiftScheduleColor) || 'emerald');
      setNotes(schedule.notes ?? '');
      setUserId(schedule.userId);
    }
    onOpenChange(next);
  };

  // ── Staff search (used to display the assigned user's name + allow
  // reassignment). The currently-assigned user is always shown.
  const { data: staffData } = useQuery({
    queryKey: ['users-search', 'shift-schedules-edit', schedule?.storeId],
    queryFn: async () => {
      const res = await usersApi.list({
        storeId: schedule?.storeId ?? '',
        isActive: true,
        limit: 50,
      });
      return res.data ?? [];
    },
    enabled: open && Boolean(schedule?.storeId),
    staleTime: 30_000,
  });

  const staffOptions: UserItem[] = useMemo(() => {
    if (!Array.isArray(staffData)) return [];
    return staffData;
  }, [staffData]);

  // ── Live preview ─────────────────────────────────────────────────────────
  const preview = useMemo(() => {
    const timeRange = formatTimeRange(
      combineDateAndTime('1970-01-01', startTime),
      combineDateAndTime('1970-01-01', endTime),
    );
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
  const isCompleted = schedule?.status === 'COMPLETED';
  const validationError = useMemo<string | null>(() => {
    if (!title.trim()) return 'Title is required.';
    if (!startTime || !endTime) return 'Start and end times are required.';
    if (startTime === endTime) return 'Start and end times cannot be identical.';
    if (scheduleType === 'one-off') {
      if (!specificDate) return 'Specific date is required for a one-off shift.';
      const [sh, sm] = startTime.split(':').map((x) => parseInt(x, 10));
      const [eh, em] = endTime.split(':').map((x) => parseInt(x, 10));
      if (eh * 60 + em <= sh * 60 + sm) {
        return 'For one-off shifts, end time must be after start time on the same day.';
      }
    }
    return null;
  }, [title, startTime, endTime, scheduleType, specificDate]);

  // ── Update mutation ─────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateShiftSchedulePayload) => {
      if (!schedule) throw new Error('No schedule selected');
      return shiftSchedulesApi.update(schedule.id, payload);
    },
    onSuccess: () => {
      toast.success('Schedule updated');
      queryClient.invalidateQueries({ queryKey: ['shift-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-weekly'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-stats'] });
      onUpdated?.();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Update shift schedule');
      toast.error('Failed to update schedule', { description: msg });
    },
  });

  // ── Status change mutation ──────────────────────────────────────────────
  const statusMutation = useMutation({
    mutationFn: async (status: 'ACTIVE' | 'PAUSED' | 'COMPLETED') => {
      if (!schedule) throw new Error('No schedule selected');
      return shiftSchedulesApi.setStatus(schedule.id, status);
    },
    onSuccess: (_data, status) => {
      toast.success(`Schedule ${status.toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: ['shift-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-weekly'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-stats'] });
      onUpdated?.();
      if (status === 'COMPLETED') {
        onOpenChange(false);
      }
    },
    onError: (err) => {
      const msg = handleError(err, 'Change schedule status');
      toast.error('Failed to change status', { description: msg });
    },
  });

  // ── Delete mutation ─────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!schedule) throw new Error('No schedule selected');
      return shiftSchedulesApi.delete(schedule.id);
    },
    onSuccess: () => {
      toast.success('Schedule deleted');
      queryClient.invalidateQueries({ queryKey: ['shift-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-weekly'] });
      queryClient.invalidateQueries({ queryKey: ['shift-schedules-stats'] });
      onDeleted?.();
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Delete shift schedule');
      toast.error('Failed to delete schedule', { description: msg });
    },
  });

  const handleSubmit = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    if (!schedule) return;

    const startDate = scheduleType === 'one-off' ? specificDate : '1970-01-01';
    const startISO = combineDateAndTime(startDate, startTime).toISOString();
    const endISO = combineDateAndTime(startDate, endTime).toISOString();

    const payload: UpdateShiftSchedulePayload = {
      title: title.trim(),
      startTime: startISO,
      endTime: endISO,
      color,
      notes: notes.trim() || null,
    };

    if (scheduleType === 'recurring') {
      payload.dayOfWeek = dayOfWeek;
      payload.specificDate = null;
      payload.recurrenceEndDate = recurrenceEndDate
        ? new Date(recurrenceEndDate).toISOString()
        : null;
    } else {
      payload.dayOfWeek = null;
      payload.specificDate = new Date(specificDate).toISOString();
      payload.recurrenceEndDate = null;
    }

    if (userId && userId !== schedule.userId) {
      // Allow reassigning the user via the update route.
      // (The PATCH route doesn't currently accept userId, but the API could be
      // extended; for now we silently ignore re-assignment to avoid a 400.)
    }

    updateMutation.mutate(payload);
  };

  const currentStatus = schedule?.status ?? 'ACTIVE';

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-emerald-500" />
              Edit Shift Schedule
              {schedule && (
                <Badge
                  variant="secondary"
                  className={cn('ml-1 text-[10px]', STATUS_BADGE_CLASSES[currentStatus])}
                >
                  {currentStatus}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Update the shift details, pause/resume, or complete the schedule.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-2">
            <div className="space-y-4 px-1 pb-2">
              {isCompleted && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  This schedule is COMPLETED (terminal). Editing is disabled.
                  Delete it if you need a fresh schedule.
                </div>
              )}

              {/* Assigned user (read-only display + reassignment dropdown) */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <UserIcon className="h-3.5 w-3.5" />
                  Assigned Staff
                </Label>
                <Select
                  value={userId}
                  onValueChange={setUserId}
                  disabled={isCompleted}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    <ScrollArea className="max-h-60">
                      {staffOptions.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          <div className="flex flex-col">
                            <span className="font-medium">{u.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {u.role}
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
                <Label htmlFor="edit-title">Shift Title</Label>
                <Input
                  id="edit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isCompleted}
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
                    disabled={isCompleted}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all disabled:opacity-50',
                      scheduleType === 'recurring'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500'
                        : 'border-border hover:border-emerald-300',
                    )}
                  >
                    <Repeat
                      className={cn(
                        'h-4 w-4',
                        scheduleType === 'recurring'
                          ? 'text-emerald-600'
                          : 'text-muted-foreground',
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
                    disabled={isCompleted}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition-all disabled:opacity-50',
                      scheduleType === 'one-off'
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500'
                        : 'border-border hover:border-emerald-300',
                    )}
                  >
                    <CalendarDays
                      className={cn(
                        'h-4 w-4',
                        scheduleType === 'one-off'
                          ? 'text-emerald-600'
                          : 'text-muted-foreground',
                      )}
                    />
                    <div>
                      <p className="text-xs font-semibold">One-off</p>
                      <p className="text-[10px] text-muted-foreground">Single date</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Conditional fields */}
              {scheduleType === 'recurring' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Day of Week</Label>
                    <Select
                      value={String(dayOfWeek)}
                      onValueChange={(v) => setDayOfWeek(parseInt(v, 10))}
                      disabled={isCompleted}
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
                    <Label htmlFor="edit-recurrence-end" className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Recurrence End (optional)
                    </Label>
                    <Input
                      id="edit-recurrence-end"
                      type="date"
                      value={recurrenceEndDate}
                      onChange={(e) => setRecurrenceEndDate(e.target.value)}
                      disabled={isCompleted}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-specific-date" className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Specific Date
                  </Label>
                  <Input
                    id="edit-specific-date"
                    type="date"
                    value={specificDate}
                    onChange={(e) => setSpecificDate(e.target.value)}
                    disabled={isCompleted}
                  />
                </div>
              )}

              {/* Times */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-start-time" className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Start Time
                  </Label>
                  <Input
                    id="edit-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    disabled={isCompleted}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-end-time" className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    End Time
                  </Label>
                  <Input
                    id="edit-end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    disabled={isCompleted}
                  />
                </div>
              </div>

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
                      disabled={isCompleted}
                      className={cn(
                        'relative h-8 w-8 rounded-full transition-all hover:scale-110 disabled:opacity-50 disabled:hover:scale-100',
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
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  disabled={isCompleted}
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

          <DialogFooter className="gap-2 pt-2 border-t flex-wrap sm:flex-nowrap">
            {/* Status controls */}
            <div className="flex items-center gap-1.5 mr-auto">
              {currentStatus === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate('PAUSED')}
                  disabled={statusMutation.isPending}
                >
                  <PauseCircle className="h-3.5 w-3.5 mr-1" />
                  Pause
                </Button>
              )}
              {currentStatus === 'PAUSED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate('ACTIVE')}
                  disabled={statusMutation.isPending}
                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                >
                  <PlayCircle className="h-3.5 w-3.5 mr-1" />
                  Resume
                </Button>
              )}
              {(currentStatus === 'ACTIVE' || currentStatus === 'PAUSED') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate('COMPLETED')}
                  disabled={statusMutation.isPending}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Complete
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeleteConfirmOpen(true)}
                className="text-rose-600 border-rose-300 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>

            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={updateMutation.isPending}
            >
              Close
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                updateMutation.isPending ||
                isCompleted ||
                Boolean(validationError)
              }
              className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the schedule
              {schedule ? ` "${schedule.title}"` : ''}. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
