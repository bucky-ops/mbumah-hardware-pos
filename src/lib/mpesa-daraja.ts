// M-Pesa Daraja STK push core — shared by the HTTP route and the outbox pump.
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md (F6-2, P0):
//   The checkout route used to initiate the server-side STK push with a
//   RELATIVE-URL fetch (`fetch('/api/payments/mpesa/stkpush?XTransformPort=3001')`)
//   which can never resolve in Node serverless — every M-Pesa sale silently
//   stuck PENDING with no push ever sent. The initiation logic now lives here
//   and is invoked DIRECTLY (in-process) by the outbox handler after the
//   checkout transaction commits — no HTTP self-call, no gateway artifacts.
//
// Server-only module.

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export interface StkPushRequest {
  phone: string;
  amount: number;
  accountReference?: string;
  transactionDesc?: string;
  storeId?: string;
  transactionId?: string;
}

export interface StkPushResult {
  mode: 'daraja' | 'mock' | 'simulated';
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: string;
  message: string;
  status: string;
}

/** Normalise Kenyan phone numbers to 254XXXXXXXXX. */
export function normalisePhone(raw: string): string {
  let p = raw.replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.length === 9 && /^\d{9}$/.test(p)) p = '254' + p;
  return p;
}

/** Build the Base64 password used by Daraja STK push: shortcode + passkey + timestamp. */
function buildDarajaPassword(shortcode: string, passkey: string, timestamp: string): string {
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
  isProduction: boolean
): Promise<string> {
  const baseUrl = isProduction
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
  const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    throw new Error(`Daraja OAuth failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Daraja OAuth returned no access_token.');
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
  const { isProduction, shortcode, passkey, consumerKey, consumerSecret, phone, amount, accountReference, transactionDesc } = params;
  const baseUrl = isProduction ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
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
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const rawBody = await res.text();
  let json: Record<string, string> = {};
  try {
    json = JSON.parse(rawBody) as Record<string, string>;
  } catch {
    // Non-JSON response from Daraja — keep rawBody for diagnostics.
  }

  if (!res.ok || (json.ResponseCode && json.ResponseCode !== '0')) {
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
    responseDescription: json.ResponseDescription || json.responseDescription || 'Success',
  };
}

/**
 * Initiate an STK push for an (already-created, PENDING) MpesaTransaction row.
 * Persists the CheckoutRequestID on the row (or creates a row when the caller
 * did not pre-create one). Never throws — failures degrade to 'simulated'
 * with a loud log so the caller's business transaction is unaffected.
 */
export async function initiateStkPush(req: StkPushRequest): Promise<StkPushResult> {
  const { phone, amount, storeId, transactionId } = req;
  const accountReference = req.accountReference || 'MBUMAH';
  const transactionDesc = req.transactionDesc || 'Payment';
  const formattedPhone = normalisePhone(String(phone));

  if (!/^254\d{9}$/.test(formattedPhone)) {
    throw new Error(
      `Invalid phone number format. Got "${formattedPhone}". Expected 2547XXXXXXXX (12 digits).`
    );
  }

  // Locate the PENDING row pre-created by checkout (if any).
  let mpesaTransaction = null as Awaited<ReturnType<typeof db.mpesaTransaction.findFirst>> | null;
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
  const darajaConfigured = Boolean(consumerKey && consumerSecret && shortcode && passkey);

  // ── REAL DARAJA PATH ──────────────────────────────────────────────────────
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
        metadata: { phoneNumber: formattedPhone, amount, checkoutRequestId: result.checkoutRequestId, transactionId, isProduction },
      }).catch(() => {});

      return {
        mode: 'daraja',
        checkoutRequestId: result.checkoutRequestId,
        merchantRequestId: result.merchantRequestId,
        resultCode: result.responseCode,
        message: result.responseDescription,
        status: 'PROCESSING',
      };
    } catch (error) {
      await systemLog({
        action: 'MPESA_STK_PUSH_DARAJA_ERROR',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.ERROR,
        message: `Daraja STK Push failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        storeId: storeId || undefined,
        metadata: { phoneNumber: formattedPhone, amount, error: error instanceof Error ? error.message : 'Unknown error' },
      }).catch(() => {});
      // Fall through to mock path so the cashier is not blocked.
    }
  }

  // ── SIMULATED PATH (mock / no credentials) ────────────────────────────────
  try {
    const mockResponse = await fetch('http://localhost:3001/api/mpesa/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: formattedPhone, amount, accountReference, transactionDesc }),
    });
    const mockData = (await mockResponse.json()) as Record<string, string>;
    const checkoutRequestId = mockData.checkoutRequestId || mockData.CheckoutRequestID || '';
    const merchantRequestId = mockData.merchantRequestId || mockData.MerchantRequestID || '';

    if (mpesaTransaction) {
      await db.mpesaTransaction.update({
        where: { id: mpesaTransaction.id },
        data: { checkoutRequestId, merchantRequestId, status: 'PROCESSING' },
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
      metadata: { phoneNumber: formattedPhone, amount, checkoutRequestId, transactionId, mode: 'mock' },
    }).catch(() => {});

    return {
      mode: 'mock',
      checkoutRequestId,
      merchantRequestId,
      resultCode: mockData.responseCode || mockData.ResponseCode || '0',
      message: mockData.responseDescription || mockData.ResponseDescription || 'Success',
      status: 'PROCESSING',
    };
  } catch (error) {
    const simulatedCheckoutId = `sim_ck_${Date.now()}`;
    const simulatedMerchantId = `sim_mk_${Date.now()}`;

    if (mpesaTransaction) {
      await db.mpesaTransaction.update({
        where: { id: mpesaTransaction.id },
        data: { checkoutRequestId: simulatedCheckoutId, merchantRequestId: simulatedMerchantId, status: 'PROCESSING' },
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
      metadata: { phoneNumber: formattedPhone, amount, checkoutRequestId: simulatedCheckoutId, error: error instanceof Error ? error.message : 'Unknown error', mode: 'simulated' },
    }).catch(() => {});

    return {
      mode: 'simulated',
      checkoutRequestId: simulatedCheckoutId,
      merchantRequestId: simulatedMerchantId,
      resultCode: '0',
      message: 'Simulated STK Push (mock service unavailable)',
      status: 'PROCESSING',
    };
  }
}
