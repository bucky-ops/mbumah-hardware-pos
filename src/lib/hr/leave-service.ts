// MBUMAH HARDWARE POS - EMS leave service (v2.18.7)
//
// Leave requests, delegation, and idempotent balance recomputation. The
// available figure is derived (allocated + carryForward - used - pending);
// recomputeBalances rewrites the stored aggregates from approved and pending
// requests and is safe to run any number of times for the same period
// (same input, same output, no drift).

import { db } from '@/lib/db';
import { hrAudit, HrEntityType } from './audit';
import {
  LEAVE_CANCEL_METADATA_MARKER,
  LEAVE_CORRECTED_METADATA_MARKER,
  LEAVE_EDITED_METADATA_MARKER,
  LEAVE_ON_BEHALF_METADATA_MARKER,
  LEAVE_REQUEST_METADATA_MARKER,
  leaveCancelledCopy,
  leaveCorrectedCopy,
  leaveEditedCopy,
  leaveOnBehalfCopy,
  leaveSubmissionCopy,
} from './leave-notify';
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
  /** v2.38.0: legacy HR-desk extras (POST /api/leaves). */
  attachmentUrl?: string | null;
  emergencyContact?: string | null;
  /** v2.38.0: on-behalf filing — when set, the request was entered by HR in
   *  the employee's name. The row is stamped (Entered by HR chip on every
   *  surface) and the EMPLOYEE is notified (bell row + email), which is the
   *  only leave surface addressed to someone who did not originate it. */
  enteredById?: string | null;
  enteredByName?: string | null;
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
      attachmentUrl: input.attachmentUrl ?? null,
      emergencyContact: input.emergencyContact ?? null,
      enteredById: input.enteredById ?? null,
      enteredByName: input.enteredByName ?? null,
    },
    include: { leaveType: { select: { name: true, code: true } } },
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
    metadata: { employeeId: input.employeeId, workingDays, year, onBehalfOf: input.enteredById ? input.enteredByName ?? 'HR' : undefined },
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
      enteredByLabel: input.enteredByName ?? null,
    });
  } catch {
    // Submission delivery is best-effort by design.
  }

  // v2.38.0: on-behalf filing — the EMPLOYEE learns a request was entered
  // in their name. Bell row to the linked user (if any) + best-effort email
  // to the employee address. Skipped for self-filed requests (no marker —
  // the employee authored it) and never fails the submission itself.
  if (input.enteredById) {
    try {
      const target = await db.employee.findUnique({
        where: { id: input.employeeId },
        select: { id: true, firstName: true, lastName: true, email: true, user: { select: { id: true } } },
      });
      if (target && target.user?.id !== input.enteredById) {
        const onBehalfCopy = leaveOnBehalfCopy({
          firstName: target.firstName,
          lastName: target.lastName,
          leaveTypeName: request.leaveType.name,
          startDate: input.startDate.toISOString(),
          endDate: input.endDate.toISOString(),
          workingDays,
          enteredByLabel: input.enteredByName ?? 'HR',
          reason: input.reason ?? null,
        });

        if (target.user?.id) {
          await db.notification.create({
            data: {
              storeId: input.storeId,
              userId: target.user.id,
              title: onBehalfCopy.title,
              message: onBehalfCopy.message,
              type: onBehalfCopy.notifType,
              category: 'HR',
              priority: onBehalfCopy.priority,
              actionUrl: '/employees/me/leave',
              actionLabel: 'View my leave',
              metadata: JSON.stringify({
                kind: LEAVE_ON_BEHALF_METADATA_MARKER,
                leaveRequestId: request.id,
                enteredByName: input.enteredByName ?? undefined,
              }),
            },
          });
        }

        if (target.email) {
          await sendEmail({
            to: target.email,
            subject: onBehalfCopy.emailSubject,
            html: onBehalfCopy.emailHtml,
            text: onBehalfCopy.emailText,
            userId: target.user?.id ?? undefined,
            type: 'LEAVE_REQUEST',
            metadata: { leaveRequestId: request.id, onBehalfOf: input.enteredByName ?? undefined },
          }).catch(() => undefined);
        }
      }
    } catch {
      // On-behalf delivery is best-effort by design.
    }
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
  /** v2.38.0: HR filer display name when the request was entered on behalf
   *  of the employee — shown on the approver email/bell so the approvals
   *  group knows the employee never typed the request. */
  enteredByLabel?: string | null;
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
    enteredByLabel: params.enteredByLabel ?? null,
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

/** v2.43.0: approver-facing CORRECTION notifications — when a PENDING leave
 *  request that was already fanned out to the approvals group gets corrected
 *  in place (the v2.40.0 edit window), every decision-capable user of the
 *  store learns the request they were notified of has changed. One durable
 *  category-HR bell row per approver + ONE grouped email, amber "re-check
 *  before deciding" copy carrying the before → after summary. Recipients
 *  mirror the submission fan-out (notifyLeaveRequestSubmitted) minus two
 *  exclusions: the actor (nobody is notified about their own action) and
 *  the employee's linked user (the employee-side leave_edited row already
 *  covers them — a manager-employee never gets the same fact twice).
 *  Best-effort by design: never blocks or fails the correction itself. */
export async function notifyLeaveRequestCorrected(params: {
  leaveRequestId: string;
  storeId: string;
  employeeId: string;
  /** Precomputed employee display name (the edit path already has it). */
  employeeName: string;
  leaveTypeName: string;
  startDate: Date;
  endDate: Date;
  workingDays: number;
  previousLeaveTypeName?: string | null;
  previousStartDate: Date;
  previousEndDate: Date;
  previousWorkingDays: number;
  /** The user who performed the correction (excluded from the fan-out). */
  actorUserId: string;
  /** The employee's linked user id, when one exists (excluded - covered by
   *  the employee-facing leave_edited row). */
  employeeLinkedUserId?: string | null;
}): Promise<void> {
  if (!params.leaveTypeName) return;

  const exclude = new Set<string>([params.actorUserId]);
  if (params.employeeLinkedUserId) exclude.add(params.employeeLinkedUserId);

  const approvers = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
      id: { notIn: [...exclude] },
      OR: [{ storeId: params.storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  if (approvers.length === 0) return;

  // Editor display label: same fallback ladder as the employee-side copy
  // above (name → email → 'HR').
  const editedByLabel =
    (await db.user
      .findUnique({ where: { id: params.actorUserId }, select: { name: true, email: true } })
      .then((u) => u?.name?.trim() || u?.email || null)
      .catch(() => null)) || 'HR';

  const copy = leaveCorrectedCopy({
    firstName: params.employeeName.split(' ')[0] || params.employeeName,
    lastName: params.employeeName.split(' ').slice(1).join(' '),
    leaveTypeName: params.leaveTypeName,
    startDate: params.startDate.toISOString(),
    endDate: params.endDate.toISOString(),
    workingDays: params.workingDays,
    previousLeaveTypeName: params.previousLeaveTypeName ?? null,
    previousStartDate: params.previousStartDate.toISOString(),
    previousEndDate: params.previousEndDate.toISOString(),
    previousWorkingDays: params.previousWorkingDays,
    editedByLabel,
    editNote: null,
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
        kind: LEAVE_CORRECTED_METADATA_MARKER,
        leaveRequestId: params.leaveRequestId,
        employeeId: params.employeeId,
        editedByLabel,
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
      type: 'LEAVE_EDIT',
      metadata: { leaveRequestId: params.leaveRequestId, employeeId: params.employeeId, editedByLabel },
    }).catch(() => undefined);
  }
}

/** Roles that can decide leave - shared by the submission fan-out above and
 *  the cancel router below so both directions address the same group. */
const DECISION_CAPABLE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

function isDecisionCapableRole(role: string): boolean {
  return (DECISION_CAPABLE_ROLES as readonly string[]).includes(role);
}

/** v2.33.0: cancellation notifications - the last silent transition on the
 *  leave lifecycle. Routing mirrors the direction of the ACTOR's counterpart
 *  so nobody is ever notified about their own action:
 *  - manager cancels → ONE durable bell row + best-effort email to the
 *    employee's linked user / employee address (mirror of the decision
 *    path), so the withdrawal is not discovered by refreshing balances;
 *  - employee self-cancels → the submissions fan-out (mirror of
 *    notifyLeaveRequestSubmitted) tells the approvals group the slot freed
 *    up, so nobody keeps a mental hold on the request.
 *  Best-effort by design: never blocks or fails the cancellation. */
export async function notifyLeaveRequestCancelled(params: {
  leaveRequestId: string;
  storeId: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  workingDays: number;
  /** The user who performed the cancellation. */
  actorUserId: string;
  actorRole: string;
  /** Optional actor display label ("cancelled by …" footer). */
  actorEmail?: string | null;
}): Promise<void> {
  const [employee, leaveType] = await Promise.all([
    db.employee.findUnique({
      where: { id: params.employeeId },
      select: { firstName: true, lastName: true, email: true, user: { select: { id: true, email: true } } },
    }),
    db.leaveType.findUnique({ where: { id: params.leaveTypeId }, select: { name: true } }),
  ]);
  if (!employee || !leaveType) return;

  const actorIsManager = isDecisionCapableRole(params.actorRole);
  const copy = leaveCancelledCopy({
    firstName: employee.firstName,
    lastName: employee.lastName,
    leaveTypeName: leaveType.name,
    startDate: params.startDate.toISOString(),
    endDate: params.endDate.toISOString(),
    workingDays: params.workingDays,
    cancelledByManager: actorIsManager,
    cancelledByLabel: params.actorEmail ?? null,
  });

  const metadata = JSON.stringify({
    kind: LEAVE_CANCEL_METADATA_MARKER,
    leaveRequestId: params.leaveRequestId,
    employeeId: params.employeeId,
    cancelledByManager: actorIsManager,
  });

  if (actorIsManager) {
    // Manager cancelled: one bell row for the employee's linked user (their
    // own action is excluded by construction - the actor is the manager).
    const recipientUserId = employee.user?.id ?? null;
    const recipientEmail = employee.email || employee.user?.email || null;
    if (recipientUserId) {
      await db.notification.create({
        data: {
          storeId: params.storeId,
          userId: recipientUserId,
          title: copy.title,
          message: copy.message,
          type: copy.notifType,
          category: 'HR',
          priority: copy.priority,
          actionUrl: '/employees/me/leave',
          actionLabel: 'View my leave',
          metadata,
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
        type: 'LEAVE_CANCEL',
        metadata: { leaveRequestId: params.leaveRequestId, employeeId: params.employeeId },
      }).catch(() => undefined);
    }
    return;
  }

  // Employee self-cancelled: fan out to the same approvals group as the
  // submission path (actor excluded), one grouped email.
  const approvers = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: [...DECISION_CAPABLE_ROLES] },
      id: { not: params.actorUserId },
      OR: [{ storeId: params.storeId }, { role: 'SUPER_ADMIN' }],
    },
    select: { id: true, email: true },
  });
  if (approvers.length === 0) return;

  await db.notification.createMany({
    data: approvers.map((u) => ({
      storeId: params.storeId,
      userId: u.id,
      title: copy.title,
      message: copy.message,
      type: copy.notifType,
      category: 'HR',
      priority: copy.priority,
      metadata,
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
      type: 'LEAVE_CANCEL',
      metadata: { leaveRequestId: params.leaveRequestId, employeeId: params.employeeId },
    }).catch(() => undefined);
  }
}

/** v2.40.0: governed edit window for PENDING leave requests. HR corrects
 *  dates / half-day / type / reason / attachment IN PLACE instead of the
 *  lossy cancel + refile dance (which would re-ping the whole approvals
 *  group and orphan the original row). Rules:
 *  - PENDING only — APPROVED/REJECTED/CANCELLED/TAKEN rows are frozen audit
 *    history (decisions already moved balances; cancel remains the path).
 *  - working days are recomputed with the same weekend-skipping arithmetic
 *    as filing, and the balance guard mirrors requestLeave: the corrected
 *    range must fit the available balance, counting the request's OWN
 *    current pending days as headroom when the leave type is unchanged
 *    (a type change draws on the target type's full availability).
 *  - balances recompute for both the old and the new (type, year) — the
 *    aggregate-derived recompute is idempotent, so pendingDays heal
 *    immediately either way.
 *  - the EMPLOYEE is always told: one bell row (linked user) + best-effort
 *    email carrying the before → after summary, the editor's name and the
 *    optional note. Never blocks or fails the correction itself.
 *  Throws (all prefixed for route mapping): NOT_EDITABLE, PERIOD_MISMATCH,
 *  INSUFFICIENT_LEAVE_BALANCE, Leave request not found. */
export interface EditLeaveRequestInput {
  requestId: string;
  actorId: string;
  actorRole: string;
  /** Corrected range (required). */
  startDate: Date;
  endDate: Date;
  halfDay?: boolean;
  /** Optional type change — omit to keep the current leave type. */
  leaveTypeId?: string;
  /** Field updates — undefined = keep the stored value (the UI always sends
   *  these explicitly, so undefined only happens for API callers). */
  reason?: string;
  emergencyContact?: string | null;
  attachmentUrl?: string | null;
  /** Display name of the editor for the employee-facing copy. */
  editedByName?: string | null;
  /** Optional note to the employee explaining the correction. */
  editNote?: string | null;
}

export async function editLeaveRequest(input: EditLeaveRequestInput) {
  const request = await db.leaveRequest.findUnique({
    where: { id: input.requestId },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          user: { select: { id: true } },
        },
      },
      leaveType: { select: { id: true, name: true } },
    },
  });
  if (!request) throw new Error('Leave request not found.');
  if (request.status !== 'PENDING') {
    throw new Error(`NOT_EDITABLE: only pending requests can be edited — this one is ${request.status}.`);
  }
  if (input.endDate < input.startDate) {
    throw new Error('endDate must be on or after startDate (PERIOD_MISMATCH).');
  }

  const newTypeId = input.leaveTypeId ?? request.leaveTypeId;
  const workingDays = countWorkingDays(input.startDate, input.endDate, input.halfDay === true);
  if (workingDays <= 0) throw new Error('Leave range contains no working days (PERIOD_MISMATCH).');

  // Balance guard (mirrors requestLeave): the corrected range must fit the
  // available balance of the TARGET type/year. The request's own current
  // pending days are added back as headroom when the type is unchanged —
  // the recompute after the update rewrites pendingDays from the table, so
  // this is purely a pre-flight check, never a manual ledger write.
  const oldYear = new Date(request.startDate).getUTCFullYear();
  const newYear = input.startDate.getUTCFullYear();
  const balance = await db.employeeLeaveBalance.findFirst({
    where: { employeeId: request.employeeId, leaveTypeId: newTypeId, leaveYear: newYear },
    select: { allocatedDays: true, carryForwardDays: true, usedDays: true, pendingDays: true },
  });
  if (balance) {
    const sameTypeAndYear = newTypeId === request.leaveTypeId && oldYear === newYear;
    const ownPending = sameTypeAndYear ? Number(request.workingDays) : 0;
    const available =
      Number(balance.allocatedDays) +
      Number(balance.carryForwardDays) -
      Number(balance.usedDays) -
      Number(balance.pendingDays) +
      ownPending;
    if (workingDays > available) {
      throw new Error(`INSUFFICIENT_LEAVE_BALANCE: corrected range needs ${workingDays} day(s), available ${available}.`);
    }
  }

  const updated = await db.leaveRequest.update({
    where: { id: input.requestId },
    data: {
      leaveTypeId: newTypeId,
      startDate: input.startDate,
      endDate: input.endDate,
      returnDate: new Date(input.endDate.getTime() + 24 * 3600 * 1000),
      workingDays,
      halfDay: input.halfDay === true,
      ...(input.reason !== undefined ? { reason: input.reason.trim() ? input.reason.trim() : null } : {}),
      ...(input.emergencyContact !== undefined ? { emergencyContact: input.emergencyContact } : {}),
      ...(input.attachmentUrl !== undefined ? { attachmentUrl: input.attachmentUrl } : {}),
      editedAt: new Date(),
      editedByName: input.editedByName ?? null,
      // v2.45.0: deterministic provenance — the acting user's id, so the
      // portal can render "Corrected by you" vs "Corrected by HR" without
      // comparing display names (which the email fallback breaks).
      editedByUserId: input.actorId,
      editNote: input.editNote?.trim() ? input.editNote.trim() : null,
    },
    include: { leaveType: { select: { name: true, code: true } } },
  });

  // Heal both (type, year) rows touched by the correction — a type change
  // frees pending days on the old type and reserves them on the new one.
  const recomputes = new Set<string>();
  recomputes.add(`${request.leaveTypeId}:${oldYear}`);
  recomputes.add(`${newTypeId}:${newYear}`);
  for (const key of recomputes) {
    const [typeId, year] = key.split(':');
    await recomputeBalances(request.employeeId, typeId, Number(year)).catch(() => undefined);
  }

  await hrAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: 'UPDATE',
    resourceType: HrEntityType.EMPLOYEE,
    resourceId: input.requestId,
    storeId: request.storeId,
    reason: 'Leave request corrected in place (edit window).',
    metadata: {
      employeeId: request.employeeId,
      before: {
        leaveTypeId: request.leaveTypeId,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        workingDays: Number(request.workingDays),
      },
      after: {
        leaveTypeId: newTypeId,
        startDate: input.startDate.toISOString(),
        endDate: input.endDate.toISOString(),
        workingDays,
      },
      editNote: input.editNote ?? undefined,
    },
  });

  // Employee notification — the other side always hears about a correction.
  // Skipped only when the actor IS the employee's linked user (nobody is
  // notified about their own action).
  try {
    if (request.employee.user?.id && request.employee.user.id !== input.actorId) {
      const editedByName =
        input.editedByName?.trim() ||
        (await db.user
          .findUnique({ where: { id: input.actorId }, select: { name: true, email: true } })
          .then((u) => u?.name?.trim() || u?.email || null)
          .catch(() => null)) ||
        'HR';

      const copy = leaveEditedCopy({
        firstName: request.employee.firstName,
        lastName: request.employee.lastName,
        leaveTypeName: updated.leaveType.name,
        startDate: input.startDate.toISOString(),
        endDate: input.endDate.toISOString(),
        workingDays,
        previousLeaveTypeName: request.leaveType.name,
        previousStartDate: request.startDate.toISOString(),
        previousEndDate: request.endDate.toISOString(),
        previousWorkingDays: Number(request.workingDays),
        editedByLabel: editedByName,
        editNote: input.editNote ?? null,
      });

      await db.notification.create({
        data: {
          storeId: request.storeId,
          userId: request.employee.user.id,
          title: copy.title,
          message: copy.message,
          type: copy.notifType,
          category: 'HR',
          priority: copy.priority,
          actionUrl: '/employees/me/leave',
          actionLabel: 'View my leave',
          metadata: JSON.stringify({
            kind: LEAVE_EDITED_METADATA_MARKER,
            leaveRequestId: request.id,
            employeeId: request.employeeId,
            editedByName,
          }),
        },
      });

      const recipientEmail = request.employee.email || null;
      if (recipientEmail) {
        await sendEmail({
          to: recipientEmail,
          subject: copy.emailSubject,
          html: copy.emailHtml,
          text: copy.emailText,
          userId: request.employee.user.id,
          type: 'LEAVE_EDIT',
          metadata: { leaveRequestId: request.id, employeeId: request.employeeId, editedByName },
        }).catch(() => undefined);
      }
    }
  } catch {
    // Edit delivery is best-effort by design — the correction itself has
    // already been applied, audited and recomputed by this point.
  }

  // v2.43.0: approver-side correction awareness — the approvals group was
  // notified of the ORIGINAL request (submission fan-out) and can sit on a
  // mental slot that silently re-based under them; without this row an
  // approver may approve on stale dates. One bell row per decision-capable
  // user, excluding the actor (nobody is notified about their own action)
  // and the employee's linked user (already covered by the employee-side
  // row above, so a manager-employee never gets the same fact twice).
  try {
    await notifyLeaveRequestCorrected({
      leaveRequestId: request.id,
      storeId: request.storeId,
      employeeId: request.employeeId,
      employeeName: `${request.employee.firstName} ${request.employee.lastName}`.trim(),
      leaveTypeName: updated.leaveType.name,
      startDate: input.startDate,
      endDate: input.endDate,
      workingDays,
      previousLeaveTypeName: request.leaveType.name,
      previousStartDate: request.startDate,
      previousEndDate: request.endDate,
      previousWorkingDays: Number(request.workingDays),
      actorUserId: input.actorId,
      employeeLinkedUserId: request.employee.user?.id ?? null,
    });
  } catch {
    // Approver delivery is best-effort by design.
  }

  return updated;
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
