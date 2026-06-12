// GET/PUT /api/customers/[id]

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getCustomerHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      debtLedgers: {
        where: { status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] } },
        orderBy: { dueDate: 'asc' },
      },
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          receiptNumber: true,
          totalAmount: true,
          paymentMethod: true,
          paymentStatus: true,
          createdAt: true,
        },
      },
      rentals: {
        where: { status: { in: ['ACTIVE', 'OVERDUE'] } },
        select: {
          id: true,
          status: true,
          rentalStartDate: true,
          expectedReturnDate: true,
          ratePerDay: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  if (!customer) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 }
    );
  }

  const totalDebtOwed = customer.debtLedgers.reduce((sum, dl) => sum + dl.balance, 0);
  const availableCredit = customer.debtLimit - customer.currentDebtBalance;

  return Response.json({
    success: true,
    data: {
      ...customer,
      summary: {
        totalDebtOwed,
        availableCredit: Math.max(0, availableCredit),
        activeRentals: customer.rentals.length,
        recentTransactions: customer.transactions.length,
      },
    },
  });
}

async function updateCustomerHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.customer.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Customer not found.' },
      { status: 404 }
    );
  }

    if (body.phone && body.phone !== existing.phone) {
    const duplicate = await db.customer.findFirst({
      where: { storeId: existing.storeId, phone: body.phone, id: { not: id } },
    });
    if (duplicate) {
      return Response.json(
        { success: false, error: 'A customer with this phone number already exists.' },
        { status: 409 }
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = [
    'name', 'phone', 'email', 'address', 'idNumber',
    'debtLimit', 'preferredChannel', 'isActive', 'loyaltyPoints',
  ];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const customer = await db.customer.update({
    where: { id },
    data: updateData,
  });

  await systemLog({
    action: 'CUSTOMER_UPDATED',
    component: LogComponent.POS,
    severity: LogSeverity.INFO,
    message: `Customer "${customer.name}" updated`,
    storeId: customer.storeId,
    metadata: { customerId: id, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: customer });
}

export const GET = withErrorBoundary(getCustomerHandler, 'CUSTOMER_DETAIL');
export const PUT = withErrorBoundary(updateCustomerHandler, 'CUSTOMER_UPDATE');
