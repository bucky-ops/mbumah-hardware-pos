// GET/POST /api/vouchers

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

function generateVoucherCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `MH-VC-${code}`;
}

async function getVouchersHandler(...args: unknown[]): Promise<Response> {
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
  const voucherType = searchParams.get('voucherType');
  const campaignId = searchParams.get('campaignId');
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (status) {
    where.status = status;
  }

  if (voucherType) {
    where.voucherType = voucherType;
  }

  if (campaignId) {
    where.campaignId = campaignId;
  }

  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['code', 'name', 'value', 'createdAt', 'startDate', 'endDate', 'currentUses'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [vouchers, total] = await Promise.all([
    db.voucher.findMany({
      where,
      include: {
        campaign: {
          select: { id: true, name: true, campaignType: true, status: true },
        },
        redemptions: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: { id: true, discountAmount: true, createdAt: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.voucher.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: vouchers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createVoucherHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    voucherType,
    value,
    description,
    minimumPurchase,
    maxDiscount,
    freeProductId,
    maxUses,
    maxUsesPerUser,
    startDate,
    endDate,
    campaignId,
    createdBy,
  } = body;

  if (!storeId || !name || !value) {
    return Response.json(
      { success: false, error: 'storeId, name, and value are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['FIXED', 'PERCENTAGE', 'FREE_PRODUCT', 'BUNDLE'];
  const vType = voucherType || 'FIXED';
  if (!validTypes.includes(vType)) {
    return Response.json(
      { success: false, error: `Invalid voucherType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  if (value <= 0) {
    return Response.json(
      { success: false, error: 'value must be greater than 0.' },
      { status: 400 }
    );
  }

  // Generate unique code (retry if collision)
  let code = generateVoucherCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.voucher.findUnique({ where: { code } });
    if (!existing) break;
    code = generateVoucherCode();
    attempts++;
  }

  const voucher = await db.voucher.create({
    data: {
      storeId,
      code,
      name,
      voucherType: vType,
      description: description || null,
      value: parseFloat(String(value)),
      minimumPurchase: minimumPurchase ?? 0,
      maxDiscount: maxDiscount ?? null,
      freeProductId: freeProductId || null,
      maxUses: maxUses ?? 1,
      currentUses: 0,
      maxUsesPerUser: maxUsesPerUser ?? 1,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      status: 'ACTIVE',
      campaignId: campaignId || null,
      createdBy: createdBy || null,
    },
    include: {
      campaign: {
        select: { id: true, name: true, campaignType: true, status: true },
      },
    },
  });

  await systemLog({
    action: 'VOUCHER_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Voucher ${code} (${name}) created with value ${value}`,
    storeId,
    userId: createdBy || undefined,
    metadata: { voucherId: voucher.id, code, voucherType: vType, value },
  });

  return Response.json({ success: true, data: voucher }, { status: 201 });
}

export const GET = withErrorBoundary(getVouchersHandler, 'VOUCHERS_LIST');
export const POST = withErrorBoundary(createVoucherHandler, 'VOUCHERS_CREATE');
