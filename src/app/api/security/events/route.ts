// GET /api/security/events - List security events for admin dashboard
// Requires SUPER_ADMIN or STORE_OWNER role

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, AuthSession } from '@/lib/auth';

async function getSecurityEventsHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20'), 1), 100);
  const eventType = searchParams.get('eventType') || '';
  const severity = searchParams.get('severity') || '';
  const ipAddress = searchParams.get('ipAddress') || '';
  const blocked = searchParams.get('blocked') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const storeIdParam = searchParams.get('storeId') || '';

  const where: Record<string, unknown> = {};

  // Non-super-admin can only see their store's events
  if (session.role !== 'SUPER_ADMIN') {
    where.storeId = session.storeId || '';
  } else if (storeIdParam) {
    where.storeId = storeIdParam;
  }

  if (eventType) where.eventType = eventType;
  if (severity) where.severity = severity;
  if (ipAddress) where.ipAddress = { contains: ipAddress };
  if (blocked === 'true') where.blocked = true;
  if (blocked === 'false') where.blocked = false;

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

  const [events, total] = await Promise.all([
    db.securityEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.securityEvent.count({ where }),
  ]);

  // Get summary stats
  const [eventsByType, eventsBySeverity, recentBlocked] = await Promise.all([
    db.securityEvent.groupBy({
      by: ['eventType'],
      where,
      _count: true,
      orderBy: { _count: { eventType: 'desc' } },
    }),
    db.securityEvent.groupBy({
      by: ['severity'],
      where,
      _count: true,
      orderBy: { _count: { severity: 'desc' } },
    }),
    db.securityEvent.count({
      where: { ...where, blocked: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  // Parse JSON details field
  const parsedEvents = events.map(e => ({
    ...e,
    details: e.details ? (() => {
      try { return JSON.parse(e.details); } catch { return e.details; }
    })() : null,
  }));

  return Response.json({
    success: true,
    data: parsedEvents,
    summary: {
      eventsByType: eventsByType.map(e => ({ type: e.eventType, count: e._count })),
      eventsBySeverity: eventsBySeverity.map(e => ({ severity: e.severity, count: e._count })),
      blockedLast24h: recentBlocked,
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
  requireAuth(getSecurityEventsHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'SECURITY_EVENTS'
);
