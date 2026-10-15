// GET /api/hr/rate-tables - list versioned statutory rate tables
//
// Read surface for the compliance UI. Rate tables are insert-only data
// (docs/EMS_MIGRATION_PLAN.md); management (insert new effective versions) is
// hr.rate-table.manage and arrives with the payroll release. This endpoint is
// org-scoped: SUPER_ADMIN and STORE_OWNER may read any org table via
// ?organizationId; HR_MANAGER reads their own organization.

import { db } from '@/lib/db';
import { hrGuard } from '@/lib/hr/guard';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;

export const GET = hrGuard('hr.employee.read.own_branch', READ_ROLES)(
  async (request, session) => {
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get('organizationId');
    const organizationId =
      session.role === 'SUPER_ADMIN' || session.role === 'STORE_OWNER'
        ? requestedOrg || session.organizationId
        : session.organizationId;

    if (!organizationId) {
      return Response.json({ success: false, error: 'No organization context.' }, { status: 400 });
    }

    const typeFilter = url.searchParams.get('type');
    const asOf = url.searchParams.get('asOf');

    const tables = await db.rateTable.findMany({
      where: {
        organizationId,
        ...(typeFilter ? { type: typeFilter } : {}),
      },
      orderBy: [{ type: 'asc' }, { effectiveFrom: 'desc' }],
      include: {
        rows: {
          orderBy: { order: 'asc' },
          select: {
            order: true,
            lowerBoundCents: true,
            upperBoundCents: true,
            rateBps: true,
            flatAmountCents: true,
            reliefCents: true,
            employerMatchBps: true,
          },
        },
      },
    });

    // asOf filter: keep only tables effective at the given date (default now).
    const at = asOf ? new Date(asOf) : new Date();
    const effective = tables.filter((t) => {
      const fromOk = t.effectiveFrom.getTime() <= at.getTime();
      const toOk = !t.effectiveTo || t.effectiveTo.getTime() >= at.getTime();
      return fromOk && toOk;
    });

    return Response.json({ success: true, data: effective, count: effective.length });
  },
);
