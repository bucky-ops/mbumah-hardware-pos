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
  updateLeaveBalanceOnStatusChange,
} from '@/lib/payroll-helpers';
import { recomputeBalances, requestLeave, notifyLeaveRequestCancelled, editLeaveRequest } from '@/lib/hr/leave-service';
import { toNum } from '@/lib/decimal-safe';
import {
  LEAVE_DECISION_METADATA_MARKER,
  leaveDecisionCopy,
  type LeaveDecisionStatus,
} from '@/lib/hr/leave-notify';
import { sendEmail } from '@/lib/email-service';
import { validateLeaveAttachmentUrl } from '@/lib/hr/leave-attachment';

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
        select: {
          id: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          photoUrl: true,
          // v2.45.0: the linked portal user id — lets the desk distinguish a
          // self-corrected row (employee edited their own request) from an
          // HR correction without comparing display names.
          user: { select: { id: true } },
        },
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
    // v2.38.0: HR-filer display name when the request was entered on behalf
    // of the employee (null = self-filed via the portal). Rendered as the
    // violet "Entered by HR" chip on the HR desk and the portal.
    enteredByName: r.enteredByName,
    // v2.40.0: edit-window provenance (null = never corrected). Rendered as
    // the amber "Corrected by HR" chip on the HR desk and the portal card.
    editedAt: r.editedAt?.toISOString() ?? null,
    editedByName: r.editedByName,
    editNote: r.editNote,
    // v2.45.0: deterministic edit provenance — who corrected it (user id)
    // and whose request it is (linked portal user id), so both the desk and
    // the portal can render "Self-corrected" / "Corrected by you" chips
    // without fragile name comparisons.
    editedByUserId: r.editedByUserId ?? null,
    employeeUserId: r.employee.user?.id ?? null,
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
// v2.38.0 REWRITE: the legacy handler hand-rolled its own creation (with a
// half-day arithmetic that diverged from the governed path and a manual
// pendingDays increment the v2.32.0 heal had to keep repairing) and had NO
// role gate — any same-store user could file leave for ANY colleague
// (horizontal authz gap, the same class the CANCEL fix closed in v2.33.0).
// Now: decision-capable roles file for anyone in their store; everyone else
// may only file for their own linked employee. Creation itself is delegated
// to requestLeave() so balances, recompute, audit and every notification
// leg (approvers + on-behalf employee notice) behave identically to the
// portal path.
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

  // v2.42.0: governed attachment — allowlist (PDF/PNG/JPEG/WebP) + 500 KB
  // decoded cap for data URLs, http(s) links stay accepted. The client
  // picker enforces the same rules; this is the authority.
  const attachmentCheck = validateLeaveAttachmentUrl(attachmentUrl);
  if (!attachmentCheck.ok) {
    return Response.json(
      { success: false, error: attachmentCheck.message, code: `ATTACHMENT_${attachmentCheck.code}` },
      { status: 400 }
    );
  }

  // Verify employee + leave type (with the linked user for the ownership
  // gate and the on-behalf marker decision below)
  const employee = await db.employee.findFirst({
    where: { id: employeeId, storeId, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      user: { select: { id: true } },
    },
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

  // v2.38.0 AUTHZ (mirrors the v2.33.0 CANCEL gate): decision-capable roles
  // file for any employee in their store (that is the on-behalf workflow);
  // every other role may only file for THEMSELVES.
  const isDecisionCapable = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(session.role);
  const isSelf = employee.user?.id === session.userId;
  if (!isDecisionCapable && !isSelf) {
    return Response.json(
      { success: false, error: 'You can only file leave requests for yourself.' },
      { status: 403 }
    );
  }

  // On-behalf marker: set whenever a decision-capable filer enters the
  // request for someone else. Filing for your own linked employee stays a
  // self-filed request (no marker, no self-notification).
  const onBehalf = isDecisionCapable && !isSelf;
  let enteredByName: string | null = null;
  if (onBehalf) {
    const actor = await db.user.findUnique({
      where: { id: session.userId },
      select: { name: true, email: true },
    });
    enteredByName = actor?.name?.trim() || actor?.email || session.email || 'HR';
  }

  // Create via the governed service path (balance guard + idempotent
  // recompute + audit + approver fan-out + on-behalf employee notice).
  let created: Awaited<ReturnType<typeof requestLeave>>;
  try {
    created = await requestLeave({
      employeeId,
      storeId,
      actorId: session.userId,
      actorRole: session.role,
      leaveTypeId,
      startDate: start,
      endDate: end,
      halfDay: halfDay === true,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : undefined,
      attachmentUrl: typeof attachmentUrl === 'string' && attachmentUrl.trim() ? attachmentUrl.trim() : null,
      emergencyContact: typeof emergencyContact === 'string' && emergencyContact.trim() ? emergencyContact.trim() : null,
      submitterEmail: session.email || undefined,
      enteredById: onBehalf ? session.userId : null,
      enteredByName,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Leave request could not be created.';
    if (message.startsWith('INSUFFICIENT_LEAVE_BALANCE')) {
      return Response.json(
        { success: false, error: message.replace('INSUFFICIENT_LEAVE_BALANCE: ', 'Insufficient leave balance. '), code: 'INSUFFICIENT_BALANCE' },
        { status: 400 }
      );
    }
    if (message.includes('Employee not found')) {
      return Response.json({ success: false, error: 'Employee not found for this store.' }, { status: 404 });
    }
    if (message.includes('PERIOD_MISMATCH') || message.includes('endDate')) {
      return Response.json({ success: false, error: message }, { status: 400 });
    }
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  await systemLog({
    action: 'LEAVE_REQUEST_SUBMITTED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Leave request submitted: ${employee.firstName} ${employee.lastName} requested ${toNum(created.workingDays)} day(s) of ${created.leaveType.name} (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)})${onBehalf ? ` - entered by HR (${enteredByName}) on behalf of the employee` : ''}`,
    storeId,
    userId: session.userId,
    metadata: {
      leaveRequestId: created.id,
      employeeId,
      leaveTypeId,
      workingDays: toNum(created.workingDays),
      onBehalfOf: onBehalf ? enteredByName : undefined,
    },
  });

  return Response.json({
    success: true,
    data: {
      id: created.id,
      employeeId: created.employeeId,
      leaveTypeId: created.leaveTypeId,
      leaveTypeName: created.leaveType.name,
      startDate: created.startDate.toISOString(),
      endDate: created.endDate.toISOString(),
      workingDays: created.workingDays,
      halfDay: created.halfDay,
      status: created.status,
      reason: created.reason,
      enteredByName: created.enteredByName,
      enteredBy: onBehalf,
      createdAt: created.createdAt.toISOString(),
    },
  }, { status: 201 });
}

export const POST = withErrorBoundary(
  requireStoreAccess(createLeaveHandler),
  'LEAVES_CREATE'
);

// PUT: Approve / reject / cancel / EDIT a leave request
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

  if (!['APPROVE', 'REJECT', 'CANCEL', 'EDIT'].includes(action)) {
    return Response.json(
      { success: false, error: 'action must be "APPROVE", "REJECT", "CANCEL", or "EDIT".' },
      { status: 400 }
    );
  }

  // Only managers+ can approve/reject; the employee themselves can cancel.
  // v2.40.0: EDIT (correcting a pending request in place) was an HR-desk
  // governance action behind this gate.
  // v2.45.0: EDIT left this gate — the request owner (the employee's linked
  // portal user) may now correct their own PENDING request from the portal,
  // which the decision-capable role gate would have refused. The owner vs
  // decision-capable split is enforced below, once the request is fetched.
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

  // v2.33.0: CANCEL authorization - the comment above promised "the employee
  // themselves can cancel", but nothing enforced it: any authenticated
  // same-store user could CANCEL a colleague's request (horizontal authz
  // gap). The gate now mirrors the notifier's routing: decision-capable
  // managers may cancel any request in their store (freeing a slot), while
  // everyone else may cancel ONLY their own request (self-withdrawal).
  if (action === 'CANCEL') {
    const isDecisionCapable = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(session.role);
    const isRequestOwner = leaveRequest.employee.user?.id === session.userId;
    if (!isDecisionCapable && !isRequestOwner) {
      return Response.json(
        { success: false, error: 'You can only cancel your own leave requests.' },
        { status: 403 }
      );
    }
  }

  // v2.45.0: EDIT authorization mirrors the CANCEL split above — decision-
  // capable roles may correct any request in their store (the v2.40.0 HR
  // desk flow), and the request OWNER may now correct their own PENDING
  // request from the portal (a typo should not cost a withdraw + refile).
  // Everyone else is refused; tenant scoping below still applies to both.
  if (action === 'EDIT') {
    const isDecisionCapable = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(session.role);
    const isRequestOwner = leaveRequest.employee.user?.id === session.userId;
    if (!isDecisionCapable && !isRequestOwner) {
      return Response.json(
        { success: false, error: 'You can only correct your own leave requests.' },
        { status: 403 }
      );
    }
  }

  // Tenant scoping: non-admin can only manage their own store's requests
  if (session.storeId && leaveRequest.storeId !== session.storeId && session.role !== 'SUPER_ADMIN') {
    return Response.json(
      { success: false, error: 'You can only manage leave requests from your own store.' },
      { status: 403 }
    );
  }

  // ── v2.40.0: EDIT — the governed correction window ─────────────────────
  // Correct a PENDING request in place (dates / half-day / type / reason /
  // attachment / note) instead of cancel + refile. Handled in its own early
  // branch: unlike the decision actions below it performs NO status
  // transition and NO approvedBy stamp — the request stays exactly where it
  // is in the approval flow, only its content is corrected (with the
  // editedAt/editedByName/editNote provenance stamp from the schema).
  if (action === 'EDIT') {
    const { startDate, endDate, halfDay, leaveTypeId, reason, emergencyContact, attachmentUrl, editNote, editedByName } =
      body as {
        startDate?: string;
        endDate?: string;
        halfDay?: boolean;
        leaveTypeId?: string;
        reason?: string;
        emergencyContact?: string | null;
        attachmentUrl?: string | null;
        editNote?: string | null;
        editedByName?: string | null;
      };

    if (!startDate || !endDate) {
      return Response.json(
        { success: false, error: 'startDate and endDate are required for an edit.' },
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
    // v2.42.0: the attachment follows the same governed rules as filing —
    // allowlist + size cap on the data URL, http(s) links accepted.
    const attachmentCheck = validateLeaveAttachmentUrl(attachmentUrl);
    if (!attachmentCheck.ok) {
      return Response.json(
        { success: false, error: attachmentCheck.message, code: `ATTACHMENT_${attachmentCheck.code}` },
        { status: 400 }
      );
    }

    // Optional type change must be real.
    if (leaveTypeId && leaveTypeId !== leaveRequest.leaveTypeId) {
      const newType = await db.leaveType.findUnique({ where: { id: leaveTypeId }, select: { id: true } });
      if (!newType) {
        return Response.json({ success: false, error: 'Leave type not found.' }, { status: 404 });
      }
    }

    // Editor display name: explicit override (from the UI session) or the
    // acting user's own record — the employee-facing copy always names who
    // corrected the request.
    let editorLabel = typeof editedByName === 'string' && editedByName.trim() ? editedByName.trim() : null;
    if (!editorLabel) {
      const actor = await db.user.findUnique({ where: { id: session.userId }, select: { name: true, email: true } });
      editorLabel = actor?.name?.trim() || actor?.email || session.email || 'HR';
    }

    let updated;
    try {
      updated = await editLeaveRequest({
        requestId: leaveRequestId,
        actorId: session.userId,
        actorRole: session.role,
        startDate: start,
        endDate: end,
        halfDay: halfDay === true,
        leaveTypeId: leaveTypeId && leaveTypeId !== leaveRequest.leaveTypeId ? leaveTypeId : undefined,
        ...(reason !== undefined ? { reason } : {}),
        ...(emergencyContact !== undefined ? { emergencyContact: typeof emergencyContact === 'string' && emergencyContact.trim() ? emergencyContact.trim() : null } : {}),
        ...(attachmentUrl !== undefined ? { attachmentUrl: typeof attachmentUrl === 'string' && attachmentUrl.trim() ? attachmentUrl.trim() : null } : {}),
        editedByName: editorLabel,
        editNote: typeof editNote === 'string' && editNote.trim() ? editNote.trim() : null,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Leave request could not be edited.';
      if (message.startsWith('NOT_EDITABLE')) {
        return Response.json({ success: false, error: message.replace('NOT_EDITABLE: ', '') , code: 'NOT_EDITABLE' }, { status: 400 });
      }
      if (message.startsWith('INSUFFICIENT_LEAVE_BALANCE')) {
        return Response.json(
          { success: false, error: message.replace('INSUFFICIENT_LEAVE_BALANCE: ', 'Insufficient leave balance. '), code: 'INSUFFICIENT_BALANCE' },
          { status: 400 }
        );
      }
      if (message.includes('PERIOD_MISMATCH') || message.includes('endDate')) {
        return Response.json({ success: false, error: message }, { status: 400 });
      }
      return Response.json({ success: false, error: message }, { status: 400 });
    }

    await systemLog({
      action: 'LEAVE_REQUEST_EDITED',
      component: LogComponent.SYSTEM,
      severity: LogSeverity.INFO,
      message: `Leave request edited: ${leaveRequest.employee.firstName} ${leaveRequest.employee.lastName} - ${leaveRequest.leaveType.name} (${toNum(leaveRequest.workingDays)} day(s), ${new Date(leaveRequest.startDate).toISOString().slice(0, 10)} to ${new Date(leaveRequest.endDate).toISOString().slice(0, 10)}) corrected to ${updated.leaveType.name} (${toNum(updated.workingDays)} day(s), ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}) by ${editorLabel}`,
      storeId: leaveRequest.storeId,
      userId: session.userId,
      metadata: {
        leaveRequestId,
        employeeId: leaveRequest.employeeId,
        oldWorkingDays: toNum(leaveRequest.workingDays),
        newWorkingDays: toNum(updated.workingDays),
        typeChanged: updated.leaveTypeId !== leaveRequest.leaveTypeId,
      },
    });

    return Response.json({ success: true, data: updated });
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

  // v2.33.0: cancellation notifications - the last silent transition on the
  // lifecycle. Routing is bidirectional (see notifyLeaveRequestCancelled):
  // manager cancels → the employee hears about it; employee withdraws → the
  // approvals group learns the slot freed up. Same best-effort contract as
  // every other delivery surface: never blocks or fails the cancellation.
  if (newStatus === 'CANCELLED') {
    try {
      await notifyLeaveRequestCancelled({
        leaveRequestId,
        storeId: leaveRequest.storeId,
        employeeId: leaveRequest.employee.id,
        leaveTypeId: leaveRequest.leaveType.id,
        startDate: leaveRequest.startDate,
        endDate: leaveRequest.endDate,
        workingDays: toNum(leaveRequest.workingDays),
        actorUserId: session.userId,
        actorRole: session.role,
        actorEmail: session.email || null,
      });
    } catch {
      // Cancel delivery is best-effort by design.
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
