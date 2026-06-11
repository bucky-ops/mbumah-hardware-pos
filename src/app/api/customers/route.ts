/**
 * MBUMAH HARDWARE POS - Customers API
 * GET /api/customers - List/search customers
 * POST /api/customers - Create a new customer
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getCustomersHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const search = searchParams.get('search') || '';
  const isActive = searchParams.get('isActive');
  const hasDebt = searchParams.get('hasDebt') === 'true';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'name';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  const where: Record<string, unknown> = { storeId };

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phone: { contains: search } },
      { email: { contains: search } },
      { idNumber: { contains: search } },
    ];
  }

  if (isActive !== null && isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  if (hasDebt) {
    where.currentDebtBalance = { gt: 0 };
  }

  const validSortFields = ['name', 'phone', 'currentDebtBalance', 'loyaltyPoints', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where,
      include: {
        _count: {
          select: {
            transactions: true,
            debtLedgers: { where: { status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] } } },
          },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.customer.count({ where }),
  ]);

  const result = customers.map((cust) => {
    const { _count, ...customerData } = cust;
    return {
      ...customerData,
      activeDebtCount: _count.debtLedgers,
      transactionCount: _count.transactions,
    };
  });

  return Response.json({
    success: true,
    data: result,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createCustomerHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    name,
    phone,
    email,
    address,
    idNumber,
    debtLimit,
    preferredChannel,
    isActive,
  } = body;

  if (!storeId || !name) {
    return Response.json(
      { success: false, error: 'storeId and name are required.' },
      { status: 400 }
    );
  }

  // Check for duplicate phone within store
  if (phone) {
    const existing = await db.customer.findFirst({
      where: { storeId, phone },
    });
    if (existing) {
      return Response.json(
        { success: false, error: 'A customer with this phone number already exists.' },
        { status: 409 }
      );
    }
  }

  const customer = await db.customer.create({
    data: {
      storeId,
      name,
      phone: phone || null,
      email: email || null,
      address: address || null,
      idNumber: idNumber || null,
      debtLimit: debtLimit ?? 50000,
      preferredChannel: preferredChannel || 'SMS',
      isActive: isActive ?? true,
    },
  });

  await systemLog({
    action: 'CUSTOMER_CREATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Customer "${name}" created`,
    storeId,
    metadata: { customerId: customer.id, phone: phone || null },
  });

  return Response.json({ success: true, data: customer }, { status: 201 });
}

export const GET = withErrorBoundary(getCustomersHandler, 'CUSTOMERS_LIST');
export const POST = withErrorBoundary(createCustomerHandler, 'CUSTOMERS_CREATE');
