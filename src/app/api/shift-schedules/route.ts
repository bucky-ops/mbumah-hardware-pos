// GET/POST /api/shift-schedules
//
// Planned shift schedules (the roster). Mirrors the auth/tenancy pattern of
// /api/shifts and the financial routes: `withErrorBoundary(withFinancialAuth(...))`.
//
// GET  ?storeId=...&userId=...&status=...&dateFrom=...&dateTo=...
// POST { storeId, userId, title, dayOfWeek?, specificDate?, startTime, endTime,
//        recurrenceEndDate?, color?, notes? }
//
// Validation:
//   - Exactly one of dayOfWeek (recurring) / specificDate (one-off) must be
//     set, not both.
//   - For overnight shifts, endTime's time-of-day may be earlier than
//     startTime's (e.g. 22:00 → 06:00); that's allowed.
//   - For recurring shifts, recurrenceEndDate is recommended (warned, not
//     required — open-ended schedules are valid).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  calculateShiftDurationHours,
  type ShiftScheduleStatus,
} from '@/lib/shift-schedule-utils';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

const VALID_STATUSES: ShiftScheduleStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED'];
const VALID_COLORS = ['emerald', 'teal', 'amber', 'rose', 'violet', 'cyan', 'orange', 'purple'];

// ── GET: list schedules ──────────────────────────────────────────────────────

async function listSchedulesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    // Mirrors /api/shifts: gracefully return an empty list before a store is
    // selected rather than a hard 400 that floods the console.
    return Response.json({ success: true, data: [] });
  }

  const userId = searchParams.get('userId') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  const where: Record<string, unknown> = { storeId };
  if (userId) where.userId = userId;
  if (status) {
    if (!VALID_STATUSES.includes(status as ShiftScheduleStatus)) {
      return Response.json(
        { success: false, error: `Invalid status: ${status}` },
        { status: 400 },
      );
    }
    where.status = status;
  }

  // Date filters apply to specificDate. Recurring schedules don't have a
  // specificDate so they're included unless the caller explicitly filters
  // by date range (in which case they remain in the result; the caller can
  // expand them with the utils).
  if (dateFrom || dateTo) {
    const range: Record<string, unknown> = {};
    if (dateFrom) range.gte = new Date(dateFrom);
    if (dateTo) range.lte = new Date(dateTo);
    where.specificDate = range;
  }

  const schedules = await db.shiftSchedule.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
      store: { select: { id: true, name: true } },
    },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });

  const data = schedules.map((s) => ({
    ...s,
    startTime: s.startTime.toISOString(),
    endTime: s.endTime.toISOString(),
    specificDate: s.specificDate ? s.specificDate.toISOString() : null,
    recurrenceEndDate: s.recurrenceEndDate ? s.recurrenceEndDate.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    durationHours: calculateShiftDurationHours(s.startTime, s.endTime),
  }));

  return Response.json({ success: true, data });
}

// ── POST: create a schedule ──────────────────────────────────────────────────

interface CreateBody {
  storeId?: string;
  userId?: string;
  title?: string;
  dayOfWeek?: number | null;
  specificDate?: string | null;
  startTime?: string;
  endTime?: string;
  recurrenceEndDate?: string | null;
  color?: string;
  notes?: string;
}

async function createScheduleHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = (await request.json()) as CreateBody;

  const {
    storeId,
    userId,
    title,
    dayOfWeek,
    specificDate,
    startTime,
    endTime,
    recurrenceEndDate,
    color,
    notes,
  } = body ?? {};

  // ── Required fields ──────────────────────────────────────────────────────
  if (!storeId || !userId || !title || !startTime || !endTime) {
    return Response.json(
      {
        success: false,
        error:
          'storeId, userId, title, startTime, and endTime are required.',
      },
      { status: 400 },
    );
  }

  const titleTrimmed = String(title).trim();
  if (!titleTrimmed) {
    return Response.json(
      { success: false, error: 'title must not be empty.' },
      { status: 400 },
    );
  }

  // ── dayOfWeek / specificDate mutual exclusivity ─────────────────────────
  const hasDow = dayOfWeek != null && !Number.isNaN(Number(dayOfWeek));
  const hasSpecific = Boolean(specificDate);

  if (hasDow && hasSpecific) {
    return Response.json(
      {
        success: false,
        error:
          'Set either dayOfWeek (recurring) OR specificDate (one-off), not both.',
      },
      { status: 400 },
    );
  }
  if (!hasDow && !hasSpecific) {
    return Response.json(
      {
        success: false,
        error:
          'Either dayOfWeek (recurring) or specificDate (one-off) must be set.',
      },
      { status: 400 },
    );
  }

  // Validate dayOfWeek range.
  let dayOfWeekVal: number | null = null;
  if (hasDow) {
    dayOfWeekVal = Number(dayOfWeek);
    if (!Number.isInteger(dayOfWeekVal) || dayOfWeekVal < 0 || dayOfWeekVal > 6) {
      return Response.json(
        { success: false, error: 'dayOfWeek must be an integer 0-6 (Sun=0 … Sat=6).' },
        { status: 400 },
      );
    }
  }

  // ── Parse times ──────────────────────────────────────────────────────────
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return Response.json(
      { success: false, error: 'startTime and endTime must be valid ISO date strings.' },
      { status: 400 },
    );
  }

  // For one-off shifts, endTime must be after startTime (no overnight for
  // a specific-date shift). For recurring shifts, overnight is allowed — we
  // only check that start and end are not exactly equal.
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  if (hasSpecific && endMin <= startMin) {
    return Response.json(
      {
        success: false,
        error:
          'For one-off shifts, endTime must be later than startTime on the same day.',
      },
      { status: 400 },
    );
  }
  if (startMin === endMin) {
    return Response.json(
      { success: false, error: 'startTime and endTime cannot be identical.' },
      { status: 400 },
    );
  }

  // ── specificDate / recurrenceEndDate ─────────────────────────────────────
  let specificDateVal: Date | null = null;
  if (hasSpecific) {
    specificDateVal = new Date(specificDate as string);
    if (Number.isNaN(specificDateVal.getTime())) {
      return Response.json(
        { success: false, error: 'specificDate must be a valid ISO date string.' },
        { status: 400 },
      );
    }
  }

  let recurrenceEndDateVal: Date | null = null;
  if (recurrenceEndDate) {
    recurrenceEndDateVal = new Date(recurrenceEndDate);
    if (Number.isNaN(recurrenceEndDateVal.getTime())) {
      return Response.json(
        { success: false, error: 'recurrenceEndDate must be a valid ISO date string.' },
        { status: 400 },
      );
    }
    if (recurrenceEndDateVal.getTime() < new Date().setHours(0, 0, 0, 0)) {
      return Response.json(
        { success: false, error: 'recurrenceEndDate cannot be in the past.' },
        { status: 400 },
      );
    }
  }

  // ── Color ────────────────────────────────────────────────────────────────
  const colorVal = color && VALID_COLORS.includes(color) ? color : 'emerald';

  // ── Verify user + store ───────────────────────────────────────────────────
  const session = await getSessionFromRequest(request);
  const createdById = session?.userId;
  if (!createdById) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const [user, store] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, storeId: true } }),
    db.store.findUnique({ where: { id: storeId }, select: { id: true, name: true } }),
  ]);

  if (!user) {
    return Response.json({ success: false, error: 'User not found.' }, { status: 404 });
  }
  if (!store) {
    return Response.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  // ── Persist ──────────────────────────────────────────────────────────────
  const created = await db.shiftSchedule.create({
    data: {
      storeId,
      userId,
      title: titleTrimmed,
      dayOfWeek: dayOfWeekVal,
      specificDate: specificDateVal,
      startTime: start,
      endTime: end,
      recurrenceEndDate: recurrenceEndDateVal,
      status: 'ACTIVE',
      color: colorVal,
      notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      createdById,
    },
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
      store: { select: { id: true, name: true } },
    },
  });

  await systemLog({
    action: 'SHIFT_SCHEDULE_CREATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Shift schedule "${titleTrimmed}" created for ${user.name} in store ${store.name}.`,
    storeId,
    userId: createdById,
    metadata: {
      scheduleId: created.id,
      targetUserId: userId,
      dayOfWeek: dayOfWeekVal,
      specificDate: specificDateVal?.toISOString() ?? null,
      recurrenceEndDate: recurrenceEndDateVal?.toISOString() ?? null,
      color: colorVal,
    },
  });

  const data = {
    ...created,
    startTime: created.startTime.toISOString(),
    endTime: created.endTime.toISOString(),
    specificDate: created.specificDate ? created.specificDate.toISOString() : null,
    recurrenceEndDate: created.recurrenceEndDate
      ? created.recurrenceEndDate.toISOString()
      : null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    durationHours: calculateShiftDurationHours(created.startTime, created.endTime),
  };

  return Response.json({ success: true, data }, { status: 201 });
}

export const GET = withErrorBoundary(
  withFinancialAuth(listSchedulesHandler, READ_ROLES),
  'SHIFT_SCHEDULES_LIST',
);

export const POST = withErrorBoundary(
  withFinancialAuth(createScheduleHandler, WRITE_ROLES),
  'SHIFT_SCHEDULE_CREATE',
);
