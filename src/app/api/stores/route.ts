import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/stores - List stores (query: organizationId, status)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organizationId') || 'org_mbumah';
    const status = searchParams.get('status') || undefined;

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
  } catch (error) {
    console.error('Error fetching stores:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stores' },
      { status: 500 }
    );
  }
}
