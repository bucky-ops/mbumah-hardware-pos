// MBUMAH HARDWARE POS - EMS leave service (v2.18.7)
//
// Leave requests, delegation, and idempotent balance recomputation. The
// available figure is derived (allocated + carryForward - used - pending);
// recomputeBalances rewrites the stored aggregates from approved and pending
// requests and is safe to run any number of times for the same period
// (same input, same output, no drift).

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import { LEAVE_REQUEST_METADATA_MARKER, leaveSubmissionCopy } from './leave-notify';
import { sendEmail } from '@/lib/email-service';

export interface RequestLeaveInput {
  employeeId: string;
  storeId: string;
  actorId: string;
  actorRole: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  halfDay?: boolean;
  reason?: string;
  /** v2.32.0: optional submitter email for the "submitted by …" footer on
   *  the manager notification email. */
  submitterEmail?: string;
}

function countWorkingDays(from: Date, to: Date, halfDay: boolean): number {
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1; // skip weekends
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const value = halfDay ? days - 0.5 : days;
  return Math.max(0, value);
}

export async function requestLeave(input: RequestLeaveInput) {
  const employee = await db.employee.findFirst({
    where: { id: input.employeeId, storeId: input.storeId, deletedAt: null },
    select: { id: true },
  });
  if (!employee) throw new Error('Employee not found.');
  if (input.endDate < input.startDate) {
    throw new Error('endDate must be on or after startDate (PERIOD_MISMATCH).');
  }

  const workingDays = countWorkingDays(input.startDate, input.endDate, input.halfDay === true);
  if (workingDays <= 0) throw new Error('Leave range contains no working days (PERIOD_MISMATCH).');

  const year = input.startDate.getUTCFullYear();
  const balance = await db.employeeLeaveBalance.findFirst({
    where: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, leaveYear: year },
    select: { id: true, allocatedDays: true, carryForwardDays: true, usedDays: true, pendingDays: true },
  });

  if (balance) {
    const available =
      Number(balance.allocatedDays) + Number(balance.carryForwardDays) - Number(balance.usedDays) - Number(balance.pendingDays);
    if (workingDays > available) {
      throw new Error(`INSUFFICIENT_LEAVE_BALANCE: requested ${workingDays} day(s), available ${available}.`);
    }
  }

  const request = await db.leaveRequest.create({
    data: {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      storeId: input.storeId,
      startDate: input.startDate,
      endDate: input.endDate,
      returnDate: new Date(input.endDate.getTime() + 24 * 3600 * 1000),
      workingDays,
      halfDay: input.halfDay === true,
      status: 'PENDING',
      reason: input.reason ?? null,
    },
  });

  // v2.32.0 FIX (QA-caught): the stored pendingDays aggregate was only
  // incremented by the legacy HR-desk POST /api/leaves path — requestLeave
  // (the portal and /api/leave/requests paths) never touched it, so the
  // derived `available` figure overstated entitlement between submission and
  // decision and a second overlapping request could over-commit. The
  // idempotent, aggregate-derived recompute (same primitive the decision
  // path uses) heals the row immediately and stays self-consistent.
  try {
    await recomputeBalances(input.employeeId, input.leaveTypeId, year);
  } catch {
    // Balance healing is best-effort; the request itself is already created.
  }

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'CREATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: request.id,
    storeId: input.storeId,
    reason: 'Leave request submitted.',
    metadata: { employeeId: input.employeeId, workingDays, year },
  });

  // v2.32.0: notify the store's decision-capable users (employee → manager
  // direction). Best-effort: a notification failure must never fail the
  // submission itself, so this is awaited inside its own try/catch.
  try {
    await notifyLeaveRequestSubmitted({
      leaveRequestId: request.id,
      storeId: input.storeId,
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      workingDays,
      reason: input.reason ?? null,
      submitterUserId: input.actorId,
      submitterEmail: input.submitterEmail ?? null,
    });
  } catch {
    // Submission delivery is best-effort by design.
  }
  return request;
}

/** v2.32.0: submission notifications for a PENDING leave request — one
 *  durable category-HR bell row per active decision-capable user
 *  (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER / ACCOUNTANT of the request's
 *  store, plus all cross-store SUPER_ADMINs, submitter excluded) and ONE
 *  grouped email. Shared by every submission path: requestLeave (portal +
 *  leave/requests route) and the HR-desk POST /api/leaves. */
export async function notifyLeaveRequestSubmitted(params: {
  leaveRequestId: string;
  storeId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  workingDays: number;
  reason?: string | null;
  submitterUserId: string;
  submitterEmail?: string | null;
}): Promise<void> {
  const [employee, leaveType] = await Promise.all([
    db.employee.findUnique({ where: { id: params.employeeId }, select: { firstName: true, lastName: true } }),
    db.leaveType.findUnique({ where: { id: params.leaveTypeId }, select: { name: true } }),
  ]);
  if (!employee || !leaveType) return;

  const approvers = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      id: { not: params.submitterUserId },
      OR: [{ storeId: params.storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  if (approvers.length === 0) return;

  const copy = leaveSubmissionCopy({
    firstName: employee.firstName,
    lastName: employee.lastName,
    leaveTypeName: leaveType.name,
    startDate: params.startDate.toISOString(),
    endDate: params.endDate.toISOString(),
    workingDays: params.workingDays,
    reason: params.reason ?? null,
    submittedByLabel: params.submitterEmail ?? null,
  });

  await db.notification.createMany({
    data: approvers.map((u) => ({
      storeId: params.storeId,
      userId: u.id,
      title: copy.title,
      message: copy.message,
      type: copy.notifType,
      category: 'HR',
      priority: copy.priority,
      metadata: JSON.stringify({
        kind: LEAVE_REQUEST_METADATA_MARKER,
        leaveRequestId: params.leaveRequestId,
        employeeId: params.employeeId,
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
      metadata: { leaveRequestId: params.leaveRequestId, employeeId: params.employeeId },
    }).catch(() => undefined);
  }
}

export async function decideLeaveRequest(
  requestId: string,
  storeId: string,
  actorId: string,
  actorRole: string,
  decision: 'APPROVED' | 'REJECTED',
  rejectionReason?: string,
  delegateApproverUserId?: string,
) {
  const request = await db.leaveRequest.findFirst({
    where: { id: requestId, storeId, status: 'PENDING' },
    select: { id: true, employeeId: true, leaveTypeId: true, startDate: true, workingDays: true },
  });
  if (!request) throw new Error('Pending leave request not found.');

  await db.leaveRequest.update({
    where: { id: requestId },
    data: {
      status: decision,
      approvedBy: decision === 'APPROVED' ? actorId : null,
      rejectionReason: decision === 'REJECTED' ? rejectionReason ?? null : null,
      delegateApproverUserId: delegateApproverUserId ?? null,
    },
  });

  await recomputeBalances(request.employeeId, request.leaveTypeId, request.startDate.getUTCFullYear());

  await hrAudit({
    actorId,
    actorRole,
    action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: requestId,
    storeId,
    reason: `Leave request ${decision.toLowerCase()}.`,
    metadata: { employeeId: request.employeeId, workingDays: Number(request.workingDays) },
  });
  return { id: requestId, status: decision };
}

/**
 * Idempotent balance recompute: aggregates derive entirely from the request
 * table, so running this for the same employee/type/year any number of times
 * yields identical rows.
 */
export async function recomputeBalances(employeeId: string, leaveTypeId: string, year: number) {
  const approved = await db.leaveRequest.aggregate({
    where: { employeeId, leaveTypeId, status: 'APPROVED', startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    _sum: { workingDays: true },
  });
  const pending = await db.leaveRequest.aggregate({
    where: { employeeId, leaveTypeId, status: 'PENDING', startDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    _sum: { workingDays: true },
  });

  const usedDays = approved._sum.workingDays ?? 0;
  const pendingDays = pending._sum.workingDays ?? 0;

  const existing = await db.employeeLeaveBalance.findFirst({
    where: { employeeId, leaveTypeId, leaveYear: year },
    select: { id: true },
  });

  if (existing) {
    await db.employeeLeaveBalance.update({
      where: { id: existing.id },
      data: { usedDays, pendingDays },
    });
  } else {
    await db.employeeLeaveBalance.create({
      data: { employeeId, leaveTypeId, leaveYear: year, usedDays, pendingDays },
    });
  }
  return { usedDays, pendingDays };
}

export async function grantBalance(
  employeeId: string,
  storeId: string,
  actorId: string,
  actorRole: string,
  leaveTypeId: string,
  year: number,
  allocatedDays: number,
  carryForwardDays?: number,
) {
  const existing = await db.employeeLeaveBalance.findFirst({
    where: { employeeId, leaveTypeId, leaveYear: year },
    select: { id: true, allocatedDays: true },
  });

  if (existing) {
    // Grants adjust the allocation baseline; they never overwrite usage
    // (recomputeBalances owns used/pending).
    await db.employeeLeaveBalance.update({
      where: { id: existing.id },
      data: { allocatedDays, ...(carryForwardDays != null ? { carryForwardDays } : {}) },
    });
  } else {
    await db.employeeLeaveBalance.create({
      data: {
        employeeId,
        leaveTypeId,
        leaveYear: year,
        allocatedDays,
        carryForwardDays: carryForwardDays ?? 0,
      },
    });
  }

  await hrAudit({
    actorId,
    actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: employeeId,
    storeId,
    reason: `Leave balance granted: ${allocatedDays} day(s) for ${year}.`,
    metadata: { leaveTypeId, year, carryForwardDays: carryForwardDays ?? 0 },
  });
  return { employeeId, leaveTypeId, year, allocatedDays };
}

/** Month-end spanning allocation: a request crossing the year boundary allocates to each year correctly (recompute per year). */
export async function recomputeAllBalancesForYear(employeeId: string, year: number) {
  const types = await db.leaveType.findMany({ select: { id: true } });
  for (const t of types) {
    await recomputeBalances(employeeId, t.id, year);
  }
}
