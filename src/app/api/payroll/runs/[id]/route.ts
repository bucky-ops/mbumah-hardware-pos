// GET /api/payroll/runs/[id] - run header + aggregate totals + action context
// v2.22.0: additive `disbursement` block (PII-free B2C state per payslip) so
// the run dialog can light up Retry failed / Check status affordances without
// a second request.
// v2.84.0: additive `history` block — the run's lifecycle as an ordered list
// of who-did-what (actor names resolved in ONE query, same fallback ladder as
// the digest labels: name → email → 'Unknown user'), when it happened (ISO;
// the dialog stamps EAT), and the rejection reason. No new visibility: the
// timeline is the same facts the header row already carried, made readable.
// v2.85.0: the walk gains its missing step — submittedAt/submittedById join
// the actor map and the builder input, and `can.isPreparer` covers the
// handover boundary (prepared OR submitted ⇒ maker-checker).

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { hasHrPermission } from '@/lib/hr/permissions';
import { summariseRunB2CState } from '@/lib/hr/payroll/disbursement-service';
import { buildRunHistory } from '@/lib/hr/payroll/run-history';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(
  async (_request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const run = await db.payrollRun.findFirst({
      where: { id, storeId: session.storeId || '' },
      include: {
        payrollPeriod: { select: { name: true, payDate: true, startDate: true, endDate: true } },
        journalEntry: { select: { id: true, entryNumber: true, postedAt: true } },
      },
    });
    if (!run) {
      return Response.json({ success: false, error: 'Payroll run not found.' }, { status: 404 });
    }
    // Viewer capabilities so the UI can disable actions it may not call.
    const can = {
      prepare: hasHrPermission(session.role, 'hr.payroll.prepare'),
      approve: hasHrPermission(session.role, 'hr.payroll.approve'),
      post: hasHrPermission(session.role, 'hr.payroll.post'),
      disburse: hasHrPermission(session.role, 'hr.payroll.disburse'),
      correct: hasHrPermission(session.role, 'hr.payroll.correct'),
      // v2.85.0: the maker-checker boundary is the HANDOVER — a session that
      // prepared OR submitted the run is bound by it, so the dialog's approve
      // affordance disables for both (the server enforces it regardless).
      isPreparer: run.preparedByUserId === session.userId || run.submittedById === session.userId,
      isCorrectionRequester: false,
    };
    // v2.22.0: B2C disbursement state. Best-effort: a state failure must never
    // degrade the run view (older runs have no transactions at all).
    let disbursement: Awaited<ReturnType<typeof summariseRunB2CState>> | null = null;
    try {
      disbursement = await summariseRunB2CState(id);
    } catch {
      disbursement = null;
    }
    // v2.84.0: resolve every lifecycle actor's label in ONE query, then let
    // the pure builder shape the ordered timeline. Best-effort: a name
    // lookup failure must never degrade the run view.
    let history: ReturnType<typeof buildRunHistory> = [];
    try {
      const actorIds = [
        run.initiatedBy,
        run.preparedByUserId,
        run.submittedById,
        run.approvedByUserId,
        run.rejectedByUserId,
        run.postedByUserId,
        run.lockedByUserId,
      ].filter((v): v is string => typeof v === 'string' && v.length > 0);
      const actorUsers = actorIds.length
        ? await db.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const actors = Object.fromEntries(
        actorUsers.map((u) => [u.id, u.name?.trim() || u.email || 'Unknown user']),
      );
      history = buildRunHistory(
        {
          createdAt: run.createdAt,
          initiatedBy: run.initiatedBy,
          status: run.status,
          preparedAt: run.preparedAt,
          preparedByUserId: run.preparedByUserId,
          submittedAt: run.submittedAt,
          submittedById: run.submittedById,
          approvedAt: run.approvedAt,
          approvedByUserId: run.approvedByUserId,
          rejectedByUserId: run.rejectedByUserId,
          rejectionReason: run.rejectionReason,
          postedAt: run.postedAt,
          postedByUserId: run.postedByUserId,
          lockedAt: run.lockedAt,
          lockedByUserId: run.lockedByUserId,
          paidAt: run.paidAt,
          journalEntryNumber: run.journalEntry?.entryNumber ?? null,
        },
        actors,
      );
    } catch {
      history = [];
    }
    return Response.json({ success: true, data: run, can, disbursement, history });
  },
);
