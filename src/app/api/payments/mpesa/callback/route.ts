// POST /api/payments/mpesa/callback — Safaricom Daraja STK push result webhook.
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • F6-1 (P0): this endpoint was publicly forgeable — no credential check,
//     no IP allowlist, and it accepted a flat "mock" body shape. Now validates
//     HTTP Basic credentials (MPESA_CALLBACK_USERNAME / MPESA_CALLBACK_PASSWORD)
//     and an optional IP allowlist (MPESA_CALLBACK_IPS), and rejects the mock
//     shape outside development. Every rejection is written to SecurityEvent.
//   • F6-3 (P0): the confirmation used to throw on every success
//     (`CashDrawerLog.userId = 'system'` violated the FK) because the
//     MpesaTransaction had already been flipped COMPLETED *outside* the tx.
//     Now: an atomic claim (`updateMany` on PENDING+callbackReceived=false)
//     runs FIRST inside one $transaction; the drawer entry uses the seeded
//     system user (see prisma/seed.ts) and is skipped — never fatal — when
//     that user is absent; the pending journal is POSTED AS-IS (Dr M-Pesa
//     Account is the correct debit — the tender was M-Pesa). The old
//     `journalEntryLine.updateMany` account rewrite (history rewriting of a
//     posted ledger line) is REMOVED.
//   • F6-3/F6-4: idempotency — duplicate Daraja callbacks return 200 without
//     re-applying anything; the DB-level `@@unique([storeId, mpesaReceiptNumber])`
//     constraint guarantees one receipt settles at most one transaction.
//   • F6-4: the callback Amount is compared to the expected amount; a mismatch
//     routes the transaction to reconciliation (PROCESSING) instead of settling.
//   • F6-5: the failure path now runs a SYMMETRIC compensating transaction —
//     restock + SALE_CANCELLED stock movement + void the pending journal —
//     so a cancelled/timeout STK push no longer permanently shrinks inventory.
//
// NOTE: this route stays PUBLIC (Safaricom cannot present a user session) but
// is credentialed. `export const POST` is deliberately not wrapped in
// requireAuth — do not "fix" that.

import { type NextRequest } from 'next/server';
import nodeCrypto from 'crypto';
import { db, withImmutabilityBypass } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent, PaymentStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

// ── Request body shapes ──────────────────────────────────────────────────────

interface MpesaCallbackBody {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string;
      MerchantRequestID?: string;
      ResultCode: number | string;
      ResultDesc: string;
      CallbackMetadata?: {
        Item?: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
  // Flat "mock" format — only honoured when MOCK_CALLBACKS_ENABLED=true
  // (development / docker mock). Rejected in production (F6-1).
  checkoutRequestId?: string;
  merchantRequestId?: string;
  resultCode?: number | string;
  resultDesc?: string;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  phoneNumber?: string;
  amount?: number;
}

function mockCallbacksAllowed(): boolean {
  return process.env.MOCK_CALLBACKS_ENABLED === 'true';
}

// ── F6-1: credential + origin validation ─────────────────────────────────────

async function logSecurityEvent(opts: {
  eventType: string;
  severity?: string;
  request: NextRequest;
  details: Record<string, unknown>;
  blocked?: boolean;
}): Promise<void> {
  try {
    await db.securityEvent.create({
      data: {
        eventType: opts.eventType,
        severity: opts.severity || 'WARN',
        ipAddress:
          opts.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          opts.request.headers.get('x-real-ip') ||
          null,
        resource: '/api/payments/mpesa/callback',
        action: 'MPESA_CALLBACK',
        details: JSON.stringify(opts.details).slice(0, 1000),
        userAgent: opts.request.headers.get('user-agent') || null,
        blocked: opts.blocked ?? true,
      },
    });
  } catch {
    /* security logging must never throw into the webhook path */
  }
}

/**
 * Validate Daraja callback authenticity (F6-1).
 *  - HTTP Basic credentials compared in constant time when configured.
 *  - IP allowlist when MPESA_CALLBACK_IPS is configured (comma-separated).
 * Returns null when authorised, or a Response to reject with.
 */
async function authorizeCallback(request: NextRequest): Promise<Response | null> {
  const url = new URL(request.url);
  const user = process.env.MPESA_CALLBACK_USERNAME;
  const pass = process.env.MPESA_CALLBACK_PASSWORD;

  // 1. Shared-credential check (Daraja supports basic-auth URLs — register the
  //    callback as https://user:pass@host/api/... or set the header upstream).
  if (user && pass) {
    const header = request.headers.get('authorization') || '';
    const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    // Constant-time-ish comparison: length check + XOR compare.
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    const equal = a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
    if (!equal) {
      await logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'ERROR',
        request,
        details: { reason: 'bad_credentials', path: url.pathname },
      });
      return Response.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }
  }

  // 2. Optional IP allowlist (Safaricom published ranges / corporate egress).
  const allowList = (process.env.MPESA_CALLBACK_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowList.length > 0) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '';
    if (!ip || !allowList.includes(ip)) {
      await logSecurityEvent({
        eventType: 'UNAUTHORIZED_ACCESS',
        severity: 'ERROR',
        request,
        details: { reason: 'ip_not_allowed', ip: ip || 'unknown' },
      });
      return Response.json({ success: false, error: 'Forbidden.' }, { status: 403 });
    }
  }

  return null;
}

// ── Payload extraction ───────────────────────────────────────────────────────

function extractCallbackData(body: MpesaCallbackBody) {
  if (body.Body?.stkCallback) {
    const stk = body.Body.stkCallback;
    const metadata: Record<string, unknown> = {};
    if (stk.CallbackMetadata?.Item) {
      for (const item of stk.CallbackMetadata.Item) metadata[item.Name] = item.Value;
    }
    return {
      isDarajaShape: true as const,
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
  // Flat mock shape — only permitted when explicitly enabled (dev/docker).
  return {
    isDarajaShape: false as const,
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

// ── Handler ──────────────────────────────────────────────────────────────────

async function mpesaCallbackHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;

  // F6-1 — credential / IP gate before anything else.
  const rejection = await authorizeCallback(request);
  if (rejection) return rejection;

  const body: MpesaCallbackBody = await request.json();
  const data = extractCallbackData(body);

  // F6-1 — reject the flat mock shape outside explicitly-enabled environments.
  if (!data.isDarajaShape && !mockCallbacksAllowed()) {
    await logSecurityEvent({
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity: 'ERROR',
      request,
      details: {
        reason: 'mock_callback_shape_rejected',
        hint: 'Flat callback bodies are only accepted when MOCK_CALLBACKS_ENABLED=true.',
      },
    });
    return Response.json(
      { success: false, error: 'Unsupported callback format.' },
      { status: 400 }
    );
  }

  const isSuccess = data.resultCode === '0';

  const mpesaTx = await db.mpesaTransaction.findFirst({
    where: { checkoutRequestId: data.checkoutRequestId },
  });

  if (!mpesaTx) {
    // Unknown checkout id — could be a probe or a stale push. Acknowledge 200
    // (Daraja stops retrying on 200) but record it for forensics.
    await logSecurityEvent({
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity: 'WARN',
      request,
      blocked: false,
      details: {
        reason: 'callback_no_matching_record',
        checkoutRequestId: data.checkoutRequestId,
        resultCode: data.resultCode,
      },
    });
    await systemLog({
      action: 'MPESA_CALLBACK_NO_RECORD',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.WARN,
      message: `M-Pesa callback received but no matching transaction found for CheckoutRequestID: ${data.checkoutRequestId}`,
      metadata: { checkoutRequestId: data.checkoutRequestId, resultCode: data.resultCode },
    });
    return Response.json({ success: true, message: 'Callback received (no matching record).' });
  }

  // ── Idempotency gate (F6-3/F6-4) ─────────────────────────────────────────
  // A terminal transaction must never be re-processed — Daraja retries
  // aggressively and double delivery used to double-count the cash drawer.
  if (mpesaTx.callbackReceived || mpesaTx.status === 'COMPLETED' || mpesaTx.status === 'FAILED') {
    await systemLog({
      action: 'MPESA_CALLBACK_DUPLICATE',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.INFO,
      message: `Duplicate M-Pesa callback ignored (already ${mpesaTx.status}) for ${data.checkoutRequestId}`,
      storeId: mpesaTx.storeId,
      metadata: { checkoutRequestId: data.checkoutRequestId, receipt: data.mpesaReceiptNumber },
    });
    return Response.json({ success: true, message: 'Callback already processed.' });
  }

  // ── Amount verification (F6-4) ───────────────────────────────────────────
  // Partial/over settlement is not accepted silently — route to reconciliation.
  if (isSuccess && data.amount > 0) {
    const expected = Number(mpesaTx.amount);
    if (Math.abs(data.amount - expected) > 0.01) {
      await db.mpesaTransaction.update({
        where: { id: mpesaTx.id },
        data: {
          status: 'PROCESSING', // reconciliation queue — NOT settled
          resultCode: data.resultCode,
          resultDesc: `AMOUNT_MISMATCH: expected ${expected}, got ${data.amount}`,
          callbackReceived: true,
        },
      });
      await systemLog({
        action: 'MPESA_CALLBACK_AMOUNT_MISMATCH',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.ERROR,
        message: `M-Pesa amount mismatch for ${data.checkoutRequestId}: expected KES ${expected}, callback KES ${data.amount}. Routed to reconciliation.`,
        storeId: mpesaTx.storeId,
        metadata: { expected, received: data.amount, transactionId: mpesaTx.transactionId },
      });
      return Response.json({ success: true, message: 'Amount mismatch — queued for reconciliation.' });
    }
  }

  if (isSuccess) {
    // ── SUCCESS: one transaction, claim-first (F6-3) ────────────────────────
    let settled = true;
    try {
      await db.$transaction(async (tx) => {
        // 1. Atomic claim: PENDING + no-callback-yet → PROCESSING. If count is 0
        //    a concurrent delivery won the race; do nothing further.
        const claimed = await tx.mpesaTransaction.updateMany({
          where: { id: mpesaTx.id, status: 'PENDING', callbackReceived: false },
          data: {
            status: 'PROCESSING',
            callbackReceived: true,
            resultCode: data.resultCode,
            resultDesc: data.resultDesc,
            mpesaReceiptNumber: data.mpesaReceiptNumber || null,
          },
        });
        if (claimed.count === 0) {
          settled = false;
          return;
        }

        if (mpesaTx.transactionId) {
          // 2. Mark the sale paid — guarded so we never clobber a terminal state.
          await tx.salesTransaction.updateMany({
            where: { id: mpesaTx.transactionId, paymentStatus: PaymentStatus.PENDING },
            data: { paymentStatus: PaymentStatus.COMPLETED },
          });

          // 3. Payments → COMPLETED with the Daraja receipt as reference.
          await tx.payment.updateMany({
            where: { transactionId: mpesaTx.transactionId, paymentMethod: 'MPESA' },
            data: { status: PaymentStatus.COMPLETED, reference: data.mpesaReceiptNumber },
          });

          // 4. Cash-drawer log — uses the seeded `system` user (F6-3 FK fix).
          //    Missing system user degrades to a skip + warning, NEVER a crash.
          const systemUser = await tx.user.findUnique({
            where: { id: 'system' },
            select: { id: true },
          });
          if (systemUser) {
            // Running balance derived from the SUM of this shift's signed
            // amounts (R6 remediation) instead of a read-modify-write of the
            // "latest" row, which loses updates under concurrency.
            const agg = await tx.cashDrawerLog.aggregate({
              where: { storeId: mpesaTx.storeId },
              _sum: { amount: true },
            });
            const runningBalance = Number(agg._sum.amount ?? 0) + Number(mpesaTx.amount);
            await tx.cashDrawerLog.create({
              data: {
                storeId: mpesaTx.storeId,
                userId: 'system',
                action: 'SALE',
                amount: mpesaTx.amount,
                balance: runningBalance,
                notes: `M-Pesa payment received - ${data.mpesaReceiptNumber}`,
              },
            });
          } else {
            console.warn(
              '[mpesa-callback] system user missing — cash drawer entry skipped (run prisma/seed.ts)'
            );
          }

          // 5. Post the pending sale journal AS-IS (F6-3): the debit on the
          //    M-Pesa Account (1100) is the correct settlement account for an
          //    M-Pesa tender. The former journalEntryLine.updateMany rewrite
          //    (M-Pesa → Cash) mutated a posted ledger line and is removed.
          const pendingJE = await tx.journalEntry.findFirst({
            where: { referenceId: mpesaTx.transactionId!, referenceType: 'SALE', isPosted: false },
          });
          if (pendingJE) {
            // Posting a pending journal entry is a sanctioned lifecycle
            // mutation on the append-only models — the audited bypass scope.
            await withImmutabilityBypass(async () => {
              await tx.journalEntry.update({
                where: { id: pendingJE.id },
                data: {
                  isPosted: true,
                  postedAt: new Date(),
                  description:
                    pendingJE.description?.replace('(pending)', '(completed)') ||
                    pendingJE.description,
                },
              });
            }, 'mpesa_callback_posting');
          }
        }

        // 6. Finalise the MpesaTransaction inside the same tx.
        await tx.mpesaTransaction.update({
          where: { id: mpesaTx.id },
          data: { status: 'COMPLETED' },
        });
      });
    } catch (err) {
      // Unique receipt collision ⇒ this receipt already settled another row —
      // treat as duplicate settlement, not an error (F6-4).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('mpesa_transactions_store_id_mpesa_receipt_number_key')) {
        await systemLog({
          action: 'MPESA_CALLBACK_DUPLICATE_RECEIPT',
          component: LogComponent.PAYMENT,
          severity: LogSeverity.WARN,
          message: `Receipt ${data.mpesaReceiptNumber} already settled another transaction — ignored.`,
          storeId: mpesaTx.storeId,
          metadata: { checkoutRequestId: data.checkoutRequestId },
        });
        return Response.json({ success: true, message: 'Duplicate receipt ignored.' });
      }
      throw err; // real failure — withErrorBoundary → 500, Daraja will retry
    }

    if (!settled) {
      return Response.json({ success: true, message: 'Callback already processed.' });
    }

    await systemLog({
      action: 'MPESA_PAYMENT_COMPLETED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.INFO,
      message: `M-Pesa payment completed: ${data.mpesaReceiptNumber}, KES ${data.amount || Number(mpesaTx.amount)}`,
      storeId: mpesaTx.storeId,
      metadata: {
        mpesaReceiptNumber: data.mpesaReceiptNumber,
        amount: data.amount || Number(mpesaTx.amount),
        phoneNumber: data.phoneNumber,
        transactionId: mpesaTx.transactionId,
      },
    });
    return Response.json({ success: true, message: 'Callback processed successfully.' });
  }

  // ── FAILURE: symmetric compensation (F6-5) ───────────────────────────────
  // Stock was decremented optimistically at checkout; a cancelled/expired STK
  // push must restore it, write a compensating movement, and void the pending
  // journal — otherwise every failed push permanently shrinks inventory.
  let compensated = true;
  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.mpesaTransaction.updateMany({
        where: { id: mpesaTx.id, status: 'PENDING', callbackReceived: false },
        data: {
          status: 'FAILED',
          callbackReceived: true,
          resultCode: data.resultCode,
          resultDesc: data.resultDesc,
        },
      });
      if (claimed.count === 0) {
        compensated = false;
        return;
      }

      if (mpesaTx.transactionId) {
        await tx.salesTransaction.updateMany({
          where: { id: mpesaTx.transactionId, paymentStatus: PaymentStatus.PENDING },
          data: { paymentStatus: PaymentStatus.FAILED },
        });
        await tx.payment.updateMany({
          where: { transactionId: mpesaTx.transactionId, paymentMethod: 'MPESA' },
          data: { status: PaymentStatus.FAILED },
        });

        // Compensating restock — one row per line item of the failed sale.
        const saleItems = await tx.saleItem.findMany({
          where: { transactionId: mpesaTx.transactionId },
          select: { productId: true, quantity: true },
        });
        for (const item of saleItems) {
          await tx.product.update({
            where: { id: item.productId },
            data: { quantityInStock: { increment: item.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              storeId: mpesaTx.storeId,
              productId: item.productId,
              movementType: 'ADJUSTMENT',
              quantity: item.quantity,
              referenceId: mpesaTx.transactionId!,
              performedBy: 'system',
              notes: `M-Pesa payment failed (${data.resultDesc}) — automatic restock`,
            },
          });
        }

        // Void the pending journal so reconciliation does not chase a ghost.
        const pendingJE = await tx.journalEntry.findFirst({
          where: { referenceId: mpesaTx.transactionId!, referenceType: 'SALE', isPosted: false },
        });
        if (pendingJE) {
          await withImmutabilityBypass(async () => {
            await tx.journalEntry.update({
              where: { id: pendingJE.id },
              data: { isVoided: true, voidedAt: new Date() },
            });
          }, 'mpesa_failure_void');
        }
      }
    });
  } catch (compensationErr) {
    // Compensation failure must not 500 the webhook (Daraja would retry into
    // the same fault) — surface loudly for the reconciliation cron instead.
    await systemLog({
      action: 'MPESA_COMPENSATION_FAILED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.ERROR,
      message: `Failed to restock after M-Pesa failure for ${data.checkoutRequestId}: ${compensationErr instanceof Error ? compensationErr.message : String(compensationErr)}`,
      storeId: mpesaTx.storeId,
      metadata: { transactionId: mpesaTx.transactionId },
    }).catch(() => {});
  }

  if (!compensated) {
    return Response.json({ success: true, message: 'Callback already processed.' });
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

  return Response.json({ success: true, message: 'Callback processed successfully.' });
}

export const POST = withErrorBoundary(mpesaCallbackHandler, 'MPESA_CALLBACK');
