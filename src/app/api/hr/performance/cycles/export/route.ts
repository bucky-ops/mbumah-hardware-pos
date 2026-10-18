// GET /api/hr/performance/cycles/export
//
// v2.97.0: the Cycles tab files itself — the governed CSV of the list the
// screen shows, via the same server builder family the report tabs (v2.58),
// the desk report (v2.70) and the reviews export (v2.96) file through. The
// route re-runs the service's listCycles — the SAME call the tab makes — so
// a downloaded file can never disagree with the screen: same scope
// (organizationId), same shape, same newest-period-first order.
//
// Contract:
//   • Guard: hr.performance.review — anyone who can READ the list can file
//     it; the export widens nothing.
//   • Static `export` segment rides beside `[id]` exactly like the goals
//     bench's static `deleted` segment — static wins, no collision.
//   • Empty result → 404 NO_CYCLE_DATA (a CSV that "looks empty" would read
//     as a broken export).
//   • PRIVACY FLOOR: the builder's input slice has NO calibrationNotes —
//     notes are manage-only content in the drawer, so a read-guarded file
//     cannot carry them (impossible by construction, contract-tested).
//   • Exports are audit logged (PERFORMANCE_CYCLES_EXPORTED) with
//     field-name-only metadata — the row says a file was built and how big
//     it is, never whose cycles are in it.

import { hrGuard } from '@/lib/hr/guard';
import { listCycles } from '@/lib/hr/performance-service';
import { cyclesToCsv } from '@/lib/hr/performance-csv';
import { digestOrgAndScope } from '@/lib/hr/report-schedule-service';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

export const GET = hrGuard('hr.performance.review')(async (_request, session) => {
  try {
    // The SAME call the Cycles tab makes — the file cannot disagree with
    // the screen (scope, shape, order all inherited from the service).
    const cycles = await listCycles(session);
    if (cycles.length === 0) {
      return Response.json(
        { success: false, error: 'No cycles match the current view.', code: 'NO_CYCLE_DATA' },
        { status: 404 },
      );
    }

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      session.storeId ?? null,
    );

    const file = cyclesToCsv(
      cycles.map((c) => ({
        name: c.name,
        periodStart: c.periodStart,
        periodEnd: c.periodEnd,
        status: c.status,
        reviewCount: c.reviewCount,
        statusCounts: c.statusCounts,
        createdAt: c.createdAt,
      })),
      { organizationName, scopeLabel },
    );
    // Unreachable while cycles.length > 0 (the builder's only null path is
    // the empty list), but the type keeps the route honest.
    if (!file) {
      return Response.json(
        { success: false, error: 'No cycles match the current view.', code: 'NO_CYCLE_DATA' },
        { status: 404 },
      );
    }

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'PERFORMANCE_CYCLES_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: file.filename,
      storeId: session.storeId ?? undefined,
      metadata: {
        count: cycles.length,
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
