// GET /api/security/dashboard - Security overview for admin dashboard
// Requires SUPER_ADMIN or STORE_OWNER role

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getSecurityDashboardHandler(
  request: NextRequest,
  session: AuthSession
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || '';

  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Base where clause — non-SUPER_ADMIN users scoped to their store
  const baseWhere: Record<string, unknown> = {};
  if (session.role !== 'SUPER_ADMIN') {
    baseWhere.storeId = session.storeId || '';
  } else if (storeId) {
    baseWhere.storeId = storeId;
  }

  // Run all queries in parallel
  const [
    totalEvents24h,
    totalEvents7d,
    totalEvents30d,
    blockedAttempts24h,
    criticalEvents24h,
    eventsByType24h,
    eventsBySeverity24h,
    topTargetedIPs,
    topTargetedResources,
    activeSessions,
    lockedAccounts,
    recentCriticalEvents,
    hourlyTimeline,
  ] = await Promise.all([
    // Total events last 24h
    db.securityEvent.count({ where: { ...baseWhere, createdAt: { gte: last24h } } }),

    // Total events last 7d
    db.securityEvent.count({ where: { ...baseWhere, createdAt: { gte: last7d } } }),

    // Total events last 30d
    db.securityEvent.count({ where: { ...baseWhere, createdAt: { gte: last30d } } }),

    // Blocked attempts last 24h
    db.securityEvent.count({ where: { ...baseWhere, blocked: true, createdAt: { gte: last24h } } }),

    // Critical events last 24h
    db.securityEvent.count({ where: { ...baseWhere, severity: 'CRITICAL', createdAt: { gte: last24h } } }),

    // Events by type last 24h
    db.securityEvent.groupBy({
      by: ['eventType'],
      where: { ...baseWhere, createdAt: { gte: last24h } },
      _count: true,
      orderBy: { _count: { eventType: 'desc' } },
    }),

    // Events by severity last 24h
    db.securityEvent.groupBy({
      by: ['severity'],
      where: { ...baseWhere, createdAt: { gte: last24h } },
      _count: true,
      orderBy: { _count: { severity: 'desc' } },
    }),

    // Top targeted IPs last 24h
    db.securityEvent.groupBy({
      by: ['ipAddress'],
      where: { ...baseWhere, createdAt: { gte: last24h }, ipAddress: { not: null } },
      _count: true,
      orderBy: { _count: { ipAddress: 'desc' } },
      take: 10,
    }),

    // Top targeted resources last 24h
    db.securityEvent.groupBy({
      by: ['resource'],
      where: { ...baseWhere, createdAt: { gte: last24h }, resource: { not: null } },
      _count: true,
      orderBy: { _count: { resource: 'desc' } },
      take: 10,
    }),

    // Active sessions count
    db.session.count({ where: { expiresAt: { gt: now } } }),

    // Locked accounts count
    db.user.count({ where: { lockedUntil: { gt: now } } }),

    // Recent critical events
    db.securityEvent.findMany({
      where: { ...baseWhere, severity: { in: ['CRITICAL', 'ERROR'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),

    // Events for hourly timeline (last 24h)
    db.securityEvent.findMany({
      where: { ...baseWhere, createdAt: { gte: last24h } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // Build hourly buckets for timeline
  const hourBuckets: { hour: string; count: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const hourDate = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hourKey = `${hourDate.getFullYear()}-${String(hourDate.getMonth() + 1).padStart(2, '0')}-${String(hourDate.getDate()).padStart(2, '0')} ${String(hourDate.getHours()).padStart(2, '0')}:00`;
    hourBuckets.push({ hour: hourKey, count: 0 });
  }

  // Fill in actual counts
  for (const event of hourlyTimeline) {
    const d = new Date(event.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    const bucket = hourBuckets.find(b => b.hour === key);
    if (bucket) bucket.count++;
  }

  // Calculate security score (0-100)
  let securityScore = 100;
  securityScore -= Math.min(criticalEvents24h * 10, 40);
  if (totalEvents24h > 0) {
    const blockRatio = blockedAttempts24h / totalEvents24h;
    if (blockRatio > 0.5) securityScore -= 20;
    else if (blockRatio > 0.2) securityScore -= 10;
  }
  const bruteForceCount = eventsByType24h.find(e => e.eventType === 'BRUTE_FORCE')?._count || 0;
  if (bruteForceCount > 5) securityScore -= 15;
  else if (bruteForceCount > 0) securityScore -= 5;
  securityScore = Math.max(0, Math.min(100, securityScore));

  return Response.json({
    success: true,
    data: {
      overview: {
        securityScore,
        eventsLast24h: totalEvents24h,
        eventsLast7d: totalEvents7d,
        eventsLast30d: totalEvents30d,
        blockedAttempts24h,
        criticalEvents24h,
        activeSessions,
        lockedAccounts,
      },
      breakdown: {
        byType: eventsByType24h.map(e => ({ type: e.eventType, count: e._count })),
        bySeverity: eventsBySeverity24h.map(e => ({ severity: e.severity, count: e._count })),
      },
      topTargets: {
        ips: topTargetedIPs.filter(e => e.ipAddress).map(e => ({ ip: e.ipAddress!, count: e._count })),
        resources: topTargetedResources.filter(e => e.resource).map(e => ({ resource: e.resource!, count: e._count })),
      },
      recentCritical: recentCriticalEvents.map(e => ({
        id: e.id,
        eventType: e.eventType,
        severity: e.severity,
        ipAddress: e.ipAddress,
        resource: e.resource,
        action: e.action,
        details: e.details ? (() => {
          try { return JSON.parse(e.details); } catch { return e.details; }
        })() : null,
        createdAt: e.createdAt,
        blocked: e.blocked,
      })),
      timeline: hourBuckets,
    },
  });
}

export const GET = withErrorBoundary(
  requireAuth(getSecurityDashboardHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'SECURITY_DASHBOARD'
);
