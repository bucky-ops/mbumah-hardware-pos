// GET /api/health - Health check endpoint for deployment diagnostics
import { db } from '@/lib/db';

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Check environment variables
  const requiredEnvVars = ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_SECRET', 'JWT_SECRET'];
  for (const varName of requiredEnvVars) {
    const value = process.env[varName];
    checks[`env_${varName}`] = {
      status: value ? 'ok' : 'missing',
      detail: value ? `${value.substring(0, 20)}...` : 'NOT SET',
    };
  }

  // Check database connection
  try {
    await db.$queryRaw`SELECT 1 as health_check`;
    checks.database = { status: 'ok', detail: 'Connection successful' };
  } catch (error) {
    checks.database = {
      status: 'error',
      detail: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const allOk = Object.values(checks).every(c => c.status === 'ok');

  return Response.json({
    status: allOk ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    checks,
  }, { status: allOk ? 200 : 503 });
}
