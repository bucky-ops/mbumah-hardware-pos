// M-Pesa Daraja B2C client - payroll disbursement (v2.21.0).
//
// EMS spec Phase 4.6 lists the optional M-Pesa B2C payslip disbursement and
// the infrastructure audit question "Can payroll disbursement reuse
// MpesaTransaction safely if B2C is enabled later?" - this module answers
// yes: every disbursement creates ONE MpesaTransaction row linked to its
// PayrollDetail through the additive nullable payrollDetailId column, and
// the result webhook settles the payslip through the same idempotency rules
// as the C2B callback (one receipt settles one row, callbacks are claimed
// exactly once).
//
// Safety model (mirrors mpesa-daraja.ts / callback route conventions):
//   • Server-only module. No secrets are logged; phone numbers are stored
//     but only ever rendered masked (last 3 digits) in UI payloads.
//   • When Daraja B2C credentials are NOT configured the module runs in
//     explicit MOCK mode (development / staging): rows complete immediately
//     with a SIM receipt so QA can exercise the full lifecycle end to end.
//     Production callers should refuse mock mode (see disbursement-service).
//   • Real mode: OAuth token, then POST /mpesa/b2c/v3/paymentrequest with
//     CommandID SalaryPayment. Settlement is asynchronous - Daraja calls
//     /api/payments/mpesa/b2c/result; until then the payslip stays PENDING.
//
// Server-only module.

import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { normalisePhone } from '@/lib/mpesa-daraja';

export interface PayrollB2CRequest {
  phone: string;
  amount: number; // KES, integer-safe (PayrollDetail.netPay)
  storeId: string;
  payrollDetailId: string;
  employeeCode: string;
  periodName: string;
}

export type PayrollB2CMode = 'daraja' | 'mock';

export interface PayrollB2CResult {
  mode: PayrollB2CMode;
  mpesaTransactionId: string;
  conversationId: string; // OriginatorConversationID (ours) / simulated
  providerConversationId: string | null; // Daraja ConversationID when real
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  receiptNumber: string | null; // mock receipts only (real arrives via webhook)
  message: string;
  alreadyInitiated: boolean;
}

/** True when every Daraja B2C prerequisite is present in the environment. */
export function isB2CConfigured(): boolean {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
      process.env.MPESA_CONSUMER_SECRET &&
      process.env.MPESA_SHORTCODE &&
      process.env.MPESA_INITIATOR_NAME &&
      (process.env.MPESA_INITIATOR_PASSWORD || process.env.MPESA_SECURITY_CREDENTIAL),
  );
}

/**
 * Build the Daraja SecurityCredential: the initiator password encrypted with
 * the Safaricom X.509 public certificate (RSA PKCS#1 v1.5), Base64-encoded.
 * The cert can be supplied inline (MPESA_CERT, PEM) or as a file path
 * (MPESA_CERT_PATH). Falls back to the legacy pre-computed
 * MPESA_SECURITY_CREDENTIAL when no cert is provided.
 */
export function buildSecurityCredential(): string | null {
  const preset = process.env.MPESA_SECURITY_CREDENTIAL;
  if (preset) return preset;

  const password = process.env.MPESA_INITIATOR_PASSWORD;
  if (!password) return null;

  let certPem: string | null = null;
  if (process.env.MPESA_CERT) {
    certPem = process.env.MPESA_CERT.replace(/\\n/g, '\n');
  } else if (process.env.MPESA_CERT_PATH) {
    try {
      certPem = readFileSync(process.env.MPESA_CERT_PATH, 'utf8');
    } catch {
      return null;
    }
  }
  if (!certPem) return null;

  return crypto.publicEncrypt(
    {
      key: certPem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(password),
  ).toString('base64');
}

/** Generate the OriginatorConversationID we control and persist. */
function newConversationId(): string {
  return `pb2c-${crypto.randomUUID()}`;
}

/** Perform the Daraja B2C payment request. Returns the conversation refs. */
async function darajaB2CRequest(params: {
  isProduction: boolean;
  phone: string;
  amount: number;
  originatorConversationId: string;
  remarks: string;
}): Promise<{ conversationId: string; responseCode: string; responseDescription: string }> {
  const { isProduction, phone, amount, originatorConversationId, remarks } = params;
  const baseUrl = isProduction ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

  const consumerKey = process.env.MPESA_CONSUMER_KEY as string;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET as string;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!tokenRes.ok) {
    throw new Error(`Daraja OAuth failed: ${tokenRes.status}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw new Error('Daraja OAuth returned no access_token.');

  const callbackBase = process.env.MPESA_CALLBACK_URL
    ? process.env.MPESA_CALLBACK_URL.replace(/\/api\/payments\/mpesa\/callback$/, '')
    : process.env.APP_URL || 'https://example.com';
  const securityCredential = buildSecurityCredential();
  if (!securityCredential) throw new Error('B2C security credential could not be built.');

  const payload = {
    OriginatorConversationID: originatorConversationId,
    InitiatorName: process.env.MPESA_INITIATOR_NAME,
    SecurityCredential: securityCredential,
    CommandID: 'SalaryPayment',
    Amount: Math.round(amount),
    PartyA: process.env.MPESA_SHORTCODE,
    PartyB: phone,
    Remarks: remarks.slice(0, 100),
    QueueTimeOutURL: `${callbackBase}/api/payments/mpesa/b2c/queue-timeout`,
    ResultURL: `${callbackBase}/api/payments/mpesa/b2c/result`,
    Occasion: 'Payroll',
  };

  const res = await fetch(`${baseUrl}/mpesa/b2c/v3/paymentrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let json: Record<string, string> = {};
  try {
    json = JSON.parse(raw) as Record<string, string>;
  } catch {
    // keep raw for diagnostics
  }
  if (!res.ok || (json.ResponseCode && json.ResponseCode !== '0')) {
    throw new Error(`Daraja B2C rejected: ${res.status} ${raw.slice(0, 200)}`);
  }
  return {
    conversationId: json.ConversationID || json.ConversationId || '',
    responseCode: json.ResponseCode || '0',
    responseDescription: json.ResponseDescription || json.ResponseDesc || 'Accept the service request successfully.',
  };
}

/**
 * Initiate one payslip's M-Pesa B2C salary payment.
 * Idempotent: a payslip with an active (PENDING/PROCESSING/COMPLETED)
 * disbursement transaction is never re-initiated.
 */
export async function initiatePayrollB2C(req: PayrollB2CRequest): Promise<PayrollB2CResult> {
  const formattedPhone = normalisePhone(String(req.phone));
  if (!/^254\d{9}$/.test(formattedPhone)) {
    throw new Error(
      `Invalid M-Pesa number for disbursement. Got "${formattedPhone}". Expected 2547XXXXXXXX.`,
    );
  }
  const amount = Math.round(Number(req.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Disbursement amount must be a positive number.');
  }

  // Idempotency: never re-initiate a payslip that already has an active
  // disbursement transaction (spec acceptance: no double disbursement).
  const existing = await db.mpesaTransaction.findFirst({
    where: {
      payrollDetailId: req.payrollDetailId,
      status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return {
      mode: existing.status === 'COMPLETED' ? 'mock' : 'daraja',
      mpesaTransactionId: existing.id,
      conversationId: existing.checkoutRequestId || '',
      providerConversationId: existing.merchantRequestId || null,
      status: existing.status as PayrollB2CResult['status'],
      receiptNumber: existing.mpesaReceiptNumber,
      message: 'Disbursement already initiated for this payslip.',
      alreadyInitiated: true,
    };
  }

  const originatorConversationId = newConversationId();

  // REAL DARAJA PATH
  if (isB2CConfigured()) {
    const row = await db.mpesaTransaction.create({
      data: {
        storeId: req.storeId,
        checkoutRequestId: originatorConversationId,
        phoneNumber: formattedPhone,
        amount,
        status: 'PENDING',
        payrollDetailId: req.payrollDetailId,
      },
    });
    try {
      const daraja = await darajaB2CRequest({
        isProduction: process.env.NODE_ENV === 'production',
        phone: formattedPhone,
        amount,
        originatorConversationId,
        remarks: `Salary ${req.employeeCode} ${req.periodName}`,
      });
      await db.mpesaTransaction.update({
        where: { id: row.id },
        data: {
          status: 'PROCESSING',
          merchantRequestId: daraja.conversationId || null,
          resultCode: daraja.responseCode,
          resultDesc: daraja.responseDescription.slice(0, 250),
        },
      });
      await systemLog({
        action: 'MPESA_B2C_PAYROLL_INITIATED',
        component: LogComponent.PAYMENT,
        severity: LogSeverity.INFO,
        message: `Payroll B2C initiated for ${req.employeeCode} (${formattedPhone.slice(0, 9)}***), conversation ${originatorConversationId}`,
        storeId: req.storeId,
        metadata: {
          payrollDetailId: req.payrollDetailId,
          conversationId: originatorConversationId,
          amount,
          mode: 'daraja',
        },
      }).catch(() => {});
      return {
        mode: 'daraja',
        mpesaTransactionId: row.id,
        conversationId: originatorConversationId,
        providerConversationId: daraja.conversationId || null,
        status: 'PROCESSING',
        receiptNumber: null,
        message: daraja.responseDescription,
        alreadyInitiated: false,
      };
    } catch (error) {
      await db.mpesaTransaction.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          resultDesc: (error instanceof Error ? error.message : 'B2C initiation failed').slice(0, 250),
        },
      });
      // Re-throw: for payroll the caller must NOT silently pretend money moved.
      throw error;
    }
  }

  // MOCK PATH (development / QA only - no Daraja B2C credentials configured)
  const mockReceipt = `SIM${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const row = await db.mpesaTransaction.create({
    data: {
      storeId: req.storeId,
      checkoutRequestId: originatorConversationId,
      merchantRequestId: `mock-${originatorConversationId}`,
      phoneNumber: formattedPhone,
      amount,
      status: 'COMPLETED',
      resultCode: '0',
      resultDesc: 'Mock B2C salary disbursement completed (development mode).',
      callbackReceived: true,
      mpesaReceiptNumber: mockReceipt,
      payrollDetailId: req.payrollDetailId,
    },
  });
  await systemLog({
    action: 'MPESA_B2C_PAYROLL_MOCK',
    component: LogComponent.PAYMENT,
    severity: LogSeverity.WARN,
    message: `Payroll B2C MOCK completed for ${req.employeeCode}, receipt ${mockReceipt}`,
    storeId: req.storeId,
    metadata: { payrollDetailId: req.payrollDetailId, conversationId: originatorConversationId, amount, mode: 'mock' },
  }).catch(() => {});
  return {
    mode: 'mock',
    mpesaTransactionId: row.id,
    conversationId: originatorConversationId,
    providerConversationId: null,
    status: 'COMPLETED',
    receiptNumber: mockReceipt,
    message: 'Mock disbursement completed (no Daraja B2C credentials configured).',
    alreadyInitiated: false,
  };
}
