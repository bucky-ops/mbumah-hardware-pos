// GET/POST /api/loyalty/transactions

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getLoyaltyTransactionsHandler(...args: unknown[]): Promise<Response> {
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
  const transactionType = searchParams.get('transactionType');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (customerId) {
    where.customerId = customerId;
  }

  if (transactionType) {
    where.transactionType = transactionType;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['createdAt', 'points', 'transactionType'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [transactions, total] = await Promise.all([
    db.loyaltyTransaction.findMany({
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
    db.loyaltyTransaction.count({ where }),
  ]);

  // Summary stats
  const earnedSummary = await db.loyaltyTransaction.aggregate({
    where: { ...where, points: { gt: 0 } },
    _sum: { points: true },
    _count: true,
  });

  const redeemedSummary = await db.loyaltyTransaction.aggregate({
    where: { ...where, points: { lt: 0 } },
    _sum: { points: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: transactions,
    summary: {
      totalPointsEarned: earnedSummary._sum.points || 0,
      totalEarnCount: earnedSummary._count,
      totalPointsRedeemed: Math.abs(redeemedSummary._sum.points || 0),
      totalRedeemCount: redeemedSummary._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createLoyaltyTransactionHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    customerId,
    points,
    transactionType,
    reference,
    description,
    createdBy,
  } = body;

  if (!storeId || !customerId || !points) {
    return Response.json(
      { success: false, error: 'storeId, customerId, and points are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['EARN', 'REDEEM', 'BONUS', 'EXPIRE', 'ADJUST'];
  const tType = transactionType || 'EARN';
  if (!validTypes.includes(tType)) {
    return Response.json(
      { success: false, error: `Invalid transactionType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const pointsValue = parseInt(String(points));
  if (pointsValue === 0) {
    return Response.json(
      { success: false, error: 'points must be non-zero.' },
      { status: 400 }
    );
  }

  // For EARN/BONUS, points must be positive; for REDEEM/EXPIRE, must be negative
  let finalPoints = pointsValue;
  if (tType === 'EARN' || tType === 'BONUS') {
    finalPoints = Math.abs(pointsValue);
  } else if (tType === 'REDEEM' || tType === 'EXPIRE') {
    finalPoints = -Math.abs(pointsValue);
  }

  // Verify customer exists
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 }
    );
  }

  // For redeem, check sufficient points
  if (tType === 'REDEEM') {
    const loyalty = await db.customerLoyalty.findFirst({
      where: { customerId },
    });
    if (!loyalty || loyalty.pointsBalance < Math.abs(finalPoints)) {
      return Response.json(
        { success: false, error: `Insufficient loyalty points. Customer has ${loyalty?.pointsBalance || 0} points.` },
        { status: 400 }
      );
    }
  }

  const transaction = await db.$transaction(async (tx) => {
    const loyaltyTx = await tx.loyaltyTransaction.create({
      data: {
        storeId,
        customerId,
        points: finalPoints,
        transactionType: tType,
        reference: reference || null,
        description: description || null,
        createdBy: createdBy || null,
      },
      include: {
        customer: {
          select: { id: true, name: true, phone: true },
        },
      },
    });

    // Update or create customer loyalty record
    const existingLoyalty = await tx.customerLoyalty.findFirst({
      where: { customerId },
    });

    if (existingLoyalty) {
      const updateData: Record<string, unknown> = {
        lastActivityAt: new Date(),
      };

      if (finalPoints > 0) {
        updateData.pointsBalance = { increment: finalPoints };
        updateData.lifetimePoints = { increment: finalPoints };
      } else {
        updateData.pointsBalance = { increment: finalPoints }; // negative
        updateData.totalRedeemed = { increment: Math.abs(finalPoints) };
      }

      await tx.customerLoyalty.update({
        where: { id: existingLoyalty.id },
        data: updateData,
      });
    } else if (finalPoints > 0) {
      // Auto-assign to first active tier for new loyalty customers
      const firstTier = await tx.loyaltyTier.findFirst({
        where: { storeId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });

      await tx.customerLoyalty.create({
        data: {
          customerId,
          tierId: firstTier?.id || 'default',
          pointsBalance: finalPoints,
          lifetimePoints: finalPoints,
          totalRedeemed: 0,
          tierAchievedAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
    }

    return loyaltyTx;
  });

  await systemLog({
    action: 'LOYALTY_TRANSACTION_CREATED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Loyalty ${tType}: ${finalPoints} points for customer ${customer.name}`,
    storeId,
    userId: createdBy || undefined,
    metadata: {
      loyaltyTransactionId: transaction.id,
      customerId,
      transactionType: tType,
      points: finalPoints,
    },
  });

  return Response.json({ success: true, data: transaction }, { status: 201 });
}

export const GET = withErrorBoundary(getLoyaltyTransactionsHandler, 'LOYALTY_TRANSACTIONS_LIST');
export const POST = withErrorBoundary(createLoyaltyTransactionHandler, 'LOYALTY_TRANSACTIONS_CREATE');
