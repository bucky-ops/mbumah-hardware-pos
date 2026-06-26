// GET /api/payments/mpesa/status/[checkoutRequestId]
//
// Checks the status of an M-Pesa STK push. Two modes:
//
//   1. REAL Daraja — when MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET,
//      MPESA_SHORTCODE and MPESA_PASSKEY env vars are set, the route
//      queries the Daraja STK push query endpoint to get the live status.
//
//   2. FALLBACK — returns the status stored on the MpesaTransaction row
//      (which is updated by the callback handler when a real callback
//      arrives, or remains at PROCESSING / PENDING otherwise).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ checkoutRequestId: string }>;
}

function darajaTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

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

async function statusHandler(...args: unknown[]): Promise<Response> {
  const _request = args[0] as NextRequest;
  const context = args[1] as RouteContext;
  const checkoutRequestId = (await context.params).checkoutRequestId;

  if (!checkoutRequestId) {
    return Response.json(
      { success: false, error: 'checkoutRequestId is required.' },
      { status: 400 },
    );
  }

  // Look up the local MpesaTransaction row.
  const mpesaTxn = await db.mpesaTransaction.findFirst({
    where: { checkoutRequestId },
  });

  if (!mpesaTxn) {
    return Response.json(
      {
        success: false,
        error: `No M-Pesa transaction found for CheckoutRequestID ${checkoutRequestId}.`,
      },
      { status: 404 },
    );
  }

  // If the local status is already terminal, just return it.
  const terminalStatuses = ['COMPLETED', 'FAILED', 'CANCELLED'];
  if (terminalStatuses.includes(mpesaTxn.status)) {
    return Response.json({
      success: true,
      data: {
        checkoutRequestId: mpesaTxn.checkoutRequestId,
        merchantRequestId: mpesaTxn.merchantRequestId,
        status: mpesaTxn.status,
        resultCode: mpesaTxn.resultCode || null,
        resultDesc: mpesaTxn.resultDesc || null,
        mpesaReceiptNumber: mpesaTxn.mpesaReceiptNumber || null,
        amount: mpesaTxn.amount,
        phoneNumber: mpesaTxn.phoneNumber,
        source: 'local',
      },
    });
  }

  // Try Daraja live query if configured.
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const isProduction = process.env.NODE_ENV === 'production';
  const darajaConfigured = Boolean(
    consumerKey && consumerSecret && shortcode && passkey,
  );

  if (darajaConfigured) {
    try {
      const token = await fetchDarajaToken(
        consumerKey!,
        consumerSecret!,
        isProduction,
      );
      const baseUrl = isProduction
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
      const timestamp = darajaTimestamp(new Date());
      const password = Buffer.from(
        `${shortcode}${passkey}${timestamp}`,
      ).toString('base64');

      const res = await fetch(
        `${baseUrl}/mpesa/stkpushquery/v1/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId,
          }),
        },
      );
      const json = (await res.json()) as Record<string, string>;

      const resultCode = json.ResultCode || '';
      const resultDesc = json.ResultDesc || '';
      let nextStatus = mpesaTxn.status;
      const mpesaReceiptNumber: string | null = null;

      // 0 = success, 1032/1037 = timeouts/cancelled-by-user
      if (resultCode === '0') {
        nextStatus = 'COMPLETED';
        // Daraja sometimes nests receipt inside ResultDesc, but the callback
        // is the authoritative source for the receipt number. We leave it
        // null here and rely on the callback to populate it.
      } else if (resultCode === '1032' || resultCode === '1037') {
        nextStatus = 'CANCELLED';
      } else if (resultCode) {
        nextStatus = 'FAILED';
      }

      if (
        nextStatus !== mpesaTxn.status ||
        resultCode !== mpesaTxn.resultCode
      ) {
        await db.mpesaTransaction.update({
          where: { id: mpesaTxn.id },
          data: {
            status: nextStatus,
            resultCode: resultCode || null,
            resultDesc: resultDesc || null,
            mpesaReceiptNumber,
          },
        });
      }

      return Response.json({
        success: true,
        data: {
          checkoutRequestId,
          merchantRequestId: mpesaTxn.merchantRequestId,
          status: nextStatus,
          resultCode: resultCode || null,
          resultDesc: resultDesc || null,
          mpesaReceiptNumber,
          amount: mpesaTxn.amount,
          phoneNumber: mpesaTxn.phoneNumber,
          source: 'daraja',
        },
      });
    } catch (error) {
      await systemLog({
        action: 'MPESA_STATUS_QUERY_ERROR',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.WARN,
        message: `Daraja STK query failed for ${checkoutRequestId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        metadata: { checkoutRequestId },
      });
      // fall through to local-only response
    }
  }

  // Local fallback — return whatever we have stored.
  return Response.json({
    success: true,
    data: {
      checkoutRequestId,
      merchantRequestId: mpesaTxn.merchantRequestId,
      status: mpesaTxn.status,
      resultCode: mpesaTxn.resultCode || null,
      resultDesc: mpesaTxn.resultDesc || null,
      mpesaReceiptNumber: mpesaTxn.mpesaReceiptNumber || null,
      amount: mpesaTxn.amount,
      phoneNumber: mpesaTxn.phoneNumber,
      source: 'local',
    },
  });
}

export const GET = withErrorBoundary(
  statusHandler,
  'MPESA_STK_STATUS',
);
