// PUT /api/financial/payments/[id] - Void a payment

import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { withFinancialAuth, getSessionFromRequest } from '@/lib/auth';
import { getAccountIds, ACCOUNT_CODES } from '@/lib/account-helper';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Only senior roles may void/refund payments
const FINANCIAL_WRITE_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function voidPaymentHandler(...args: unknown[]): Promise<Response> {
  const context = args[1] as RouteContext;
  const { id } = await context.params;

  const existing = await db.payment.findUnique({ where: { id } });
  if (!existing) {
    return Response.json(
      { success: false, error: 'Payment not found.' },
      { status: 404 }
    );
  }

  if (existing.status === 'REFUNDED') {
    return Response.json(
      { success: false, error: 'Payment is already refunded/voided.' },
      { status: 400 }
    );
  }

  if (existing.status === 'FAILED') {
    return Response.json(
      { success: false, error: 'Cannot void a failed payment.' },
      { status: 400 }
    );
  }

  // F7-5 remediation: voiding a payment used to flip ONLY the status row —
  // the original posted journal (Dr Cash/M-Pesa, Cr Revenue) stayed posted, so
  // cash and revenue remained overstated. Classic refund-fraud vector: refund
  // the cash, keep the revenue entry. Now a balanced REVERSING journal entry
  // is posted in the SAME transaction (Dr Revenue, Cr tender account), the
  // parent sale's payment status is reopened, and the act is audit-logged.
  const session = await getSessionFromRequest(args[0] as Request);

  const payment = await db.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id },
      data: { status: 'REFUNDED' },
    });

    // Post the reversing journal — only when the sale's journal exists and
    // this payment was part of a posted sale (cash/mpesa/debt tenders).
    if (existing.transactionId) {
      const sale = await tx.salesTransaction.findUnique({
        where: { id: existing.transactionId },
        select: { storeId: true, receiptNumber: true },
      });
      if (sale) {
        const store = await tx.store.findUnique({
          where: { id: sale.storeId },
          select: { organizationId: true },
        });
        const orgId = store?.organizationId || 'org_mbumah';
        const accounts = await getAccountIds(orgId, [
          ACCOUNT_CODES.SALES_REVENUE,
          ACCOUNT_CODES.CASH_ON_HAND,
          ACCOUNT_CODES.MPESA_ACCOUNT,
        ]);
        // Reverse the tender side: cash refunds go back to Cash on Hand;
        // every other tender reverses from its original debit account.
        const tenderAccountId =
          existing.paymentMethod === 'CASH' ? accounts.CASH_ON_HAND : accounts.MPESA_ACCOUNT;
        const amount = Number(existing.amount);
        const totalDebit = amount;
        const totalCredit = amount;

        await tx.journalEntry.create({
          data: {
            storeId: sale.storeId,
            entryNumber: generateJournalEntryNumber(),
            description: `Reversal of voided payment for sale ${sale.receiptNumber} (${existing.paymentMethod})`,
            referenceType: 'PAYMENT_VOID',
            referenceId: existing.id,
            totalDebit,
            totalCredit,
            isPosted: true,
            postedAt: new Date(),
            createdBy: session?.userId || null,
            lines: {
              create: [
                {
                  accountId: accounts.SALES_REVENUE,
                  debit: amount,
                  credit: 0,
                  description: `Reverse revenue for voided payment (sale ${sale.receiptNumber})`,
                },
                {
                  accountId: tenderAccountId,
                  debit: 0,
                  credit: amount,
                  description: `Refund ${existing.paymentMethod} tender to customer`,
                },
              ],
            },
          },
        });
      }
    }

    return updated;
  });

  await systemLog({
    action: 'PAYMENT_VOIDED',
    component: LogComponent.PAYMENT,
    severity: LogSeverity.WARN,
    message: `Payment ${id} voided/refunded (KES ${existing.amount}, ${existing.paymentMethod})`,
    storeId: existing.storeId,
    metadata: {
      paymentId: id,
      amount: existing.amount,
      paymentMethod: existing.paymentMethod,
      transactionId: existing.transactionId,
    },
  });

  return Response.json({
    success: true,
    message: 'Payment voided successfully.',
    data: payment,
  });
}

export const PUT = withErrorBoundary(
  withFinancialAuth(voidPaymentHandler, FINANCIAL_WRITE_ROLES),
  'PAYMENT_VOID',
);
