// GET /api/health/db - Database connectivity + data presence check
// Public endpoint (allowed through middleware via /api/health/ prefix).
// Used by VERCEL_NEON_VERIFICATION.md Step 6c to verify the Neon DB
// is reachable and has seed data.

import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const startTime = Date.now();

  // 1. Connectivity check (SELECT 1)
  try {
    await db.$queryRaw`SELECT 1 as health_check`;
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        reachable: false,
        detail: error instanceof Error ? error.message : 'Unknown DB error',
        responseTime: `${Date.now() - startTime}ms`,
      },
      { status: 503 }
    );
  }

  // 2. Data presence check (count key tables)
  // Distinguish "missing table" (schema not pushed) from "empty table" (not seeded).
  let counts: Record<string, number> = {};
  let missingTables: string[] = [];
  let countsError: string | null = null;

  const tablesToCount: Array<[string, 'organization' | 'store' | 'user' | 'product' | 'productCategory' | 'customer' | 'salesTransaction' | 'rolePermission']> = [
    ['organizations', 'organization'],
    ['stores', 'store'],
    ['users', 'user'],
    ['products', 'product'],
    ['categories', 'productCategory'],
    ['customers', 'customer'],
    ['salesTransactions', 'salesTransaction'],
    ['permissions', 'rolePermission'],
  ];

  try {
    for (const [label, model] of tablesToCount) {
      try {
        counts[label] = await (db as Record<string, { count: () => Promise<number> }>)[model].count();
      } catch {
        missingTables.push(model);
        counts[label] = -1;
      }
    }
  } catch (error) {
    countsError = error instanceof Error ? error.message : 'Unknown count error';
  }

  const responseTime = Date.now() - startTime;
  const hasUsers = (counts.users ?? -1) > 0;
  const hasFoundation = (counts.organizations ?? -1) > 0 && (counts.stores ?? -1) > 0;

  const status: 'ok' | 'warning' | 'error' =
    missingTables.length > 0 ? 'error'
    : !hasFoundation ? 'warning'
    : !hasUsers ? 'warning'
    : 'ok';

  const detail =
    missingTables.length > 0
      ? `Missing tables: ${missingTables.join(', ')}`
      : !hasFoundation
        ? `Database reachable but foundation data missing (${counts.organizations ?? 0} org(s), ${counts.stores ?? 0} store(s)). Run prisma db seed.`
        : !hasUsers
          ? `Database reachable but no users found. Run prisma db seed.`
          : `Database healthy: ${counts.organizations} org(s), ${counts.users} user(s), ${counts.products} product(s).`;

  return Response.json(
    {
      status,
      reachable: true,
      counts,
      missingTables: missingTables.length > 0 ? missingTables : undefined,
      countsError: countsError ?? undefined,
      detail,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
    },
    { status: status === 'error' ? 503 : 200 }
  );
}
