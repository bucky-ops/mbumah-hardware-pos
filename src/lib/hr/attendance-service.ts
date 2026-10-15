// MBUMAH HARDWARE POS - EMS attendance service (v2.18.7)
//
// Stage E of the EMS implementation protocol (Phase 4.4). Server time is
// authoritative; punches are replay-safe through AttendanceRecord.idempotencyKey;
// timesheet approval gates payroll; the Shift system stays the source of truth
// for till duty (attendance reconciles against it and never duplicates the
// ghost-shift logic, which uses endedAt null as the canonical open signal).

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';

export interface PunchInput {
  employeeId: string;
  storeId: string;
  actorId: string;
  actorRole: string;
  kind: 'IN' | 'OUT';
  idempotencyKey?: string;
  sourceDevice?: string;
}

export interface PunchResult {
  recordId: string;
  checkIn: Date | null;
  checkOut: Date | null;
  replayed: boolean;
}

function dayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Record a punch. Server time is authoritative (client timestamps ignored).
 * Replays with the same idempotency key return the existing record unchanged.
 * Punch IN is refused when an open Shift exists for the employee today is NOT
 * required: attendance reconciles with Shift later; but a duplicate IN on the
 * same day is suppressed (the record already carrying checkIn is returned).
 */
export async function punch(input: PunchInput): Promise<PunchResult> {
  const now = new Date();
  const date = dayStartUtc(now);
  const employee = await db.employee.findFirst({
    where: { id: input.employeeId, storeId: input.storeId, deletedAt: null },
    select: { id: true },
  });
  if (!employee) throw new Error('Employee not found.');

  if (input.idempotencyKey) {
    const existing = await db.attendanceRecord.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, checkIn: true, checkOut: true },
    });
    if (existing) {
      return { recordId: existing.id, checkIn: existing.checkIn, checkOut: existing.checkOut, replayed: true };
    }
  }

  const record = await db.attendanceRecord.findFirst({
    where: { employeeId: input.employeeId, storeId: input.storeId, date },
    orderBy: { date: 'desc' },
  });

  if (input.kind === 'IN') {
    if (record?.checkIn) {
      // Duplicate punch IN suppression.
      return { recordId: record.id, checkIn: record.checkIn, checkOut: record.checkOut, replayed: true };
    }
    if (record) {
      await db.attendanceRecord.update({ where: { id: record.id }, data: { checkIn: now, idempotencyKey: input.idempotencyKey ?? null, sourceDevice: input.sourceDevice ?? null } });
      await auditPunch(input, record.id, 'PUNCH_IN');
      return { recordId: record.id, checkIn: now, checkOut: record.checkOut, replayed: false };
    }
    const created = await db.attendanceRecord.create({
      data: {
        employeeId: input.employeeId,
        storeId: input.storeId,
        date,
        checkIn: now,
        status: 'PRESENT',
        idempotencyKey: input.idempotencyKey ?? null,
        sourceDevice: input.sourceDevice ?? null,
      },
    });
    await auditPunch(input, created.id, 'PUNCH_IN');
    return { recordId: created.id, checkIn: now, checkOut: null, replayed: false };
  }

  // Punch OUT
  if (!record?.checkIn) {
    throw new Error('No punch IN found for today; punch IN first.');
  }
  if (record.checkOut) {
    return { recordId: record.id, checkIn: record.checkIn, checkOut: record.checkOut, replayed: true };
  }
  const workingMs = now.getTime() - record.checkIn.getTime();
  const workingHours = Math.max(0, Math.round((workingMs / 3600000) * 100) / 100);
  await db.attendanceRecord.update({
    where: { id: record.id },
    data: { checkOut: now, workingHours, idempotencyKey: input.idempotencyKey ?? record.idempotencyKey ?? null, sourceDevice: input.sourceDevice ?? record.sourceDevice },
  });
  await auditPunch(input, record.id, 'PUNCH_OUT');
  return { recordId: record.id, checkIn: record.checkIn, checkOut: now, replayed: false };
}

async function auditPunch(input: PunchInput, recordId: string, action: string) {
  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action,
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: recordId,
    storeId: input.storeId,
    reason: `Attendance punch ${action} recorded (server time authoritative).`,
    metadata: { employeeId: input.employeeId, replaySafe: Boolean(input.idempotencyKey) },
  });
}

/**
 * Approve a day range as a timesheet for one employee. Payroll refuses
 * periods containing unapproved records (TIMESHEET_NOT_APPROVED guardrail).
 */
export async function approveTimesheet(
  employeeId: string,
  storeId: string,
  from: Date,
  to: Date,
  actorId: string,
  actorRole: string,
): Promise<{ approved: number }> {
  const result = await db.attendanceRecord.updateMany({
    where: {
      employeeId,
      storeId,
      date: { gte: from, lte: to },
      checkIn: { not: null },
      timesheetApprovedByUserId: null,
    },
    data: { timesheetApprovedByUserId: actorId, timesheetApprovedAt: new Date() },
  });

  await hrAudit({
    actorId,
    actorRole,
    action: 'APPROVE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employeeId,
    storeId,
    reason: `Timesheet approved for ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.`,
    metadata: { approvedCount: result.count },
  });
  return { approved: result.count };
}

/**
 * Payroll gate: does this employee/period contain unapproved attendance?
 * Returns the guardrail code for the payroll engine to surface.
 */
export async function hasUnapprovedTimesheet(
  employeeId: string,
  storeId: string,
  from: Date,
  to: Date,
): Promise<boolean> {
  const count = await db.attendanceRecord.count({
    where: {
      employeeId,
      storeId,
      date: { gte: from, lte: to },
      checkIn: { not: null },
      timesheetApprovedByUserId: null,
    },
  });
  return count > 0;
}

/** Shift reconciliation: days where attendance exists but no Shift ran (or vice versa) are surfaced, not mutated. */
export async function attendanceShiftVariance(
  storeId: string,
  from: Date,
  to: Date,
): Promise<Array<{ employeeId: string; date: string; hasAttendance: boolean; hasShift: boolean }>> {
  const attendance = await db.attendanceRecord.findMany({
    where: { storeId, date: { gte: from, lte: to }, checkIn: { not: null } },
    select: { employeeId: true, date: true },
  });
  const shifts = await db.shift.findMany({
    where: { storeId, startedAt: { gte: from, lte: to } },
    select: { userId: true, startedAt: true },
  });

  const shiftKeys = new Set(
    shifts.map((s) => `${s.userId}:${s.startedAt.toISOString().slice(0, 10)}`),
  );
  const attendanceKeys = new Set<string>();
  const variances: Array<{ employeeId: string; date: string; hasAttendance: boolean; hasShift: boolean }> = [];

  for (const a of attendance) {
    const key = `${a.employeeId}:${a.date.toISOString().slice(0, 10)}`;
    attendanceKeys.add(key);
    if (!shiftKeys.has(key)) {
      variances.push({ employeeId: a.employeeId, date: a.date.toISOString().slice(0, 10), hasAttendance: true, hasShift: false });
    }
  }
  for (const key of shiftKeys) {
    if (!attendanceKeys.has(key)) {
      const [employeeId, date] = key.split(':');
      variances.push({ employeeId, date, hasAttendance: false, hasShift: true });
    }
  }
  return variances;
}
