// GET /api/audit-logs

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

async function getAuditLogsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId') || '';
  const type = searchParams.get('type') || searchParams.get('component') || '';
  const severity = searchParams.get('severity') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const userId = searchParams.get('userId') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50'), 1), 100);

  const where: Record<string, unknown> = {};

  if (storeId) where.storeId = storeId;
  if (type) where.component = type;
  if (severity) where.severity = severity;
  if (userId) where.userId = userId;

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
    ];
  }

  const [logs, total] = await Promise.all([
    db.systemLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.systemLog.count({ where }),
  ]);

    const [severityCounts, componentCounts, recentErrors] = await Promise.all([
    db.systemLog.groupBy({
      by: ['severity'],
      where: storeId ? { storeId } : {},
      _count: true,
    }),
    db.systemLog.groupBy({
      by: ['component'],
      where: storeId ? { storeId } : {},
      _count: true,
      orderBy: { _count: { component: 'desc' } },
    }),
    db.systemLog.count({
      where: {
        ...(storeId ? { storeId } : {}),
        severity: { in: ['ERROR', 'CRITICAL'] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return Response.json({
    success: true,
    data: logs,
    summary: {
      bySeverity: severityCounts.reduce((acc, s) => {
        acc[s.severity] = s._count;
        return acc;
      }, {} as Record<string, number>),
      byComponent: componentCounts.reduce((acc, c) => {
        acc[c.component] = c._count;
        return acc;
      }, {} as Record<string, number>),
      recentErrors,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export const GET = withErrorBoundary(getAuditLogsHandler, 'AUDIT_LOGS');
