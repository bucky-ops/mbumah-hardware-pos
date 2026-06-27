// GET /api/financial/audit-trail — query the immutable audit trail.
//
// Query params (all optional): storeId, entityType, entityId, action, userId,
// dateFrom, dateTo, page, limit. Default: newest 50 entries (capped at 200).

import { type NextRequest } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { LogComponent } from '@/lib/types';
import { withFinancialAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { listAuditTrail } from '@/lib/accounting-helpers';

export const dynamic = 'force-dynamic';

async function listAuditTrailHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || undefined;
  const entityType = searchParams.get('entityType') || undefined;
  const entityId = searchParams.get('entityId') || undefined;
  const action = searchParams.get('action') || undefined;
  const userId = searchParams.get('userId') || undefined;
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const parsedDateFrom = dateFrom ? new Date(dateFrom) : undefined;
  const parsedDateTo = dateTo ? new Date(dateTo) : undefined;
  if (dateFrom && (!parsedDateFrom || isNaN(parsedDateFrom.getTime()))) {
    return Response.json(
      { success: false, error: 'Invalid dateFrom. Use ISO 8601.' },
      { status: 400 },
    );
  }
  if (dateTo && (!parsedDateTo || isNaN(parsedDateTo.getTime()))) {
    return Response.json(
      { success: false, error: 'Invalid dateTo. Use ISO 8601.' },
      { status: 400 },
    );
  }

  const safeLimit = Math.max(1, Math.min(limit || 50, 200));
  const offset = Math.max(0, (page - 1) * safeLimit);

  const { entries, total } = await listAuditTrail({
    storeId,
    entityType,
    entityId,
    action,
    userId,
    dateFrom: parsedDateFrom,
    dateTo: parsedDateTo,
    limit: safeLimit,
    offset,
  });

  return Response.json({
    success: true,
    data: entries,
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  });
}

export const GET = withFinancialAuth(
  withErrorBoundary(listAuditTrailHandler, LogComponent.FINANCIAL),
  FINANCIAL_ROLES.AUDIT,
);
