// GET/POST /api/loyalty/tiers
//
// GET behaviour (Phase 3 update):
//   - If `?storeId=X` is provided → returns DB-configured LoyaltyTier rows
//     for that store (legacy behaviour, used by the loyalty-tab.tsx admin UI).
//   - If NO storeId is provided → returns the STANDARD tier configuration
//     (BRONZE / SILVER / GOLD / PLATINUM with pointsRequired, discountRate,
//     and benefits[]) so any client can render tier badges without a store
//     context.
//
// Both GET and POST now require authentication (any authenticated user for
// GET; SUPER_ADMIN or STORE_OWNER for POST).
//
// RBAC:
//   GET  — any authenticated user (read-only tier config)
//   POST — SUPER_ADMIN, STORE_OWNER

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { getTierConfigList } from '@/lib/loyalty-utils';

export const dynamic = 'force-dynamic';

// ─── GET ─────────────────────────────────────────────────────────────────────

async function getLoyaltyTiersHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId');

  // ── Standard tier config (no storeId required) ──
  // Returns the canonical BRONZE/SILVER/GOLD/PLATINUM tiers used by the
  // Phase-3 loyalty system. This is the response shape the loyalty card
  // widget consumes.
  if (!storeId) {
    const tiers = getTierConfigList();
    return Response.json({
      success: true,
      data: tiers,
      source: 'standard',
    });
  }

  // ── DB-configured tiers (storeId provided) ──
  // Legacy path: return store-specific LoyaltyTier rows.
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
    where.name = { contains: search };
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
    source: 'database',
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// ─── POST ────────────────────────────────────────────────────────────────────

async function createLoyaltyTierHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
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
    userId: session.userId,
    metadata: { tierId: tier.id, name, minPoints, discountPercent: discountPercent || 0 },
  });

  return Response.json({ success: true, data: tier }, { status: 201 });
}

// ─── Exports ─────────────────────────────────────────────────────────────────
//
// The legacy GET handler signature was `(...args: unknown[])` so we keep
// compatibility by accepting the variadic args and forwarding to the typed
// authed handler. `requireAuth` injects the session as the 2nd positional
// argument.

export const GET = withErrorBoundary(
  requireAuth(getLoyaltyTiersHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'],
  }),
  'LOYALTY_TIERS_LIST',
);

export const POST = withErrorBoundary(
  requireAuth(createLoyaltyTierHandler, {
    roles: ['SUPER_ADMIN', 'STORE_OWNER'],
  }),
  'LOYALTY_TIERS_CREATE',
);
