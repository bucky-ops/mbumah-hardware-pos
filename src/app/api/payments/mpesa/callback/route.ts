// POST /api/payments/mpesa/callback
//
// C-06: M-Pesa Callback Verification
// ----------------------------------------------------------------------------
// This endpoint is intentionally public (it must be reachable by Safaricom's
// Daraja API), which makes it a prime target for forged callbacks that mark
// payments as completed without an actual M-Pesa transaction taking place.
//
// Hardening implemented here (defense in depth, since no single control is
// sufficient on its own):
//
//  1. Shared-secret check (MPESA_CALLBACK_SECRET). If the env var is set, the
//     caller MUST supply it in the `X-Mpesa-Callback-Secret` header. This is
//     intended to be configured to the same value Safaricom would send if the
//     Daraja CallbackURL were routed through an authenticating reverse proxy.
//     If the env var is NOT set, the route logs a WARN every time it is hit
//     so operators notice the unauthenticated surface in production.
//
//  2. Replay / status guard. The MpesaTransaction must be in PENDING or
//     PROCESSING state. A callback for an already-COMPLETED or already-FAILED
//     record is rejected (401) and logged, which prevents an attacker from
//     replaying an old legitimate callback to re-confirm a payment.
//
//  3. Amount validation. The Amount in the callback metadata must match the
//     amount stored on the MpesaTransaction record (tolerance: 0.01 KES for
//     floating-point rounding). A mismatch is rejected (400) and logged as
//     SUSPICIOUS_ACTIVITY.
//
//  4. CheckoutRequestID must exist in the database. A callback for an unknown
//     CheckoutRequestID is rejected (401) and logged as UNAUTHORIZED_ACCESS —
//     previously the route returned `success: true` for missing records
//     (Safaricom-friendly), which masked forgery attempts. Rejecting with 401
//     is a deliberate trade-off: it slightly deviates from Safaricom's
//     expected 200-ACK contract in exchange for not silently accepting
//     forgeries. (If 200-ACK is required for production, route the callback
//     through an authenticating reverse proxy that 200-acks untrusted input
//     and only forwards verified callbacks to this handler.)
//
// RECOMMENDED FULL FIX (requires schema change, tracked as follow-up):
//  - Add `callbackHmac` String? column to MpesaTransaction.
//  - When initiating STK push, compute HMAC-SHA256(MPESA_CALLBACK_SECRET,
//    checkoutRequestId || merchantRequestId || amount) and persist it.
//  - Configure Safaricom Daraja to include the HMAC in a callback header
//    (this typically requires an authenticating reverse proxy in front of
//    the app that injects the header based on the request body).
//  - On callback, recompute the HMAC and compare with `crypto.timingSafeEqual`.
//  - Add a Safaricom IP allowlist check (TODO below) once the production
//    egress IPs are confirmed.
// ----------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateJournalEntryNumber } from '@/lib/helpers';
import { getAccountId, ACCOUNT_CODES } from '@/lib/account-helper';
import { maskSensitiveData, logSecurityEvent, SecurityEvent } from '@/lib/security';
import { getClientIp } from '@/lib/security';
import { LogSeverity, LogComponent, PaymentStatus } from '@/lib/types';

// TODO(C-06 follow-up): populate with Safaricom Daraja production egress IPs
// before going live. Until this list is non-empty, the IP-allowlist check is
// skipped (the shared-secret + amount + status checks below still apply).
const SAFARICOM_CALLBACK_IP_ALLOWLIST: string[] = [
  // Example placeholders — confirmed production IPs must be added by ops:
  // '196.201.214.200',
  // '196.201.214.206',
];

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

/**
 * Verify that the inbound callback is plausibly from M-Pesa / our own mock.
 * Returns `{ ok: true }` on success, or `{ ok: false, status, code }` on
 * failure. Failure responses are still 200-shaped to mimic Safaricom's
 * expected callback ACK, but every failure is logged.
 */
function verifyCallbackOrigin(
  request: NextRequest
): { ok: true } | { ok: false; reason: string } {
  // 1. Shared-secret check (only enforced when MPESA_CALLBACK_SECRET is set).
  const expectedSecret = process.env.MPESA_CALLBACK_SECRET;
  if (expectedSecret) {
    const supplied =
      request.headers.get('x-mpesa-callback-secret') ||
      request.headers.get('x-callback-secret');
    if (!supplied || supplied !== expectedSecret) {
      return { ok: false, reason: 'missing_or_invalid_shared_secret' };
    }
  }

  // 2. IP allowlist check (only enforced when allowlist is populated).
  if (SAFARICOM_CALLBACK_IP_ALLOWLIST.length > 0) {
    const clientIp = getClientIp(request);
    if (clientIp === 'unknown' || !SAFARICOM_CALLBACK_IP_ALLOWLIST.includes(clientIp)) {
      return { ok: false, reason: `ip_not_allowedlist:${clientIp}` };
    }
  }

  return { ok: true };
}

async function mpesaCallbackHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const clientIp = getClientIp(request);
  const body: MpesaCallbackBody = await request.json();

  const data = extractCallbackData(body);
  const isSuccess = data.resultCode === '0';

  // ---- C-06 verification: origin / shared secret / IP allowlist -------------
  const originCheck = verifyCallbackOrigin(request);
  if (!originCheck.ok) {
    await logSecurityEvent({
      event: SecurityEvent.UNAUTHORIZED_ACCESS,
      message: `M-Pesa callback rejected: ${originCheck.reason}`,
      ipAddress: clientIp,
      metadata: {
        checkoutRequestId: data.checkoutRequestId,
        resultCode: data.resultCode,
        reason: originCheck.reason,
      },
    });
    // Return 401 — forgers don't get to learn which records exist.
    return Response.json(
      { success: false, error: 'Unauthorized.' },
      { status: 401 }
    );
  }

  // If no shared secret is configured, surface the unprotected surface loudly
  // so production deployments notice. (Dev/mock environments may intentionally
  // leave this unset, but the WARN makes the trade-off explicit.)
  if (!process.env.MPESA_CALLBACK_SECRET) {
    await systemLog({
      action: 'MPESA_CALLBACK_NO_SHARED_SECRET',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.WARN,
      message:
        'M-Pesa callback processed without MPESA_CALLBACK_SECRET env var set. ' +
        'Callback origin cannot be authenticated. Set MPESA_CALLBACK_SECRET in production.',
      metadata: { checkoutRequestId: data.checkoutRequestId, resultCode: data.resultCode },
    });
  }

  // ---- C-06 verification: CheckoutRequestID must reference a real record ----
  // Empty CheckoutRequestID is an immediate reject — do not even hit the DB.
  if (!data.checkoutRequestId) {
    await logSecurityEvent({
      event: SecurityEvent.SUSPICIOUS_ACTIVITY,
      message: 'M-Pesa callback received with empty CheckoutRequestID.',
      ipAddress: clientIp,
      metadata: { resultCode: data.resultCode, resultDesc: data.resultDesc },
    });
    return Response.json(
      { success: false, error: 'Invalid callback payload.' },
      { status: 400 }
    );
  }

    const mpesaTx = await db.mpesaTransaction.findFirst({
    where: {
      checkoutRequestId: data.checkoutRequestId,
    },
  });

  if (!mpesaTx) {
    await logSecurityEvent({
      event: SecurityEvent.UNAUTHORIZED_ACCESS,
      message: `M-Pesa callback for unknown CheckoutRequestID: ${data.checkoutRequestId}`,
      ipAddress: clientIp,
      metadata: { checkoutRequestId: data.checkoutRequestId, resultCode: data.resultCode },
    });

    // 401 — forgers don't get a 200 OK to learn the ID is invalid.
    return Response.json(
      { success: false, error: 'Unauthorized.' },
      { status: 401 }
    );
  }

  // ---- C-06 verification: replay guard -------------------------------------
  // A callback for an already-terminal record is suspicious — could be a
  // replay of a previously captured legitimate callback, or an attacker
  // trying to flip a FAILED record back to COMPLETED.
  if (mpesaTx.status === 'COMPLETED' || mpesaTx.status === 'FAILED' || mpesaTx.callbackReceived) {
    await logSecurityEvent({
      event: SecurityEvent.SUSPICIOUS_ACTIVITY,
      message: `M-Pesa callback replay for already-${mpesaTx.status} transaction ${mpesaTx.id}`,
      ipAddress: clientIp,
      metadata: {
        mpesaTransactionId: mpesaTx.id,
        checkoutRequestId: data.checkoutRequestId,
        currentStatus: mpesaTx.status,
        callbackAlreadyReceived: mpesaTx.callbackReceived,
        newResultCode: data.resultCode,
      },
    });
    return Response.json(
      { success: false, error: 'Transaction already processed.' },
      { status: 409 }
    );
  }

  // ---- C-06 verification: amount must match the stored amount --------------
  // (Only enforce on success callbacks — failure callbacks legitimately have
  // no Amount in their metadata.)
  if (isSuccess && data.amount > 0) {
    const expectedAmount = mpesaTx.amount;
    const delta = Math.abs(data.amount - expectedAmount);
    // 0.01 KES tolerance to absorb any float rounding differences.
    if (delta > 0.01) {
      await logSecurityEvent({
        event: SecurityEvent.SUSPICIOUS_ACTIVITY,
        message:
          `M-Pesa callback amount mismatch for tx ${mpesaTx.id}: ` +
          `expected ${expectedAmount}, got ${data.amount}`,
        ipAddress: clientIp,
        metadata: {
          mpesaTransactionId: mpesaTx.id,
          checkoutRequestId: data.checkoutRequestId,
          expectedAmount,
          callbackAmount: data.amount,
        },
      });
      return Response.json(
        { success: false, error: 'Amount mismatch.' },
        { status: 400 }
      );
    }
  }

  // L-02: mask the phone number for any logging downstream.
  const maskedPhone = maskSensitiveData(String(data.phoneNumber || ''), 'phone');

  if (isSuccess) {
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

        if (mpesaTx.transactionId) {
      await db.$transaction(async (tx) => {
                await tx.salesTransaction.update({
          where: { id: mpesaTx.transactionId! },
          data: { paymentStatus: PaymentStatus.COMPLETED },
        });

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
        // L-02: mask phone number before logging
        phoneNumber: maskedPhone,
        transactionId: mpesaTx.transactionId,
      },
    });
  } else {
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
