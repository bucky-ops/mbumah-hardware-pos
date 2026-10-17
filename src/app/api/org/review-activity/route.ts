// GET /api/org/review-activity (v2.64.0 organization console)
//
// The visit ledger steps into the light — the org console gets a "Desk
// activity" audit panel over the v2.63.0 LeaveReviewVisit ledger. Every
// desk visit is already on the record per request (the dialog's timeline);
// this read turns the SAME ledger org-wide: who looked at what, where,
// when, and whether the visit cleared a re-check marker — the audit view
// the corrections loop never had at the organization level.
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
// org's desks.
//
// READS go through rawDb (the un-intercepted client) inside
// runWithoutTenant so the v2.57.0 leak class (a tenant interceptor
// silently AND-narrowing an org read to the browsing store) can never
// shrink an org audit to one branch's visits.

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

async function orgReviewActivityHandler(): Promise<Response> {
  return runWithoutTenant(async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [recentRows, total, weekVisits, weekClears, weekReviewerRows] = await Promise.all([
      rawDb.leaveReviewVisit.findMany({
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
    ]);

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
      },
    });
  });
}

export const GET = withErrorBoundary(
  requireAuth(orgReviewActivityHandler, { roles: ORG_ROLES }),
  LogComponent.API,
);
