// POST /api/leaves/[id]/review - stamp the desk visit (v2.59.0).
//
// v2.60.0: the stamp is now PERSONAL — the reviewer's User.id + display
// name ride alongside the timestamp, so the desk receipt says "Last
// reviewed by Grace" and the employee's portal card shows the same
// reviewer. A review is a person reading, not a timer firing.
//
// v2.63.0: every visit is now also recorded in the LeaveReviewVisit ledger
// (WHO looked, WHEN, whether THIS visit cleared a re-check marker), and the
// response carries the visit history + total count so the desk dialog can
// render the visit timeline — "three people looked at this" is now
// distinguishable from "nobody has".
//
// The HR desk's detail dialog is the ONE place an approver actually reads a
// request before deciding. Opening it stamps deskReviewedAt, which powers
// the amber "re-check" chip on rows whose last correction has not been seen
// yet (needsDeskRecheck: editedAt > deskReviewedAt, or any editedAt with no
// visit at all). Merely opening the dialog never mutates request data — the
// stamp is a read-receipt, not a decision; APPROVE/REJECT/CANCEL/EDIT keep
// their own guards on PUT /api/leaves.
//
// Guard: requireStoreAccess (the same guard as GET /api/leaves — anyone who
// can already see the desk's rows may mark one as read; stamping a review
// timestamp is not an escalation). Cross-store ids answer 404, not 403, so
// the endpoint never discloses that a foreign request id exists.

import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { needsDeskRecheck } from '@/lib/hr/leave-recheck';
// v2.62.0: the answered fan-out reuses the EXACT decision-capable set the
// correction fan-out addressed, so the group told "a correction landed" and
// the group later told "it was answered" can never drift apart.
import { DECISION_CAPABLE_ROLES } from '@/lib/hr/leave-service';
import {
  LEAVE_REVIEW_SEEN_METADATA_MARKER,
  LEAVE_REVIEW_ANSWERED_METADATA_MARKER,
  leaveReviewSeenCopy,
  leaveReviewAnsweredCopy,
} from '@/lib/hr/leave-notify';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function reviewLeaveHandler(...args: unknown[]): Promise<Response> {
  const session = args[1] as {
    userId: string;
    role: string;
    email?: string;
    storeId: string | null;
  };
  const { id } = await (args[2] as RouteContext).params;

  const existing = await db.leaveRequest.findUnique({
    where: { id },
    select: {
      id: true,
      storeId: true,
      status: true,
      editedAt: true,
      deskReviewedAt: true,
      // v2.61.0: the bell answers the correction — the row needs the leave
      // type + range (copy) and the employee's linked user (recipient) so
      // the desk visit can TELL the employee their correction was read.
      // v2.62.0: the same visit answers the APPROVERS too — the row needs
      // the employee's name so the answered copy leads with the person the
      // approver knows the request by.
      startDate: true,
      endDate: true,
      leaveType: { select: { name: true } },
      employee: {
        select: {
          firstName: true,
          lastName: true,
          user: { select: { id: true } },
        },
      },
    },
  });

  if (!existing || existing.storeId !== session.storeId) {
    return Response.json(
      { success: false, error: 'Leave request not found.' },
      { status: 404 },
    );
  }

  const reviewedAt = new Date();

  // Computed from the PRE-update row: true exactly when this stamp actually
  // clears a pending correction (the v2.59.0 re-check marker flips off).
  // Doubles as the v2.61.0 bell gate — only a visit that carries news (the
  // correction was unseen) writes the employee row; re-opening an already
  // reviewed dialog is silent by construction, no matter how many
  // approvers repeat the visit.
  const hadPendingCorrection = needsDeskRecheck(existing.editedAt, existing.deskReviewedAt);

  // v2.60.0: resolve the reviewer's display name (the session carries only
  // the id + email; the receipt is addressed to a human). Fallback chain:
  // Users.name -> session email -> raw id, so the stamp NEVER fails just
  // because a name lookup misfired.
  const reviewer = await db.user.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true },
  });
  const reviewerName = reviewer?.name ?? session.email ?? session.userId;

  const updated = await db.leaveRequest.update({
    where: { id },
    data: {
      deskReviewedAt: reviewedAt,
      deskReviewedById: session.userId,
      deskReviewedByName: reviewerName,
    },
    select: { id: true, deskReviewedAt: true, deskReviewedByName: true, editedAt: true },
  });

  // v2.63.0: the desk keeps its own ledger — the stamp columns above only
  // ever carry the LATEST visit (every re-open overwrites them), so the
  // visit itself is now also recorded as a LeaveReviewVisit row: WHO
  // looked, WHEN, and whether THIS visit cleared a pending re-check
  // marker. Best-effort under its own guard by the same contract as every
  // leave delivery: the stamp is already durable, a ledger failure must
  // never fail the visit (the dialog still opens, the chip still clears).
  try {
    await db.leaveReviewVisit.create({
      data: {
        leaveRequestId: id,
        visitedById: session.userId,
        visitedByName: reviewerName,
        clearedRecheck: hadPendingCorrection,
      },
    });
  } catch {
    // Visit-ledger write is best-effort by design.
  }

  await systemLog({
    action: 'LEAVE_REVIEW_STAMPED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Desk review stamped for leave request ${id} by ${session.email ?? session.userId}`,
    userId: session.userId,
    storeId: session.storeId ?? undefined,
    metadata: {
      leaveRequestId: id,
      requestStatus: existing.status,
      hadPendingCorrection,
      reviewerId: session.userId,
      reviewerName,
    },
  });

  // v2.61.0: the bell answers the correction — when the stamp actually
  // CLEARS a pending correction, the employee's bell gets an active row
  // ("Your corrected leave request was seen", named reviewer) instead of
  // the v2.60.0 mirror waiting passively for them to open the portal.
  // Best-effort by the same contract as every leave delivery: the stamp is
  // already on record, so a notification failure must never fail the visit.
  // The hadPendingCorrection gate is the dedup: the FIRST visit after an
  // edit carries the news, every later re-open of the dialog is silent.
  if (hadPendingCorrection) {
    try {
      const recipientUserId = existing.employee?.user?.id ?? null;
      if (recipientUserId) {
        const copy = leaveReviewSeenCopy({
          leaveTypeName: existing.leaveType.name,
          startDate: existing.startDate.toISOString(),
          endDate: existing.endDate.toISOString(),
          reviewerName,
        });
        await db.notification.create({
          data: {
            storeId: existing.storeId,
            userId: recipientUserId,
            title: copy.title,
            message: copy.message,
            type: copy.notifType,
            category: 'HR',
            priority: copy.priority,
            actionUrl: '/employees/me/leave',
            actionLabel: 'View my leave',
            metadata: JSON.stringify({
              kind: LEAVE_REVIEW_SEEN_METADATA_MARKER,
              leaveRequestId: id,
              reviewerName,
            }),
          },
        });
      }
    } catch {
      // Review-seen delivery is best-effort by design.
    }

    // v2.62.0: the correction answers to the room — the SAME clearing visit
    // also rings the APPROVERS who were told about the correction (the
    // v2.43.0 amber "corrected — re-check it" fan-out raised a question;
    // this row answers it). Recipients are the exact decision-capable set
    // the correction went to, minus the reviewer (they ARE the answer) and
    // minus the employee's linked user (their own v2.61.0 row already
    // carries the moment). Bell-only like the employee row — a
    // read-receipt is not inbox-worthy. Best-effort under its own guard:
    // the stamp is durable, a fan-out failure must never fail the visit,
    // and the employee row above must not be lost to an approver error.
    try {
      const employeeLinkedUserId = existing.employee?.user?.id ?? null;
      const exclude = [session.userId, ...(employeeLinkedUserId ? [employeeLinkedUserId] : [])];

      const approvers = await db.user.findMany({
        where: {
          isActive: true,
          role: { in: [...DECISION_CAPABLE_ROLES] },
          id: { notIn: exclude },
          OR: [{ storeId: existing.storeId }, { role: 'SUPER_ADMIN' }],
        },
        select: { id: true },
      });

      if (approvers.length > 0) {
        const copy = leaveReviewAnsweredCopy({
          firstName: existing.employee.firstName,
          lastName: existing.employee.lastName,
          leaveTypeName: existing.leaveType.name,
          startDate: existing.startDate.toISOString(),
          endDate: existing.endDate.toISOString(),
          reviewerName,
        });

        await db.notification.createMany({
          data: approvers.map((u) => ({
            storeId: existing.storeId,
            userId: u.id,
            title: copy.title,
            message: copy.message,
            type: copy.notifType,
            category: 'HR',
            priority: copy.priority,
            metadata: JSON.stringify({
              kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER,
              leaveRequestId: id,
              reviewerName,
            }),
          })),
        });
      }
    } catch {
      // Review-answered delivery is best-effort by design.
    }
  }

  // v2.63.0: the dialog renders the visit timeline — the ledger rides the
  // SAME response as the stamp (the dialog already POSTs on open), so no
  // extra GET round-trip and the history is fresh the moment it opens.
  // Newest first (the desk reads top-down), capped at the 8 most recent
  // with the TOTAL count alongside so "12 visits" can render honestly
  // without shipping all 12 rows.
  let visitHistory: Array<{ visitedByName: string; visitedAt: string; clearedRecheck: boolean }> = [];
  let visitCount = 0;
  try {
    const [rows, total] = await Promise.all([
      db.leaveReviewVisit.findMany({
        where: { leaveRequestId: id },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { visitedByName: true, createdAt: true, clearedRecheck: true },
      }),
      db.leaveReviewVisit.count({ where: { leaveRequestId: id } }),
    ]);
    visitHistory = rows.map((r) => ({
      visitedByName: r.visitedByName,
      visitedAt: r.createdAt.toISOString(),
      clearedRecheck: r.clearedRecheck,
    }));
    visitCount = total;
  } catch {
    // History read is best-effort — an empty timeline must never fail the
    // stamp response.
  }

  return Response.json({
    success: true,
    data: {
      id: updated.id,
      deskReviewedAt: updated.deskReviewedAt?.toISOString() ?? null,
      deskReviewedByName: updated.deskReviewedByName ?? null,
      // Always false after a stamp BY CONSTRUCTION — the review just now is
      // not older than any edit that already landed. Stated explicitly so
      // the client can update its row without recomputing the rule.
      needsRecheck: needsDeskRecheck(updated.editedAt, updated.deskReviewedAt),
      // v2.63.0: the visit ledger — newest-first entries (capped at 8) plus
      // the total visit count, rendered as the dialog's visit timeline.
      visitHistory,
      visitCount,
    },
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(reviewLeaveHandler),
  'LEAVES_REVIEW'
);
