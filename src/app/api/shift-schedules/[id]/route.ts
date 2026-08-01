// GET/PATCH/DELETE /api/shift-schedules/[id]
//
// Single-schedule operations.
//   - GET    any read role
//   - PATCH  only when status is ACTIVE or PAUSED. COMPLETED schedules are
//            frozen (their lifetime ended).
//   - DELETE any state (manager discretion).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { calculateShiftDurationHours } from '@/lib/shift-schedule-utils';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

const VALID_COLORS = ['emerald', 'teal', 'amber', 'rose', 'violet', 'cyan', 'orange', 'purple'];

interface RouteContext {
  params: Promise<{ id: string }>;
}

function serialize(s: {
  id: string;
  storeId: string;
  userId: string;
  title: string;
  dayOfWeek: number | null;
  specificDate: Date | null;
  startTime: Date;
  endTime: Date;
  recurrenceEndDate: Date | null;
  status: string;
  color: string;
  notes: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: string; name: string; role: string; avatarUrl?: string | null };
  store?: { id: string; name: string };
}) {
  return {
    ...s,
    startTime: s.startTime.toISOString(),
    endTime: s.endTime.toISOString(),
    specificDate: s.specificDate ? s.specificDate.toISOString() : null,
    recurrenceEndDate: s.recurrenceEndDate ? s.recurrenceEndDate.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    durationHours: calculateShiftDurationHours(s.startTime, s.endTime),
  };
}

// ── GET ──────────────────────────────────────────────────────────────────────

async function getScheduleHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const schedule = await db.shiftSchedule.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
      store: { select: { id: true, name: true } },
    },
  });

  if (!schedule) {
    return Response.json(
      { success: false, error: 'Shift schedule not found.' },
      { status: 404 },
    );
  }

  return Response.json({ success: true, data: serialize(schedule) });
}

// ── PATCH ────────────────────────────────────────────────────────────────────

interface PatchBody {
  title?: string;
  dayOfWeek?: number | null;
  specificDate?: string | null;
  startTime?: string;
  endTime?: string;
  recurrenceEndDate?: string | null;
  color?: string;
  notes?: string | null;
}

async function patchScheduleHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = (await request.json()) as PatchBody;

  const existing = await db.shiftSchedule.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Shift schedule not found.' },
      { status: 404 },
    );
  }

  // COMPLETED schedules are terminal and frozen.
  if (existing.status === 'COMPLETED') {
    return Response.json(
      {
        success: false,
        error:
          'Cannot edit a COMPLETED schedule. Reopen it via the status endpoint first if needed.',
      },
      { status: 400 },
    );
  }

  const session = await getSessionFromRequest(request);
  const userId = session?.userId;

  const updates: Record<string, unknown> = {};

  if (typeof body.title === 'string') {
    const trimmed = body.title.trim();
    if (!trimmed) {
      return Response.json(
        { success: false, error: 'title must not be empty.' },
        { status: 400 },
      );
    }
    updates.title = trimmed;
  }

  if (body.dayOfWeek !== undefined) {
    if (body.dayOfWeek == null) {
      updates.dayOfWeek = null;
    } else {
      const v = Number(body.dayOfWeek);
      if (!Number.isInteger(v) || v < 0 || v > 6) {
        return Response.json(
          { success: false, error: 'dayOfWeek must be an integer 0-6.' },
          { status: 400 },
        );
      }
      updates.dayOfWeek = v;
    }
  }

  if (body.specificDate !== undefined) {
    if (body.specificDate == null) {
      updates.specificDate = null;
    } else {
      const d = new Date(body.specificDate);
      if (Number.isNaN(d.getTime())) {
        return Response.json(
          { success: false, error: 'specificDate must be a valid ISO date.' },
          { status: 400 },
        );
      }
      updates.specificDate = d;
    }
  }

  // Enforce mutual exclusivity after the patch is applied.
  const finalDow = updates.dayOfWeek !== undefined ? (updates.dayOfWeek as number | null) : existing.dayOfWeek;
  const finalSpecific =
    updates.specificDate !== undefined ? (updates.specificDate as Date | null) : existing.specificDate;
  if (finalDow != null && finalSpecific != null) {
    return Response.json(
      { success: false, error: 'Cannot set both dayOfWeek and specificDate.' },
      { status: 400 },
    );
  }
  if (finalDow == null && finalSpecific == null) {
    return Response.json(
      { success: false, error: 'Either dayOfWeek or specificDate must be set.' },
      { status: 400 },
    );
  }

  if (body.startTime !== undefined) {
    const d = new Date(body.startTime);
    if (Number.isNaN(d.getTime())) {
      return Response.json(
        { success: false, error: 'startTime must be a valid ISO date.' },
        { status: 400 },
      );
    }
    updates.startTime = d;
  }
  if (body.endTime !== undefined) {
    const d = new Date(body.endTime);
    if (Number.isNaN(d.getTime())) {
      return Response.json(
        { success: false, error: 'endTime must be a valid ISO date.' },
        { status: 400 },
      );
    }
    updates.endTime = d;
  }

  // Validate times: for one-off shifts, endTime must be after startTime on
  // the same day. For recurring shifts, allow overnight (end before start).
  const finalStart = (updates.startTime as Date | undefined) ?? existing.startTime;
  const finalEnd = (updates.endTime as Date | undefined) ?? existing.endTime;
  const startMin = finalStart.getHours() * 60 + finalStart.getMinutes();
  const endMin = finalEnd.getHours() * 60 + finalEnd.getMinutes();
  if (startMin === endMin) {
    return Response.json(
      { success: false, error: 'startTime and endTime cannot be identical.' },
      { status: 400 },
    );
  }
  if (finalSpecific != null && endMin <= startMin) {
    return Response.json(
      {
        success: false,
        error:
          'For one-off shifts, endTime must be later than startTime on the same day.',
      },
      { status: 400 },
    );
  }

  if (body.recurrenceEndDate !== undefined) {
    if (body.recurrenceEndDate == null) {
      updates.recurrenceEndDate = null;
    } else {
      const d = new Date(body.recurrenceEndDate);
      if (Number.isNaN(d.getTime())) {
        return Response.json(
          { success: false, error: 'recurrenceEndDate must be a valid ISO date.' },
          { status: 400 },
        );
      }
      updates.recurrenceEndDate = d;
    }
  }

  if (body.color !== undefined) {
    if (!VALID_COLORS.includes(body.color)) {
      return Response.json(
        { success: false, error: `Invalid color: ${body.color}` },
        { status: 400 },
      );
    }
    updates.color = body.color;
  }

  if (body.notes !== undefined) {
    updates.notes =
      typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 },
    );
  }

  const updated = await db.shiftSchedule.update({
    where: { id },
    data: updates,
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
      store: { select: { id: true, name: true } },
    },
  });

  await systemLog({
    action: 'SHIFT_SCHEDULE_UPDATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Shift schedule ${id} updated. Fields: ${Object.keys(updates).join(', ')}`,
    storeId: existing.storeId,
    userId: userId || undefined,
    metadata: { scheduleId: id, updates },
  });

  return Response.json({ success: true, data: serialize(updated) });
}

// ── DELETE ───────────────────────────────────────────────────────────────────

async function deleteScheduleHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const session = await getSessionFromRequest(request);
  const userId = session?.userId;

  const existing = await db.shiftSchedule.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Shift schedule not found.' },
      { status: 404 },
    );
  }

  await db.shiftSchedule.delete({ where: { id } });

  await systemLog({
    action: 'SHIFT_SCHEDULE_DELETED',
    component: LogComponent.POS,
    severity: LogSeverity.WARN,
    message: `Shift schedule ${id} ("${existing.title}") deleted.`,
    storeId: existing.storeId,
    userId: userId || undefined,
    metadata: {
      scheduleId: id,
      targetUserId: existing.userId,
      title: existing.title,
    },
  });

  return Response.json({
    success: true,
    message: 'Shift schedule deleted successfully.',
  });
}

export const GET = withErrorBoundary(
  withFinancialAuth(getScheduleHandler, READ_ROLES),
  'SHIFT_SCHEDULE_GET',
);

export const PATCH = withErrorBoundary(
  withFinancialAuth(patchScheduleHandler, WRITE_ROLES),
  'SHIFT_SCHEDULE_UPDATE',
);

export const DELETE = withErrorBoundary(
  withFinancialAuth(deleteScheduleHandler, WRITE_ROLES),
  'SHIFT_SCHEDULE_DELETE',
);
