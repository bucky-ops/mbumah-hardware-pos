// POST /api/payments/mpesa/stkpush (proxies to mock service at :3001)

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, AuthSession } from '@/lib/auth';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { maskSensitiveData } from '@/lib/security';
import { LogSeverity, LogComponent } from '@/lib/types';

async function stkPushHandler(request: NextRequest, session: AuthSession): Promise<Response> {
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

    let formattedPhone = phoneNumber.replace(/\s/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '254' + formattedPhone.substring(1);
  } else if (formattedPhone.startsWith('+')) {
    formattedPhone = formattedPhone.substring(1);
  }

    let mpesaTransaction: Awaited<ReturnType<typeof db.mpesaTransaction.findFirst>> | null = null;
  if (storeId && transactionId) {
    mpesaTransaction = await db.mpesaTransaction.findFirst({
      where: { storeId, transactionId, status: 'PENDING' },
    });
  }

  try {
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

    // L-02: mask phone numbers in logs to prevent PII leakage. The full phone
    // number is never needed for audit purposes — last 4 digits is enough to
    // correlate with support tickets and customer records.
    const maskedPhone = maskSensitiveData(formattedPhone, 'phone');
    await systemLog({
      action: 'MPESA_STK_PUSH_INITIATED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.INFO,
      message: `M-Pesa STK Push initiated for ${maskedPhone}, amount KES ${amount}`,
      storeId: storeId || undefined,
      metadata: {
        phoneNumber: maskedPhone,
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

    // L-02: mask phone number before logging (avoid plaintext PII in logs).
    const maskedPhone = maskSensitiveData(formattedPhone, 'phone');
    await systemLog({
      action: 'MPESA_STK_PUSH_SIMULATED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.WARN,
      message: `M-Pesa mock service unavailable. Simulated STK Push for ${maskedPhone}`,
      storeId: storeId || undefined,
      metadata: {
        phoneNumber: maskedPhone,
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

export const POST = withErrorBoundary(requireAuth(stkPushHandler), 'MPESA_STK_PUSH');
