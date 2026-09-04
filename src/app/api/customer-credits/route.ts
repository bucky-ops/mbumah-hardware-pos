// GET/POST /api/customer-credits

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, MANAGER_PLUS_ROLES } from '@/lib/auth';
// Task 12-c: canonical financial math. Prisma Decimal `valueOf()` returns a
// STRING — `previousBalance + Math.abs(amount)` used to STRING-CONCATENATE
// when previousBalance came from the last credit row's Decimal balance.
import { toDec, round2 } from '@/lib/utils/financialMath';

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

  // Task 12-c: running balance math in Decimal (HALF_UP 2dp at emit).
  // Ordering semantics preserved: latest non-voided row by createdAt desc.
  const previousBalanceDec = toDec(latestCredit?.balance ?? 0);
  const amountDec = toDec(amount);
  const absAmount = amountDec.abs();

  let newBalanceDec = previousBalanceDec;

  switch (type) {
    case 'CREDIT':
    case 'REFUND':
      newBalanceDec = previousBalanceDec.plus(absAmount);
      break;
    case 'DEBIT':
      newBalanceDec = previousBalanceDec.minus(absAmount);
      break;
    case 'ADJUSTMENT':
      newBalanceDec = previousBalanceDec.plus(amountDec); // Can be positive or negative
      break;
    default:
      newBalanceDec = previousBalanceDec;
  }
  const newBalance = round2(newBalanceDec);

  const credit = await db.customerCredit.create({
    data: {
      storeId,
      customerId,
      amount: round2(absAmount),
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
      previousBalance: round2(previousBalanceDec),
      newBalance,
    },
  });

  return Response.json({ success: true, data: credit }, { status: 201 });
}

// AUDIT FIX (Task 3-d): GET = any store role; POST mutates the customer credit
// balance (ledger) = manager-or-above.
export const GET = withErrorBoundary(
  withSessionAuth(getCustomerCreditsHandler),
  'CUSTOMER_CREDITS_LIST',
);
export const POST = withErrorBoundary(
  withSessionAuth(createCustomerCreditHandler, { roles: MANAGER_PLUS_ROLES }),
  'CUSTOMER_CREDITS_CREATE',
);
