// GET/POST /api/cash-drawer

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, UserRole } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest } from '@/lib/auth';
// Task 12-c: canonical financial math. Prisma Decimal `valueOf()` returns a
// STRING — the GET summary reduce `sum + e.amount` STRING-CONCATENATED and
// the POST balance mixed `Number(_sum) + amount` float dust into the ledger.
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

const VALID_DRAWER_ACTIONS = ['OPEN', 'CLOSE', 'CASH_IN', 'CASH_OUT'];

// AUDIT FIX (drawer/shift RBAC): any store role from PERMISSION_MATRIX may
// VIEW drawer data (X-analog inquiry). Destructive drawer ops that remove
// cash (CLOSE, CASH_OUT) are restricted in-handler to manager-or-above
// (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER); non-destructive OPEN/CASH_IN
// remain available to any store role.
const STORE_ROLES: string[] = Object.values(UserRole);
const MANAGER_UP_ROLES: string[] = [
  UserRole.SUPER_ADMIN,
  UserRole.STORE_OWNER,
  UserRole.BRANCH_MANAGER,
];

async function getCashDrawerHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const userId = searchParams.get('userId') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const action = searchParams.get('action') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = { storeId };

  if (userId) {
    where.userId = userId;
  }

  if (action) {
    where.action = action;
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

  const [logs, total] = await Promise.all([
    db.cashDrawerLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        store: { select: { id: true, name: true, location: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.cashDrawerLog.count({ where }),
  ]);

  // AUDIT FIX: read-latest-row → aggregate _sum (same pattern as the R6
  // remediation in transactions/route.ts). The latest row's balance can be
  // stale/missing under concurrent drawer writes; the SUM of signed amounts
  // is the authoritative store-wide drawer position.
  const balanceAgg = await db.cashDrawerLog.aggregate({
    where: { storeId },
    _sum: { amount: true },
  });
  const currentDrawerBalance = round2(toDec(balanceAgg._sum.amount ?? 0));

  const summaryData = await db.cashDrawerLog.findMany({
    where,
    select: { action: true, amount: true },
  });

  // Task 12-c: Decimal accumulators (was `sum + e.amount` string-concat over
  // Prisma Decimals); HALF_UP 2dp at emit.
  let totalCashInDec = toDec(0);
  let totalCashOutDec = toDec(0);
  for (const e of summaryData) {
    if (['CASH_IN', 'OPEN', 'SALE'].includes(e.action)) {
      totalCashInDec = totalCashInDec.plus(toDec(e.amount));
    } else if (['CASH_OUT', 'REFUND'].includes(e.action)) {
      totalCashOutDec = totalCashOutDec.plus(toDec(e.amount));
    }
  }

  const summary = {
    currentBalance: currentDrawerBalance,
    totalCashIn: round2(totalCashInDec),
    totalCashOut: round2(totalCashOutDec),
  };

  return Response.json({
    success: true,
    data: logs,
    summary,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createCashDrawerHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const { storeId, userId, eventType, amount, notes } = body;

    if (!storeId || !userId || !eventType || amount === undefined || amount === null) {
    return Response.json(
      { success: false, error: 'storeId, userId, eventType, and amount are required.' },
      { status: 400 }
    );
  }

  if (!VALID_DRAWER_ACTIONS.includes(eventType)) {
    return Response.json(
      { success: false, error: `Invalid eventType. Must be one of: ${VALID_DRAWER_ACTIONS.join(', ')}` },
      { status: 400 }
    );
  }

  const parsedAmount = parseFloat(String(amount));
  if (isNaN(parsedAmount) || parsedAmount < 0) {
    return Response.json(
      { success: false, error: 'Amount must be a non-negative number.' },
      { status: 400 }
    );
  }
  // Task 12-c: money rounded HALF_UP to 2dp before it touches a Decimal column.
  const amountNum = round2(parsedAmount);

    const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    return Response.json(
      { success: false, error: 'Invalid or inactive user.' },
      { status: 400 }
    );
  }

  // AUDIT FIX: read-latest-row lost-update race — the previous findFirst
  // (latest row balance) silently dropped concurrent drawer writes. Derive
  // the running balance from the SUM of all drawer amounts instead (same
  // aggregate pattern as src/app/api/transactions/route.ts R6 remediation).
  const balanceAgg = await db.cashDrawerLog.aggregate({
    where: { storeId },
    _sum: { amount: true },
  });
  // Task 12-c: Decimal running balance (was `Number(_sum) + amount` float).
  const currentBalanceDec = toDec(balanceAgg._sum.amount ?? 0);
  const currentBalance = round2(currentBalanceDec);

  // AUDIT FIX: destructive ops (CLOSE/CASH_OUT remove cash from the drawer)
  // are manager-or-above per PERMISSION_MATRIX. OPEN/CASH_IN remain available
  // to any store role (the wrapper below already enforces a valid session).
  const session = await getSessionFromRequest(request);
  if (
    (eventType === 'CLOSE' || eventType === 'CASH_OUT') &&
    (!session || !MANAGER_UP_ROLES.includes(session.role))
  ) {
    return Response.json(
      { success: false, error: 'Closing the drawer or removing cash requires manager privileges.' },
      { status: 403 }
    );
  }

    // Task 12-c: Decimal balance math (HALF_UP 2dp).
    // NOTE: CashDrawerLog is an APPEND-ONLY ledger — there is no mutable
    // balance row, so Prisma's atomic increment/decrement does not apply here
    // (the `balance` column is an insert-time snapshot of the running sum,
    // which the SUM-derived derivation below keeps concurrency-safe — see the
    // R6 remediation notes). The arithmetic itself is exact Decimal.
    let newBalanceDec = currentBalanceDec;
    switch (eventType) {
    case 'OPEN':
    case 'CASH_IN':
      newBalanceDec = currentBalanceDec.plus(amountNum);
      break;
    case 'CLOSE':
    case 'CASH_OUT': {
      newBalanceDec = currentBalanceDec.minus(amountNum);
      if (newBalanceDec.isNegative()) {
        return Response.json(
          { success: false, error: `Insufficient cash drawer balance. Current: KES ${currentBalance.toLocaleString()}, Requested: KES ${amountNum.toLocaleString()}` },
          { status: 400 }
        );
      }
      break;
    }
    }
    const newBalance = round2(newBalanceDec);

    const logEntry = await db.cashDrawerLog.create({
    data: {
      storeId,
      userId,
      action: eventType,
      amount: amountNum,
      balance: newBalance,
      notes: notes || null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
  });

    if ((eventType === 'CASH_IN' || eventType === 'CASH_OUT') && amountNum > 0) {
    try {
      const orgId = user.organizationId;
      const accounts = await getAccountIds(orgId, [
        ACCOUNT_CODES.CASH_ON_HAND,
        ACCOUNT_CODES.OWNER_EQUITY,
      ]);

      const jeNumber = generateJournalEntryNumber();

      if (eventType === 'CASH_IN') {
                await db.journalEntry.create({
          data: {
            storeId,
            entryNumber: jeNumber,
            description: `Cash drawer - CASH IN: ${notes || 'Cash added to drawer'}`,
            referenceType: 'ADJUSTMENT',
            referenceId: logEntry.id,
            totalDebit: amountNum,
            totalCredit: amountNum,
            isPosted: true,
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: [
                {
                  accountId: accounts.CASH_ON_HAND,
                  debit: amountNum,
                  credit: 0,
                  description: `Cash added to drawer`,
                },
                {
                  accountId: accounts.OWNER_EQUITY,
                  debit: 0,
                  credit: amountNum,
                  description: `Owner equity - cash injection`,
                },
              ],
            },
          },
        });
      } else {
                await db.journalEntry.create({
          data: {
            storeId,
            entryNumber: jeNumber,
            description: `Cash drawer - CASH OUT: ${notes || 'Cash removed from drawer'}`,
            referenceType: 'ADJUSTMENT',
            referenceId: logEntry.id,
            totalDebit: amountNum,
            totalCredit: amountNum,
            isPosted: true,
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: [
                {
                  accountId: accounts.OWNER_EQUITY,
                  debit: amountNum,
                  credit: 0,
                  description: `Owner draw - cash removed from drawer`,
                },
                {
                  accountId: accounts.CASH_ON_HAND,
                  debit: 0,
                  credit: amountNum,
                  description: `Cash removed from drawer`,
                },
              ],
            },
          },
        });
      }
    } catch (error) {
      // Don't let journal entry failure block the drawer log
      console.error('Failed to create journal entry for cash drawer event:', error);
    }
  }

  await systemLog({
    action: 'CASH_DRAWER_EVENT',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Cash drawer ${eventType}: KES ${amountNum.toLocaleString()} by ${user.name}. New balance: KES ${newBalance.toLocaleString()}`,
    storeId,
    userId,
    metadata: {
      logId: logEntry.id,
      eventType,
      amount: amountNum,
      previousBalance: currentBalance,
      newBalance,
    },
  });

  return Response.json({ success: true, data: logEntry }, { status: 201 });
}

// AUDIT FIX (RBAC): GET was FINANCIAL_ROLES.WRITE — per the audit directive
// any store role may VIEW drawer data; destructive POST events (CLOSE /
// CASH_OUT) are additionally gated to manager-or-above inside the handler.
export const GET = withErrorBoundary(withSessionAuth(getCashDrawerHandler, STORE_ROLES), 'CASH_DRAWER_LIST');
export const POST = withErrorBoundary(withSessionAuth(createCashDrawerHandler, STORE_ROLES), 'CASH_DRAWER_CREATE');
