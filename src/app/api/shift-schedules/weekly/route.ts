// GET /api/shift-schedules/weekly?storeId=...&weekStart=YYYY-MM-DD
//
// Returns expanded schedules for the given week (Sun → Sat). Each day in the
// week is represented as an object with the calendar date and the array of
// schedules that apply on that day — both recurring schedules (expanded by
// dayOfWeek) and one-off schedules whose specificDate falls in the week.
//
// Response shape:
//   [
//     {
//       date: "2025-07-28T00:00:00.000Z",
//       schedules: [
//         { ...schedule, durationHours, user: { id, name, role } }
//       ]
//     },
//     ...
//   ]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth } from '@/lib/auth';
import {
  calculateShiftDurationHours,
  getWeekDays,
  getWeekStart,
  type ScheduleLike,
} from '@/lib/shift-schedule-utils';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface WeeklySchedule extends ScheduleLike {
  id: string;
  title: string;
  color: string;
  notes: string | null;
  storeId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  durationHours: number;
  user: { id: string; name: string; role: string; avatarUrl?: string | null };
}

async function weeklyHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const weekStartParam = searchParams.get('weekStart');
  const today = new Date();
  const weekStart = weekStartParam ? new Date(weekStartParam) : getWeekStart(today);
  if (Number.isNaN(weekStart.getTime())) {
    return Response.json(
      { success: false, error: 'weekStart must be a valid YYYY-MM-DD date.' },
      { status: 400 },
    );
  }
  // Normalize to Sunday of that week (caller may pass any day-of-week).
  const sunday = getWeekStart(weekStart);
  const weekDays = getWeekDays(sunday);
  const weekEnd = weekDays[6];
  // End of Saturday (inclusive).
  const weekEndInclusive = new Date(weekEnd);
  weekEndInclusive.setHours(23, 59, 59, 999);

  // Fetch every active/paused schedule for the store. We need both recurring
  // (expand by dayOfWeek) and one-off (filter by specificDate in week).
  const schedules = await db.shiftSchedule.findMany({
    where: {
      storeId,
      status: { in: ['ACTIVE', 'PAUSED'] },
      // Include schedules whose specificDate falls in the week OR null
      // (recurring schedules).
      OR: [
        { specificDate: null },
        { specificDate: { gte: sunday, lte: weekEndInclusive } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
  });

  const byDay = weekDays.map((date) => {
    const daySchedules: WeeklySchedule[] = [];

    for (const s of schedules) {
      // Skip paused schedules — they don't appear on the weekly grid.
      if (s.status === 'PAUSED') continue;

      let applies = false;

      if (s.specificDate) {
        const sd = new Date(s.specificDate);
        sd.setHours(0, 0, 0, 0);
        const d2 = new Date(date);
        d2.setHours(0, 0, 0, 0);
        applies = sd.getTime() === d2.getTime();
      } else if (s.dayOfWeek != null) {
        if (date.getDay() === s.dayOfWeek) {
          // Within the recurrence range (if any).
          if (s.recurrenceEndDate) {
            const end = new Date(s.recurrenceEndDate);
            end.setHours(23, 59, 59, 999);
            applies = date.getTime() <= end.getTime();
          } else {
            applies = true;
          }
        }
      }

      if (!applies) continue;

      daySchedules.push({
        id: s.id,
        storeId: s.storeId,
        userId: s.userId,
        title: s.title,
        dayOfWeek: s.dayOfWeek,
        specificDate: s.specificDate ? s.specificDate.toISOString() : null,
        startTime: s.startTime.toISOString(),
        endTime: s.endTime.toISOString(),
        recurrenceEndDate: s.recurrenceEndDate ? s.recurrenceEndDate.toISOString() : null,
        status: s.status,
        color: s.color,
        notes: s.notes,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        durationHours: calculateShiftDurationHours(s.startTime, s.endTime),
        user: {
          id: s.user.id,
          name: s.user.name,
          role: s.user.role,
          avatarUrl: s.user.avatarUrl,
        },
      });
    }

    // Sort by start time-of-day ascending.
    daySchedules.sort((a, b) => {
      const aMin = new Date(a.startTime).getHours() * 60 + new Date(a.startTime).getMinutes();
      const bMin = new Date(b.startTime).getHours() * 60 + new Date(b.startTime).getMinutes();
      return aMin - bMin;
    });

    return {
      date: date.toISOString(),
      dayOfWeek: date.getDay(),
      isToday:
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate(),
      schedules: daySchedules,
    };
  });

  return Response.json({ success: true, data: byDay });
}

export const GET = withErrorBoundary(
  withFinancialAuth(weeklyHandler, READ_ROLES),
  'SHIFT_SCHEDULES_WEEKLY',
);
