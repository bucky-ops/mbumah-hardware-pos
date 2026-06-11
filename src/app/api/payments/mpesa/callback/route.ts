/**
 * MBUMAH HARDWARE POS - M-Pesa Callback API
 * POST /api/payments/mpesa/callback - Handle M-Pesa callback notification
 *
 * Processes the M-Pesa STK Push callback result:
 * - Updates MpesaTransaction status
 * - Updates SalesTransaction payment status
 * - Creates cash drawer log for M-Pesa receipt
 * - Posts journal entries
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountId, ACCOUNT_CODES } from '@/lib/account-helper';
import { LogSeverity, LogComponent, PaymentStatus } from '@/lib/types';

interface MpesaCallbackBody {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string;
      MerchantRequestID?: string;
      ResultCode: number | string;
      ResultDesc: string;
      CallbackMetadata?: {
        Item?: Array<{
          Name: string;
          Value?: string | number;
        }>;
      };
    };
  };
  // Alternative flat format from mock
  checkoutRequestId?: string;
  merchantRequestId?: string;
  resultCode?: number | string;
  resultDesc?: string;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  phoneNumber?: string;
  amount?: number;
}

function extractCallbackData(body: MpesaCallbackBody) {
  // Handle Daraja API format
  if (body.Body?.stkCallback) {
    const stk = body.Body.stkCallback;
    const metadata: Record<string, unknown> = {};

    if (stk.CallbackMetadata?.Item) {
      for (const item of stk.CallbackMetadata.Item) {
        metadata[item.Name] = item.Value;
      }
    }

    return {
      checkoutRequestId: stk.CheckoutRequestID || '',
      merchantRequestId: stk.MerchantRequestID || '',
      resultCode: String(stk.ResultCode),
      resultDesc: stk.ResultDesc,
      mpesaReceiptNumber: (metadata.MpesaReceiptNumber as string) || '',
      transactionDate: (metadata.TransactionDate as string) || '',
      phoneNumber: (metadata.PhoneNumber as string) || '',
      amount: (metadata.Amount as number) || 0,
    };
  }

  // Handle flat format from mock service
  return {
    checkoutRequestId: body.checkoutRequestId || '',
    merchantRequestId: body.merchantRequestId || '',
    resultCode: String(body.resultCode ?? '0'),
    resultDesc: body.resultDesc || '',
    mpesaReceiptNumber: body.mpesaReceiptNumber || '',
    transactionDate: body.transactionDate || '',
    phoneNumber: body.phoneNumber || '',
    amount: body.amount || 0,
  };
}

async function mpesaCallbackHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body: MpesaCallbackBody = await request.json();

  const data = extractCallbackData(body);
  const isSuccess = data.resultCode === '0';

  // Find the MpesaTransaction by checkoutRequestId
  const mpesaTx = await db.mpesaTransaction.findFirst({
    where: {
      checkoutRequestId: data.checkoutRequestId,
    },
  });

  if (!mpesaTx) {
    await systemLog({
      action: 'MPESA_CALLBACK_NO_RECORD',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.WARN,
      message: `M-Pesa callback received but no matching transaction found for CheckoutRequestID: ${data.checkoutRequestId}`,
      metadata: { checkoutRequestId: data.checkoutRequestId, resultCode: data.resultCode },
    });

    return Response.json({ success: true, message: 'Callback received (no matching record).' });
  }

  if (isSuccess) {
    // Update MpesaTransaction as completed
    await db.mpesaTransaction.update({
      where: { id: mpesaTx.id },
      data: {
        status: 'COMPLETED',
        mpesaReceiptNumber: data.mpesaReceiptNumber,
        resultCode: data.resultCode,
        resultDesc: data.resultDesc,
        callbackReceived: true,
      },
    });

    // If linked to a SalesTransaction, update its payment status
    if (mpesaTx.transactionId) {
      await db.$transaction(async (tx) => {
        // Update SalesTransaction payment status
        await tx.salesTransaction.update({
          where: { id: mpesaTx.transactionId! },
          data: { paymentStatus: PaymentStatus.COMPLETED },
        });

        // Update Payment record
        await tx.payment.updateMany({
          where: {
            transactionId: mpesaTx.transactionId!,
            paymentMethod: 'MPESA',
          },
          data: {
            status: PaymentStatus.COMPLETED,
            reference: data.mpesaReceiptNumber,
          },
        });

        // Record in cash drawer
        const lastDrawerEntry = await tx.cashDrawerLog.findFirst({
          where: { storeId: mpesaTx.storeId },
          orderBy: { createdAt: 'desc' },
        });
        const currentBalance = lastDrawerEntry?.balance || 0;

        await tx.cashDrawerLog.create({
          data: {
            storeId: mpesaTx.storeId,
            userId: 'system',
            action: 'SALE',
            amount: mpesaTx.amount,
            balance: currentBalance + mpesaTx.amount,
            notes: `M-Pesa payment received - ${data.mpesaReceiptNumber}`,
          },
        });

        // Post the pending journal entries
        const pendingJE = await tx.journalEntry.findFirst({
          where: {
            referenceId: mpesaTx.transactionId!,
            referenceType: 'SALE',
            isPosted: false,
          },
        });

        if (pendingJE) {
          await tx.journalEntry.update({
            where: { id: pendingJE.id },
            data: {
              isPosted: true,
              postedAt: new Date(),
              description: pendingJE.description?.replace('(pending)', '(completed)') || pendingJE.description,
            },
          });

          // Change DR from M-Pesa Account to Cash on Hand (now that payment is confirmed)
          // Resolve account IDs dynamically
          const store = await tx.store.findUnique({ where: { id: mpesaTx.storeId }, select: { organizationId: true } });
          const orgId = store?.organizationId || 'org_mbumah';
          const mpesaAccountId = await getAccountId(orgId, ACCOUNT_CODES.MPESA_ACCOUNT);
          const cashAccountId = await getAccountId(orgId, ACCOUNT_CODES.CASH_ON_HAND);

          await tx.journalEntryLine.updateMany({
            where: {
              journalEntryId: pendingJE.id,
              accountId: mpesaAccountId,
              debit: { gt: 0 },
            },
            data: {
              accountId: cashAccountId,
            },
          });
        }
      });
    }

    await systemLog({
      action: 'MPESA_PAYMENT_COMPLETED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.INFO,
      message: `M-Pesa payment completed: ${data.mpesaReceiptNumber}, KES ${data.amount || mpesaTx.amount}`,
      storeId: mpesaTx.storeId,
      metadata: {
        mpesaReceiptNumber: data.mpesaReceiptNumber,
        amount: data.amount || mpesaTx.amount,
        phoneNumber: data.phoneNumber,
        transactionId: mpesaTx.transactionId,
      },
    });
  } else {
    // Payment failed
    await db.mpesaTransaction.update({
      where: { id: mpesaTx.id },
      data: {
        status: 'FAILED',
        resultCode: data.resultCode,
        resultDesc: data.resultDesc,
        callbackReceived: true,
      },
    });

    if (mpesaTx.transactionId) {
      await db.salesTransaction.update({
        where: { id: mpesaTx.transactionId },
        data: { paymentStatus: PaymentStatus.FAILED },
      });

      await db.payment.updateMany({
        where: {
          transactionId: mpesaTx.transactionId,
          paymentMethod: 'MPESA',
        },
        data: { status: PaymentStatus.FAILED },
      });
    }

    await systemLog({
      action: 'MPESA_PAYMENT_FAILED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.ERROR,
      message: `M-Pesa payment failed: ${data.resultDesc}`,
      storeId: mpesaTx.storeId,
      metadata: {
        resultCode: data.resultCode,
        resultDesc: data.resultDesc,
        checkoutRequestId: data.checkoutRequestId,
        transactionId: mpesaTx.transactionId,
      },
    });
  }

  return Response.json({ success: true, message: 'Callback processed successfully.' });
}

export const POST = withErrorBoundary(mpesaCallbackHandler, 'MPESA_CALLBACK');
