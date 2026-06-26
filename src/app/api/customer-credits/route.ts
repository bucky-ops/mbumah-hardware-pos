// GET/POST /api/customer-credits

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getCustomerCreditsHandler(...args: unknown[]): Promise<Response> {
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
  const creditType = searchParams.get('creditType');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const status = searchParams.get('status');

  const where: Record<string, unknown> = { storeId };

  if (customerId) {
    where.customerId = customerId;
  }

  if (creditType) {
    const types = creditType.split(',');
    where.creditType = types.length === 1 ? types[0] : { in: types };
  }

  if (status) {
    where.status = status;
  }

  const validSortFields = ['amount', 'balance', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [credits, total] = await Promise.all([
    db.customerCredit.findMany({
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
    db.customerCredit.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: credits,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createCustomerCreditHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    customerId,
    amount,
    creditType,
    reference,
    description,
    createdBy,
  } = body;

  if (!storeId || !customerId || amount === undefined) {
    return Response.json(
      { success: false, error: 'storeId, customerId, and amount are required.' },
      { status: 400 }
    );
  }

  const type = creditType || 'CREDIT';
  const validTypes = ['CREDIT', 'DEBIT', 'ADJUSTMENT', 'REFUND'];
  if (!validTypes.includes(type)) {
    return Response.json(
      { success: false, error: `Invalid creditType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  // Verify customer exists
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 }
    );
  }

  // Calculate running balance: get the latest non-voided credit entry for this customer
  const latestCredit = await db.customerCredit.findFirst({
    where: { customerId, status: { not: 'VOIDED' } },
    orderBy: { createdAt: 'desc' },
    select: { balance: true },
  });

  const previousBalance = latestCredit?.balance ?? 0;
  let newBalance: number;

  switch (type) {
    case 'CREDIT':
    case 'REFUND':
      newBalance = previousBalance + Math.abs(amount);
      break;
    case 'DEBIT':
      newBalance = previousBalance - Math.abs(amount);
      break;
    case 'ADJUSTMENT':
      newBalance = previousBalance + amount; // Can be positive or negative
      break;
    default:
      newBalance = previousBalance;
  }

  const credit = await db.customerCredit.create({
    data: {
      storeId,
      customerId,
      amount: Math.abs(amount),
      creditType: type,
      reference: reference || null,
      description: description || null,
      balance: newBalance,
      createdBy: createdBy || null,
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  await systemLog({
    action: 'CUSTOMER_CREDIT_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `${type} entry of ${amount} created for customer "${customer.name}"`,
    storeId,
    metadata: {
      creditId: credit.id,
      customerId,
      creditType: type,
      amount,
      previousBalance,
      newBalance,
    },
  });

  return Response.json({ success: true, data: credit }, { status: 201 });
}

export const GET = withErrorBoundary(getCustomerCreditsHandler, 'CUSTOMER_CREDITS_LIST');
export const POST = withErrorBoundary(createCustomerCreditHandler, 'CUSTOMER_CREDITS_CREATE');
