// GET /api/attendance/timesheets/pending - the timesheet desk's read (v2.136.0)
//
// Who still has unapproved timesheet days, grouped per employee — the data
// behind /hr/timesheets and the run gate's TIMESHEET_NOT_APPROVED door.
// Read-only by construction: no approval happens here (that is
// POST /api/attendance/timesheets/approve's job), no record is mutated.
//
// PARITY CONTRACT: the where mirrors run-gate.ts line for line —
//   checkIn: { not: null }, timesheetApprovedByUserId: null,
//   employee ACTIVE + not deleted + store-scoped (the gate's own employee
//   where, so the desk can never offer a day the gate would never count),
//   employeeCode ascending (the gate's orderBy). When periodId is given
//   the read scopes to that period's dates; an unknown or cross-branch
//   period is an honest 404, mirroring the gate read. Reads ride the runs
//   list's read-right quartet — seeing what blocks payroll is part of
//   reading the payroll desk, not part of running it.

import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { hrGuard } from '@/lib/hr/guard';
import { payrollActorContext } from '@/lib/hr/payroll/run-service';
import { groupUnapprovedByEmployee } from '@/lib/hr/attendance-desk';

export const dynamic = 'force-dynamic';

// THE SAME read-right quartet as the gate read (parity by construction).
const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (request: NextRequest, session) => {
    const ctx = payrollActorContext(session);
    const periodId = new URL(request.url).searchParams.get('periodId') ?? '';

    let period: {
      id: string;
      name: string;
      startDate: Date;
      endDate: Date;
      status: string;
    } | null = null;
    if (periodId) {
      period = await db.payrollPeriod.findFirst({
        where: { id: periodId, storeId: ctx.storeId },
        select: { id: true, name: true, startDate: true, endDate: true, status: true },
      });
      if (!period) {
        return Response.json(
          { success: false, error: 'Payroll period not found.', code: 'PERIOD_NOT_FOUND' },
          { status: 404 },
        );
      }
    }

    // THE SAME unapproved where as the gate (hasUnapprovedTimesheet), THE
    // SAME employee where as the gate's loop (ACTIVE, not deleted, store).
    const records = await db.attendanceRecord.findMany({
      where: {
        storeId: ctx.storeId,
        checkIn: { not: null },
        timesheetApprovedByUserId: null,
        employee: { storeId: ctx.storeId, deletedAt: null, status: 'ACTIVE' },
        ...(period ? { date: { gte: period.startDate, lte: period.endDate } } : {}),
      },
      orderBy: [{ date: 'asc' }],
      select: {
        employeeId: true,
        date: true,
        employee: {
          select: { id: true, employeeCode: true, firstName: true, lastName: true },
        },
      },
    });

    const rows = groupUnapprovedByEmployee(
      records.map((record) => ({
        employeeId: record.employee.id,
        employeeCode: record.employee.employeeCode,
        firstName: record.employee.firstName,
        lastName: record.employee.lastName,
        date: record.date,
      })),
    );

    return Response.json({
      success: true,
      data: {
        scope: period
          ? {
              periodId: period.id,
              periodName: period.name,
              startDate: period.startDate.toISOString(),
              endDate: period.endDate.toISOString(),
              status: period.status,
            }
          : null,
        rows,
        totalDays: rows.reduce((sum, row) => sum + row.days.length, 0),
        checkedAt: new Date().toISOString(),
      },
    });
  },
);
