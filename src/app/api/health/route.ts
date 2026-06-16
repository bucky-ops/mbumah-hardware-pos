// GET /api/health - Health check endpoint
// Public endpoint: returns minimal status only.
// Detailed diagnostics require authentication (moved to /api/health/detailed).

import { db } from '@/lib/db';

export async function GET() {
  const startTime = Date.now();

  // Minimal health check: just verify database connectivity
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    await db.$queryRaw`SELECT 1 as health_check`;
  } catch {
    dbStatus = 'error';
  }

  const responseTime = Date.now() - startTime;

  return Response.json({
    status: dbStatus === 'ok' ? 'ok' : 'error',
    timestamp: new Date().toISOString(),
    responseTime: `${responseTime}ms`,
  }, { status: dbStatus === 'ok' ? 200 : 503 });
}
