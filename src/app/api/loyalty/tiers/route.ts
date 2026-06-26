// GET/POST /api/loyalty/tiers

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getLoyaltyTiersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const isActive = searchParams.get('isActive');
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'sortOrder';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  const where: Record<string, unknown> = { storeId };

  if (isActive !== null && isActive !== undefined && isActive !== '') {
    where.isActive = isActive === 'true';
  }

  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const validSortFields = ['name', 'sortOrder', 'minPoints', 'discountPercent', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'sortOrder';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [tiers, total] = await Promise.all([
    db.loyaltyTier.findMany({
      where,
      include: {
        _count: { select: { customerTiers: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.loyaltyTier.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: tiers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createLoyaltyTierHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    minPoints,
    maxPoints,
    discountPercent,
    pointsMultiplier,
    benefits,
    color,
    icon,
    sortOrder,
  } = body;

  if (!storeId || !name || minPoints === undefined) {
    return Response.json(
      { success: false, error: 'storeId, name, and minPoints are required.' },
      { status: 400 }
    );
  }

  if (minPoints < 0) {
    return Response.json(
      { success: false, error: 'minPoints must be 0 or greater.' },
      { status: 400 }
    );
  }

  if (discountPercent !== undefined && (discountPercent < 0 || discountPercent > 100)) {
    return Response.json(
      { success: false, error: 'discountPercent must be between 0 and 100.' },
      { status: 400 }
    );
  }

  if (pointsMultiplier !== undefined && pointsMultiplier <= 0) {
    return Response.json(
      { success: false, error: 'pointsMultiplier must be greater than 0.' },
      { status: 400 }
    );
  }

  const tier = await db.loyaltyTier.create({
    data: {
      storeId,
      name,
      minPoints: parseInt(String(minPoints)),
      maxPoints: maxPoints !== undefined && maxPoints !== null ? parseInt(String(maxPoints)) : null,
      discountPercent: discountPercent ?? 0,
      pointsMultiplier: pointsMultiplier ?? 1,
      benefits: benefits || null,
      color: color || '#6B7280',
      icon: icon || null,
      isActive: true,
      sortOrder: sortOrder ?? 0,
    },
  });

  await systemLog({
    action: 'LOYALTY_TIER_CREATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Loyalty tier "${name}" created (min ${minPoints} points)`,
    storeId,
    metadata: { tierId: tier.id, name, minPoints, discountPercent: discountPercent || 0 },
  });

  return Response.json({ success: true, data: tier }, { status: 201 });
}

export const GET = withErrorBoundary(getLoyaltyTiersHandler, 'LOYALTY_TIERS_LIST');
export const POST = withErrorBoundary(createLoyaltyTierHandler, 'LOYALTY_TIERS_CREATE');
