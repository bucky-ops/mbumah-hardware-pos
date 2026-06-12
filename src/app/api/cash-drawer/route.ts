/**
 * MBUMAH HARDWARE - Cash Drawer API
 * GET /api/cash-drawer - List cash drawer events with filters
 * POST /api/cash-drawer - Record a cash drawer event (OPEN, CLOSE, CASH_IN, CASH_OUT)
 *
 * POST creates: CashDrawerLog entry + JournalEntry for CASH_IN/CASH_OUT
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent } from '@/lib/types';

const VALID_DRAWER_ACTIONS = ['OPEN', 'CLOSE', 'CASH_IN', 'CASH_OUT'];

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

  // Get current drawer balance
  const latestEntry = await db.cashDrawerLog.findFirst({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
    select: { balance: true },
  });

  // Calculate summary for the filtered period
  const summaryData = await db.cashDrawerLog.findMany({
    where,
    select: { action: true, amount: true },
  });

  const summary = {
    currentBalance: latestEntry?.balance || 0,
    totalCashIn: summaryData
      .filter((e) => ['CASH_IN', 'OPEN', 'SALE'].includes(e.action))
      .reduce((sum, e) => sum + e.amount, 0),
    totalCashOut: summaryData
      .filter((e) => ['CASH_OUT', 'REFUND'].includes(e.action))
      .reduce((sum, e) => sum + e.amount, 0),
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

  // Validate required fields
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

  // Verify the user exists
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    return Response.json(
      { success: false, error: 'Invalid or inactive user.' },
      { status: 400 }
    );
  }

  // Get current balance
  const lastEntry = await db.cashDrawerLog.findFirst({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
  });
  const currentBalance = lastEntry?.balance || 0;

  // Calculate new balance based on event type
  let newBalance = currentBalance;
  switch (eventType) {
    case 'OPEN':
    case 'CASH_IN':
      newBalance = currentBalance + parsedAmount;
      break;
    case 'CLOSE':
    case 'CASH_OUT':
      newBalance = currentBalance - parsedAmount;
      if (newBalance < 0) {
        return Response.json(
          { success: false, error: `Insufficient cash drawer balance. Current: KES ${currentBalance.toLocaleString()}, Requested: KES ${parsedAmount.toLocaleString()}` },
          { status: 400 }
        );
      }
      break;
  }

  // Create the cash drawer log entry
  const logEntry = await db.cashDrawerLog.create({
    data: {
      storeId,
      userId,
      action: eventType,
      amount: parsedAmount,
      balance: newBalance,
      notes: notes || null,
    },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      store: { select: { id: true, name: true, location: true } },
    },
  });

  // Create journal entry for CASH_IN and CASH_OUT events
  if ((eventType === 'CASH_IN' || eventType === 'CASH_OUT') && parsedAmount > 0) {
    try {
      const orgId = user.organizationId;
      const accounts = await getAccountIds(orgId, [
        ACCOUNT_CODES.CASH_ON_HAND,
        ACCOUNT_CODES.OWNER_EQUITY,
      ]);

      const jeNumber = generateJournalEntryNumber();

      if (eventType === 'CASH_IN') {
        // Cash added to drawer: Debit Cash, Credit Owner's Equity
        await db.journalEntry.create({
          data: {
            storeId,
            entryNumber: jeNumber,
            description: `Cash drawer - CASH IN: ${notes || 'Cash added to drawer'}`,
            referenceType: 'ADJUSTMENT',
            referenceId: logEntry.id,
            totalDebit: parsedAmount,
            totalCredit: parsedAmount,
            isPosted: true,
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: [
                {
                  accountId: accounts.CASH_ON_HAND,
                  debit: parsedAmount,
                  credit: 0,
                  description: `Cash added to drawer`,
                },
                {
                  accountId: accounts.OWNER_EQUITY,
                  debit: 0,
                  credit: parsedAmount,
                  description: `Owner equity - cash injection`,
                },
              ],
            },
          },
        });
      } else {
        // Cash removed from drawer: Debit Owner's Equity, Credit Cash
        await db.journalEntry.create({
          data: {
            storeId,
            entryNumber: jeNumber,
            description: `Cash drawer - CASH OUT: ${notes || 'Cash removed from drawer'}`,
            referenceType: 'ADJUSTMENT',
            referenceId: logEntry.id,
            totalDebit: parsedAmount,
            totalCredit: parsedAmount,
            isPosted: true,
            postedAt: new Date(),
            createdBy: userId,
            lines: {
              create: [
                {
                  accountId: accounts.OWNER_EQUITY,
                  debit: parsedAmount,
                  credit: 0,
                  description: `Owner draw - cash removed from drawer`,
                },
                {
                  accountId: accounts.CASH_ON_HAND,
                  debit: 0,
                  credit: parsedAmount,
                  description: `Cash removed from drawer`,
                },
              ],
            },
          },
        });
      }
    } catch (error) {
      // Journal entry creation failure should not block the drawer log
      console.error('Failed to create journal entry for cash drawer event:', error);
    }
  }

  await systemLog({
    action: 'CASH_DRAWER_EVENT',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Cash drawer ${eventType}: KES ${parsedAmount.toLocaleString()} by ${user.name}. New balance: KES ${newBalance.toLocaleString()}`,
    storeId,
    userId,
    metadata: {
      logId: logEntry.id,
      eventType,
      amount: parsedAmount,
      previousBalance: currentBalance,
      newBalance,
    },
  });

  return Response.json({ success: true, data: logEntry }, { status: 201 });
}

export const GET = withErrorBoundary(getCashDrawerHandler, 'CASH_DRAWER_LIST');
export const POST = withErrorBoundary(createCashDrawerHandler, 'CASH_DRAWER_CREATE');
