// GET /api/shift-schedules/stats?storeId=...&weekStart=YYYY-MM-DD
//
// Aggregated stats for the Shift Scheduling tab:
//   - totalScheduledHours   sum of durationHours across all expanded days
//   - perUserHours          [{ userId, name, role, hours, shiftCount }]
//   - shiftsPerDay          [{ date, dayOfWeek, count, hours }]
//   - coverageGaps          [{ date, dayOfWeek }]  (days with 0 shifts)
//   - peakDay               { date, count, hours } | null
//   - coverageDays          number (0-7) — how many days have ≥ 1 shift
//   - activeStaff           number of distinct staff with ≥ 1 shift this week

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth } from '@/lib/auth';
import {
  calculateShiftDurationHours,
  getWeekDays,
  getWeekStart,
} from '@/lib/shift-schedule-utils';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface PerUserHours {
  userId: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
  hours: number;
  shiftCount: number;
}

interface PerDayStat {
  date: string;
  dayOfWeek: number;
  count: number;
  hours: number;
}

interface CoverageGap {
  date: string;
  dayOfWeek: number;
}

interface StatsResponse {
  totalScheduledHours: number;
  perUserHours: PerUserHours[];
  shiftsPerDay: PerDayStat[];
  coverageGaps: CoverageGap[];
  peakDay: { date: string; dayOfWeek: number; count: number; hours: number } | null;
  coverageDays: number;
  activeStaff: number;
  avgHoursPerStaff: number;
}

async function statsHandler(...args: unknown[]): Promise<Response> {
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
  const sunday = getWeekStart(weekStart);
  const weekDays = getWeekDays(sunday);
  const weekEnd = weekDays[6];
  const weekEndInclusive = new Date(weekEnd);
  weekEndInclusive.setHours(23, 59, 59, 999);

  // Pull all schedules (active only — paused don't contribute to coverage).
  const schedules = await db.shiftSchedule.findMany({
    where: {
      storeId,
      status: 'ACTIVE',
      OR: [
        { specificDate: null },
        { specificDate: { gte: sunday, lte: weekEndInclusive } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
  });

  // Aggregate.
  const perUser = new Map<string, PerUserHours>();
  const perDay: PerDayStat[] = weekDays.map((d) => ({
    date: d.toISOString(),
    dayOfWeek: d.getDay(),
    count: 0,
    hours: 0,
  }));
  let totalHours = 0;

  for (const s of schedules) {
    const duration = calculateShiftDurationHours(s.startTime, s.endTime);

    // Determine which days this schedule applies to.
    const matchingDays: number[] = [];
    for (let i = 0; i < weekDays.length; i++) {
      const date = weekDays[i];
      if (s.specificDate) {
        const sd = new Date(s.specificDate);
        sd.setHours(0, 0, 0, 0);
        const d2 = new Date(date);
        d2.setHours(0, 0, 0, 0);
        if (sd.getTime() === d2.getTime()) matchingDays.push(i);
      } else if (s.dayOfWeek != null && date.getDay() === s.dayOfWeek) {
        if (s.recurrenceEndDate) {
          const end = new Date(s.recurrenceEndDate);
          end.setHours(23, 59, 59, 999);
          if (date.getTime() <= end.getTime()) matchingDays.push(i);
        } else {
          matchingDays.push(i);
        }
      }
    }

    for (const idx of matchingDays) {
      perDay[idx].count += 1;
      perDay[idx].hours = Math.round((perDay[idx].hours + duration) * 100) / 100;
      totalHours = Math.round((totalHours + duration) * 100) / 100;

      const key = s.userId;
      const existing = perUser.get(key);
      if (existing) {
        existing.hours = Math.round((existing.hours + duration) * 100) / 100;
        existing.shiftCount += 1;
      } else {
        perUser.set(key, {
          userId: s.userId,
          name: s.user.name,
          role: s.user.role,
          avatarUrl: s.user.avatarUrl,
          hours: Math.round(duration * 100) / 100,
          shiftCount: 1,
        });
      }
    }
  }

  const perUserHours = Array.from(perUser.values()).sort((a, b) => b.hours - a.hours);

  const coverageGaps: CoverageGap[] = perDay
    .filter((d) => d.count === 0)
    .map((d) => ({ date: d.date, dayOfWeek: d.dayOfWeek }));

  let peakDay: StatsResponse['peakDay'] = null;
  for (const d of perDay) {
    if (d.count > 0 && (!peakDay || d.count > peakDay.count)) {
      peakDay = { ...d };
    }
  }

  const coverageDays = perDay.filter((d) => d.count > 0).length;
  const activeStaff = perUserHours.length;
  const avgHoursPerStaff =
    activeStaff > 0 ? Math.round((totalHours / activeStaff) * 100) / 100 : 0;

  const data: StatsResponse = {
    totalScheduledHours: totalHours,
    perUserHours,
    shiftsPerDay: perDay,
    coverageGaps,
    peakDay,
    coverageDays,
    activeStaff,
    avgHoursPerStaff,
  };

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  withFinancialAuth(statsHandler, READ_ROLES),
  'SHIFT_SCHEDULES_STATS',
);
