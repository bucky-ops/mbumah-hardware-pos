// GET/POST /api/gift-cards

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

function generateGiftCardCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `MH-GC-${code}`;
}

async function getGiftCardsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const customerId = searchParams.get('customerId');
  const status = searchParams.get('status');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (customerId) {
    where.customerId = customerId;
  }

  if (status) {
    where.status = status;
  }

  const validSortFields = ['code', 'currentBalance', 'createdAt', 'expiresAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [giftCards, total] = await Promise.all([
    db.giftCard.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, phone: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.giftCard.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: giftCards,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createGiftCardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    customerId,
    initialBalance,
    issuedReason,
    minimumPurchase,
    expiresAt,
  } = body;

  if (!storeId || !initialBalance) {
    return Response.json(
      { success: false, error: 'storeId and initialBalance are required.' },
      { status: 400 }
    );
  }

  if (initialBalance <= 0) {
    return Response.json(
      { success: false, error: 'initialBalance must be greater than 0.' },
      { status: 400 }
    );
  }

  // Generate unique code (retry if collision)
  let code = generateGiftCardCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await db.giftCard.findUnique({ where: { code } });
    if (!existing) break;
    code = generateGiftCardCode();
    attempts++;
  }

  const giftCard = await db.giftCard.create({
    data: {
      storeId,
      customerId: customerId || null,
      code,
      initialBalance,
      currentBalance: initialBalance,
      status: 'ACTIVE',
      issuedReason: issuedReason || 'LOYALTY',
      minimumPurchase: minimumPurchase ?? 0,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  await systemLog({
    action: 'GIFT_CARD_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Gift card ${code} created with balance ${initialBalance}`,
    storeId,
    metadata: { giftCardId: giftCard.id, code, initialBalance, customerId: customerId || null },
  });

  return Response.json({ success: true, data: giftCard }, { status: 201 });
}

export const GET = withErrorBoundary(getGiftCardsHandler, 'GIFT_CARDS_LIST');
export const POST = withErrorBoundary(createGiftCardHandler, 'GIFT_CARDS_CREATE');
