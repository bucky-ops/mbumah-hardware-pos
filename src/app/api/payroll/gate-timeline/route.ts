// GET /api/payroll/gate-timeline - the store's gate story across runs (v2.141.0)
//
// The per-run trail lives on the run detail (v2.138.0); the runs table wears
// each run's attempt chip (v2.139.0). This read answers the cross-run
// question: every append-only PayrollRunGateEvent this store has produced,
// newest first, with run + period context attached, movement computed
// chronologically by the pure builder.
//
// WINDOW HONESTY: the read takes the NEWEST 120 events (the activity view's
// bounded appetite) and the payload SAYS the window (`window: 120`,
// `totalEvents` from a parallel count) — the card can never pretend it saw
// more than it read. Read-only: no create/update/delete path exists here.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';
import { buildGateTimeline, summarizeGateTimeline } from '@/lib/hr/payroll/gate-timeline';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const TIMELINE_WINDOW = 120;

export const GET = hrGuard('hr.payroll.read.all', READ_ROLES)(async (_request, session) => {
  const storeId = session.storeId || '';
  // ONE bounded read of the newest events (desc) + ONE count for the honest
  // window line; reversed to chronological order here so the pure builder
  // computes movement in the direction attempts actually happened.
  const [events, totalEvents] = await Promise.all([
    db.payrollRunGateEvent.findMany({
      where: { storeId },
      orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }],
      take: TIMELINE_WINDOW,
      include: {
        run: {
          select: {
            status: true,
            payrollPeriod: { select: { name: true } },
          },
        },
      },
    }),
    db.payrollRunGateEvent.count({ where: { storeId } }),
  ]);

  // Actor labels in ONE query — the same fallback ladder the run detail
  // uses: name → email → 'Unknown user'.
  const actorIds = events
    .map((e) => e.actorId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const actorUsers = actorIds.length
    ? await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actors = Object.fromEntries(
    actorUsers.map((u) => [u.id, u.name?.trim() || u.email || 'Unknown user']),
  );

  // Chronological feed → chronological rows → newest-first payload (the
  // activity reading). moved flags survive the reverse: they are per-row
  // facts about the attempt BEFORE it, not positional artifacts.
  const chronological = [...events].reverse();
  const rows = buildGateTimeline(
    chronological.map((e) => ({
      id: e.id,
      runId: e.runId,
      runLabel: e.run.payrollPeriod?.name ?? null,
      runStatus: e.run.status ?? null,
      outcome: e.outcome,
      checkedAt: e.checkedAt,
      summary: e.summary,
      actorLabel: e.actorId ? actors[e.actorId] ?? 'Unknown user' : null,
    })),
  );

  return Response.json({
    success: true,
    data: {
      rows: [...rows].reverse(),
      summary: summarizeGateTimeline(rows),
      window: TIMELINE_WINDOW,
      totalEvents,
      checkedAt: new Date().toISOString(),
    },
  });
});
