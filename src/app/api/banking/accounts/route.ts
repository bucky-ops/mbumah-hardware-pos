// GET/POST /api/banking/accounts

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getBankAccountsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const accountType = searchParams.get('accountType');
  const isActive = searchParams.get('isActive');
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (accountType) {
    where.accountType = accountType;
  }

  if (isActive !== null && isActive !== undefined && isActive !== '') {
    where.isActive = isActive === 'true';
  }

  if (search) {
    where.OR = [
      { bankName: { contains: search, mode: 'insensitive' } },
      { accountName: { contains: search, mode: 'insensitive' } },
      { accountNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  const validSortFields = ['bankName', 'accountName', 'currentBalance', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [accounts, total] = await Promise.all([
    db.bankAccount.findMany({
      where,
      include: {
        store: { select: { id: true, name: true, location: true } },
        _count: { select: { transactions: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.bankAccount.count({ where }),
  ]);

  // Summary stats
  const summary = await db.bankAccount.aggregate({
    where: { ...where, isActive: true },
    _sum: { currentBalance: true, openingBalance: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: accounts,
    summary: {
      totalBalance: summary._sum.currentBalance || 0,
      totalOpeningBalance: summary._sum.openingBalance || 0,
      activeAccounts: summary._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createBankAccountHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    bankName,
    accountName,
    accountNumber,
    branch,
    swiftCode,
    currency,
    openingBalance,
    accountType,
  } = body;

  if (!storeId || !bankName || !accountName || !accountNumber) {
    return Response.json(
      { success: false, error: 'storeId, bankName, accountName, and accountNumber are required.' },
      { status: 400 }
    );
  }

  const validTypes = ['CHECKING', 'SAVINGS', 'MPESA', 'PETTY_CASH'];
  const aType = accountType || 'CHECKING';
  if (!validTypes.includes(aType)) {
    return Response.json(
      { success: false, error: `Invalid accountType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  const balance = openingBalance ?? 0;

  const account = await db.bankAccount.create({
    data: {
      storeId,
      bankName,
      accountName,
      accountNumber,
      branch: branch || null,
      swiftCode: swiftCode || null,
      currency: currency || 'KES',
      openingBalance: parseFloat(String(balance)),
      currentBalance: parseFloat(String(balance)),
      accountType: aType,
      isActive: true,
    },
    include: {
      store: { select: { id: true, name: true, location: true } },
    },
  });

  await systemLog({
    action: 'BANK_ACCOUNT_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Bank account ${accountName} (${bankName}) created with balance ${balance}`,
    storeId,
    metadata: { bankAccountId: account.id, bankName, accountName, accountType: aType, openingBalance: balance },
  });

  return Response.json({ success: true, data: account }, { status: 201 });
}

export const GET = withErrorBoundary(getBankAccountsHandler, 'BANK_ACCOUNTS_LIST');
export const POST = withErrorBoundary(createBankAccountHandler, 'BANK_ACCOUNTS_CREATE');
