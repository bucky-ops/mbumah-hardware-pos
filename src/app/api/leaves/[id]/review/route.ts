// POST /api/leaves/[id]/review - stamp the desk visit (v2.59.0).
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
    select: { id: true, storeId: true, status: true, editedAt: true, deskReviewedAt: true },
  });

  if (!existing || existing.storeId !== session.storeId) {
    return Response.json(
      { success: false, error: 'Leave request not found.' },
      { status: 404 },
    );
  }

  const reviewedAt = new Date();

  const updated = await db.leaveRequest.update({
    where: { id },
    data: { deskReviewedAt: reviewedAt },
    select: { id: true, deskReviewedAt: true, editedAt: true },
  });

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
      hadPendingCorrection: needsDeskRecheck(existing.editedAt, existing.deskReviewedAt),
    },
  });

  return Response.json({
    success: true,
    data: {
      id: updated.id,
      deskReviewedAt: updated.deskReviewedAt?.toISOString() ?? null,
      // Always false after a stamp BY CONSTRUCTION — the review just now is
      // not older than any edit that already landed. Stated explicitly so
      // the client can update its row without recomputing the rule.
      needsRecheck: needsDeskRecheck(updated.editedAt, updated.deskReviewedAt),
    },
  });
}

export const POST = withErrorBoundary(
  requireStoreAccess(reviewLeaveHandler),
  'LEAVES_REVIEW'
);
