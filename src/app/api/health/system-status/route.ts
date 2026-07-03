// GET /api/health/system-status
//
// Phase 8 — Aggregated System Status endpoint.
//
// Returns a single JSON object combining health check, circuit breaker
// states, DLQ metrics, compliance scores, and retention stats.
// Designed for the frontend "System Health" tab so it can fetch one
// endpoint instead of five.
//
// Requires authentication. SUPER_ADMIN and STORE_OWNER see full detail;
// other roles see a summarised view.

import { requireAuth } from '@/lib/auth';
import { successResponse, errorFromThrown } from '@/lib/api-response';
import { db } from '@/lib/db';
import { circuitBreakerRegistry } from '@/lib/circuit-breaker';
import { dlq } from '@/lib/dead-letter-queue';

export const dynamic = 'force-dynamic';

export const GET = requireAuth(async (_request, session) => {
  try {
    const isPrivileged = ['SUPER_ADMIN', 'STORE_OWNER'].includes(session.role);

    // ── 1. Database health ────────────────────────────────────────────
    const dbStart = Date.now();
    let dbStatus: 'ok' | 'error' | 'warning' = 'ok';
    let dbResponseTime = 0;
    let dbDetail = '';
    let dbStats: Record<string, number> = {};

    try {
      await db.$queryRaw`SELECT 1 as health_check`;
      dbResponseTime = Date.now() - dbStart;
      dbStatus = dbResponseTime > 1000 ? 'warning' : 'ok';
      dbDetail = `Connected (${dbResponseTime}ms)`;

      const [users, products, transactions, sessions] = await Promise.all([
        db.user.count(),
        db.product.count(),
        db.salesTransaction.count(),
        db.session.count({ where: { expiresAt: { gt: new Date() } } }),
      ]);
      dbStats = { users, products, transactions, activeSessions: sessions };
    } catch (err) {
      dbStatus = 'error';
      dbDetail = err instanceof Error ? err.message : 'Connection failed';
    }

    // ── 2. Circuit breaker status ─────────────────────────────────────
    const allBreakers = circuitBreakerRegistry.getAllMetrics();
    const openBreakers = allBreakers.filter((b) => b.state === 'OPEN');
    const halfOpenBreakers = allBreakers.filter((b) => b.state === 'HALF_OPEN');
    const closedBreakers = allBreakers.filter((b) => b.state === 'CLOSED');

    const circuitStatus =
      openBreakers.length > 0 ? 'error' :
      halfOpenBreakers.length > 0 ? 'warning' : 'ok';

    // ── 3. DLQ status ─────────────────────────────────────────────────
    let dlqMetrics;
    let dlqStatus: 'ok' | 'warning' | 'error' = 'ok';

    try {
      dlqMetrics = await dlq.getMetrics({});
      if (dlqMetrics.dead > 0) dlqStatus = 'warning';
      if (dlqMetrics.dead > 10 || dlqMetrics.pending > 50) dlqStatus = 'error';
    } catch {
      dlqMetrics = { pending: 0, retrying: 0, completed: 0, dead: 0, cancelled: 0, totalEnqueued: 0 };
      dlqStatus = 'warning';
    }

    // ── 4. Security events (last hour) ────────────────────────────────
    let securityStatus: 'ok' | 'warning' | 'error' = 'ok';
    let criticalEvents = 0;
    let lockedAccounts = 0;

    try {
      criticalEvents = await db.securityEvent.count({
        where: {
          severity: 'CRITICAL',
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      }).catch(() => 0);

      lockedAccounts = await db.user.count({
        where: { lockedUntil: { gt: new Date() } },
      }).catch(() => 0);

      if (criticalEvents > 10) securityStatus = 'error';
      else if (criticalEvents > 0 || lockedAccounts > 3) securityStatus = 'warning';
    } catch {
      // Tables may not be initialised
    }

    // ── 5. Financial integrity (quick check) ──────────────────────────
    let financialStatus: 'ok' | 'warning' | 'error' = 'ok';
    let financialDetail = 'Ledger balanced';

    try {
      const { quickIntegrityCheck } = await import('@/lib/financial-audit');
      const integrity = await quickIntegrityCheck();
      if (!integrity.healthy) {
        financialStatus = 'error';
        financialDetail = `${integrity.unbalancedEntryCount} unbalanced entries`;
      }
    } catch {
      financialStatus = 'warning';
      financialDetail = 'Check unavailable';
    }

    // ── 6. Compliance (quick score) ───────────────────────────────────
    let complianceScore = 100;
    let iso27001Score = 100;
    let iso9001Score = 100;
    let resilienceStatus: Record<string, string> = {};

    try {
      const { getComplianceDashboard } = await import('@/lib/compliance');
      const dashboard = await getComplianceDashboard();
      complianceScore = dashboard.overallScore;
      iso27001Score = dashboard.iso27001Score;
      iso9001Score = dashboard.iso9001Score;
      resilienceStatus = dashboard.resilienceStatus as Record<string, string>;
    } catch {
      // Compliance module may not be fully initialised
    }

    // ── 7. Retention summary ──────────────────────────────────────────
    let retentionSummary: Array<{ name: string; retentionDays: number; isoRef: string; purgeableCount: number }> = [];

    try {
      const { dataRetention } = await import('@/lib/data-retention');
      const metrics = await dataRetention.getMetrics();
      retentionSummary = metrics.policies.map((p) => ({
        name: p.name,
        retentionDays: p.retentionDays,
        isoRef: p.isoRef,
        purgeableCount: p.purgeableCount,
      }));
    } catch {
      // Retention module may not be available
    }

    // ── 8. Access control metrics ─────────────────────────────────────
    let accessMetrics: Record<string, unknown> = {};

    if (isPrivileged) {
      try {
        const { getAccessControlMetrics } = await import('@/lib/access-control');
        accessMetrics = await getAccessControlMetrics();
      } catch {
        // Module unavailable
      }
    }

    // ── 9. Audit trail stats ──────────────────────────────────────────
    let auditStats: Record<string, unknown> = {};

    if (isPrivileged) {
      try {
        const { auditTrail } = await import('@/lib/audit-trail');
        auditStats = await auditTrail.getStats();
      } catch {
        // Module unavailable
      }
    }

    // ── Compute overall status ────────────────────────────────────────
    const overallStatus =
      [dbStatus, circuitStatus, dlqStatus, securityStatus, financialStatus].includes('error')
        ? 'unhealthy'
        : [dbStatus, circuitStatus, dlqStatus, securityStatus, financialStatus].includes('warning')
          ? 'degraded'
          : 'healthy';

    // ── Build response ────────────────────────────────────────────────
    const response: Record<string, unknown> = {
      overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nodeEnv: process.env.NODE_ENV,

      database: {
        status: dbStatus,
        detail: dbDetail,
        responseTime: dbResponseTime,
        stats: isPrivileged ? dbStats : undefined,
      },

      circuitBreakers: {
        status: circuitStatus,
        total: allBreakers.length,
        open: openBreakers.length,
        halfOpen: halfOpenBreakers.length,
        closed: closedBreakers.length,
        breakers: isPrivileged ? allBreakers : allBreakers.map((b) => ({
          name: b.name,
          state: b.state,
          failureRate: b.failureRate,
        })),
      },

      deadLetterQueue: {
        status: dlqStatus,
        ...dlqMetrics,
      },

      security: {
        status: securityStatus,
        criticalEventsLastHour: criticalEvents,
        lockedAccounts,
      },

      financial: {
        status: financialStatus,
        detail: financialDetail,
      },

      compliance: {
        overallScore: complianceScore,
        iso27001Score,
        iso9001Score,
        resilienceStatus,
      },
    };

    if (isPrivileged) {
      response.retention = retentionSummary;
      response.accessControl = accessMetrics;
      response.auditTrail = auditStats;
    }

    return successResponse(response);
  } catch (err) {
    return errorFromThrown(err, { context: 'SYSTEM_STATUS' });
  }
});
