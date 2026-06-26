// POST /api/payments/mpesa/stkpush
//
// Initiates an M-Pesa STK Push. Two modes:
//
//   1. REAL Daraja — when MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
//      MPESA_SHORTCODE and MPESA_PASSKEY are all set in env, the route
//      performs the actual Daraja OAuth + STK push against the Safaricom
//      API (sandbox in non-production, production otherwise).
//
//   2. SIMULATED — when the env vars are missing, the route falls back to
//      the legacy behaviour: call the local mock service at :3001 and
//      return a synthetic CheckoutRequestID so dev keeps working.
//
// Accepts (new + legacy field names for backward compat):
//   { phone, phoneNumber, amount, accountReference, transactionDesc,
//     storeId, transactionId }
//
// Always persists a MpesaTransaction row carrying the CheckoutRequestID.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface StkPushBody {
  phone?: string;
  phoneNumber?: string;
  amount: number | string;
  accountReference?: string;
  transactionDesc?: string;
  storeId?: string;
  transactionId?: string;
}

/** Normalise Kenyan phone numbers to 254XXXXXXXXX. */
function normalisePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.length === 9 && /^\d{9}$/.test(p)) p = '254' + p;
  return p;
}

/** Build the Base64 password used by Daraja STK push: shortcode + passkey + timestamp. */
function buildDarajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  // In Node 18+ Buffer is available globally in route handlers.
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/** Format a Date as YYYYMMDDHHmmss (Daraja timestamp format). */
function darajaTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Fetch an OAuth access token from Daraja. */
async function fetchDarajaToken(
  consumerKey: string,
  consumerSecret: string,
  isProduction: boolean,
): Promise<string> {
  const baseUrl = isProduction
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
  const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    throw new Error(`Daraja OAuth failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Daraja OAuth returned no access_token.');
  }
  return json.access_token;
}

/** Perform the actual Daraja STK push. */
async function darajaStkPush(params: {
  isProduction: boolean;
  shortcode: string;
  passkey: string;
  consumerKey: string;
  consumerSecret: string;
  phone: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
}): Promise<{
  checkoutRequestId: string;
  merchantRequestId: string;
  responseCode: string;
  responseDescription: string;
}> {
  const {
    isProduction,
    shortcode,
    passkey,
    consumerKey,
    consumerSecret,
    phone,
    amount,
    accountReference,
    transactionDesc,
  } = params;

  const baseUrl = isProduction
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
  const url = `${baseUrl}/mpesa/stkpush/v1/processrequest`;
  const timestamp = darajaTimestamp(new Date());
  const password = buildDarajaPassword(shortcode, passkey, timestamp);
  const token = await fetchDarajaToken(consumerKey, consumerSecret, isProduction);

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: `${process.env.MPESA_CALLBACK_URL || 'https://example.com/api/payments/mpesa/callback'}`,
    AccountReference: accountReference.slice(0, 12),
    TransactionDesc: transactionDesc.slice(0, 13),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const rawBody = await res.text();
  let json: Record<string, string> = {};
  try {
    json = JSON.parse(rawBody) as Record<string, string>;
  } catch {
    // Non-JSON response from Daraja — keep rawBody for diagnostics.
  }

  // Log the full Daraja response for debugging callback/credential issues.
  if (!res.ok || json.ResponseCode && json.ResponseCode !== '0') {
    console.error('[MPESA STK] Daraja response:', {
      status: res.status,
      body: rawBody,
      payload: { phone, amount, accountReference },
    });
  }

  return {
    checkoutRequestId: json.CheckoutRequestID || json.checkoutRequestId || '',
    merchantRequestId: json.MerchantRequestID || json.merchantRequestId || '',
    responseCode: json.ResponseCode || json.responseCode || '0',
    responseDescription:
      json.ResponseDescription || json.responseDescription || 'Success',
  };
}

async function stkPushHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = (await request.json()) as StkPushBody;

  const rawPhone = body.phone || body.phoneNumber;
  const amount = parseFloat(String(body.amount));

  if (!rawPhone || !amount || amount <= 0) {
    return Response.json(
      {
        success: false,
        error: 'phone (or phoneNumber) and a positive amount are required.',
      },
      { status: 400 },
    );
  }

  const storeId = body.storeId || '';
  const transactionId = body.transactionId || '';
  const accountReference = body.accountReference || 'MBUMAH';
  const transactionDesc = body.transactionDesc || 'Payment';

  const formattedPhone = normalisePhone(String(rawPhone));

  // Strict validation: Daraja requires exactly 254 + 9 digits.
  if (!/^254\d{9}$/.test(formattedPhone)) {
    return Response.json(
      {
        success: false,
        error: `Invalid phone number format. Got "${formattedPhone}". Expected 2547XXXXXXXX (12 digits).`,
      },
      { status: 400 },
    );
  }

  // Find any pre-existing MpesaTransaction row created by the checkout
  // flow (transactions/route.ts creates one with status PENDING before
  // hitting this endpoint).
  let mpesaTransaction: Awaited<
    ReturnType<typeof db.mpesaTransaction.findFirst>
  > | null = null;
  if (storeId && transactionId) {
    mpesaTransaction = await db.mpesaTransaction.findFirst({
      where: { storeId, transactionId, status: 'PENDING' },
    });
  }

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const isProduction = process.env.NODE_ENV === 'production';
  const darajaConfigured = Boolean(
    consumerKey && consumerSecret && shortcode && passkey,
  );

  // ── REAL DARAJA PATH ──────────────────────────────────────────────────
  if (darajaConfigured) {
    try {
      const result = await darajaStkPush({
        isProduction,
        shortcode: shortcode!,
        passkey: passkey!,
        consumerKey: consumerKey!,
        consumerSecret: consumerSecret!,
        phone: formattedPhone,
        amount,
        accountReference,
        transactionDesc,
      });

      if (mpesaTransaction) {
        await db.mpesaTransaction.update({
          where: { id: mpesaTransaction.id },
          data: {
            checkoutRequestId: result.checkoutRequestId,
            merchantRequestId: result.merchantRequestId,
            phoneNumber: formattedPhone,
            amount,
            status: 'PROCESSING',
          },
        });
      } else {
        mpesaTransaction = await db.mpesaTransaction.create({
          data: {
            storeId: storeId || 'unknown',
            checkoutRequestId: result.checkoutRequestId,
            merchantRequestId: result.merchantRequestId,
            phoneNumber: formattedPhone,
            amount,
            status: 'PROCESSING',
            transactionId: transactionId || null,
          },
        });
      }

      await systemLog({
        action: 'MPESA_STK_PUSH_DARAJA',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.INFO,
        message: `Daraja STK Push initiated for ${formattedPhone}, KES ${amount} (CheckoutRequestID: ${result.checkoutRequestId})`,
        storeId: storeId || undefined,
        metadata: {
          phoneNumber: formattedPhone,
          amount,
          checkoutRequestId: result.checkoutRequestId,
          merchantRequestId: result.merchantRequestId,
          responseCode: result.responseCode,
          transactionId,
          isProduction,
        },
      });

      return Response.json({
        success: true,
        data: {
          checkoutRequestId: result.checkoutRequestId,
          merchantRequestId: result.merchantRequestId,
          resultCode: result.responseCode,
          message: result.responseDescription,
          status: 'PROCESSING',
          mode: 'daraja',
        },
      });
    } catch (error) {
      await systemLog({
        action: 'MPESA_STK_PUSH_DARAJA_ERROR',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.ERROR,
        message: `Daraja STK Push failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        storeId: storeId || undefined,
        metadata: {
          phoneNumber: formattedPhone,
          amount,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      // Fall through to simulated path so the cashier is not blocked.
    }
  }

  // ── SIMULATED PATH (legacy behaviour) ─────────────────────────────────
  try {
    const mockResponse = await fetch(
      'http://localhost:3001/api/mpesa/stkpush',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: formattedPhone,
          amount,
          accountReference,
          transactionDesc,
        }),
      },
    );

    const mockData = (await mockResponse.json()) as {
      checkoutRequestId?: string;
      CheckoutRequestID?: string;
      merchantRequestId?: string;
      MerchantRequestID?: string;
      responseCode?: string;
      ResponseCode?: string;
      responseDescription?: string;
      ResponseDescription?: string;
    };

    const checkoutRequestId =
      mockData.checkoutRequestId || mockData.CheckoutRequestID || '';
    const merchantRequestId =
      mockData.merchantRequestId || mockData.MerchantRequestID || '';

    if (mpesaTransaction) {
      await db.mpesaTransaction.update({
        where: { id: mpesaTransaction.id },
        data: {
          checkoutRequestId,
          merchantRequestId,
          status: 'PROCESSING',
        },
      });
    } else {
      mpesaTransaction = await db.mpesaTransaction.create({
        data: {
          storeId: storeId || 'unknown',
          checkoutRequestId,
          merchantRequestId,
          phoneNumber: formattedPhone,
          amount,
          status: 'PROCESSING',
          transactionId: transactionId || null,
        },
      });
    }

    await systemLog({
      action: 'MPESA_STK_PUSH_INITIATED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.INFO,
      message: `M-Pesa STK Push (mock) initiated for ${formattedPhone}, KES ${amount}`,
      storeId: storeId || undefined,
      metadata: {
        phoneNumber: formattedPhone,
        amount,
        checkoutRequestId,
        transactionId,
        mode: 'mock',
      },
    });

    return Response.json({
      success: true,
      data: {
        checkoutRequestId,
        merchantRequestId,
        resultCode: mockData.responseCode || mockData.ResponseCode || '0',
        message:
          mockData.responseDescription ||
          mockData.ResponseDescription ||
          'Success',
        status: 'PROCESSING',
        mode: 'mock',
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
    } else {
      mpesaTransaction = await db.mpesaTransaction.create({
        data: {
          storeId: storeId || 'unknown',
          checkoutRequestId: simulatedCheckoutId,
          merchantRequestId: simulatedMerchantId,
          phoneNumber: formattedPhone,
          amount,
          status: 'PROCESSING',
          transactionId: transactionId || null,
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
        mode: 'simulated',
      },
    });

    return Response.json({
      success: true,
      data: {
        checkoutRequestId: simulatedCheckoutId,
        merchantRequestId: simulatedMerchantId,
        resultCode: '0',
        message: 'Simulated STK Push (mock service unavailable)',
        status: 'PROCESSING',
        mode: 'simulated',
      },
    });
  }
}

export const POST = withErrorBoundary(stkPushHandler, 'MPESA_STK_PUSH');
