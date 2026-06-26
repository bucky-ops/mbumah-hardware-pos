// GET/POST /api/banking/reconciliations

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function getBankReconciliationsHandler(...args: unknown[]): Promise<Response> {
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

  const status = searchParams.get('status');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = {};

  if (bankAccountId) {
    where.bankAccountId = bankAccountId;
  } else if (storeId) {
    where.bankAccount = { storeId };
  }

  if (status) {
    where.status = status;
  }

  if (dateFrom || dateTo) {
    const statementDate: Record<string, Date> = {};
    if (dateFrom) statementDate.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      statementDate.lte = to;
    }
    where.statementDate = statementDate;
  }

  const validSortFields = ['statementDate', 'createdAt', 'status', 'difference'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [reconciliations, total] = await Promise.all([
    db.bankReconciliation.findMany({
      where,
      include: {
        bankAccount: {
          select: { id: true, bankName: true, accountName: true, accountNumber: true, storeId: true, currentBalance: true },
        },
        transactions: {
          select: { id: true, transactionType: true, amount: true, reference: true, isReconciled: true },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.bankReconciliation.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: reconciliations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createBankReconciliationHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    bankAccountId,
    statementDate,
    statementBalance,
    bookBalance,
    notes,
    createdBy,
  } = body;

  if (!bankAccountId || !statementDate || statementBalance === undefined || bookBalance === undefined) {
    return Response.json(
      { success: false, error: 'bankAccountId, statementDate, statementBalance, and bookBalance are required.' },
      { status: 400 }
    );
  }

  const bankAccount = await db.bankAccount.findUnique({
    where: { id: bankAccountId },
  });

  if (!bankAccount) {
    return Response.json(
      { success: false, error: 'Bank account not found.' },
      { status: 404 }
    );
  }

  const difference = parseFloat(String(statementBalance)) - parseFloat(String(bookBalance));

  const reconciliation = await db.bankReconciliation.create({
    data: {
      bankAccountId,
      statementDate: new Date(statementDate),
      statementBalance: parseFloat(String(statementBalance)),
      bookBalance: parseFloat(String(bookBalance)),
      difference,
      status: 'DRAFT',
      notes: notes || null,
      createdBy: createdBy || null,
    },
    include: {
      bankAccount: {
        select: { id: true, bankName: true, accountName: true, accountNumber: true },
      },
    },
  });

  await systemLog({
    action: 'BANK_RECONCILIATION_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Bank reconciliation created for ${bankAccount.accountName} - difference: ${difference}`,
    storeId: bankAccount.storeId,
    userId: createdBy || undefined,
    metadata: {
      reconciliationId: reconciliation.id,
      bankAccountId,
      statementBalance,
      bookBalance,
      difference,
    },
  });

  return Response.json({ success: true, data: reconciliation }, { status: 201 });
}

export const GET = withErrorBoundary(getBankReconciliationsHandler, 'BANK_RECONCILIATIONS_LIST');
export const POST = withErrorBoundary(createBankReconciliationHandler, 'BANK_RECONCILIATIONS_CREATE');
