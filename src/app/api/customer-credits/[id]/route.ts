// GET/PUT/DELETE /api/customer-credits/[id]

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getCustomerCreditHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const credit = await db.customerCredit.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  if (!credit) {
    return Response.json(
      { success: false, error: 'Credit entry not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: credit });
}

async function updateCustomerCreditHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.customerCredit.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Credit entry not found.' },
      { status: 404 }
    );
  }

  if (existing.status === 'VOIDED') {
    return Response.json(
      { success: false, error: 'Cannot update a voided entry.' },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = ['amount', 'creditType', 'reference', 'description'];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // Validate creditType if being changed
  if (updateData.creditType) {
    const validTypes = ['CREDIT', 'DEBIT', 'ADJUSTMENT', 'REFUND'];
    if (!validTypes.includes(updateData.creditType as string)) {
      return Response.json(
        { success: false, error: `Invalid creditType. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }
  }

  // Validate amount if being changed
  if (updateData.amount !== undefined) {
    const newAmount = Number(updateData.amount);
    if (isNaN(newAmount) || newAmount <= 0) {
      return Response.json(
        { success: false, error: 'Amount must be a valid positive number.' },
        { status: 400 }
      );
    }
    updateData.amount = Math.abs(newAmount);
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  // Recalculate running balance if amount or creditType changed
  if (updateData.amount !== undefined || updateData.creditType !== undefined) {
    const effectiveAmount = Number(updateData.amount ?? existing.amount);
    const effectiveType = (updateData.creditType ?? existing.creditType) as string;

    // Get all credit entries for this customer up to and including this one, ordered by date
    const allCredits = await db.customerCredit.findMany({
      where: {
        customerId: existing.customerId,
        status: { not: 'VOIDED' },
        createdAt: { lte: existing.createdAt },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Recalculate running balance from the beginning
    let runningBalance = 0;
    for (const entry of allCredits) {
      if (entry.id === id) {
        // Use the new values for this entry
        switch (effectiveType) {
          case 'CREDIT':
          case 'REFUND':
            runningBalance += effectiveAmount;
            break;
          case 'DEBIT':
            runningBalance -= effectiveAmount;
            break;
          case 'ADJUSTMENT':
            runningBalance += effectiveAmount;
            break;
        }
      } else {
        switch (entry.creditType) {
          case 'CREDIT':
          case 'REFUND':
            runningBalance += entry.amount;
            break;
          case 'DEBIT':
            runningBalance -= entry.amount;
            break;
          case 'ADJUSTMENT':
            runningBalance += entry.amount;
            break;
        }
      }
    }

    updateData.balance = runningBalance;

    // Update all subsequent entries' running balances
    const subsequentCredits = await db.customerCredit.findMany({
      where: {
        customerId: existing.customerId,
        status: { not: 'VOIDED' },
        createdAt: { gt: existing.createdAt },
      },
      orderBy: { createdAt: 'asc' },
    });

    let subsequentBalance = runningBalance;
    for (const entry of subsequentCredits) {
      switch (entry.creditType) {
        case 'CREDIT':
        case 'REFUND':
          subsequentBalance += entry.amount;
          break;
        case 'DEBIT':
          subsequentBalance -= entry.amount;
          break;
        case 'ADJUSTMENT':
          subsequentBalance += entry.amount;
          break;
      }
      await db.customerCredit.update({
        where: { id: entry.id },
        data: { balance: subsequentBalance },
      });
    }
  }

  // Handle reference/description clearing (set to null)
  if (body.reference === null || body.reference === '') {
    updateData.reference = null;
  }
  if (body.description === null || body.description === '') {
    updateData.description = null;
  }

  const credit = await db.customerCredit.update({
    where: { id },
    data: updateData,
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  await systemLog({
    action: 'CUSTOMER_CREDIT_UPDATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Credit entry updated for customer "${credit.customer?.name || 'Unknown'}"`,
    storeId: existing.storeId,
    metadata: { creditId: id, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: credit });
}

async function deleteCustomerCreditHandler(...args: unknown[]): Promise<Response> {
  const _request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.customerCredit.findUnique({
    where: { id },
    include: {
      customer: {
        select: { id: true, name: true },
      },
    },
  });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Credit entry not found.' },
      { status: 404 }
    );
  }

  if (existing.status === 'VOIDED') {
    return Response.json(
      { success: false, error: 'Entry is already voided.' },
      { status: 400 }
    );
  }

  // Soft delete (void) the entry
  const credit = await db.customerCredit.update({
    where: { id },
    data: {
      status: 'VOIDED',
      voidedAt: new Date(),
      voidReason: 'Voided by user',
    },
    include: {
      customer: {
        select: { id: true, name: true, phone: true },
      },
    },
  });

  // Recalculate running balances for all subsequent entries for this customer
  const allCredits = await db.customerCredit.findMany({
    where: {
      customerId: existing.customerId,
      status: { not: 'VOIDED' },
    },
    orderBy: { createdAt: 'asc' },
  });

  let runningBalance = 0;
  for (const entry of allCredits) {
    switch (entry.creditType) {
      case 'CREDIT':
      case 'REFUND':
        runningBalance += entry.amount;
        break;
      case 'DEBIT':
        runningBalance -= entry.amount;
        break;
      case 'ADJUSTMENT':
        runningBalance += entry.amount;
        break;
    }
    await db.customerCredit.update({
      where: { id: entry.id },
      data: { balance: runningBalance },
    });
  }

  await systemLog({
    action: 'CUSTOMER_CREDIT_VOIDED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Credit entry voided for customer "${existing.customer?.name || 'Unknown'}"`,
    storeId: existing.storeId,
    metadata: {
      creditId: id,
      creditType: existing.creditType,
      amount: existing.amount,
      previousBalance: existing.balance,
    },
  });

  return Response.json({
    success: true,
    message: 'Credit entry voided successfully.',
    data: credit,
  });
}

export const GET = withErrorBoundary(getCustomerCreditHandler, 'CUSTOMER_CREDIT_DETAIL');
export const PUT = withErrorBoundary(updateCustomerCreditHandler, 'CUSTOMER_CREDIT_UPDATE');
export const DELETE = withErrorBoundary(deleteCustomerCreditHandler, 'CUSTOMER_CREDIT_VOID');
