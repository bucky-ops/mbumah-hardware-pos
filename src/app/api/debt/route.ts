// GET/POST /api/debt

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber, calculateAgingBucket } from '@/lib/helpers';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, DebtStatus } from '@/lib/types';
import { withSessionAuth, FINANCIAL_ROLES, getSessionFromRequest } from '@/lib/auth';
// Task 12-c: canonical financial math. Prisma Decimal `valueOf()` returns a
// STRING — the summary reduce `sum + d.balance` used to STRING-CONCATENATE
// (0 + Decimal("123.45") → "0123.45").
import { toDec, round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

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

  // Task 12-c: Decimal accumulators (was float `sum + d.balance` string-concat
  // over Prisma Decimals); HALF_UP 2dp at emit.
  const sumByBucket: Record<string, ReturnType<typeof toDec>> = {
    CURRENT: toDec(0),
    DAYS_30: toDec(0),
    DAYS_60: toDec(0),
    DAYS_90_PLUS: toDec(0),
  };
  let totalOutstandingDec = toDec(0);
  for (const d of allDebts) {
    const bal = toDec(d.balance);
    totalOutstandingDec = totalOutstandingDec.plus(bal);
    if (sumByBucket[d.agingBucket]) {
      sumByBucket[d.agingBucket] = sumByBucket[d.agingBucket].plus(bal);
    }
  }

  const summary = {
    totalOutstanding: round2(totalOutstandingDec),
    countOutstanding: allDebts.length,
    byAgingBucket: {
      CURRENT: round2(sumByBucket.CURRENT),
      DAYS_30: round2(sumByBucket.DAYS_30),
      DAYS_60: round2(sumByBucket.DAYS_60),
      DAYS_90_PLUS: round2(sumByBucket.DAYS_90_PLUS),
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
    notes: _bodyNotes, // notes intentionally not persisted to ledger after R3 rework
  } = body;

  // SYS-2: the receiving actor ALWAYS comes from the authenticated session —
  // a body-supplied `receivedBy` allowed payments to be attributed to anyone.
  const session = await getSessionFromRequest(request);
  const receivedBy = session?.userId ?? null;

  // F9 (journal integrity): only tender methods backed by a real asset
  // account are accepted — arbitrary strings used to debit whichever
  // account the journal mapping resolved to.
  if (!['CASH', 'MPESA'].includes(paymentMethod)) {
    return Response.json(
      { success: false, error: 'paymentMethod must be CASH or MPESA for debt payments.' },
      { status: 400 }
    );
  }

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

  // SYS-3 (cross-tenant): a debt ledger from another store can no longer be
  // paid by supplying a foreign debtLedgerId with a local storeId.
  if (debt.storeId !== storeId) {
    return Response.json(
      { success: false, error: 'Debt ledger does not belong to this store.' },
      { status: 403 }
    );
  }

  if (debt.status === 'SETTLED' || debt.status === 'WRITTEN_OFF') {
    return Response.json(
      { success: false, error: `Cannot record payment on a ${debt.status.toLowerCase()} debt.` },
      { status: 400 }
    );
  }

  // Task 12-c: exact Decimal comparison (was `paymentAmount > debt.balance`,
  // a float-vs-Prisma-Decimal comparison that coerced through valueOf()).
  if (toDec(paymentAmount).gt(debt.balance)) {
    return Response.json(
      { success: false, error: `Payment amount (KES ${paymentAmount.toLocaleString()}) exceeds outstanding balance (KES ${debt.balance.toLocaleString()}).` },
      { status: 400 }
    );
  }

  const result = await db.$transaction(async (tx) => {
    // R3 remediation: ATOMIC conditional claim. The old code computed
    // `amountPaid + payment` from a STALE pre-transaction read — two
    // concurrent submissions (double-click) both passed the balance check
    // and both wrote, collecting cash twice. The `gte` predicate makes the
    // balance check + decrement one atomic operation; the loser aborts.
    const claimed = await tx.debtLedger.updateMany({
      where: {
        id: debtLedgerId,
        status: { notIn: ['SETTLED', 'WRITTEN_OFF'] },
        balance: { gte: paymentAmount },
      },
      data: {
        amountPaid: { increment: paymentAmount },
        balance: { decrement: paymentAmount },
      },
    });
    if (claimed.count === 0) {
      throw new Error(
        'Debt payment conflict: balance changed or already settled. Refresh and retry.'
      );
    }

    // Re-read INSIDE the tx for the authoritative post-claim state.
    const updatedDebt = await tx.debtLedger.findUniqueOrThrow({
      where: { id: debtLedgerId },
    });
    const newAmountPaid = Number(updatedDebt.amountPaid);
    const newBalance = Number(updatedDebt.balance);

    let newStatus: string;
    if (newBalance <= 0) {
      newStatus = DebtStatus.SETTLED;
    } else if (newAmountPaid > 0) {
      newStatus = DebtStatus.PARTIAL;
    } else {
      newStatus = debt.status;
    }

    const newAgingBucket = calculateAgingBucket(debt.dueDate);

    await tx.debtLedger.update({
      where: { id: debtLedgerId },
      data: { status: newStatus, agingBucket: newAgingBucket },
    });

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

        await tx.customer.update({
      where: { id: debt.customerId },
      data: { currentDebtBalance: { decrement: paymentAmount } },
    });

    // Record payment in cash drawer if CASH
    if (paymentMethod === 'CASH') {
      // R6 remediation: SUM-derived running balance (concurrency-safe).
      const drawerAgg = await tx.cashDrawerLog.aggregate({
        where: { storeId },
        _sum: { amount: true },
      });
      const currentBalance = Number(drawerAgg._sum.amount ?? 0);

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

        const jeNumber = generateJournalEntryNumber();

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

  // F9-1: tamper-evident audit entry for every debt payment (best-effort).
  try {
    const { auditTrail } = await import('@/lib/audit-trail');
    await auditTrail.log({
      action: 'CREATE',
      resourceType: 'DebtPayment',
      resourceId: String(result?.id || debtLedgerId),
      actorId: receivedBy || 'system',
      storeId,
      // AUDIT FIX: referenced out-of-scope `newBalance` (tx-local variable)
      // → ReferenceError silently swallowed by the empty catch. Use the
      // actual post-payment balance returned by the transaction (`result` is
      // the updated DebtLedger row) so the audit trail records the truth.
      newValues: { debtLedgerId, amount: paymentAmount, paymentMethod, balanceAfter: Number(result.balance) },
    });
  } catch (error) {
    // AUDIT FIX: audit chain still must never block payment recording,
    // but the swallow is no longer silent.
    console.error('Failed to write tamper-evident audit entry for debt payment:', error);
  }

  return Response.json({ success: true, data: result });
}

export const GET = withErrorBoundary(withSessionAuth(getDebtHandler, FINANCIAL_ROLES.WRITE), 'DEBT_LIST');
export const POST = withErrorBoundary(withSessionAuth(recordDebtPaymentHandler, FINANCIAL_ROLES.WRITE), 'DEBT_PAYMENT');
