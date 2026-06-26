// GET/POST /api/voucher-campaigns

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getVoucherCampaignsHandler(...args: unknown[]): Promise<Response> {
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

  const validSortFields = ['name', 'createdAt', 'startDate', 'status', 'totalRedemptions', 'totalRevenue'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [campaigns, total] = await Promise.all([
    db.voucherCampaign.findMany({
      where,
      include: {
        vouchers: {
          select: { id: true, code: true, status: true, currentUses: true, maxUses: true },
        },
        _count: { select: { vouchers: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.voucherCampaign.count({ where }),
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

async function createVoucherCampaignHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    campaignType,
    description,
    startDate,
    endDate,
    budget,
    targetAudience,
    createdBy,
  } = body;

  if (!storeId || !name) {
    return Response.json(
      { success: false, error: 'storeId and name are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['PROMOTION', 'SEASONAL', 'LOYALTY', 'REFERRAL', 'FLASH_SALE'];
  const cType = campaignType || 'PROMOTION';
  if (!validTypes.includes(cType)) {
    return Response.json(
      { success: false, error: `Invalid campaignType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const campaign = await db.voucherCampaign.create({
    data: {
      storeId,
      name,
      campaignType: cType,
      description: description || null,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      budget: budget ?? 0,
      spentAmount: 0,
      targetAudience: targetAudience || null,
      status: 'DRAFT',
      totalRedemptions: 0,
      totalRevenue: 0,
      createdBy: createdBy || null,
    },
  });

  await systemLog({
    action: 'VOUCHER_CAMPAIGN_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Voucher campaign "${name}" created (${cType})`,
    storeId,
    userId: createdBy || undefined,
    metadata: { campaignId: campaign.id, campaignType: cType, budget: budget || 0 },
  });

  return Response.json({ success: true, data: campaign }, { status: 201 });
}

export const GET = withErrorBoundary(getVoucherCampaignsHandler, 'VOUCHER_CAMPAIGNS_LIST');
export const POST = withErrorBoundary(createVoucherCampaignHandler, 'VOUCHER_CAMPAIGNS_CREATE');
