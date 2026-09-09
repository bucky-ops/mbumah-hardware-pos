// GET/POST /api/customers

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { createCustomerSchema, validationErrorResponse } from '@/lib/validations';
import { parsePagination, buildPaginationMeta } from '@/lib/api-pagination';
import { withSessionAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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
  // AUDIT FIX (Finding 2.1): pagination parsing centralised + sanitised
  // (page clamped to ≥ 1, limit clamped to [1, 500], NaN → default 50).
  const { page, limit, skip } = parsePagination(searchParams, {
    defaultLimit: 50,
    maxLimit: 500,
  });
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
      skip,
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
    pagination: buildPaginationMeta(page, limit, total),
  });
}

async function createCustomerHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  // AUDIT FIX (Finding 1.4): same schema and status code as before, but the
  // failure response now uses the canonical validation shape — a summary
  // string plus a machine-readable per-field `errors` map clients can use
  // for form highlighting.
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const {
    storeId,
    name,
    phone,
    email,
    address,
    idNumber,
    debtLimit,
  } = parsed.data;

  const preferredChannel = (body as Record<string, unknown>).preferredChannel || 'SMS';
  const isActive = (body as Record<string, unknown>).isActive ?? true;

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

// AUDIT FIX (Task 3-d): GET = any store role. POST intentionally allows ALL
// store roles (integration decision): walk-in customer creation is a core POS
// checkout workflow and the audit deny-list for cashiers covers price edits,
// profit visibility, invoice deletion and user administration — not customer
// intake. Customer edits/deletes remain manager-or-above (customers/[id]).
export const GET = withErrorBoundary(withSessionAuth(getCustomersHandler), 'CUSTOMERS_LIST');
export const POST = withErrorBoundary(withSessionAuth(createCustomerHandler), 'CUSTOMERS_CREATE');
