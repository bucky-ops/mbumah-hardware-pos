// PUT/DELETE /api/expenses/[id]

import { type NextRequest } from 'next/server';
import { db, withImmutabilityBypass } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function updateExpenseHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = await db.expense.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Expense not found.' },
      { status: 404 }
    );
  }

  if (existing.status === 'VOIDED') {
    return Response.json(
      { success: false, error: 'Cannot update a voided expense.' },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  const allowedFields = ['description', 'category', 'paymentMethod', 'notes'];

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  if (body.amount !== undefined) {
    const newAmount = parseFloat(String(body.amount));
    if (isNaN(newAmount) || newAmount <= 0) {
      return Response.json(
        { success: false, error: 'Amount must be a valid positive number.' },
        { status: 400 }
      );
    }
    updateData.amount = newAmount;
  }

  const VALID_CATEGORIES = ['RENT', 'SALARIES', 'UTILITIES', 'TRANSPORT', 'MAINTENANCE', 'SUPPLIES', 'BAD_DEBT', 'OTHER'];
  if (updateData.category && !VALID_CATEGORIES.includes(updateData.category as string)) {
    return Response.json(
      { success: false, error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  if (updateData.paymentMethod && !['CASH', 'MPESA'].includes(updateData.paymentMethod as string)) {
    return Response.json(
      { success: false, error: 'paymentMethod must be CASH or MPESA.' },
      { status: 400 }
    );
  }

  if (Object.keys(updateData).length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields to update.' },
      { status: 400 }
    );
  }

  const expense = await db.expense.update({
    where: { id },
    data: updateData,
    include: {
      store: { select: { id: true, name: true, location: true } },
    },
  });

  await systemLog({
    action: 'EXPENSE_UPDATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Expense "${existing.description}" updated`,
    storeId: existing.storeId,
    metadata: { expenseId: id, updatedFields: Object.keys(updateData) },
  });

  return Response.json({ success: true, data: expense });
}

async function deleteExpenseHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const url = new URL(request.url);
  const hardDelete = url.searchParams.get('hardDelete') === 'true';

  const existing = await db.expense.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Expense not found.' },
      { status: 404 }
    );
  }

  if (hardDelete) {
    if (existing.status !== 'VOIDED') {
      return Response.json(
        { success: false, error: 'Only voided expenses can be permanently deleted.' },
        { status: 400 }
      );
    }

    await db.expense.delete({ where: { id } });

    await systemLog({
      action: 'EXPENSE_HARD_DELETED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.WARN,
      message: `Expense "${existing.description}" permanently deleted`,
      storeId: existing.storeId,
      metadata: { expenseId: id, description: existing.description, amount: existing.amount },
    });

    return Response.json({
      success: true,
      message: 'Expense permanently deleted.',
    });
  }

  if (existing.status === 'VOIDED') {
    return Response.json(
      { success: false, error: 'Expense is already voided.' },
      { status: 400 }
    );
  }

  const expense = await db.expense.update({
    where: { id },
    data: {
      status: 'VOIDED',
      voidedAt: new Date(),
    },
    include: {
      store: { select: { id: true, name: true, location: true } },
    },
  });

  if (existing.journalEntryId) {
    // Voiding the linked JournalEntry is a sanctioned mutation on the
    // append-only financial ledger — wrapped in withImmutabilityBypass().
    await withImmutabilityBypass(() =>
      db.journalEntry.update({
        where: { id: existing.journalEntryId! },
        data: {
          isVoided: true,
          voidedAt: new Date(),
        },
      }),
      'expense_void_linked_journal',
    );
  }

  await systemLog({
    action: 'EXPENSE_VOIDED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.WARN,
    message: `Expense "${existing.description}" voided (KES ${existing.amount})`,
    storeId: existing.storeId,
    metadata: { expenseId: id, amount: existing.amount, journalEntryId: existing.journalEntryId },
  });

  return Response.json({
    success: true,
    message: 'Expense voided successfully.',
    data: expense,
  });
}

export const PUT = withErrorBoundary(updateExpenseHandler, 'EXPENSE_UPDATE');
export const DELETE = withErrorBoundary(deleteExpenseHandler, 'EXPENSE_DELETE');
