// PATCH /api/shift-schedules/[id]/status
//
// State machine for the schedule status field.
//
//   ACTIVE   → PAUSED or COMPLETED
//   PAUSED   → ACTIVE or COMPLETED
//   COMPLETED → (terminal — no transitions allowed)
//
// Body: { status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' }

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { calculateShiftDurationHours, type ShiftScheduleStatus } from '@/lib/shift-schedule-utils';

export const dynamic = 'force-dynamic';

const WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;

const VALID_STATUSES: ShiftScheduleStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED'];

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface StatusBody {
  status?: string;
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

async function statusHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = (await request.json()) as StatusBody;

  const target = body.status as ShiftScheduleStatus;
  if (!target || !VALID_STATUSES.includes(target)) {
    return Response.json(
      {
        success: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.`,
      },
      { status: 400 },
    );
  }

  const existing = await db.shiftSchedule.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
  });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Shift schedule not found.' },
      { status: 404 },
    );
  }

  const current = existing.status as ShiftScheduleStatus;

  if (current === target) {
    // No-op — return current state without an UPDATE.
    return Response.json({ success: true, data: serialize(existing) });
  }

  if (current === 'COMPLETED') {
    return Response.json(
      {
        success: false,
        error:
          'COMPLETED is a terminal state. The schedule cannot be reopened.',
      },
      { status: 400 },
    );
  }

  // current is ACTIVE or PAUSED → allowed transitions to PAUSED or COMPLETED.
  // Resuming (PAUSED → ACTIVE) is also allowed.
  const allowed =
    (current === 'ACTIVE' && (target === 'PAUSED' || target === 'COMPLETED')) ||
    (current === 'PAUSED' && (target === 'ACTIVE' || target === 'COMPLETED'));

  if (!allowed) {
    return Response.json(
      {
        success: false,
        error: `Cannot transition schedule from ${current} to ${target}.`,
      },
      { status: 400 },
    );
  }

  const session = await getSessionFromRequest(request);
  const userId = session?.userId;

  const updated = await db.shiftSchedule.update({
    where: { id },
    data: { status: target },
    include: {
      user: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
  });

  await systemLog({
    action: 'SHIFT_SCHEDULE_STATUS_CHANGE',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Shift schedule ${id} ("${existing.title}") transitioned ${current} → ${target}.`,
    storeId: existing.storeId,
    userId: userId || undefined,
    metadata: { scheduleId: id, from: current, to: target },
  });

  return Response.json({ success: true, data: serialize(updated) });
}

export const PATCH = withErrorBoundary(
  withFinancialAuth(statusHandler, WRITE_ROLES),
  'SHIFT_SCHEDULE_STATUS',
);
