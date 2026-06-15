// GET/POST /api/banking/transactions

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function getBankTransactionsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const bankAccountId = searchParams.get('bankAccountId');
  const storeId = searchParams.get('storeId');
  if (!bankAccountId && !storeId) {
    return Response.json(
      { success: false, error: 'bankAccountId or storeId is required.' },
      { status: 400 }
    );
  }

  const transactionType = searchParams.get('transactionType');
  const isReconciled = searchParams.get('isReconciled');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'transactionDate';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = {};

  if (bankAccountId) {
    where.bankAccountId = bankAccountId;
  } else if (storeId) {
    where.bankAccount = { storeId };
  }

  if (transactionType) {
    where.transactionType = transactionType;
  }

  if (isReconciled !== null && isReconciled !== undefined && isReconciled !== '') {
    where.isReconciled = isReconciled === 'true';
  }

  if (dateFrom || dateTo) {
    const transactionDate: Record<string, Date> = {};
    if (dateFrom) transactionDate.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      transactionDate.lte = to;
    }
    where.transactionDate = transactionDate;
  }

  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['transactionDate', 'amount', 'createdAt', 'transactionType'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'transactionDate';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [transactions, total] = await Promise.all([
    db.bankTransaction.findMany({
      where,
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountName: true, accountNumber: true, storeId: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.bankTransaction.count({ where }),
  ]);

  // Summary stats
  const summary = await db.bankTransaction.aggregate({
    where,
    _sum: { amount: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: transactions,
    summary: {
      totalAmount: summary._sum.amount || 0,
      totalCount: summary._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createBankTransactionHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    bankAccountId,
    transactionType,
    amount,
    reference,
    description,
    transactionDate,
  } = body;

  if (!bankAccountId || !amount) {
    return Response.json(
      { success: false, error: 'bankAccountId and amount are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE', 'INTEREST'];
  const tType = transactionType || 'DEPOSIT';
  if (!validTypes.includes(tType)) {
    return Response.json(
      { success: false, error: `Invalid transactionType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  if (amount <= 0) {
    return Response.json(
      { success: false, error: 'amount must be greater than 0.' },
      { status: 400 }
    );
  }

  // Get current balance and compute new balance
  const bankAccount = await db.bankAccount.findUnique({
    where: { id: bankAccountId },
  });

  if (!bankAccount) {
    return Response.json(
      { success: false, error: 'Bank account not found.' },
      { status: 404 }
    );
  }

  if (!bankAccount.isActive) {
    return Response.json(
      { success: false, error: 'Cannot transact on an inactive bank account.' },
      { status: 400 }
    );
  }

  // Compute new balance: deposits increase, withdrawals/fees decrease
  let newBalance = bankAccount.currentBalance;
  if (tType === 'DEPOSIT' || tType === 'INTEREST') {
    newBalance += parseFloat(String(amount));
  } else {
    newBalance -= parseFloat(String(amount));
  }

  const transaction = await db.$transaction(async (tx) => {
    const bankTx = await tx.bankTransaction.create({
      data: {
        bankAccountId,
        transactionType: tType,
        amount: parseFloat(String(amount)),
        balanceAfter: newBalance,
        reference: reference || null,
        description: description || null,
        transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
        isReconciled: false,
      },
    });

    // Update bank account balance
    await tx.bankAccount.update({
      where: { id: bankAccountId },
      data: { currentBalance: newBalance },
    });

    return bankTx;
  });

  await systemLog({
    action: 'BANK_TRANSACTION_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Bank transaction ${tType} of ${amount} on ${bankAccount.accountName}`,
    storeId: bankAccount.storeId,
    metadata: {
      bankTransactionId: transaction.id,
      bankAccountId,
      transactionType: tType,
      amount,
      newBalance,
    },
  });

  return Response.json({ success: true, data: transaction }, { status: 201 });
}

export const GET = withErrorBoundary(getBankTransactionsHandler, 'BANK_TRANSACTIONS_LIST');
export const POST = withErrorBoundary(createBankTransactionHandler, 'BANK_TRANSACTIONS_CREATE');
