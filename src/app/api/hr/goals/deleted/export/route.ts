// GET /api/hr/goals/deleted/export
//
// v2.99.0: the bench files itself — the governed CSV of the EXACT rows the
// bench dialog shows, through the same server builder family the report
// tabs (v2.58), the desk report (v2.70) and the reviews/cycles/goals
// exports (v2.96/v2.97) file through. The filing family completes: every
// performance surface a manager can LOOK at now FILEs too.
//
// Contract:
//   • Guard: hr.performance.manage — the SAME guard the bench list answers
//     through; the export widens nothing. The bench is a manager's
//     surface; reviewers read the live board only.
//   • The file is the whole bench window the service returns (the 50 most
//     recent deletions), newest first — the service's own order. When the
//     window is the cap, the header block's Window line says so instead of
//     letting the file silently pose as the whole bench.
//   • Empty bench → 404 NO_BENCH_DATA (never an empty-looking sheet).
//   • Exports are audit logged (PERFORMANCE_BENCH_EXPORTED) with
//     field-name-only metadata — count and size ride the row, never
//     employee names.
//
// Static segment precedent: `deleted` already wins over `[id]` (v2.93);
// `deleted/export` nests beside `deleted/route.ts` the same way
// `goals/export` sits beside the goals collection route.

import { hrGuard } from '@/lib/hr/guard';
import { listDeletedGoals } from '@/lib/hr/goal-service';
import { benchToCsv } from '@/lib/hr/performance-csv';
import { digestOrgAndScope } from '@/lib/hr/report-schedule-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

/** The bench's filing window label — honest about the service's take: 50. */
export function benchWindowLabel(count: number): string {
  return count >= 50 ? 'most recent 50 deletions' : 'all deletions';
}

export const GET = hrGuard('hr.performance.manage')(async (_request, session) => {
  try {
    // The SAME call the bench dialog's rows come from — the file cannot
    // disagree with the screen (scope, shape, order all inherited from
    // the service).
    const goals = await listDeletedGoals(session);
    if (goals.length === 0) {
      return Response.json(
        { success: false, error: 'The bench is clear — nothing to file.', code: 'NO_BENCH_DATA' },
        { status: 404 },
      );
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );

    const file = benchToCsv(
      goals.map((g) => ({
        title: g.title,
        employeeName: g.employeeName,
        cycleName: g.cycleName,
        metricSource: g.metricSource,
        metricLabel: g.metricLabel,
        status: g.status,
        currentValue: g.currentValue,
        targetValue: g.targetValue,
        progressPct: g.progressPct,
        dueDate: g.dueDate,
        deletedAt: g.deletedAt,
      })),
      {
        organizationName,
        scopeLabel,
        windowLabel: benchWindowLabel(goals.length),
      },
    );
    // Unreachable while goals.length > 0 (the builder's only null path is
    // the empty list), but the type keeps the route honest.
    if (!file) {
      return Response.json(
        { success: false, error: 'The bench is clear — nothing to file.', code: 'NO_BENCH_DATA' },
        { status: 404 },
      );
    }

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_BENCH_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: file.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        count: goals.length,
        byteSize: file.byteSize,
        format: 'csv',
        channel: 'ad_hoc_download',
        window: benchWindowLabel(goals.length),
      },
    }).catch(() => undefined);

    return new Response(file.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': String(file.byteSize),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
