// GET/POST /api/loyalty/campaigns

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getLoyaltyCampaignsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const status = searchParams.get('status');
  const campaignType = searchParams.get('campaignType');
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (status) {
    where.status = status;
  }

  if (campaignType) {
    where.campaignType = campaignType;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['name', 'createdAt', 'startDate', 'status', 'totalPointsAwarded'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [campaigns, total] = await Promise.all([
    db.loyaltyCampaign.findMany({
      where,
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.loyaltyCampaign.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: campaigns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createLoyaltyCampaignHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    campaignType,
    description,
    bonusPoints,
    multiplier,
    startDate,
    endDate,
    targetTierId,
    createdBy,
  } = body;

  if (!storeId || !name) {
    return Response.json(
      { success: false, error: 'storeId and name are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['BONUS_POINTS', 'DOUBLE_POINTS', 'TIER_UPGRADE', 'SPECIAL_EVENT'];
  const cType = campaignType || 'BONUS_POINTS';
  if (!validTypes.includes(cType)) {
    return Response.json(
      { success: false, error: `Invalid campaignType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const campaign = await db.loyaltyCampaign.create({
    data: {
      storeId,
      name,
      campaignType: cType,
      description: description || null,
      bonusPoints: bonusPoints ?? 0,
      multiplier: multiplier ?? 1,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      targetTierId: targetTierId || null,
      status: 'DRAFT',
      totalPointsAwarded: 0,
      totalParticipants: 0,
      createdBy: createdBy || null,
    },
  });

  await systemLog({
    action: 'LOYALTY_CAMPAIGN_CREATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Loyalty campaign "${name}" created (${cType})`,
    storeId,
    userId: createdBy || undefined,
    metadata: { campaignId: campaign.id, campaignType: cType, bonusPoints: bonusPoints || 0, multiplier: multiplier || 1 },
  });

  return Response.json({ success: true, data: campaign }, { status: 201 });
}

export const GET = withErrorBoundary(getLoyaltyCampaignsHandler, 'LOYALTY_CAMPAIGNS_LIST');
export const POST = withErrorBoundary(createLoyaltyCampaignHandler, 'LOYALTY_CAMPAIGNS_CREATE');
