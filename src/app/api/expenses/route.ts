// GET/POST /api/expenses

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES, type AccountCode } from '@/lib/account-helper';
import { LogSeverity, LogComponent } from '@/lib/types';
import { createExpenseSchema, validateInput } from '@/lib/validations';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
// Task 12-c: canonical financial math (HALF_UP 2dp). Prisma Decimal
// `valueOf()` returns a STRING — `currentBalance - Number(expense.amount)`
// coerced through float, and parseFloat() let NaN/dust into Decimal columns.
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

// Expense category -> account code mapping
const CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  RENT: ACCOUNT_CODES.RENT_EXPENSE,
  SALARIES: ACCOUNT_CODES.SALARIES_EXPENSE,
  UTILITIES: ACCOUNT_CODES.UTILITIES_EXPENSE,
  BAD_DEBT: ACCOUNT_CODES.BAD_DEBT_EXPENSE,
};

const VALID_CATEGORIES = ['RENT', 'SALARIES', 'UTILITIES', 'TRANSPORT', 'MAINTENANCE', 'SUPPLIES', 'BAD_DEBT', 'OTHER'];

async function getExpensesHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const category = searchParams.get('category') || '';
  const limit = parseInt(searchParams.get('limit') || '50');
  const page = parseInt(searchParams.get('page') || '1');

  const where: Record<string, unknown> = { storeId };

  if (category) {
    where.category = category;
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

  const [expenses, total] = await Promise.all([
    db.expense.findMany({
      where,
      include: {
        store: {
          select: { id: true, name: true, location: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.expense.count({ where }),
  ]);

  // Calculate summary stats
  const expenseSummary = await db.expense.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });

  // DECIMAL SERIALIZATION GUARD (financial audit): `amount` is a Prisma
  // Decimal — raw pass-through makes Response.json emit a STRING (decimal.js
  // toJSON), and client-side sums like `reduce((s, e) => s + e.amount, 0)`
  // then string-concatenate ("0" + "500" → "0500"…) producing corrupt
  // totals. Serialize as a JS number to honor the api.ts contract
  // (ExpenseItem.amount: number).
  return Response.json({
    success: true,
    data: expenses.map((expense) => ({ ...expense, amount: Number(expense.amount) })),
    summary: {
      totalAmount: Number(expenseSummary._sum.amount ?? 0),
      totalCount: expenseSummary._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createExpenseHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const validation = validateInput(createExpenseSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const {
    storeId,
    description,
    amount,
    category,
    paidBy,
    paymentMethod,
    notes,
  } = validation.data;

  if (!VALID_CATEGORIES.includes(category)) {
    return Response.json(
      { success: false, error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }

  if (!paidBy) {
    return Response.json(
      { success: false, error: 'paidBy is required.' },
      { status: 400 }
    );
  }

  const expensePaymentMethod = paymentMethod || 'CASH';
  if (!['CASH', 'MPESA', 'BANK_TRANSFER', 'CHEQUE'].includes(expensePaymentMethod)) {
    return Response.json(
      { success: false, error: 'paymentMethod must be CASH, MPESA, BANK_TRANSFER, or CHEQUE.' },
      { status: 400 }
    );
  }

    const user = await db.user.findUnique({ where: { id: paidBy } });
  if (!user || !user.isActive) {
    return Response.json(
      { success: false, error: 'Invalid or inactive user for paidBy.' },
      { status: 400 }
    );
  }

    const orgId = user.organizationId;
  const creditAccountCode = expensePaymentMethod === 'MPESA'
    ? ACCOUNT_CODES.MPESA_ACCOUNT
    : ACCOUNT_CODES.CASH_ON_HAND;

    const expenseAccountCode = CATEGORY_ACCOUNT_MAP[category] || ACCOUNT_CODES.SALARIES_EXPENSE;

  const accounts = await getAccountIds(orgId, [
    expenseAccountCode as AccountCode,
    creditAccountCode as AccountCode,
  ]);

  const expenseAccountKey = Object.entries(ACCOUNT_CODES).find(([, v]) => v === expenseAccountCode)?.[0] || 'SALARIES_EXPENSE';
  const creditAccountKey = Object.entries(ACCOUNT_CODES).find(([, v]) => v === creditAccountCode)?.[0] || 'CASH_ON_HAND';

  const expenseAccountId = accounts[expenseAccountKey];
  const creditAccountId = accounts[creditAccountKey];

  if (!expenseAccountId || !creditAccountId) {
    return Response.json(
      { success: false, error: 'Required accounting accounts not found. Please ensure chart of accounts is initialized.' },
      { status: 500 }
    );
  }

    const result = await db.$transaction(async (tx) => {
      // Task 12-c: Decimal coercion + HALF_UP 2dp (was parseFloat — NaN slipped
      // straight into the Decimal column and 0.1+0.2-class dust survived).
      const expenseAmount = round2(toDec(amount));
        const expense = await tx.expense.create({
      data: {
        storeId,
        description,
        amount: expenseAmount,
        category,
        paidBy,
        paymentMethod: expensePaymentMethod,
        notes: notes || null,
      },
    });

    // Create journal entry: Debit expense account, Credit cash/mpesa account
    const jeNumber = generateJournalEntryNumber();
    const journalEntry = await tx.journalEntry.create({
      data: {
        storeId,
        entryNumber: jeNumber,
        description: `Expense: ${description}`,
        referenceType: 'EXPENSE',
        referenceId: expense.id,
        totalDebit: expense.amount,
        totalCredit: expense.amount,
        isPosted: true,
        postedAt: new Date(),
        createdBy: paidBy,
        lines: {
          create: [
            {
              accountId: expenseAccountId,
              debit: expense.amount,
              credit: 0,
              description: `${category} expense: ${description}`,
            },
            {
              accountId: creditAccountId,
              debit: 0,
              credit: expense.amount,
              description: `Payment for ${category} expense via ${expensePaymentMethod}`,
            },
          ],
        },
      },
    });

        await tx.expense.update({
      where: { id: expense.id },
      data: { journalEntryId: journalEntry.id },
    });

        if (expensePaymentMethod === 'CASH') {
      // AUDIT FIX: read-latest-row lost-update race → aggregate _sum pattern
      // (same as src/app/api/transactions/route.ts R6 remediation). The
      // latest row's balance can be stale under concurrent drawer writes.
      const drawerAgg = await tx.cashDrawerLog.aggregate({
        where: { storeId },
        _sum: { amount: true },
      });
      // Task 12-c: Decimal running balance (was `currentBalance -
      // Number(expense.amount)`). NOTE: CashDrawerLog is an APPEND-ONLY ledger
      // (no mutable balance row), so Prisma's atomic increment/decrement does
      // not apply — the SUM-derived balance below is the concurrency-safe
      // equivalent (R6 pattern), now with exact Decimal arithmetic.
      const drawerBalanceDec = toDec(drawerAgg._sum.amount ?? 0);

      await tx.cashDrawerLog.create({
        data: {
          storeId,
          userId: paidBy,
          action: 'CASH_OUT',
          amount: expense.amount,
          balance: round2(drawerBalanceDec.minus(toDec(expense.amount))),
          notes: `Expense: ${description} (${category})`,
        },
      });
    }

    return { expense, journalEntry };
  });

  await systemLog({
    action: 'EXPENSE_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Expense "${description}" created: KES ${amount} (${category}) via ${expensePaymentMethod}`,
    storeId,
    userId: paidBy,
    metadata: {
      expenseId: result.expense.id,
      journalEntryId: result.journalEntry.id,
      amount,
      category,
      paymentMethod: expensePaymentMethod,
    },
  });

    const fullExpense = await db.expense.findUnique({
    where: { id: result.expense.id },
    include: {
      store: { select: { id: true, name: true, location: true } },
    },
  });

  return Response.json(
    {
      success: true,
      data: {
        ...fullExpense,
        journalEntry: {
          id: result.journalEntry.id,
          entryNumber: result.journalEntry.entryNumber,
        },
      },
    },
    { status: 201 }
  );
}

export const GET = withErrorBoundary(withSessionAuth(getExpensesHandler, FINANCIAL_ROLES.WRITE), 'EXPENSES_LIST');
export const POST = withErrorBoundary(withSessionAuth(createExpenseHandler, FINANCIAL_ROLES.WRITE), 'EXPENSES_CREATE');
