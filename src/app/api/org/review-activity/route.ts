// GET /api/org/review-activity (v2.64.0 organization console, v2.65.0 depth)
//
// The visit ledger steps into the light — the org console gets a "Desk
// activity" audit panel over the v2.63.0 LeaveReviewVisit ledger. Every
// desk visit is already on the record per request (the dialog's timeline);
// this read turns the SAME ledger org-wide: who looked at what, where,
// when, and whether the visit cleared a re-check marker — the audit view
// the corrections loop never had at the organization level.
//
// v2.65.0 — the console answers WHO and WHERE: the read grew two optional
// query params so the panel can drill down instead of only listing.
//   ?reviewer=<visitedByName>  drill-down: `recent` narrows to that
//           reviewer's visits (newest-first), and `reviewerStats` rides
//           along — their org-wide totals (visits, clears, last visit) so
//           the drill-down header can answer "how much desk does this
//           person actually pull". Unmatched names yield an honest empty
//           list, never an error.
//   ?branch=<storeId>         branch filter: `recent` narrows to visits on
//           that store's requests. Composes with ?reviewer (AND).
//   `branches` always rides the payload — per-store visit counts org-wide
//           (unaffected by the filters) so the panel's filter chips stay
//           stable while the timeline narrows.
//   `stats`   stays ORG-WIDE under every filter — the tiles are the
//           at-a-glance org figures; the drill-down bar carries the
//           reviewer-specific ones. One read, two altitudes, no surprise
//           re-keyed numbers.
//
// DATA MODEL (mirrors /api/org/kpi-summary v2.58.0):
//   recent  newest-first 12 visits joined to their request (store name,
//           employee name, leave type, request status) — enough for the
//           panel's timeline without shipping the whole ledger.
//   stats   total on record, visits in the trailing 7 days, how many of
//           those cleared a re-check marker, distinct reviewers in the
//           window (the "how many people are actually reading" figure).
//
// AUTHORIZATION: SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER — the exact
// ORG_ROLES gate /api/org/kpi-summary uses. ACCOUNTANT keeps the per-store
// matrix (/api/org/summary) and stays out of the cross-store audit view,
// per the v2.18.3 reconciliation precedent. Cross-store PII is limited to
// what these roles already see: employee names + leave types on their
// org's desks — the drill-down only narrows what is already visible.
//
// READS go through rawDb (the un-intercepted client) inside
// runWithoutTenant so the v2.57.0 leak class (a tenant interceptor
// silently AND-narrowing an org read to the browsing store) can never
// shrink an org audit to one branch's visits — INCLUDING the v2.65.0
// branch filter, which is an explicit caller choice, never an
// interceptor's silent default.

import { rawDb, runWithoutTenant } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

const DAY_MS = 86_400_000;

// The panel reads top-down and never drowns: 12 rows is the same density
// the KPI timeline and the live feed settle at.
const RECENT_LIMIT = 12;

async function orgReviewActivityHandler(request: Request): Promise<Response> {
  return runWithoutTenant(async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    // v2.65.0 drill-down params — absent/empty means "no filter". The
    // reviewer is matched on the denormalised visitedByName display name
    // (the exact string the timeline rows render), the branch on the
    // request's storeId. Unknown values simply match nothing — the panel
    // shows its honest empty state instead of an error.
    const url = new URL(request.url);
    const reviewer = url.searchParams.get('reviewer')?.trim() || null;
    const branch = url.searchParams.get('branch')?.trim() || null;

    const visitWhere: Record<string, unknown> = {};
    if (reviewer) visitWhere.visitedByName = reviewer;
    if (branch) visitWhere.leaveRequest = { storeId: branch };

    const [recentRows, total, weekVisits, weekClears, weekReviewerRows, branchRows, reviewerVisits, reviewerClears, reviewerLast] = await Promise.all([
      rawDb.leaveReviewVisit.findMany({
        where: visitWhere,
        orderBy: { createdAt: 'desc' },
        take: RECENT_LIMIT,
        select: {
          id: true,
          visitedByName: true,
          createdAt: true,
          clearedRecheck: true,
          leaveRequest: {
            select: {
              id: true,
              status: true,
              store: { select: { name: true } },
              leaveType: { select: { name: true } },
              employee: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      rawDb.leaveReviewVisit.count(),
      rawDb.leaveReviewVisit.count({ where: { createdAt: { gte: weekAgo } } }),
      rawDb.leaveReviewVisit.count({ where: { createdAt: { gte: weekAgo }, clearedRecheck: true } }),
      rawDb.leaveReviewVisit.findMany({
        where: { createdAt: { gte: weekAgo } },
        distinct: ['visitedByName'],
        select: { visitedByName: true },
      }),
      // v2.65.0: per-store visit counts for the filter chips — read
      // org-wide and NEVER narrowed by the caller's filters, so the chip
      // row stays stable while the timeline above it narrows. The ledger
      // is visit-scale (one row per dialog open), so the full scan is the
      // honest cheap read; a groupBy cannot traverse the relation.
      rawDb.leaveReviewVisit.findMany({
        select: { leaveRequest: { select: { storeId: true, store: { select: { name: true } } } } },
      }),
      // v2.65.0: the drill-down's reviewer figures — org-wide for the
      // person (NOT narrowed by the branch chip) so the header answers
      // "how much desk does this reviewer pull" at the org altitude.
      reviewer
        ? rawDb.leaveReviewVisit.count({ where: { visitedByName: reviewer } })
        : Promise.resolve(0),
      reviewer
        ? rawDb.leaveReviewVisit.count({ where: { visitedByName: reviewer, clearedRecheck: true } })
        : Promise.resolve(0),
      reviewer
        ? rawDb.leaveReviewVisit.findFirst({
            where: { visitedByName: reviewer },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          })
        : Promise.resolve(null),
    ]);

    const branchCounts = new Map<string, { storeId: string; storeName: string; visits: number }>();
    for (const row of branchRows) {
      const storeId = row.leaveRequest.storeId;
      const storeName = row.leaveRequest.store?.name ?? storeId;
      const entry = branchCounts.get(storeId) ?? { storeId, storeName, visits: 0 };
      entry.visits += 1;
      branchCounts.set(storeId, entry);
    }
    const branches = [...branchCounts.values()].sort(
      (a, b) => b.visits - a.visits || a.storeName.localeCompare(b.storeName),
    );

    return Response.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        stats: {
          total,
          weekVisits,
          weekClears,
          weekReviewers: weekReviewerRows.length,
        },
        recent: recentRows.map((v) => ({
          id: v.id,
          visitedByName: v.visitedByName,
          visitedAt: v.createdAt.toISOString(),
          clearedRecheck: v.clearedRecheck,
          storeName: v.leaveRequest.store?.name ?? null,
          employeeName: `${v.leaveRequest.employee.firstName} ${v.leaveRequest.employee.lastName}`,
          leaveTypeName: v.leaveRequest.leaveType?.name ?? 'Leave',
          requestStatus: v.leaveRequest.status,
        })),
        branches,
        ...(reviewer
          ? {
              reviewerStats: {
                visits: reviewerVisits,
                clears: reviewerClears,
                lastVisitAt: reviewerLast?.createdAt.toISOString() ?? null,
              },
            }
          : {}),
      },
    });
  });
}

export const GET = withErrorBoundary(
  requireAuth((request: Request) => orgReviewActivityHandler(request), { roles: ORG_ROLES }),
  LogComponent.API,
);
