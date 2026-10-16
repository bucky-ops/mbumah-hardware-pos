// GET /api/hr/stores - branches of the caller's organization (v2.23.0)
//
// Session-scoped store listing for the HR workspace drill-downs: the
// /hr/reports per-branch filter and the Schedules tab store selector. Unlike
// /api/stores (cross-tenant by design, client-supplied organizationId) this
// endpoint derives the organization from the session and fails closed.

import { hrGuard } from '@/lib/hr/guard';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER'] as const;

export const GET = hrGuard('hr.report.branch', REPORT_ROLES)(async (_request, session) => {
  const stores = await db.store.findMany({
    where: { organizationId: session.organizationId },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  return Response.json({ success: true, data: stores });
});
