// GET /api/org/review-activity (v2.64.0 organization console, v2.65.0 depth,
// v2.67.0 the morning note)
//
// v2.67.0 — the digest: the payload grew a `yesterday` block, the desk's
// morning note derived from the previous EAT calendar day of the ledger —
// visits, corrections answered, distinct reviewers, distinct requests,
// busiest branch, most active reviewer, per-branch breakdown. Org-wide by
// contract: the note never re-keys under the panel's filters (same rule
// as `stats` and `branches`).
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

    // v2.67.0 — the desk's morning note. YESTERDAY on the desk's own
    // calendar, not a trailing 24h: Mbumah trades in Kenya (EAT, UTC+3),
    // so the digest window is the previous EAT calendar day — a visit at
    // 23:00 counts for the evening it happened and the note resets at
    // local midnight, which is what "yesterday" means to the person
    // reading it. The window is [yesterdayStart, todayStart) in epochs:
    // today's EAT-midnight = (UTC midnight of today's EAT wall date) - 3h.
    const EAT_OFFSET_MS = 3 * 3_600_000;
    const eatNow = new Date(now.getTime() + EAT_OFFSET_MS);
    const todayStart = new Date(
      Date.UTC(eatNow.getUTCFullYear(), eatNow.getUTCMonth(), eatNow.getUTCDate()) - EAT_OFFSET_MS,
    );
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    // The day label is rendered from the EAT wall clock of the summarized
    // day — computed server-side so a browser in any timezone reads the
    // same "Fri, 16 Oct" the ledger window actually covers.
    const eatYesterday = new Date(yesterdayStart.getTime() + EAT_OFFSET_MS);
    const yesterdayLabel = eatYesterday.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    });

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

    const [recentRows, total, weekVisits, weekClears, weekReviewerRows, branchRows, reviewerVisits, reviewerClears, reviewerLast, yesterdayRows] = await Promise.all([
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
      // v2.67.0: the morning note's raw rows — the full yesterday window
      // (a day of visit-scale rows is small), from which every digest
      // figure below is derived. Deliberately NOT narrowed by visitWhere:
      // the note is the org's shared "what happened yesterday" and must
      // never re-key under the panel's drill-down/branch filters (same
      // contract as `stats` and `branches`).
      rawDb.leaveReviewVisit.findMany({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart } },
        select: {
          visitedByName: true,
          clearedRecheck: true,
          leaveRequestId: true,
          leaveRequest: { select: { storeId: true, store: { select: { name: true } } } },
        },
      }),
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

    // v2.67.0 digest figures — derived from the window rows in one pass:
    // visits, corrections answered (clearedRecheck), distinct reviewers,
    // distinct requests, busiest branch, most active reviewer, and the
    // per-branch breakdown the strip's mini chips render. An empty window
    // derives to honest zeros/nulls — the UI says the desk was quiet.
    const branchDigest = new Map<string, { storeId: string; storeName: string; visits: number }>();
    const reviewerDigest = new Map<string, number>();
    const requestIds = new Set<string>();
    let digestVisits = 0;
    let digestClears = 0;
    for (const row of yesterdayRows) {
      digestVisits += 1;
      if (row.clearedRecheck) digestClears += 1;
      requestIds.add(row.leaveRequestId);
      reviewerDigest.set(row.visitedByName, (reviewerDigest.get(row.visitedByName) ?? 0) + 1);
      const storeId = row.leaveRequest.storeId;
      const storeName = row.leaveRequest.store?.name ?? storeId;
      const entry = branchDigest.get(storeId) ?? { storeId, storeName, visits: 0 };
      entry.visits += 1;
      branchDigest.set(storeId, entry);
    }
    const digestBranches = [...branchDigest.values()].sort(
      (a, b) => b.visits - a.visits || a.storeName.localeCompare(b.storeName),
    );
    const digestTopReviewer = [...reviewerDigest.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null;

    return Response.json({
      success: true,
      data: {
        generatedAt: now.toISOString(),
        yesterday: {
          date: yesterdayStart.toISOString(),
          label: yesterdayLabel,
          visits: digestVisits,
          clears: digestClears,
          reviewers: reviewerDigest.size,
          requests: requestIds.size,
          busiestBranch: digestBranches[0]
            ? { storeName: digestBranches[0].storeName, visits: digestBranches[0].visits }
            : null,
          topReviewer: digestTopReviewer
            ? { name: digestTopReviewer[0], visits: digestTopReviewer[1] }
            : null,
          branches: digestBranches,
        },
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
