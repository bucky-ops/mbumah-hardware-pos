// GET/POST /api/attendance
//
// Attendance / time-tracking.
//   GET  — list attendance records (filter by storeId, employeeId, date range, status)
//   POST — clock in or clock out for an employee
//
// Clock-in/out logic:
//   • If no record exists for (employeeId, today) → create one with checkIn = now
//   • If a record exists with checkOut = null → set checkOut = now, compute workingHours
//   • If a record exists with checkOut set → return error (already clocked out)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ── GET: List attendance records ─────────────────────────────────────────────
async function listAttendanceHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  const employeeId = searchParams.get('employeeId') || undefined;
  const status = searchParams.get('status') || undefined;
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  if (!storeId) {
    return Response.json({ success: true, data: [] });
  }

  const where: Record<string, unknown> = { storeId };
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;

  if (startDate || endDate) {
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);
    where.date = dateFilter;
  }

  const records = await db.attendanceRecord.findMany({
    where,
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          photoUrl: true,
        },
      },
    },
    orderBy: { date: 'desc' },
    take: limit,
  });

  const data = records.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    storeId: r.storeId,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    employeeJobTitle: r.employee.jobTitle,
    photoUrl: r.employee.photoUrl,
    date: r.date.toISOString(),
    checkIn: r.checkIn?.toISOString() ?? null,
    checkOut: r.checkOut?.toISOString() ?? null,
    breakStart: r.breakStart?.toISOString() ?? null,
    breakEnd: r.breakEnd?.toISOString() ?? null,
    breakHours: r.breakHours,
    workingHours: r.workingHours,
    overtimeHours: r.overtimeHours,
    expectedHours: r.expectedHours,
    status: r.status,
    lateMinutes: r.lateMinutes,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    source: r.source,
    location: r.location,
    verified: r.verified,
    notes: r.notes,
    approvedBy: r.approvedBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return Response.json({ success: true, data });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listAttendanceHandler),
  'ATTENDANCE_LIST'
);

// ── POST: Clock in / clock out ───────────────────────────────────────────────
async function clockInOutHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string }
): Promise<Response> {
  const body = await request.json();

  const { employeeId, storeId, action, location, notes } = body;

  if (!employeeId || !storeId) {
    return Response.json(
      { success: false, error: 'employeeId and storeId are required.' },
      { status: 400 }
    );
  }

  if (!action || !['CLOCK_IN', 'CLOCK_OUT'].includes(action)) {
    return Response.json(
      { success: false, error: 'action must be "CLOCK_IN" or "CLOCK_OUT".' },
      { status: 400 }
    );
  }

  // Verify the employee exists and belongs to the store
  const employee = await db.employee.findFirst({
    where: { id: employeeId, storeId, status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!employee) {
    return Response.json(
      { success: false, error: 'Active employee not found for this store.' },
      { status: 404 }
    );
  }

  // Today's date (midnight UTC — the schema stores date-only semantics)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Find today's attendance record (or create one on clock-in)
  let record = await db.attendanceRecord.findUnique({
    where: {
      employeeId_date: { employeeId, date: today },
    },
  });

  const now = new Date();

  if (action === 'CLOCK_IN') {
    if (record && record.checkIn) {
      return Response.json(
        { success: false, error: `${employee.firstName} already clocked in today at ${record.checkIn.toISOString()}.` },
        { status: 409 }
      );
    }

    // Determine if late (assume shift starts at 8:00 AM local time)
    const shiftStart = new Date(today);
    shiftStart.setHours(8, 0, 0, 0);
    const lateMinutes = now > shiftStart
      ? Math.floor((now.getTime() - shiftStart.getTime()) / (1000 * 60))
      : 0;

    if (record) {
      // Update existing record (e.g. was marked ABSENT manually, now clocking in)
      record = await db.attendanceRecord.update({
        where: { id: record.id },
        data: {
          checkIn: now,
          status: lateMinutes > 0 ? 'LATE' : 'PRESENT',
          lateMinutes,
          source: 'MOBILE',
          location: location || null,
          notes: notes || record.notes,
        },
      });
    } else {
      record = await db.attendanceRecord.create({
        data: {
          employeeId,
          storeId,
          date: today,
          checkIn: now,
          status: lateMinutes > 0 ? 'LATE' : 'PRESENT',
          lateMinutes,
          expectedHours: 8,
          source: 'MOBILE',
          location: location || null,
          notes: notes || null,
        },
      });
    }

    await systemLog({
      action: 'ATTENDANCE_CLOCK_IN',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: `${employee.firstName} ${employee.lastName} clocked in${lateMinutes > 0 ? ` (${lateMinutes} min late)` : ''}`,
      storeId,
      userId: session.userId,
      metadata: { employeeId, attendanceId: record.id, lateMinutes },
    });

    return Response.json({
      success: true,
      data: {
        id: record.id,
        employeeId: record.employeeId,
        date: record.date.toISOString(),
        checkIn: record.checkIn?.toISOString(),
        status: record.status,
        lateMinutes: record.lateMinutes,
      },
    }, { status: 201 });
  }

  // CLOCK_OUT
  if (!record || !record.checkIn) {
    return Response.json(
      { success: false, error: `${employee.firstName} has not clocked in today. Cannot clock out.` },
      { status: 400 }
    );
  }
  if (record.checkOut) {
    return Response.json(
      { success: false, error: `${employee.firstName} already clocked out today at ${record.checkOut.toISOString()}.` },
      { status: 409 }
    );
  }

  // Compute working hours = (checkOut - checkIn) - breakHours
  const checkIn = record.checkIn;
  const totalHours = (now.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
  const workingHours = Math.max(0, totalHours - (record.breakHours || 0));
  const overtimeHours = Math.max(0, workingHours - (record.expectedHours || 8));

  record = await db.attendanceRecord.update({
    where: { id: record.id },
    data: {
      checkOut: now,
      workingHours: Math.round(workingHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
      notes: notes || record.notes,
    },
  });

  await systemLog({
    action: 'ATTENDANCE_CLOCK_OUT',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `${employee.firstName} ${employee.lastName} clocked out (${Math.round(workingHours * 100) / 100}h worked, ${Math.round(overtimeHours * 100) / 100}h OT)`,
    storeId,
    userId: session.userId,
    metadata: {
      employeeId,
      attendanceId: record.id,
      workingHours: Math.round(workingHours * 100) / 100,
      overtimeHours: Math.round(overtimeHours * 100) / 100,
    },
  });

  return Response.json({
    success: true,
    data: {
      id: record.id,
      employeeId: record.employeeId,
      date: record.date.toISOString(),
      checkIn: record.checkIn?.toISOString(),
      checkOut: record.checkOut?.toISOString(),
      workingHours: record.workingHours,
      overtimeHours: record.overtimeHours,
      status: record.status,
    },
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(clockInOutHandler),
  'ATTENDANCE_CLOCK'
);
