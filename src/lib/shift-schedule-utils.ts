// Shift Schedule — utilities for the planned/roster shift feature.
//
// The `ShiftSchedule` model (table `shift_schedules`) records *planned*
// shifts (recurring weekly or one-off), distinct from the `Shift` model
// which records *actual* worked shifts (clock-in/out).
//
// Time handling:
//   - `startTime` / `endTime` are stored as DateTime values (SQLite
//     compatibility — there's no native TIME type). Only the time-of-day
//     portion matters; the date portion is a fixed epoch (1970-01-01).
//   - Overnight shifts are encoded as endTime < startTime (e.g. start at
//     22:00 and end at 06:00 the next day). `calculateShiftDurationHours`
//     handles this case.

// ── Types ────────────────────────────────────────────────────────────────────

export type ShiftScheduleStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED';

/** Shape used by the expansion helpers — a minimal projection of the DB row. */
export interface ScheduleLike {
  id: string;
  /** 0 = Sunday … 6 = Saturday. `null` when `specificDate` is set. */
  dayOfWeek?: number | null;
  /** ISO string for one-off schedules. `null` when `dayOfWeek` is set. */
  specificDate?: string | Date | null;
  startTime: string | Date;
  endTime: string | Date;
  /** ISO string. `null` means open-ended recurring schedule. */
  recurrenceEndDate?: string | Date | null;
  status?: string;
}

// ── Color palette ────────────────────────────────────────────────────────────
//
// Statically-declared color tokens so Tailwind's JIT can find every class
// in the build. `bg`, `text`, and `border` hold full Tailwind class strings
// for the chosen intensity.

export interface ShiftColor {
  name: string;
  value: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
  gradient: string;
}

export const COLOR_PALETTE: ShiftColor[] = [
  {
    name: 'Emerald',
    value: 'emerald',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-500',
    dot: 'bg-emerald-500',
    gradient: 'from-emerald-500 to-emerald-600',
  },
  {
    name: 'Teal',
    value: 'teal',
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-500',
    dot: 'bg-teal-500',
    gradient: 'from-teal-500 to-teal-600',
  },
  {
    name: 'Amber',
    value: 'amber',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-500',
    dot: 'bg-amber-500',
    gradient: 'from-amber-500 to-amber-600',
  },
  {
    name: 'Rose',
    value: 'rose',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-500',
    dot: 'bg-rose-500',
    gradient: 'from-rose-500 to-rose-600',
  },
  {
    name: 'Violet',
    value: 'violet',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-500',
    dot: 'bg-violet-500',
    gradient: 'from-violet-500 to-violet-600',
  },
  {
    name: 'Cyan',
    value: 'cyan',
    bg: 'bg-cyan-50 dark:bg-cyan-950/40',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-500',
    dot: 'bg-cyan-500',
    gradient: 'from-cyan-500 to-cyan-600',
  },
  {
    name: 'Orange',
    value: 'orange',
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-500',
    dot: 'bg-orange-500',
    gradient: 'from-orange-500 to-orange-600',
  },
  {
    name: 'Purple',
    value: 'purple',
    bg: 'bg-purple-50 dark:bg-purple-950/40',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-500',
    dot: 'bg-purple-500',
    gradient: 'from-purple-500 to-purple-600',
  },
];

const COLOR_MAP: Record<string, ShiftColor> = COLOR_PALETTE.reduce(
  (acc, c) => {
    acc[c.value] = c;
    return acc;
  },
  {} as Record<string, ShiftColor>,
);

export function getColor(value: string | null | undefined): ShiftColor {
  if (value && COLOR_MAP[value]) return COLOR_MAP[value];
  return COLOR_MAP.emerald;
}

// ── Day helpers ──────────────────────────────────────────────────────────────

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Returns the Sunday (00:00 local) of the week containing `date`.
 * Mirrors the convention used by the calendar UI: weeks start on Sunday.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  d.setDate(d.getDate() - dow);
  return d;
}

/**
 * Returns the 7 Date objects (Sun–Sat) for the week starting at `weekStart`.
 * Each Date is normalized to local midnight.
 */
export function getWeekDays(weekStart: Date): Date[] {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** True if `a` and `b` are the same calendar day (ignoring time). */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True if `target` is in [start, end] inclusive of calendar days. */
function isInRange(target: Date, start: Date | null, end: Date | null): boolean {
  const t = new Date(target);
  t.setHours(0, 0, 0, 0);
  if (start) {
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    if (t.getTime() < s.getTime()) return false;
  }
  if (end) {
    const e = new Date(end);
    e.setHours(0, 0, 0, 0);
    if (t.getTime() > e.getTime()) return false;
  }
  return true;
}

// ── Expansion ────────────────────────────────────────────────────────────────
//
// A recurring schedule (dayOfWeek set) applies to every week between its
// implicit start (createdAt or the week of createdAt) and recurrenceEndDate.
// A one-off schedule (specificDate set) only applies to that single day.
//
// We don't store a startDate on the model — the implicit lower bound for
// recurring schedules is the schedule's createdAt (so a schedule created on
// Wednesday doesn't retroactively appear on the previous Tuesday). When the
// caller passes a week that contains createdAt we still emit the matching
// day(s) on/after createdAt within that week.

function scheduleStartDate(schedule: ScheduleLike): Date | null {
  // The model doesn't expose createdAt on ScheduleLike; the caller can pass
  // it in if needed. For our pure helpers we treat the lower bound as
  // "no bound" when it isn't supplied — practical use passes the actual
  // createdAt through the API serialization so the lower bound is honored.
  // We accept an optional `_createdAt` field for callers that have it.
  const created = (schedule as ScheduleLike & { _createdAt?: string | Date })._createdAt;
  if (!created) return null;
  return new Date(created);
}

/**
 * Given a recurring schedule and a week-start date, returns the date(s) in
 * that week the schedule applies to. Returns [] when the schedule is paused,
 * not recurring, or the week falls outside [createdAt, recurrenceEndDate].
 */
export function expandScheduleForWeek(schedule: ScheduleLike, weekStart: Date): Date[] {
  if (schedule.status === 'PAUSED' || schedule.status === 'COMPLETED') return [];
  if (schedule.dayOfWeek == null) return []; // not recurring

  const start = scheduleStartDate(schedule);
  const end = schedule.recurrenceEndDate ? new Date(schedule.recurrenceEndDate) : null;
  const days = getWeekDays(weekStart);
  return days.filter((d) => {
    if (d.getDay() !== schedule.dayOfWeek) return false;
    return isInRange(d, start, end);
  });
}

/**
 * Given a recurring schedule and a month-start date, returns the date(s) in
 * that month the schedule applies to. Returns [] when paused/completed or
 * outside the recurrence window.
 */
export function expandScheduleForMonth(schedule: ScheduleLike, monthStart: Date): Date[] {
  if (schedule.status === 'PAUSED' || schedule.status === 'COMPLETED') return [];
  if (schedule.dayOfWeek == null) return [];

  const start = scheduleStartDate(schedule);
  const end = schedule.recurrenceEndDate ? new Date(schedule.recurrenceEndDate) : null;

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const out: Date[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const d = new Date(year, month, day);
    if (d.getDay() !== schedule.dayOfWeek) continue;
    if (!isInRange(d, start, end)) continue;
    out.push(d);
  }
  return out;
}

/**
 * Returns the schedules that apply to a specific date — either a one-off
 * whose specificDate matches, or a recurring schedule whose dayOfWeek matches
 * AND is within its recurrence range AND status=ACTIVE.
 *
 * NOTE: PAUSED/COMPLETED schedules are excluded. Callers that want a fuller
 * picture (e.g. an "all schedules" admin view) should filter the source list
 * themselves.
 */
export function getSchedulesForDate<T extends ScheduleLike>(
  schedules: T[],
  date: Date,
): T[] {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const start = (s: T) => scheduleStartDate(s);
  return schedules.filter((s) => {
    if (s.status && s.status !== 'ACTIVE') return false;

    if (s.specificDate) {
      const sd = new Date(s.specificDate);
      sd.setHours(0, 0, 0, 0);
      return sd.getTime() === target.getTime();
    }

    if (s.dayOfWeek != null) {
      if (target.getDay() !== s.dayOfWeek) return false;
      const end = s.recurrenceEndDate ? new Date(s.recurrenceEndDate) : null;
      return isInRange(target, start(s), end);
    }

    return false;
  });
}

// ── Time helpers ─────────────────────────────────────────────────────────────

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Formats the time portion of a DateTime as "HH:MM" (24-hour).
 * e.g. 1970-01-01T09:00:00Z (local 12:00) → "12:00".
 */
export function formatTime(value: string | Date): string {
  const d = toDate(value);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Returns a "HH:MM - HH:MM" formatted range for a shift. Only the
 * time-of-day portion of the DateTimes matters.
 */
export function formatTimeRange(
  startTime: string | Date,
  endTime: string | Date,
): string {
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

/**
 * Computes the duration of a shift in hours (decimal). Handles overnight
 * shifts — when endTime's time-of-day is earlier than startTime's, the end
 * is assumed to be the next day (so 22:00 → 06:00 = 8h, not -16h).
 *
 * Returns 0 when either input is missing/invalid.
 */
export function calculateShiftDurationHours(
  startTime: string | Date,
  endTime: string | Date,
): number {
  const start = toDate(startTime);
  const end = toDate(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  // Compare time-of-day in minutes.
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();

  let diffMin: number;
  if (endMin >= startMin) {
    diffMin = endMin - startMin;
  } else {
    // Overnight — wrap around 24h.
    diffMin = 24 * 60 - startMin + endMin;
  }
  return Math.round((diffMin / 60) * 100) / 100;
}

/**
 * Formats a duration (in hours) as "8h" or "8.5h" or "30m" when sub-hour.
 */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0h';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

/**
 * Combines a date (YYYY-MM-DD) and a time (HH:MM) into a Date object.
 * Used when constructing the startTime/endTime values from form inputs.
 */
export function combineDateAndTime(dateISO: string, time: string): Date {
  // The schema only cares about time-of-day for startTime/endTime, but we
  // use the supplied date for storage so the value round-trips cleanly.
  // Use the epoch (1970-01-01) as the base for pure time-of-day storage.
  const baseDate = dateISO || '1970-01-01';
  const [h, m] = time.split(':').map((s) => parseInt(s, 10));
  const d = new Date(`${baseDate}T00:00:00`);
  if (!Number.isNaN(h)) d.setHours(h);
  if (!Number.isNaN(m)) d.setMinutes(m);
  d.setSeconds(0, 0);
  return d;
}

/**
 * Converts a Date (used to store startTime/endTime) into the "HH:MM" value
 * expected by an `<input type="time">`.
 */
export function dateToTimeInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Converts a Date (specificDate) into the "YYYY-MM-DD" value expected by an
 * `<input type="date">`. Uses local time (not UTC) so the value matches the
 * calendar day the user picked.
 */
export function dateToDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Formats a Date's calendar day for display in a week header, e.g. "Jul 28". */
export function formatDayLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Formats a week range, e.g. "Jul 28 - Aug 3, 2025". */
export function formatWeekRange(weekStart: Date): string {
  const days = getWeekDays(weekStart);
  const start = days[0];
  const end = days[6];
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const year = end.getFullYear();
  return `${startStr} - ${endStr}, ${year}`;
}
