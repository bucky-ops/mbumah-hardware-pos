// GET /api/system-logs
// Requires SUPER_ADMIN or ACCOUNTANT role

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getSystemLogsHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || '';
  const component = searchParams.get('component') || '';
  const severity = searchParams.get('severity') || '';
  const action = searchParams.get('action') || '';
  const userId = searchParams.get('userId') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = {};

  // Non-SUPER_ADMIN users can only see logs from their own store
  if (session.role !== 'SUPER_ADMIN') {
    where.storeId = session.storeId || '';
  } else {
    if (storeId) {
      where.storeId = storeId;
    }
  }

  if (component) {
    where.component = component;
  }

  if (severity) {
    where.severity = severity;
  }

  if (action) {
    where.action = { contains: action };
  }

  if (userId) {
    where.userId = userId;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  if (search) {
    where.OR = [
      { message: { contains: search } },
      { action: { contains: search } },
      { metadata: { contains: search } },
    ];
  }

  const validSortFields = ['createdAt', 'severity', 'component', 'action'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [logs, total] = await Promise.all([
    db.systemLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        store: { select: { id: true, name: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.systemLog.count({ where }),
  ]);

  const parsedLogs = logs.map((log) => ({
    ...log,
    metadata: log.metadata ? (() => {
      try { return JSON.parse(log.metadata); } catch { return log.metadata; }
    })() : null,
  }));

  // Use the same store-scoped where clause for aggregations
  const summaryWhere = session.role !== 'SUPER_ADMIN'
    ? { storeId: session.storeId || '' }
    : storeId ? { storeId } : {};

  const severityCounts = await db.systemLog.groupBy({
    by: ['severity'],
    where: summaryWhere,
    _count: true,
  });

  const componentCounts = await db.systemLog.groupBy({
    by: ['component'],
    where: summaryWhere,
    _count: true,
    orderBy: { _count: { component: 'desc' } },
  });

  return Response.json({
    success: true,
    data: parsedLogs,
    summary: {
      bySeverity: severityCounts.reduce((acc, s) => {
        acc[s.severity] = s._count;
        return acc;
      }, {} as Record<string, number>),
      byComponent: componentCounts.reduce((acc, c) => {
        acc[c.component] = c._count;
        return acc;
      }, {} as Record<string, number>),
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getSystemLogsHandler, { roles: ['SUPER_ADMIN', 'ACCOUNTANT'] }),
  'SYSTEM_LOGS'
);
