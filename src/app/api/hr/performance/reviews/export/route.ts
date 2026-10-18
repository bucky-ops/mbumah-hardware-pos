// GET /api/hr/performance/reviews/export?cycleId=&status=
//
// v2.96.0: the Reviews tab files itself — a governed CSV of the EXACT
// filtered subset the screen shows, via the same server builder family the
// report tabs use (v2.58) and the desk report uses (v2.70). The route
// re-runs the service's listReviews with the query's filters, so a
// downloaded file can never disagree with the screen: same scope
// (employeeScopeWhere), same shape (the rating-free list DTO — spec rule 7),
// same order.
//
// Contract:
//   • Guard: hr.performance.review — anyone who can READ the list can file
//     it; the export widens nothing.
//   • status must be one of REVIEW_STATUSES when present (400 otherwise) —
//     an unknown status is refused honestly, never silently meaning 'all'.
//   • cycleId is optional; when present it is passed through to the service
//     (an unknown id simply matches nothing → honest 404).
//   • Empty result → 404 NO_REVIEW_DATA (a CSV that "looks empty" would
//     read as a broken export).
//   • Exports are audit logged (PERFORMANCE_REVIEWS_EXPORTED) with
//     field-name-only metadata — no employee names ride the audit row.

import { hrGuard } from '@/lib/hr/guard';
import { listReviews, REVIEW_STATUSES } from '@/lib/hr/performance-service';
import { reviewsToCsv } from '@/lib/hr/performance-csv';
import { digestOrgAndScope } from '@/lib/hr/report-schedule-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

/**
 * Pure query parsing/validation (unit-tested). Returns either a
 * ready-to-list request or a structured client error. Mirrors the report
 * export route's boolean-by-presence honesty: a garbage status is a 400,
 * not a silent 'all'.
 */
export function parseReviewsExportQuery(
  params: URLSearchParams,
): { ok: true; cycleId: string | null; status: string | null } | { ok: false; status: number; code: string; error: string } {
  const cycleId = (params.get('cycleId') ?? '').trim() || null;
  const statusRaw = (params.get('status') ?? '').trim();
  if (statusRaw && !(REVIEW_STATUSES as readonly string[]).includes(statusRaw)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_STATUS',
      error: `Unknown status "${statusRaw}". Filterable statuses: ${REVIEW_STATUSES.join(', ')}.`,
    };
  }
  return { ok: true, cycleId, status: statusRaw || null };
}

export const GET = hrGuard('hr.performance.review')(async (request, session) => {
  try {
    const parsed = parseReviewsExportQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return Response.json(
        { success: false, error: parsed.error, code: parsed.code },
        { status: parsed.status },
      );
    }

    // The SAME call the Reviews tab makes — the file cannot disagree with
    // the screen (scope, shape, order all inherited from the service).
    const reviews = await listReviews(session, {
      cycleId: parsed.cycleId ?? undefined,
      status: parsed.status ?? undefined,
    });
    if (reviews.length === 0) {
      return Response.json(
        { success: false, error: 'No reviews match the current filters.', code: 'NO_REVIEW_DATA' },
        { status: 404 },
      );
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );
    const cycleLabel = parsed.cycleId
      ? reviews[0]?.cycleName ?? 'Selected cycle'
      : 'All cycles';
    const statusLabel = parsed.status
      ? parsed.status.replace(/_/g, ' ').toLowerCase()
      : 'all';

    const file = reviewsToCsv(
      reviews.map((r) => ({
        employeeName: r.employeeName,
        jobTitle: r.jobTitle,
        cycleName: r.cycleName,
        status: r.status,
        acknowledgedAt: r.acknowledgedAt,
        createdAt: r.createdAt,
      })),
      { organizationName, scopeLabel, cycleLabel, statusLabel },
    );
    // Unreachable while reviews.length > 0 (the builder's only null path is
    // the empty list), but the type keeps the route honest.
    if (!file) {
      return Response.json(
        { success: false, error: 'No reviews match the current filters.', code: 'NO_REVIEW_DATA' },
        { status: 404 },
      );
    }

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_REVIEWS_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: file.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        cycleId: parsed.cycleId,
        status: parsed.status,
        count: reviews.length,
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
