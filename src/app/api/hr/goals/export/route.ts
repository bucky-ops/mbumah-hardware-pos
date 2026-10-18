// GET /api/hr/goals/export?employeeId=&cycleId=&status=&source=
//
// v2.97.0: the Goals tab files itself — the governed CSV of the EXACT
// filtered subset the board shows, via the same server builder family the
// report tabs (v2.58), the desk report (v2.70) and the reviews export
// (v2.96) file through. The route re-runs the service's listGoals with the
// query's filters (employee / cycle / status / metric source — the source
// predicate joined the service this round), so a downloaded file can never
// disagree with the screen: same scope (employeeScopeWhere), same shape,
// same order.
//
// Contract:
//   • Guard: hr.performance.review — the same read guard the list answers
//     through; the export widens nothing.
//   • status must be one of GOAL_STATUSES when present (400 INVALID_STATUS);
//     source must be one of GOAL_SOURCES (400 INVALID_SOURCE) — unknown
//     values are refused honestly, never silently meaning 'all'.
//   • employeeId / cycleId are optional passthroughs (an unknown id simply
//     matches nothing → honest 404).
//   • Empty result → 404 NO_GOAL_DATA (never an empty-looking sheet).
//   • Deleted goals never file: the export re-runs listGoals (the live
//     board); the bench has its own reconcile view.
//   • Exports are audit logged (PERFORMANCE_GOALS_EXPORTED) with
//     field-name-only metadata — filter ids and sizes ride the row, never
//     employee names.

import { hrGuard } from '@/lib/hr/guard';
import { listGoals, GOAL_SOURCES, GOAL_STATUSES, type GoalDto } from '@/lib/hr/goal-service';
import { goalsToCsv } from '@/lib/hr/performance-csv';
import { digestOrgAndScope } from '@/lib/hr/report-schedule-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

/**
 * Pure query parsing/validation (unit-tested). Boolean-by-presence honesty
 * like the reviews export: a garbage status or source is a 400, not a
 * silent 'all'.
 */
export function parseGoalsExportQuery(
  params: URLSearchParams,
): {
  ok: true;
  employeeId: string | null;
  cycleId: string | null;
  status: string | null;
  source: string | null;
} | { ok: false; status: number; code: string; error: string } {
  const employeeId = (params.get('employeeId') ?? '').trim() || null;
  const cycleId = (params.get('cycleId') ?? '').trim() || null;
  const statusRaw = (params.get('status') ?? '').trim();
  if (statusRaw && !(GOAL_STATUSES as readonly string[]).includes(statusRaw)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_STATUS',
      error: `Unknown status "${statusRaw}". Filterable statuses: ${GOAL_STATUSES.join(', ')}.`,
    };
  }
  const sourceRaw = (params.get('source') ?? '').trim();
  if (sourceRaw && !(GOAL_SOURCES as readonly string[]).includes(sourceRaw)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_SOURCE',
      error: `Unknown source "${sourceRaw}". Filterable sources: ${GOAL_SOURCES.join(', ')}.`,
    };
  }
  return { ok: true, employeeId, cycleId, status: statusRaw || null, source: sourceRaw || null };
}

/** The DTO's visible facts narrowed to the filing row shape. */
function toFilingRow(g: GoalDto) {
  return {
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
  };
}

export const GET = hrGuard('hr.performance.review')(async (request, session) => {
  try {
    const parsed = parseGoalsExportQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return Response.json(
        { success: false, error: parsed.error, code: parsed.code },
        { status: parsed.status },
      );
    }

    // The SAME call the Goals tab's data comes from — the file cannot
    // disagree with the screen (scope, shape, order all inherited from the
    // service; the source predicate rides along since v2.97.0).
    const goals = await listGoals(session, {
      employeeId: parsed.employeeId ?? undefined,
      cycleId: parsed.cycleId ?? undefined,
      status: parsed.status ?? undefined,
      source: parsed.source ?? undefined,
    });
    if (goals.length === 0) {
      return Response.json(
        { success: false, error: 'No goals match the current filters.', code: 'NO_GOAL_DATA' },
        { status: 404 },
      );
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );
    const statusLabel = parsed.status
      ? parsed.status.replace(/_/g, ' ').toLowerCase()
      : 'all';
    const sourceLabel = parsed.source
      ? parsed.source.replace(/_/g, ' ').toLowerCase()
      : 'all';

    const file = goalsToCsv(goals.map(toFilingRow), {
      organizationName,
      scopeLabel,
      statusLabel,
      sourceLabel,
    });
    // Unreachable while goals.length > 0 (the builder's only null path is
    // the empty list), but the type keeps the route honest.
    if (!file) {
      return Response.json(
        { success: false, error: 'No goals match the current filters.', code: 'NO_GOAL_DATA' },
        { status: 404 },
      );
    }

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_GOALS_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: file.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        employeeId: parsed.employeeId,
        cycleId: parsed.cycleId,
        status: parsed.status,
        source: parsed.source,
        count: goals.length,
        byteSize: file.byteSize,
        format: 'csv',
        channel: 'ad_hoc_download',
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
