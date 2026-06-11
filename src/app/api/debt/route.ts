/**
 * MBUMAH HARDWARE POS - Debt Management API
 * GET /api/debt - List debt ledgers with filtering
 * POST /api/debt - Record a debt payment
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber, calculateAgingBucket } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, DebtStatus } from '@/lib/types';

async function getDebtHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const status = searchParams.get('status') || '';
  const customerId = searchParams.get('customerId') || '';
  const agingBucket = searchParams.get('agingBucket') || '';
  const overdue = searchParams.get('overdue') === 'true';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const sortBy = searchParams.get('sortBy') || 'dueDate';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  const where: Record<string, unknown> = { storeId };

  if (status) {
    where.status = status;
  } else if (!overdue) {
    // By default, show only non-settled debts
    where.status = { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] };
  }

  if (customerId) {
    where.customerId = customerId;
  }

  if (agingBucket) {
    where.agingBucket = agingBucket;
  }

  if (overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { in: ['OUTSTANDING', 'PARTIAL'] };
  }

  const validSortFields = ['dueDate', 'balance', 'amountOwed', 'createdAt', 'status'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'dueDate';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [debts, total] = await Promise.all([
    db.debtLedger.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true, debtLimit: true, currentDebtBalance: true } },
        transaction: { select: { id: true, receiptNumber: true, totalAmount: true, createdAt: true } },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.debtLedger.count({ where }),
  ]);

  // Calculate summary
  const allDebts = await db.debtLedger.findMany({
    where: { storeId, status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] } },
    select: { balance: true, agingBucket: true },
  });

  const summary = {
    totalOutstanding: allDebts.reduce((sum, d) => sum + d.balance, 0),
    countOutstanding: allDebts.length,
    byAgingBucket: {
      CURRENT: allDebts.filter((d) => d.agingBucket === 'CURRENT').reduce((sum, d) => sum + d.balance, 0),
      DAYS_30: allDebts.filter((d) => d.agingBucket === 'DAYS_30').reduce((sum, d) => sum + d.balance, 0),
      DAYS_60: allDebts.filter((d) => d.agingBucket === 'DAYS_60').reduce((sum, d) => sum + d.balance, 0),
      DAYS_90_PLUS: allDebts.filter((d) => d.agingBucket === 'DAYS_90_PLUS').reduce((sum, d) => sum + d.balance, 0),
    },
  };

  return Response.json({
    success: true,
    data: debts,
    summary,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function recordDebtPaymentHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    storeId,
    debtLedgerId,
    amount,
    paymentMethod,
    reference,
    receivedBy,
    notes,
  } = body;

  if (!storeId || !debtLedgerId || !amount || !paymentMethod) {
    return Response.json(
      { success: false, error: 'storeId, debtLedgerId, amount, and paymentMethod are required.' },
      { status: 400 }
    );
  }

  const paymentAmount = parseFloat(String(amount));

  if (paymentAmount <= 0) {
    return Response.json(
      { success: false, error: 'Payment amount must be greater than zero.' },
      { status: 400 }
    );
  }

  const debt = await db.debtLedger.findUnique({
    where: { id: debtLedgerId },
    include: {
      customer: true,
      transaction: true,
    },
  });

  if (!debt) {
    return Response.json(
      { success: false, error: 'Debt ledger entry not found.' },
      { status: 404 }
    );
  }

  if (debt.status === 'SETTLED' || debt.status === 'WRITTEN_OFF') {
    return Response.json(
      { success: false, error: `Cannot record payment on a ${debt.status.toLowerCase()} debt.` },
      { status: 400 }
    );
  }

  if (paymentAmount > debt.balance) {
    return Response.json(
      { success: false, error: `Payment amount (KES ${paymentAmount.toLocaleString()}) exceeds outstanding balance (KES ${debt.balance.toLocaleString()}).` },
      { status: 400 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    const newAmountPaid = debt.amountPaid + paymentAmount;
    const newBalance = debt.amountOwed - newAmountPaid;

    let newStatus: string;
    if (newBalance <= 0) {
      newStatus = DebtStatus.SETTLED;
    } else if (newAmountPaid > 0) {
      newStatus = DebtStatus.PARTIAL;
    } else {
      newStatus = debt.status;
    }

    const newAgingBucket = calculateAgingBucket(debt.dueDate);

    // Update the debt ledger
    const updatedDebt = await tx.debtLedger.update({
      where: { id: debtLedgerId },
      data: {
        amountPaid: newAmountPaid,
        balance: Math.max(0, newBalance),
        status: newStatus,
        agingBucket: newAgingBucket,
        notes: notes ? `${debt.notes || ''}\n${notes}` : debt.notes,
      },
    });

    // Create debt payment record
    await tx.debtPayment.create({
      data: {
        storeId,
        debtLedgerId,
        amount: paymentAmount,
        paymentMethod,
        reference: reference || null,
        receivedBy: receivedBy || null,
      },
    });

    // Update customer debt balance
    await tx.customer.update({
      where: { id: debt.customerId },
      data: { currentDebtBalance: { decrement: paymentAmount } },
    });

    // Record payment in cash drawer if CASH
    if (paymentMethod === 'CASH') {
      const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
      });
      const currentBalance = lastDrawerEntry?.balance || 0;

      await tx.cashDrawerLog.create({
        data: {
          storeId,
          userId: receivedBy || 'system',
          action: 'CASH_IN',
          amount: paymentAmount,
          balance: currentBalance + paymentAmount,
          notes: `Debt payment from ${debt.customer.name}`,
        },
      });
    }

    // Create journal entries for debt payment
    const jeNumber = generateJournalEntryNumber();

    // Resolve account IDs dynamically
    const store = await tx.store.findUnique({ where: { id: storeId }, select: { organizationId: true } });
    const orgId = store?.organizationId || 'org_mbumah';
    const accounts = await getAccountIds(orgId, [
      ACCOUNT_CODES.CASH_ON_HAND,
      ACCOUNT_CODES.MPESA_ACCOUNT,
      ACCOUNT_CODES.ACCOUNTS_RECEIVABLE,
    ]);
    const cashAccountId = paymentMethod === 'CASH' ? accounts.CASH_ON_HAND : accounts.MPESA_ACCOUNT;

    await tx.journalEntry.create({
      data: {
        storeId,
        entryNumber: jeNumber,
        description: `Debt payment received from ${debt.customer.name} - KES ${paymentAmount.toLocaleString()}`,
        referenceType: 'DEBT_PAYMENT',
        referenceId: debtLedgerId,
        totalDebit: paymentAmount,
        totalCredit: paymentAmount,
        isPosted: true,
        postedAt: new Date(),
        createdBy: receivedBy || null,
        lines: {
          create: [
            {
              accountId: cashAccountId,
              debit: paymentAmount,
              credit: 0,
              description: `Debt payment received - ${paymentMethod}`,
            },
            {
              accountId: accounts.ACCOUNTS_RECEIVABLE,
              debit: 0,
              credit: paymentAmount,
              description: `Reduce accounts receivable for ${debt.customer.name}`,
            },
          ],
        },
      },
    });

    return updatedDebt;
  });

  await systemLog({
    action: 'DEBT_PAYMENT_RECORDED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Debt payment of KES ${paymentAmount.toLocaleString()} recorded for ${debt.customer.name}`,
    storeId,
    userId: receivedBy || undefined,
    metadata: {
      debtLedgerId,
      amount: paymentAmount,
      paymentMethod,
      customerId: debt.customerId,
      newBalance: result.balance,
      newStatus: result.status,
    },
  });

  return Response.json({ success: true, data: result });
}

export const GET = withErrorBoundary(getDebtHandler, 'DEBT_LIST');
export const POST = withErrorBoundary(recordDebtPaymentHandler, 'DEBT_PAYMENT');
