// GET/POST/PUT /api/leaves
//
// Leave management.
//   GET - list leave requests (filter by storeId, employeeId, status, leaveType)
//          also returns leave balances when ?balances=true is passed
//   POST - submit a new leave request (PENDING status)
//   PUT - approve / reject / cancel a leave request (managers only)

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess, requireRole } from '@/lib/auth';
import {
  getOrCreateLeaveBalance,
  updateLeaveBalanceOnStatusChange,
  calculateWorkingDays,
} from '@/lib/payroll-helpers';
import { recomputeBalances } from '@/lib/hr/leave-service';
import { toNum } from '@/lib/decimal-safe';
import {
  LEAVE_DECISION_METADATA_MARKER,
  LEAVE_REQUEST_METADATA_MARKER,
  leaveDecisionCopy,
  leaveSubmissionCopy,
  type LeaveDecisionStatus,
} from '@/lib/hr/leave-notify';
import { sendEmail } from '@/lib/email-service';

export const dynamic = 'force-dynamic';

// GET: List leave requests + optionally balances
async function listLeavesHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null }
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;
  const employeeId = searchParams.get('employeeId') || undefined;
  const status = searchParams.get('status') || undefined;
  const leaveTypeId = searchParams.get('leaveTypeId') || undefined;
  const includeBalances = searchParams.get('balances') === 'true';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);

  if (!storeId) {
    return Response.json({ success: true, data: [] });
  }

  const where: Record<string, unknown> = { storeId };
  if (employeeId) where.employeeId = employeeId;
  if (status) where.status = status;
  if (leaveTypeId) where.leaveTypeId = leaveTypeId;

  const requests = await db.leaveRequest.findMany({
    where,
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, jobTitle: true, photoUrl: true },
      },
      leaveType: {
        select: { id: true, name: true, code: true, isPaid: true, isStatutory: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const requestData = requests.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    storeId: r.storeId,
    employeeName: `${r.employee.firstName} ${r.employee.lastName}`,
    employeeJobTitle: r.employee.jobTitle,
    photoUrl: r.employee.photoUrl,
    leaveTypeId: r.leaveTypeId,
    leaveTypeName: r.leaveType.name,
    leaveTypeCode: r.leaveType.code,
    isPaid: r.leaveType.isPaid,
    isStatutory: r.leaveType.isStatutory,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    returnDate: r.returnDate?.toISOString() ?? null,
    workingDays: r.workingDays,
    halfDay: r.halfDay,
    status: r.status,
    reason: r.reason,
    rejectionReason: r.rejectionReason,
    attachmentUrl: r.attachmentUrl,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    emergencyContact: r.emergencyContact,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  // Optionally include leave balances for the filtered employees
  let balances: unknown[] = [];
  if (includeBalances && requestData.length > 0) {
    const employeeIds = [...new Set(requestData.map(r => r.employeeId))];
    const leaveYear = new Date().getFullYear();

    const balanceRecords = await db.employeeLeaveBalance.findMany({
      where: {
        employeeId: { in: employeeIds },
        leaveYear,
      },
      include: {
        leaveType: { select: { name: true, code: true, isPaid: true } },
        employee: { select: { firstName: true, lastName: true } },
      },
    });

    balances = balanceRecords.map((b) => ({
      id: b.id,
      employeeId: b.employeeId,
      employeeName: `${b.employee.firstName} ${b.employee.lastName}`,
      leaveTypeId: b.leaveTypeId,
      leaveTypeName: b.leaveType.name,
      leaveTypeCode: b.leaveType.code,
      leaveYear: b.leaveYear,
      allocatedDays: b.allocatedDays,
      usedDays: b.usedDays,
      pendingDays: b.pendingDays,
      carryForwardDays: b.carryForwardDays,
      encashedDays: b.encashedDays,
      // Decimal-safe: Decimal + Decimal CONCATENATES at runtime ("21" + "0"
      // = "210") — coerce before the arithmetic (v2.30.0).
      availableDays: Math.round((Number(b.allocatedDays) + Number(b.carryForwardDays) - Number(b.usedDays) - Number(b.pendingDays)) * 100) / 100,
    }));
  }

  // Always include the list of leave types (for the request form)
  const leaveTypes = await db.leaveType.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      code: true,
      defaultDaysPerYear: true,
      isPaid: true,
      isStatutory: true,
      carryForwardAllowed: true,
    },
    orderBy: { name: 'asc' },
  });

  return Response.json({
    success: true,
    data: requestData,
    balances: includeBalances ? balances : undefined,
    leaveTypes,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(listLeavesHandler),
  'LEAVES_LIST'
);

// POST: Submit a new leave request
async function createLeaveHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string }
): Promise<Response> {
  const body = await request.json();

  const { employeeId, storeId, leaveTypeId, startDate, endDate, halfDay, reason, attachmentUrl, emergencyContact } = body;

  // Validation
  if (!employeeId || !storeId || !leaveTypeId || !startDate || !endDate) {
    return Response.json(
      { success: false, error: 'employeeId, storeId, leaveTypeId, startDate, and endDate are required.' },
      { status: 400 }
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json(
      { success: false, error: 'Invalid date format. Use ISO 8601.' },
      { status: 400 }
    );
  }
  if (start > end) {
    return Response.json(
      { success: false, error: 'startDate must be before or equal to endDate.' },
      { status: 400 }
    );
  }

  // Verify employee + leave type
  const employee = await db.employee.findFirst({
    where: { id: employeeId, storeId },
    select: { id: true, firstName: true, lastName: true, status: true },
  });
  if (!employee) {
    return Response.json(
      { success: false, error: 'Employee not found for this store.' },
      { status: 404 }
    );
  }

  const leaveType = await db.leaveType.findUnique({
    where: { id: leaveTypeId },
    select: { id: true, name: true, defaultDaysPerYear: true, isPaid: true },
  });
  if (!leaveType) {
    return Response.json(
      { success: false, error: 'Leave type not found.' },
      { status: 404 }
    );
  }

  // Compute working days (excludes weekends)
  const workingDays = calculateWorkingDays(start, end) * (halfDay ? 0.5 : 1);

  // Check leave balance (for paid, non-unlimited leave types)
  // v2.31.0: defaultDaysPerYear is a Decimal column (valueOf is a STRING) -
  // read through toNum so the guard compares numbers, not coerced strings.
  if (toNum(leaveType.defaultDaysPerYear) > 0) {
    const leaveYear = start.getFullYear();
    const balance = await getOrCreateLeaveBalance(employeeId, leaveTypeId, leaveYear);
    if (balance.available < workingDays) {
      return Response.json(
        {
          success: false,
          error: `Insufficient leave balance. Requested ${workingDays} day(s), available ${balance.available} day(s) for ${leaveType.name} in ${leaveYear}.`,
          code: 'INSUFFICIENT_BALANCE',
          requested: workingDays,
          available: balance.available,
        },
        { status: 400 }
      );
    }
  }

  // Create the request
  const leaveRequest = await db.leaveRequest.create({
    data: {
      employeeId,
      leaveTypeId,
      storeId,
      startDate: start,
      endDate: end,
      returnDate: new Date(end.getTime() + 24 * 60 * 60 * 1000), // day after end
      workingDays,
      halfDay: halfDay || false,
      status: 'PENDING',
      reason: reason || null,
      attachmentUrl: attachmentUrl || null,
      emergencyContact: emergencyContact || null,
    },
    include: {
      leaveType: { select: { name: true, code: true } },
    },
  });

  // Add to pendingDays on the balance
  const leaveYear = start.getFullYear();
  const balance = await getOrCreateLeaveBalance(employeeId, leaveTypeId, leaveYear);
  await db.employeeLeaveBalance.update({
    where: { id: balance.id },
    // Decimal-safe: pendingDays is a Decimal (string valueOf) — a bare `+`
    // would CONCATENATE ("3" + 2 = "32") once pendingDays is non-zero.
    data: { pendingDays: Math.round((Number(balance.pendingDays) + workingDays) * 100) / 100 },
  });

  await systemLog({
    action: 'LEAVE_REQUEST_SUBMITTED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Leave request submitted: ${employee.firstName} ${employee.lastName} requested ${workingDays} day(s) of ${leaveType.name} (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})`,
    storeId,
    userId: session.userId,
    metadata: { leaveRequestId: leaveRequest.id, employeeId, leaveTypeId, workingDays },
  });

  // v2.32.0: submission notifications (employee → manager direction, the
  // mirror of the v2.31.0 decision notifications). Every active decision-
  // capable user of the store (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER /
  // ACCOUNTANT - the same roles PUT requires to decide) plus all SUPER_ADMINs
  // anywhere (they may decide cross-store) gets a durable bell row, and the
  // group gets ONE email. The submitter is excluded - a manager submitting
  // their own request never notifies themselves. Best-effort: a notification
  // or email failure must never surface as a failed submission.
  const approvers = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      id: { not: session.userId },
      OR: [{ storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  if (approvers.length > 0) {
    try {
      const copy = leaveSubmissionCopy({
        firstName: employee.firstName,
        lastName: employee.lastName,
        leaveTypeName: leaveType.name,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        workingDays,
        reason: reason || null,
        submittedByLabel: session.email || null,
      });
      await db.notification.createMany({
        data: approvers.map((u) => ({
          storeId,
          userId: u.id,
          title: copy.title,
          message: copy.message,
          type: copy.notifType,
          category: 'HR',
          priority: copy.priority,
          metadata: JSON.stringify({
            kind: LEAVE_REQUEST_METADATA_MARKER,
            leaveRequestId: leaveRequest.id,
            employeeId,
          }),
        })),
      });
      const approverEmails = approvers
        .map((u) => u.email)
        .filter((e): e is string => typeof e === 'string' && e.includes('@'));
      if (approverEmails.length > 0) {
        await sendEmail({
          to: approverEmails,
          subject: copy.emailSubject,
          html: copy.emailHtml,
          text: copy.emailText,
          type: 'LEAVE_REQUEST',
          metadata: { leaveRequestId: leaveRequest.id, employeeId },
        }).catch(() => undefined);
      }
    } catch {
      // Submission delivery is best-effort by design.
    }
  }

  return Response.json({
    success: true,
    data: {
      id: leaveRequest.id,
      employeeId: leaveRequest.employeeId,
      leaveTypeId: leaveRequest.leaveTypeId,
      leaveTypeName: leaveRequest.leaveType.name,
      startDate: leaveRequest.startDate.toISOString(),
      endDate: leaveRequest.endDate.toISOString(),
      workingDays: leaveRequest.workingDays,
      halfDay: leaveRequest.halfDay,
      status: leaveRequest.status,
      reason: leaveRequest.reason,
      createdAt: leaveRequest.createdAt.toISOString(),
    },
  }, { status: 201 });
}

export const POST = withErrorBoundary(
  requireStoreAccess(createLeaveHandler),
  'LEAVES_CREATE'
);

// PUT: Approve / reject / cancel a leave request
async function updateLeaveHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string }
): Promise<Response> {
  const body = await request.json();

  const { leaveRequestId, action, rejectionReason } = body;

  if (!leaveRequestId || !action) {
    return Response.json(
      { success: false, error: 'leaveRequestId and action are required.' },
      { status: 400 }
    );
  }

  if (!['APPROVE', 'REJECT', 'CANCEL'].includes(action)) {
    return Response.json(
      { success: false, error: 'action must be "APPROVE", "REJECT", or "CANCEL".' },
      { status: 400 }
    );
  }

  // Only managers+ can approve/reject; the employee themselves can cancel
  if (action === 'APPROVE' || action === 'REJECT') {
    const roleError = requireRole('SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')(session);
    if (roleError) return roleError;
  }

  const leaveRequest = await db.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          storeId: true,
          // v2.31.0: decision-notification recipients - the linked user (in-app
          // bell row) and the employee email (best-effort email delivery).
          email: true,
          user: { select: { id: true, email: true } },
        },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });

  if (!leaveRequest) {
    return Response.json(
      { success: false, error: 'Leave request not found.' },
      { status: 404 }
    );
  }

  // Tenant scoping: non-admin can only manage their own store's requests
  if (session.storeId && leaveRequest.storeId !== session.storeId && session.role !== 'SUPER_ADMIN') {
    return Response.json(
      { success: false, error: 'You can only manage leave requests from your own store.' },
      { status: 403 }
    );
  }

  const oldStatus = leaveRequest.status;
  let newStatus: string;

  switch (action) {
    case 'APPROVE':
      if (oldStatus !== 'PENDING') {
        return Response.json(
          { success: false, error: `Cannot approve a request that is already ${oldStatus}.` },
          { status: 400 }
        );
      }
      newStatus = 'APPROVED';
      break;
    case 'REJECT':
      if (oldStatus !== 'PENDING') {
        return Response.json(
          { success: false, error: `Cannot reject a request that is already ${oldStatus}.` },
          { status: 400 }
        );
      }
      newStatus = 'REJECTED';
      break;
    case 'CANCEL':
      if (oldStatus === 'CANCELLED' || oldStatus === 'TAKEN') {
        return Response.json(
          { success: false, error: `Cannot cancel a request that is ${oldStatus}.` },
          { status: 400 }
        );
      }
      newStatus = 'CANCELLED';
      break;
    default:
      return Response.json(
        { success: false, error: 'Invalid action.' },
        { status: 400 }
      );
  }

  // Update the request
  const updated = await db.leaveRequest.update({
    where: { id: leaveRequestId },
    data: {
      status: newStatus,
      approvedBy: session.userId,
      approvedAt: new Date(),
      rejectionReason: action === 'REJECT' ? (rejectionReason || null) : leaveRequest.rejectionReason,
    },
  });

  // Update the leave balance: the incremental transition applies the delta
  // immediately (v2.30.0: Decimal-safe via leaveStatusTransitionDelta), then
  // the aggregate-derived recompute rewrites the stored aggregates straight
  // from the request table — idempotent, and it HEALS any drift left by the
  // old string-concatenation bug (approved leave never incremented usedDays).
  await updateLeaveBalanceOnStatusChange(leaveRequestId, newStatus, oldStatus);
  await recomputeBalances(
    leaveRequest.employeeId,
    leaveRequest.leaveTypeId,
    new Date(leaveRequest.startDate).getUTCFullYear(),
  ).catch(() => undefined);

  await systemLog({
    action: `LEAVE_REQUEST_${newStatus}`,
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Leave request ${newStatus.toLowerCase()}: ${leaveRequest.employee.firstName} ${leaveRequest.employee.lastName} - ${leaveRequest.leaveType.name} (${leaveRequest.workingDays} day(s))${rejectionReason ? ` - Reason: ${rejectionReason}` : ''}`,
    storeId: leaveRequest.storeId,
    userId: session.userId,
    metadata: { leaveRequestId, employeeId: leaveRequest.employeeId, oldStatus, newStatus },
  });

  // v2.31.0: decision notifications - a durable in-app bell row addressed to
  // the employee's linked user (feed type 'leave_decision') plus a
  // best-effort email via the central email service. NEVER blocks or fails
  // the decision itself: the request is already updated, balanced and logged
  // by the time this runs, and every step below is individually fail-soft.
  if (newStatus === 'APPROVED' || newStatus === 'REJECTED') {
    const recipientUserId = leaveRequest.employee.user?.id ?? null;
    const recipientEmail =
      leaveRequest.employee.email || leaveRequest.employee.user?.email || null;
    try {
      const copy = leaveDecisionCopy({
        status: newStatus as LeaveDecisionStatus,
        firstName: leaveRequest.employee.firstName,
        lastName: leaveRequest.employee.lastName,
        leaveTypeName: leaveRequest.leaveType.name,
        startDate: leaveRequest.startDate.toISOString(),
        endDate: leaveRequest.endDate.toISOString(),
        workingDays: toNum(leaveRequest.workingDays),
        rejectionReason: rejectionReason || null,
        decidedByLabel: session.email || null,
      });

      if (recipientUserId) {
        await db.notification.create({
          data: {
            storeId: leaveRequest.storeId,
            userId: recipientUserId,
            title: copy.title,
            message: copy.message,
            type: copy.notifType,
            category: 'HR',
            priority: copy.priority,
            actionUrl: '/employees/me/leave',
            actionLabel: 'View my leave',
            metadata: JSON.stringify({
              kind: LEAVE_DECISION_METADATA_MARKER,
              leaveRequestId,
              status: newStatus,
              decidedByLabel: session.email || undefined,
            }),
          },
        });
      }

      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: copy.emailSubject,
          html: copy.emailHtml,
          text: copy.emailText,
          userId: recipientUserId ?? undefined,
          type: 'LEAVE_DECISION',
          metadata: { leaveRequestId, status: newStatus },
        }).catch(() => undefined);
      }
    } catch {
      // Decision delivery is best-effort by design - a notification or email
      // failure must never surface as a failed decision to the manager.
    }
  }

  return Response.json({
    success: true,
    data: {
      id: updated.id,
      employeeId: updated.employeeId,
      status: updated.status,
      approvedBy: updated.approvedBy,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      rejectionReason: updated.rejectionReason,
    },
  });
}

export const PUT = withErrorBoundary(
  requireStoreAccess(updateLeaveHandler),
  'LEAVES_UPDATE'
);
