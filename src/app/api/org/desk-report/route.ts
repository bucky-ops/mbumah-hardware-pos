// GET /api/org/desk-report (v2.69.0)
//
// The desk files its report — a printable per-branch roll-up of the
// LeaveReviewVisit ledger over an explicit window, the third voice of the
// morning-note family (v2.67.0 strip → v2.68.0 bell → v2.69.0 report).
//
// SCOPE CONTRACT (deliberately differs from the morning note): the digest
// note is always org-wide — it is the org's shared yesterday, never re-keyed
// by the panel's filters. The REPORT is an explicit scope the caller picks:
//   ?days=7|14|30   window length in EAT calendar days, today included
//                   (resolveDeskReportDays falls back to 7 on anything else)
//   ?branch=<id>    optional narrow to one store's visits
// Both re-key the whole report — that is the point of a report. The UI
// states the scope it is printing; no filter ever moves silently.
//
// READ-ONLY by contract: no bell, no notification writes, nothing created.
// The morning note rings from /api/org/review-activity; this route only
// derives. Printing a report never rings anything.
//
// AUTHORIZATION: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER — the exact
// ORG_ROLES gate /api/org/review-activity uses (DESK_REPORT_ORG_ROLES).
// Cross-store PII is limited to what these roles already see on the panel:
// employee names + leave types on their org's desks.
//
// READS go through rawDb (the un-intercepted client) inside runWithoutTenant
// so the v2.57.0 leak class (a tenant interceptor silently AND-narrowing an
// org read to the browsing store) can never shrink the report — the branch
// narrow here is an explicit caller choice, never an interceptor default.

import { rawDb, runWithoutTenant } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import {
  DESK_REPORT_ORG_ROLES,
  deskReportCsvFilename,
  deskReportToCsv,
  deriveDeskReport,
  deskReportWindow,
  resolveDeskReportDays,
  type DeskReportPayload,
  type DeskReportVisitRow,
} from '@/lib/hr/desk-report';

export const dynamic = 'force-dynamic';

async function deskReportHandler(request: Request): Promise<Response> {
  return runWithoutTenant(async () => {
    const url = new URL(request.url);
    const days = resolveDeskReportDays(url.searchParams.get('days'));
    const branch = url.searchParams.get('branch')?.trim() || null;
    // v2.70.0: ?format=csv files the report — same read, same derivation,
    // serialized through the shared deskReportToCsv builder instead of JSON.
    const wantCsv = url.searchParams.get('format') === 'csv';
    const now = new Date();
    const window = deskReportWindow(now, days);

    // One visit-scale scan of the window (already branch-narrowed in the
    // where when the caller picked a branch) — every figure below derives
    // from these rows in one pass, so the printed page and the screen can
    // never disagree about the same window.
    const rows = await rawDb.leaveReviewVisit.findMany({
      where: {
        createdAt: { gte: window.start, lt: window.end },
        ...(branch ? { leaveRequest: { storeId: branch } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        visitedByName: true,
        createdAt: true,
        clearedRecheck: true,
        leaveRequestId: true,
        leaveRequest: {
          select: {
            status: true,
            storeId: true,
            store: { select: { name: true } },
            employee: { select: { firstName: true, lastName: true } },
            leaveType: { select: { name: true } },
          },
        },
      },
    });

    const report = deriveDeskReport(rows as DeskReportVisitRow[], { ...window, days });
    // The scope line names the branch when narrowed — from the rows' own
    // store name when the narrow matched something, else the raw id (an
    // unknown/empty branch derives to an honest all-zero report, never 404).
    const branchName = branch
      ? (rows.find((r) => r.leaveRequest.storeId === branch)?.leaveRequest.store?.name ?? branch)
      : null;

    const data: DeskReportPayload = {
      generatedAt: now.toISOString(),
      scope: { branch, branchName },
      ...report,
    };

    // v2.70.0 — the CSV voice. The organization name rides the same
    // fallback the digest service uses; the filename carries the window
    // bounds so filed copies never overwrite each other.
    if (wantCsv) {
      const organizationName =
        (await rawDb.organization.findFirst({ select: { name: true } }))?.name ?? 'MBUMAH Hardware';
      const csv = deskReportToCsv(data, {
        organizationName,
        scopeLabel: branchName ? `Branch: ${branchName}` : 'All branches',
        generatedAt: now,
      });
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${deskReportCsvFilename(data)}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return Response.json({
      success: true,
      data,
    });
  });
}

export const GET = withErrorBoundary(
  requireAuth((request: Request) => deskReportHandler(request), {
    roles: [...DESK_REPORT_ORG_ROLES],
  }),
  LogComponent.API,
);
