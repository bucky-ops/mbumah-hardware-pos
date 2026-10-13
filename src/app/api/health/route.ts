// GET /api/health - Comprehensive health check endpoint
// Public endpoint (allowed through middleware) but env values are stripped
// to avoid leaking secrets.

import { db } from '@/lib/db';
// APP_VERSION prefers the mbumah.releaseVersion metadata (2.18.0.0) over the
// package.json semver "version" (2.18.0) so /api/health reports the true
// correction-release version.
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

interface HealthCheck {
  status: 'ok' | 'error' | 'warning';
  detail?: string;
  responseTime?: number;
}

export async function GET() {
  const startTime = Date.now();
  const checks: Record<string, HealthCheck> = {};

  // Check environment variables - only report set/missing, NOT actual values
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

  // Check database size (record counts for key tables) + seeded state.
  // The previous version swallowed the actual error behind "Could not
  // retrieve stats", which made the "backend unavailable on an empty DB"
  // laptop failure undiagnosable from the health endpoint alone. The error
  // message is now surfaced (truncated) and a dedicated `seed` check tells
  // an EMPTY-but-reachable database apart from a BROKEN connection.
  let userCount: number | null = null;
  try {
    const [users, products, transactions, sessions] = await Promise.all([
      db.user.count(),
      db.product.count(),
      db.salesTransaction.count(),
      db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    ]);
    userCount = users;
    checks.database_stats = {
      status: 'ok',
      detail: `${users} users, ${products} products, ${transactions} transactions, ${sessions} active sessions`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 160) : 'Unknown error';
    checks.database_stats = {
      status: 'warning',
      detail: `Could not retrieve stats: ${detail}`,
    };
  }

  // Schema-drift sentinel (v2.15.2) - a database created by an OLDER release
  // can be perfectly reachable with row counts intact while missing columns
  // the deployed code queries (offline incident: v2.14.0 added five nullable
  // `idempotencyKey @unique` columns; the bare `db push` on the laptop had
  // been refused, so /api/notifications, /api/debt, /api/reminders/debt/
  // overdue and /api/stock-movements kept failing with P2022 even though
  // every count above succeeded and the start/update health gates passed).
  // Probe a recently added column so drift degrades `database_stats` from
  // 'ok' to 'warning' with a self-service fix hint - the start-pos and
  // update-pos health gates key on exactly that status. The updater's
  // schema converge step (scripts/ensure-schema.mjs) repairs the database
  // BEFORE this gate runs, so a healthy update never sees this warning.
  if (checks.database_stats.status === 'ok') {
    try {
      // Use the generated client, NOT raw SQL: SQLite silently treats a
      // double-quoted unknown identifier as a string literal ("SELECT
      // \"idempotencyKey\" ..." returns rows instead of erroring when the
      // column is missing), so a raw probe would never detect the drift.
      // The ORM emits correctly quoted per-dialect SQL and raises P2022.
      await db.equipmentRental.findFirst({ select: { idempotencyKey: true }, take: 1 });
    } catch {
      // Static detail on purpose: dev bundlers mangle Prisma error text with
      // code-frame noise, and the probe is deterministic (it asks for exactly
      // one known-new column), so the reason never needs parsing.
      checks.database_stats = {
        status: 'warning',
        detail: 'Schema drift detected: the database is missing columns this release expects (Prisma P2022 on equipment_rentals.idempotencyKey). Run the updater (Update-Mbumah-POS.bat) or "npm run db:push" in the app folder to converge the schema.',
      };
    }
  }

  // Seeded-state check - a reachable but EMPTY database (fresh install where
  // the seed never ran, or the server pointed at the wrong file) used to look
  // "healthy" here because `SELECT 1` succeeds on any SQLite/Postgres. The
  // frontend then shows the backend as unavailable for every module. A
  // warning (not error) keeps the HTTP 200 contract for uptime monitors.
  if (userCount === null) {
    checks.seed = {
      status: 'warning',
      detail: 'Seed state unknown - user count query failed',
    };
  } else if (userCount === 0) {
    checks.seed = {
      status: 'warning',
      detail: 'Database is EMPTY (0 users) - run the seed (SEED_DATABASE=true / installer) or verify DATABASE_URL points at the intended database',
    };
  } else {
    checks.seed = {
      status: 'ok',
      detail: `${userCount} users present`,
    };
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

  // Check financial ledger integrity (lightweight - last 24h only)
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
      : 'Not configured - errors will not be sent to Sentry',
  };

  const totalResponseTime = Date.now() - startTime;
  const allOk = Object.values(checks).every(c => c.status === 'ok' || c.status === 'warning');
  const hasErrors = Object.values(checks).some(c => c.status === 'error');

  // AUDIT FIX (Finding 7.2 - health response contract): expose uptime and
  // process memory so load balancers / monitoring can distinguish "app
  // starting up" (tiny uptime) from "app degraded" (bloated heap) instead of
  // guessing from HTTP status alone. Additive fields only - existing
  // consumers (CI health check, uptime monitors) read status/checks.
  const memory = process.memoryUsage();

  // HOSTING SPEC FIELDS (hosting-readiness-audit gap P1): observability for
  // multi-topology deployments. Monitors (uptime pings, tunnel checks, the
  // LAN health gates) can now tell WHICH deployment posture answered without
  // guessing from the environment. All three are informational strings -
  // they never influence the status computation above.
  //   appMode: the documented .env.example vocabulary
  //            (local-offline | development | production), falling back to
  //            the deployment target when APP_MODE is unset.
  //   workspaceMode: the configured workspace routing posture (auto |
  //            subdomain | path | off, default auto per .env.example).
  //   databaseProvider: derived from DATABASE_URL scheme so a Vercel/Neon
  //            deployment reports postgresql while a laptop install reports
  //            sqlite, regardless of which Prisma client flavor was bundled.
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const databaseProvider = databaseUrl.startsWith('file:')
    ? 'sqlite'
    : databaseUrl.startsWith('postgres')
      ? 'postgresql'
      : 'unknown';

  return Response.json({
    status: hasErrors ? 'unhealthy' : allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    responseTime: `${totalResponseTime}ms`,
    // npm_package_version is an npm-lifecycle env var and is NOT present in
    // the Vercel runtime - import the version from src/lib/version.ts (which
    // reads package.json and prefers the mbumah.releaseVersion metadata) so
    // /api/health always reports the true release version.
    version: APP_VERSION,
    appMode: process.env.APP_MODE || (process.env.VERCEL ? 'production' : 'local'),
    workspaceMode: process.env.NEXT_PUBLIC_STORE_WORKSPACE_MODE || 'auto',
    databaseProvider,
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
      rssMB: Math.round(memory.rss / 1024 / 1024),
    },
    checks,
  }, { status: hasErrors ? 503 : 200 });
}
