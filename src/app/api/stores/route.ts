import { type NextRequest, NextResponse } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// GET /api/stores - List stores (query: organizationId, status)
// Uses runWithoutTenant because store listing is a cross-tenant operation
// (used before a specific store is selected for the current session).
async function getHandler(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get('organizationId') || 'org_mbumah';
  const status = searchParams.get('status') || undefined;

  return runWithoutTenant(async () => {
    const stores = await db.store.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        organizationId: true,
        name: true,
        location: true,
        address: true,
        phone: true,
        email: true,
        taxPin: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ data: stores });
  });
}

export const GET = withErrorBoundary(getHandler, 'STORES');
