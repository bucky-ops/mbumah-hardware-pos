// GET/POST /api/banking/transactions

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
// Task 12-c: canonical financial math (toDec/round2, HALF_UP 2dp). Prisma
// Decimal `valueOf()` returns a STRING, so the previous
// `newBalance += parseFloat(...)` on `account.currentBalance` silently
// STRING-CONCATENATED ("1000.00" + 5 → "1000.005") into the ledger.
import { toDec, toNum, round2 } from '@/lib/utils/financialMath';

// Typed in-transaction failure for the conditional WITHDRAWAL claim (count 0).
// Caught in the handler and surfaced as the client-facing 400 — a failed
// overdraw attempt is a normal user error, not a server fault (same pattern
// as CreditLimitExceededError in src/app/api/transactions/route.ts).
class InsufficientFundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export const dynamic = 'force-dynamic';

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

  // Task 12-c: NaN-guarded numeric coercion. `amount` is body input (may be
  // number or numeric string); toDec() maps garbage/NaN → 0, which the > 0
  // check below rejects. (Previously NaN slipped through `!amount` truthiness
  // and `NaN <= 0` and was written to the ledger.)
  const amtDec = toDec(amount);
  if (!bankAccountId || amount === undefined || amount === null || amount === '') {
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

  if (!amtDec.gt(0)) {
    return Response.json(
      { success: false, error: 'amount must be greater than 0.' },
      { status: 400 }
    );
  }
  // Money rounded HALF_UP to 2dp before it touches a Decimal column.
  const amountNum = round2(amtDec);
  // Compute direction ONCE: deposits/interest are inflows; everything else
  // (WITHDRAWAL, TRANSFER, FEE) is an outflow — same split as before.
  const isInflow = tType === 'DEPOSIT' || tType === 'INTEREST';

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

  // ── Task 12-c: ATOMIC ledger write ──────────────────────────────────────
  // The old flow read `account.currentBalance` OUTSIDE the transaction,
  // string-concatenated the amount onto the Prisma Decimal, then wrote the
  // absolute value back — corrupting the ledger AND racing concurrent
  // transactions (lost update). Now the balance moves via Prisma's atomic
  // increment/decrement inside the transaction, and the WITHDRAWAL-style
  // outflow claims the funds with a `gte` predicate so an overdraw can
  // never be committed (count 0 → typed 400). The ledger row's
  // `balanceAfter` is re-read from the post-mutation account row.
  let transaction;
  try {
    transaction = await db.$transaction(async (tx) => {
      if (isInflow) {
        await tx.bankAccount.updateMany({
          where: { id: bankAccountId },
          data: { currentBalance: { increment: amountNum } },
        });
      } else {
        // Conditional claim: balance check + decrement in ONE statement.
        const claimed = await tx.bankAccount.updateMany({
          where: { id: bankAccountId, currentBalance: { gte: amountNum } },
          data: { currentBalance: { decrement: amountNum } },
        });
        if (claimed.count === 0) {
          throw new InsufficientFundsError(
            `Insufficient funds. Balance: KES ${round2(bankAccount.currentBalance).toLocaleString()}, requested: KES ${amountNum.toLocaleString()}.`
          );
        }
      }

      // Re-read INSIDE the tx: authoritative post-mutation balance.
      const freshAccount = await tx.bankAccount.findUniqueOrThrow({
        where: { id: bankAccountId },
        select: { currentBalance: true },
      });
      const newBalance = round2(freshAccount.currentBalance);

      return await tx.bankTransaction.create({
        data: {
          bankAccountId,
          transactionType: tType,
          amount: amountNum,
          balanceAfter: newBalance,
          reference: reference || null,
          description: description || null,
          transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
          isReconciled: false,
        },
      });
    });
  } catch (err) {
    // Map the typed in-transaction overdraw failure to the client-facing 400.
    if (err instanceof InsufficientFundsError) {
      return Response.json(
        { success: false, error: err.message },
        { status: 400 }
      );
    }
    throw err;
  }

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
      amount: amountNum,
      // Task 12-c: the authoritative balance now lives on the ledger row's
      // balanceAfter (re-read post-mutation), not a stale tx-local variable.
      newBalance: toNum(transaction.balanceAfter),
    },
  });

  return Response.json({ success: true, data: transaction }, { status: 201 });
}

export const GET = withErrorBoundary(withSessionAuth(getBankTransactionsHandler, FINANCIAL_ROLES.WRITE), 'BANK_TRANSACTIONS_LIST');
export const POST = withErrorBoundary(withSessionAuth(createBankTransactionHandler, FINANCIAL_ROLES.WRITE), 'BANK_TRANSACTIONS_CREATE');
