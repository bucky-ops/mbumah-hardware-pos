// GET /api/debug - Debug endpoint for diagnosing deployment issues
// DISABLED in production — returns 404

export async function GET() {
  // Block this endpoint entirely in production
  if (process.env.NODE_ENV === 'production') {
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
          error: queryErr instanceof Error ? queryErr.message : String(queryErr),
        };
      }

      // Disconnect
      try { await client.$disconnect(); } catch {}
    } catch (createErr: unknown) {
      results.prismaClientCreate = {
        status: 'Failed',
        error: createErr instanceof Error ? createErr.message : String(createErr),
      };
    }
  } catch (importErr: unknown) {
    results.prismaImport = {
      status: 'Failed',
      error: importErr instanceof Error ? importErr.message : String(importErr),
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
        engineCheck[p] = `Error: ${e}`;
      }
    }
    results.prismaPaths = engineCheck;
  } catch {
    results.prismaPaths = 'Could not check paths';
  }

  return Response.json(results, { status: 200 });
}
