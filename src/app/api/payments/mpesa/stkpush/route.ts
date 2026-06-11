/**
 * MBUMAH HARDWARE POS - M-Pesa STK Push API
 * POST /api/payments/mpesa/stkpush - Initiate M-Pesa STK Push
 *
 * This route proxies to the M-Pesa mock service at localhost:3001
 * and records the STK push request in the database.
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

async function stkPushHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const {
    phoneNumber,
    amount,
    accountReference,
    transactionDesc,
    storeId,
    transactionId,
  } = body;

  if (!phoneNumber || !amount) {
    return Response.json(
      { success: false, error: 'phoneNumber and amount are required.' },
      { status: 400 }
    );
  }

  // Format phone number to 254 format
  let formattedPhone = phoneNumber.replace(/\s/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.substring(1);
  } else if (formattedPhone.startsWith('+')) {
    formattedPhone = formattedPhone.substring(1);
  }

  // Find or create the MpesaTransaction record
  let mpesaTransaction = null;
  if (storeId && transactionId) {
    mpesaTransaction = await db.mpesaTransaction.findFirst({
      where: { storeId, transactionId, status: 'PENDING' },
    });
  }

  try {
    // Call the M-Pesa mock service via XTransformPort pattern
    const mockResponse = await fetch('http://localhost:3001/api/mpesa/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: formattedPhone,
        amount: parseFloat(String(amount)),
        accountReference: accountReference || 'MBUMAH',
        transactionDesc: transactionDesc || 'Payment',
      }),
    });

    const mockData = await mockResponse.json();

    if (mpesaTransaction) {
      await db.mpesaTransaction.update({
        where: { id: mpesaTransaction.id },
        data: {
          checkoutRequestId: mockData.checkoutRequestId || mockData.CheckoutRequestID || null,
          merchantRequestId: mockData.merchantRequestId || mockData.MerchantRequestID || null,
          status: 'PROCESSING',
        },
      });
    }

    await systemLog({
      action: 'MPESA_STK_PUSH_INITIATED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.INFO,
      message: `M-Pesa STK Push initiated for ${formattedPhone}, amount KES ${amount}`,
      storeId: storeId || undefined,
      metadata: {
        phoneNumber: formattedPhone,
        amount,
        checkoutRequestId: mockData.checkoutRequestId || mockData.CheckoutRequestID,
        transactionId,
      },
    });

    return Response.json({
      success: true,
      data: {
        checkoutRequestId: mockData.checkoutRequestId || mockData.CheckoutRequestID,
        merchantRequestId: mockData.merchantRequestId || mockData.MerchantRequestID,
        responseCode: mockData.responseCode || mockData.ResponseCode || '0',
        responseDescription: mockData.responseDescription || mockData.ResponseDescription || 'Success',
        status: 'PROCESSING',
      },
    });
  } catch (error) {
    // If mock service is unavailable, simulate a successful STK push
    const simulatedCheckoutId = `sim_ck_${Date.now()}`;
    const simulatedMerchantId = `sim_mk_${Date.now()}`;

    if (mpesaTransaction) {
      await db.mpesaTransaction.update({
        where: { id: mpesaTransaction.id },
        data: {
          checkoutRequestId: simulatedCheckoutId,
          merchantRequestId: simulatedMerchantId,
          status: 'PROCESSING',
        },
      });
    }

    await systemLog({
      action: 'MPESA_STK_PUSH_SIMULATED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.WARN,
      message: `M-Pesa mock service unavailable. Simulated STK Push for ${formattedPhone}`,
      storeId: storeId || undefined,
      metadata: {
        phoneNumber: formattedPhone,
        amount,
        checkoutRequestId: simulatedCheckoutId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return Response.json({
      success: true,
      data: {
        checkoutRequestId: simulatedCheckoutId,
        merchantRequestId: simulatedMerchantId,
        responseCode: '0',
        responseDescription: 'Simulated STK Push (mock service unavailable)',
        status: 'PROCESSING',
      },
    });
  }
}

export const POST = withErrorBoundary(stkPushHandler, 'MPESA_STK_PUSH');
