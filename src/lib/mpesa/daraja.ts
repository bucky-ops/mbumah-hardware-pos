import { ApiError } from "@/lib/api-error-handler";
import { balanceDue, round2 } from "@/lib/format";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Safaricom Daraja client (STK Push / Lipa na M-Pesa Online).
//
// MOCK MODE: when MPESA_CONSUMER_KEY is absent (or MPESA_MODE=mock) the stack
// runs fully offline — routes create synthetic MpesaTransaction rows and the
// status endpoint simulates a PIN entry. No network calls are made.
//
// SPOOF-RESISTANCE (the core security property of this stack):
// Safaricom callbacks are unauthenticated HTTP POSTs from the public internet
// (only our optional shared-secret header protects them, and that header can
// leak). Therefore a callback payload is NEVER trusted on its own. Before any
// DB write that marks money as received, the transaction state is cross-checked
// with Daraja itself via `stkQuery` — an authenticated call made WITH OUR OWN
// credentials, whose answer is the only source of truth. See the callback
// route's `after()` handler: query first, settle from the query result, and
// only fall back to (clearly marked unverified) payload data if the query is
// unreachable.
// ─────────────────────────────────────────────────────────────────────────────

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

// Public sandbox passkey documented by Safaricom for the default test paybill
// 174379 — safe to embed as a fallback for sandbox development.
const SANDBOX_PASSKEY =
  "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919";

const HTTP_TIMEOUT_MS = 10_000;

/** True when the stack should simulate M-Pesa instead of calling Daraja. */
export function isMockMode(): boolean {
  return !process.env.MPESA_CONSUMER_KEY || process.env.MPESA_MODE === "mock";
}

function baseUrl(): string {
  return process.env.MPESA_ENV === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

function credentials(): { key: string; secret: string } {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new ApiError(500, "M-Pesa consumer credentials are not configured");
  }
  return { key, secret };
}

/** fetch with a hard 10s timeout — Daraja must never hang a request thread. */
async function darajaFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

// ── OAuth ────────────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Cached OAuth access token (Basic auth), refreshed 60s before expiry. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

  const { key, secret } = credentials();
  const res = await darajaFetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
    },
  });
  if (!res.ok) throw new ApiError(502, `Daraja OAuth failed (HTTP ${res.status})`);

  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: string };
  if (!data.access_token) throw new ApiError(502, "Daraja OAuth response missing access_token");

  const ttl = Number(data.expires_in ?? "3599") || 3599;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return cachedToken.token;
}

// ── Timestamp helpers ────────────────────────────────────────────────────────

/** Nairobi-wall-clock timestamp in Daraja's yyyyMMddHHmmss format. */
function nairobiTimestamp(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

function stkPassword(timestamp: string): string {
  const shortcode = process.env.MPESA_SHORTCODE || "174379";
  const passkey = process.env.MPESA_PASSKEY || SANDBOX_PASSKEY;
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

// ── STK Push ─────────────────────────────────────────────────────────────────

export type MpesaPurpose = "SALE" | "DEBT_REPAYMENT";

export interface StkPushArgs {
  phone: string; // normalized 2547XXXXXXXX
  amount: number;
  ref: string; // account reference (≤12 chars after sanitization)
  purpose: MpesaPurpose;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  responseDescription: string;
}

/** Initiates an STK push (Lipa na M-Pesa Online) and returns Daraja's request ids. */
export async function initiateStkPush({ phone, amount, ref, purpose }: StkPushArgs): Promise<StkPushResult> {
  const shortcode = process.env.MPESA_SHORTCODE || "174379";
  const timestamp = nairobiTimestamp();
  const token = await getAccessToken();

  const res = await darajaFetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.max(1, Math.round(amount)),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: `${process.env.APP_URL || "http://localhost:3000"}/api/v1/payments/mpesa/callback`,
      AccountReference: ref.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 12) || "MBUMAH",
      TransactionDesc: purpose === "DEBT_REPAYMENT" ? "Mbumah debt repayment" : "Mbumah hardware sale",
    }),
  });
  if (!res.ok) throw new ApiError(502, `Daraja STK push failed (HTTP ${res.status})`);

  const data = (await res.json().catch(() => ({}))) as {
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    ResponseDescription?: string;
    errorMessage?: string;
  };
  if (!data.CheckoutRequestID) {
    throw new ApiError(502, data.errorMessage || "STK push rejected by Daraja");
  }
  return {
    checkoutRequestId: data.CheckoutRequestID,
    merchantRequestId: data.MerchantRequestID ?? "",
    responseDescription: data.ResponseDescription ?? "Success. Request accepted for processing",
  };
}

// ── STK Query ────────────────────────────────────────────────────────────────

export interface StkQueryResult {
  ResultCode: number;
  ResultDesc: string;
}

/**
 * Authenticated status cross-check with Daraja. This — not the callback
 * payload — is the authoritative answer about whether a customer actually
 * entered their PIN. ResultCode 0 = success.
 */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  const shortcode = process.env.MPESA_SHORTCODE || "174379";
  const timestamp = nairobiTimestamp();
  const token = await getAccessToken();

  const res = await darajaFetch(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: stkPassword(timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });
  if (!res.ok) throw new ApiError(502, `Daraja STK query failed (HTTP ${res.status})`);

  const data = (await res.json().catch(() => ({}))) as {
    ResultCode?: number | string;
    ResultDesc?: string;
    errorMessage?: string;
  };
  if (data.ResultCode === undefined) {
    throw new ApiError(502, data.errorMessage || "Daraja STK query returned no ResultCode");
  }
  return { ResultCode: Number(data.ResultCode), ResultDesc: String(data.ResultDesc ?? "") };
}

// ── Idempotent settlement ────────────────────────────────────────────────────

export interface SettleMpesaArgs {
  checkoutRequestId: string;
  resultCode: number;
  resultDesc?: string | null;
  mpesaReceipt?: string | null;
  merchantRequestId?: string | null;
  /** true ONLY when the result was cross-verified with Daraja (stkQuery). */
  verified?: boolean;
}

export interface SettleMpesaResult {
  ok: boolean;
  alreadySettled?: boolean;
  status?: "SUCCESS" | "FAILED";
  paymentApplied?: boolean;
}

/**
 * SHARED idempotent settlement — the ONLY code path allowed to flip a
 * MpesaTransaction to SUCCESS/FAILED (used by the callback webhook, the mock
 * simulator and the status poller alike).
 *
 *  • Unknown checkoutRequestId            → { ok: false } (caller decides).
 *  • Already SUCCESS/FAILED               → { ok: true, alreadySettled } (no double-writes).
 *  • resultCode !== 0                     → status FAILED.
 *  • resultCode === 0                     → status SUCCESS (+verified) and, when the STK
 *    was linked to a real Transaction (transactionId), an atomic MPESA Payment is
 *    created for min(balanceDue, mpesa.amount) and the transaction's
 *    amountPaid / balanceDue / status are recomputed.
 *
 * Everything runs in one db.$transaction so callback retries can never double-
 * credit a sale.
 */
export async function settleMpesa({
  checkoutRequestId,
  resultCode,
  resultDesc,
  mpesaReceipt,
  merchantRequestId,
  verified = false,
}: SettleMpesaArgs): Promise<SettleMpesaResult> {
  return db.$transaction(async (tx) => {
    const mpesa = await tx.mpesaTransaction.findUnique({ where: { checkoutRequestId } });
    if (!mpesa) return { ok: false };

    // Idempotency gate: a settled transaction is immutable.
    if (mpesa.status === "SUCCESS" || mpesa.status === "FAILED") {
      return { ok: true, alreadySettled: true, status: mpesa.status as "SUCCESS" | "FAILED" };
    }

    if (resultCode !== 0) {
      await tx.mpesaTransaction.update({
        where: { id: mpesa.id },
        data: {
          status: "FAILED",
          resultCode,
          resultDesc: resultDesc ?? "Payment failed",
          merchantRequestId: merchantRequestId ?? mpesa.merchantRequestId,
          verified,
        },
      });
      return { ok: true, status: "FAILED" as const, paymentApplied: false };
    }

    await tx.mpesaTransaction.update({
      where: { id: mpesa.id },
      data: {
        status: "SUCCESS",
        resultCode: 0,
        resultDesc: resultDesc ?? "The service request is processed successfully.",
        mpesaReceipt: mpesaReceipt ?? mpesa.mpesaReceipt,
        merchantRequestId: merchantRequestId ?? mpesa.merchantRequestId,
        verified,
      },
    });

    // Link to an existing receivable (e.g. STK fired against a PARTIAL/CREDIT
    // transaction): book the money as an MPESA payment on that transaction.
    if (mpesa.transactionId) {
      const txn = await tx.transaction.findUnique({
        where: { id: mpesa.transactionId },
        include: { payments: false },
      });
      if (txn) {
        const outstanding = round2(Number(txn.balanceDue));
        const amount = round2(Math.min(outstanding, Number(mpesa.amount)));
        if (amount > 0) {
          await tx.payment.create({
            data: {
              transactionId: txn.id,
              branchId: txn.branchId,
              method: "MPESA",
              amount,
              reference: mpesaReceipt ?? null,
              status: "COMPLETED",
            },
          });
          const amountPaid = round2(Number(txn.amountPaid) + amount);
          const balance = balanceDue(Number(txn.totalAmount), amountPaid);
          await tx.transaction.update({
            where: { id: txn.id },
            data: {
              amountPaid,
              balanceDue: balance,
              status: balance <= 0 ? "COMPLETED" : "PARTIAL",
            },
          });
          return { ok: true, status: "SUCCESS" as const, paymentApplied: true };
        }
      }
    }

    return { ok: true, status: "SUCCESS" as const, paymentApplied: false };
  });
}
