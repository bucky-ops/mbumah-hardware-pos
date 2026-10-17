// GET /api/hr/reports/export?report=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD[&storeId=]
//
// v2.52.0: AD-HOC digest CSV export — the SAME governed digest payload the
// scheduled emails carry (buildDigestPayload), downloadable on demand from
// the /hr/reports page. One builder for both channels means the numbers in a
// downloaded CSV can never drift from the numbers in a digest email.
//
// Contract:
//   • Same guard + roles as the interactive report routes (hr.report.branch).
//   • report must be one of HR_SCHEDULE_REPORTS (400 otherwise).
//   • from/to are REQUIRED for the six period-keyed reports and IGNORED for
//     the year-keyed leave-utilisation digest (its period label is
//     "Leave year YYYY", exactly like the scheduled email).
//   • Period sanity: from ≤ to, span ≤ 366 days (filing exports are for a
//     filing period, not a data dump).
//   • Aggregates only — the payload is the digest, so no names / raw ids by
//     construction; scope narrowing happens inside the report functions
//     (BRANCH-scoped callers can never widen, org callers may drill down via
//     the validated storeId param).
//   • Empty report → honest 404 NO_REPORT_DATA (a CSV that "looks empty"
//     would read as a broken export).
//   • Exports are audit logged (DATA_EXPORT) with field-name-only metadata.

import { hrGuard } from '@/lib/hr/guard';
import {
  HR_SCHEDULE_REPORTS,
  buildDigestPayload,
  digestOrgAndScope,
  type HrScheduleReportKey,
} from '@/lib/hr/report-schedule-service';
import { digestToCsv, tableToCsv } from '@/lib/hr/digest-csv';
import { resolveReportScope, validateReportStore } from '@/lib/hr/reports';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';
import { toErrorResponse } from '@/lib/hr/stage-g-shared';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

/** 366 days — a leap-year filing period is the largest legitimate export. */
const MAX_EXPORT_SPAN_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure query parsing/validation for the export endpoint (unit-tested).
 * Returns either a ready-to-compute request or a structured client error.
 * v2.58.0: `section` — 'digest' (full file: header + Summary + table, the
 * default) or 'table' (header + the report's single table, no Summary — the
 * per-table CSV buttons on the report tabs deliver the SAME governed file,
 * table-only).
 */
export function parseExportQuery(
  params: URLSearchParams,
): { ok: true; reportKey: HrScheduleReportKey; from: string | null; to: string | null; year: number | null; storeId: string | null; section: 'digest' | 'table' } | { ok: false; status: number; code: string; error: string } {
  const reportRaw = (params.get('report') ?? '').trim();
  if (!reportRaw) {
    return { ok: false, status: 400, code: 'MISSING_REPORT', error: 'The report query parameter is required.' };
  }
  if (!HR_SCHEDULE_REPORTS.includes(reportRaw as HrScheduleReportKey)) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_REPORT',
      error: `Unknown report "${reportRaw}". Exportable reports: ${HR_SCHEDULE_REPORTS.join(', ')}.`,
    };
  }
  const reportKey = reportRaw as HrScheduleReportKey;

  // v2.58.0: the section param is boolean-by-presence — any value other than
  // '1'/'true' is refused honestly instead of silently meaning 'digest'.
  const tableRaw = (params.get('table') ?? '').trim();
  let section: 'digest' | 'table' = 'digest';
  if (tableRaw) {
    if (tableRaw !== '1' && tableRaw.toLowerCase() !== 'true') {
      return { ok: false, status: 400, code: 'INVALID_SECTION', error: 'table must be 1 or true (the table section of the governed digest file).' };
    }
    section = 'table';
  }

  const from = (params.get('from') ?? '').trim() || null;
  const to = (params.get('to') ?? '').trim() || null;

  // leave-utilisation is year-keyed: the digest ignores from/to by design and
  // takes the page's selected leave year instead (honours what the screen
  // shows — an export of a different year than displayed would be a lie).
  if (reportKey === 'leave-utilisation') {
    const yearRaw = (params.get('year') ?? '').trim();
    let year: number | null = null;
    if (yearRaw) {
      if (!/^\d{4}$/.test(yearRaw)) {
        return { ok: false, status: 400, code: 'INVALID_YEAR', error: 'year must be a four-digit year.' };
      }
      year = Number(yearRaw);
    }
    return { ok: true, reportKey, from: null, to: null, year, storeId: (params.get('storeId') ?? '').trim() || null, section };
  }

  if (!from || !to) {
    return {
      ok: false,
      status: 400,
      code: 'MISSING_PERIOD',
      error: 'from and to dates are required for this report (YYYY-MM-DD).',
    };
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return { ok: false, status: 400, code: 'INVALID_PERIOD', error: 'from and to must be YYYY-MM-DD dates.' };
  }
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return { ok: false, status: 400, code: 'INVALID_PERIOD', error: 'from and to must be valid calendar dates.' };
  }
  if (fromDate.getTime() > toDate.getTime()) {
    return { ok: false, status: 400, code: 'INVALID_PERIOD', error: 'from must be on or before to.' };
  }
  const spanDays = (toDate.getTime() - fromDate.getTime()) / 86_400_000;
  if (spanDays > MAX_EXPORT_SPAN_DAYS) {
    return {
      ok: false,
      status: 400,
      code: 'PERIOD_TOO_LONG',
      error: `The export period may span at most ${MAX_EXPORT_SPAN_DAYS} days.`,
    };
  }
  return { ok: true, reportKey, from, to, year: null, storeId: (params.get('storeId') ?? '').trim() || null, section };
}

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (request, session) => {
  try {
    const url = new URL(request.url);
    const parsed = parseExportQuery(url.searchParams);
    if (!parsed.ok) {
      return Response.json({ success: false, error: parsed.error, code: parsed.code }, { status: parsed.status });
    }
    const { reportKey } = parsed;

    // Same scope resolution as the interactive report routes: org roles may
    // drill down to one validated branch; branch roles are pinned to theirs.
    const scope = resolveReportScope(session);
    if (!scope) {
      return Response.json(
        { success: false, error: 'You do not have permission to export reports.', code: 'PERMISSION_DENIED' },
        { status: 403 },
      );
    }
    const store = await validateReportStore(session, scope, parsed.storeId);

    const now = new Date();
    const period =
      parsed.from && parsed.to
        ? { from: new Date(`${parsed.from}T00:00:00.000Z`), to: new Date(`${parsed.to}T23:59:59.999Z`) }
        : { from: now, to: now }; // leave-utilisation: dates unused, year comes from `year`/`now`
    const effectiveYear = parsed.year ?? now.getUTCFullYear();
    const periodLabel =
      reportKey === 'leave-utilisation'
        ? `Leave year ${effectiveYear}`
        : `${parsed.from} → ${parsed.to}`;

    const { organizationName, scopeLabel } = await digestOrgAndScope(
      session.organizationId,
      store?.id ?? null,
    );
    const digest = await buildDigestPayload(
      session,
      reportKey,
      period,
      { organizationName, scopeLabel, periodLabel, frequencyLabel: 'AD_HOC' },
      now,
      { storeId: store?.id ?? null, year: parsed.year ?? undefined },
    );
    if (!digest) {
      return Response.json(
        { success: false, error: 'No report data for this period.', code: 'NO_REPORT_DATA' },
        { status: 404 },
      );
    }

    const csv = parsed.section === 'table' ? tableToCsv(digest, now) : digestToCsv(digest, now);
    if (!csv) {
      return Response.json(
        { success: false, error: parsed.section === 'table' ? 'This report has no table section for this period.' : 'No report data for this period.', code: parsed.section === 'table' ? 'NO_TABLE_DATA' : 'NO_REPORT_DATA' },
        { status: 404 },
      );
    }

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'HR_REPORT_DIGEST_EXPORTED',
      resourceType: HrEntityType.DATA_EXPORT,
      resourceId: csv.filename,
      storeId: store?.id ?? session.storeId ?? undefined,
      metadata: {
        reportKey,
        from: parsed.from,
        to: parsed.to,
        year: parsed.year,
        scope: scopeLabel,
        format: 'csv',
        // v2.58.0: which section of the governed file was filed.
        section: parsed.section,
        byteSize: csv.byteSize,
        channel: 'ad_hoc_download',
      },
    }).catch(() => undefined);

    return new Response(Buffer.from(csv.content, 'base64'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csv.filename}"`,
        'Content-Length': String(csv.byteSize),
        'X-Digest-Csv-Filename': csv.filename,
        'X-Digest-Csv-Size': String(csv.byteSize),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
});
