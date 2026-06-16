// GET /api/debug - Debug endpoint for diagnosing deployment issues
// COMPLETELY DISABLED in production — returns 404 at both build-time and runtime

// SECURITY (L-01): Sanitize raw database/Prisma error messages before surfacing
// them in the (development-only) debug payload. Raw driver messages can include
// connection-string fragments, internal schema/table names, and SQL syntax — none
// of which should be exposed even to a developer looking at the JSON response in
// a browser. We classify the error by family and return a stable, generic string.
function sanitizeDebugError(label: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('authentication') || lower.includes('password') || lower.includes('credential')) {
    return `${label}: authentication failed`;
  }
  if (lower.includes('connect') || lower.includes('econnrefused') || lower.includes('timeout') || lower.includes('reach')) {
    return `${label}: connection failed`;
  }
  if (lower.includes('does not exist') || lower.includes('relation') || lower.includes('column')) {
    return `${label}: schema/table not found`;
  }
  if (lower.includes('permission') || lower.includes('denied')) {
    return `${label}: permission denied`;
  }
  return `${label}: failed`;
}

export async function GET() {
  // Double guard: check both NODE_ENV and a build-time flag
  if (process.env.NODE_ENV === 'production' || process.env.DISABLE_DEBUG_ENDPOINT === 'true') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Also block if not in development
  if (process.env.NODE_ENV !== 'development') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
  };

  // 1. Check environment variables (mask sensitive values)
  const envVars = ['DATABASE_URL', 'DIRECT_URL', 'NEXTAUTH_SECRET', 'JWT_SECRET', 'NEXTAUTH_URL'];
  const envCheck: Record<string, string> = {};
  for (const v of envVars) {
    const val = process.env[v];
    if (val) {
      envCheck[v] = val.length > 20 ? val.substring(0, 20) + '...' : val;
    } else {
      envCheck[v] = 'NOT SET';
    }
  }
  results.envVars = envCheck;

  // 2. Check if Prisma Client can be imported
  try {
    const { PrismaClient } = await import('@prisma/client');
    results.prismaImport = 'Success';

    // 3. Try to create a PrismaClient instance
    let client: InstanceType<typeof PrismaClient> | null = null;
    try {
      client = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
      results.prismaClientCreate = 'Success';

      // 4. Try a simple query
      try {
        const result = await client.$queryRaw`SELECT 1 as test`;
        results.databaseQuery = { status: 'Success', result };
      } catch (queryErr: unknown) {
        results.databaseQuery = {
          status: 'Failed',
          error: sanitizeDebugError('database query', queryErr),
        };
      }

      // Disconnect
      try { await client.$disconnect(); } catch {}
    } catch (createErr: unknown) {
      results.prismaClientCreate = {
        status: 'Failed',
        error: sanitizeDebugError('prisma client create', createErr),
      };
    }
  } catch (importErr: unknown) {
    results.prismaImport = {
      status: 'Failed',
      error: sanitizeDebugError('prisma import', importErr),
    };
  }

  // 5. Check if the Prisma engine file exists
  try {
    const { existsSync, readdirSync } = await import('fs');
    const path = await import('path');

    const possiblePaths = [
      './node_modules/.prisma/client',
      './node_modules/@prisma/client',
    ];

    const engineCheck: Record<string, unknown> = {};
    for (const p of possiblePaths) {
      try {
        const resolved = path.resolve(p);
        engineCheck[p] = {
          exists: existsSync(resolved),
          files: existsSync(resolved) ? readdirSync(resolved).slice(0, 10) : [],
        };
      } catch (e) {
        engineCheck[p] = sanitizeDebugError('path check', e);
      }
    }
    results.prismaPaths = engineCheck;
  } catch {
    results.prismaPaths = 'Could not check paths';
  }

  return Response.json(results, { status: 200 });
}
