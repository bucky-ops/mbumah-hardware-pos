// GET /api/health - Comprehensive health check endpoint
// Public endpoint (allowed through middleware) but env values are stripped
// to avoid leaking secrets.

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface HealthCheck {
  status: 'ok' | 'error' | 'warning';
  detail?: string;
  responseTime?: number;
}

export async function GET() {
  const startTime = Date.now();
  const checks: Record<string, HealthCheck> = {};

  // Check environment variables — only report set/missing, NOT actual values
  const requiredEnvVars = ['DATABASE_URL', 'NEXTAUTH_SECRET', 'JWT_SECRET'];
  const optionalEnvVars = ['DIRECT_URL'];
  
  for (const varName of requiredEnvVars) {
    const value = process.env[varName];
    checks[`env_${varName}`] = {
      status: value ? 'ok' : 'error',
    };
  }
  
  for (const varName of optionalEnvVars) {
    const value = process.env[varName];
    checks[`env_${varName}`] = {
      status: value ? 'ok' : 'warning',
      detail: value ? undefined : 'Optional - needed for PostgreSQL prod',
    };
  }

  // Check database connection with timing
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1 as health_check`;
    const dbResponseTime = Date.now() - dbStart;
    checks.database = { 
      status: dbResponseTime > 1000 ? 'warning' : 'ok',
      detail: `Connection successful (${dbResponseTime}ms)`,
      responseTime: dbResponseTime,
    };
  } catch (error) {
    checks.database = {
      status: 'error',
      detail: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Check database size (record counts for key tables)
  try {
    const [users, products, transactions, sessions] = await Promise.all([
      db.user.count(),
      db.product.count(),
      db.salesTransaction.count(),
      db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    ]);
    checks.database_stats = {
      status: 'ok',
      detail: `${users} users, ${products} products, ${transactions} transactions, ${sessions} active sessions`,
    };
  } catch {
    checks.database_stats = { status: 'warning', detail: 'Could not retrieve stats' };
  }

  // Check for security concerns
  try {
    const criticalEvents = await db.securityEvent.count({
      where: {
        severity: 'CRITICAL',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    }).catch(() => 0);
    
    checks.security = {
      status: criticalEvents > 10 ? 'error' : criticalEvents > 0 ? 'warning' : 'ok',
      detail: criticalEvents > 0 ? `${criticalEvents} critical security events in the last hour` : 'No critical security events',
    };
  } catch {
    checks.security = { status: 'ok', detail: 'Security events table not yet initialized' };
  }

  // Check for locked accounts
  try {
    const lockedAccounts = await db.user.count({
      where: { lockedUntil: { gt: new Date() } },
    }).catch(() => 0);
    
    checks.account_security = {
      status: lockedAccounts > 5 ? 'warning' : 'ok',
      detail: lockedAccounts > 0 ? `${lockedAccounts} accounts currently locked` : 'No locked accounts',
    };
  } catch {
    checks.account_security = { status: 'ok', detail: 'Account security check skipped' };
  }

  // Check financial ledger integrity (lightweight — last 24h only)
  try {
    const { quickIntegrityCheck } = await import('@/lib/financial-audit');
    const integrity = await quickIntegrityCheck();
    checks.financial_integrity = {
      status: integrity.healthy ? 'ok' : 'error',
      detail: integrity.healthy
        ? `Ledger balanced (last 24h)`
        : `${integrity.unbalancedEntryCount} unbalanced entries in last 24h`,
    };
  } catch {
    checks.financial_integrity = {
      status: 'warning',
      detail: 'Financial integrity check skipped (module unavailable)',
    };
  }

  // Check Sentry configuration
  checks.sentry = {
    status: process.env.SENTRY_DSN ? 'ok' : 'warning',
    detail: process.env.SENTRY_DSN
      ? 'Configured'
      : 'Not configured — errors will not be sent to Sentry',
  };

  const totalResponseTime = Date.now() - startTime;
  const allOk = Object.values(checks).every(c => c.status === 'ok' || c.status === 'warning');
  const hasErrors = Object.values(checks).some(c => c.status === 'error');

  return Response.json({
    status: hasErrors ? 'unhealthy' : allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    responseTime: `${totalResponseTime}ms`,
    version: process.env.npm_package_version || '1.0.0',
    checks,
  }, { status: hasErrors ? 503 : 200 });
}
