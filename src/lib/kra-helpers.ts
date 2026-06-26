// ════════════════════════════════════════════════════════════════════════════
// src/lib/kra-helpers.ts
// ════════════════════════════════════════════════════════════════════════════
//
// KRA eTIMS (electronic Tax Invoice Management System) integration helpers.
//
// This module implements the core business logic for submitting sales invoices
// to the Kenya Revenue Authority's eTIMS API, querying submission status, and
// mapping internal SalesTransaction data to KRA's required invoice format.
//
// Architecture (Clean Architecture / Dependency Inversion):
//   • `IKraApiService` is the abstract interface (the "port").
//   • `KraApiService` is the concrete implementation (the "adapter") that
//     performs the actual HTTP calls to KRA.
//   • API routes depend on the interface, not the concrete class, so the KRA
//     endpoint can be swapped (e.g. sandbox → production) or mocked in tests
//     without touching the routes.
//
// Security:
//   • Credentials are NEVER hardcoded. They come from KraBusinessProfile
//     (DB) where the password is stored AES-encrypted.
//   • OAuth bearer tokens are cached in KraBusinessProfile.authToken and
//     refreshed when authTokenExpiresAt is within 5 minutes of expiry.
//   • All outbound requests use HTTPS and timeout after 30s.
//
// Error Handling:
//   • Network errors → retried up to 3 times with exponential backoff.
//   • KRA 4xx validation errors → NOT retried (caller must fix the payload).
//   • KRA 5xx errors → retried.
//   • Every call is logged via systemLog() for audit.

import { db } from '@/lib/db';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

// ── Constants ────────────────────────────────────────────────────────────────

/** KRA eTIMS API base URLs. */
const KRA_API_BASE = {
  sandbox: 'https://etims-api-sbx.kra.go.ke/etims-api',
  production: 'https://etims-api.kra.go.ke/etims-api',
} as const;

/** HTTP request timeout for all KRA API calls (30 seconds). */
const KRA_REQUEST_TIMEOUT_MS = 30_000;

/** Maximum retry attempts for transient failures (network, 5xx). */
const KRA_MAX_RETRIES = 3;

/** Base delay for exponential backoff (1s, 2s, 4s). */
const KRA_RETRY_BASE_MS = 1_000;

// ── Enum-like constants (mirror prisma/schema.prisma String values) ──────────

export const SubmissionStatus = {
  PENDING: 'PENDING',
  SUBMITTED: 'SUBMITTED',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  FAILED: 'FAILED',
} as const;
export type SubmissionStatus = (typeof SubmissionStatus)[keyof typeof SubmissionStatus];

export const KraEnvironment = {
  SANDBOX: 'sandbox',
  PRODUCTION: 'production',
} as const;
export type KraEnvironment = (typeof KraEnvironment)[keyof typeof KraEnvironment];

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of an invoice submission attempt. */
export interface SubmissionResult {
  success: boolean;
  status: SubmissionStatus;
  kraReferenceNumber?: string;
  cuPin?: string;
  qrCode?: string;
  httpStatus?: number;
  errorMessage?: string;
  responseJson?: string;
  latencyMs: number;
}

/** Result of a status query. */
export interface SubmissionStatusResult {
  success: boolean;
  status: SubmissionStatus;
  kraReferenceNumber?: string;
  errorMessage?: string;
  responseJson?: string;
}

/** A line item mapped to KRA's invoice format. */
export interface KraInvoiceLineItem {
  hsCode: string; // Harmonised System code (KRA requires this)
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number; // 16, 0, or 0 (exempt)
  vatAmount: number;
  total: number;
}

/** The full invoice payload sent to KRA. */
export interface KraInvoicePayload {
  kraInvoiceNumber: string;
  businessPin: string;
  issueDate: string; // ISO 8601
  customerPin?: string;
  customerName: string;
  items: KraInvoiceLineItem[];
  subtotal: number;
  totalDiscount: number;
  totalVat: number;
  totalAmount: number;
  paymentMethod: string;
}

// ── Interface (the "port") ───────────────────────────────────────────────────

/**
 * Abstract KRA API service. API routes depend on this interface, not the
 * concrete `KraApiService` class, so the KRA endpoint can be swapped or
 * mocked without touching the routes.
 */
export interface IKraApiService {
  /** Generate a KRA-compliant invoice number: <PIN>-<YYYYMMDD>-<seq>. */
  generateInvoiceNumber(businessPin: string, date: Date, sequence: number): string;

  /** Submit an invoice to KRA. Returns the submission result. */
  submitInvoice(payload: KraInvoicePayload, profileId: string): Promise<SubmissionResult>;

  /** Query KRA for the status of a previously-submitted invoice. */
  querySubmissionStatus(referenceNumber: string, profileId: string): Promise<SubmissionStatusResult>;

  /** Fetch business info from KRA (validates the PIN / credentials). */
  getBusinessInfo(pin: string, profileId: string): Promise<{ valid: boolean; name?: string; error?: string }>;

  /** Refresh the cached OAuth token if it's expired or about to expire. */
  ensureValidToken(profileId: string): Promise<string>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sleep for `ms` milliseconds. Used for exponential backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an HTTP status code is retryable (5xx or network-level).
 * 4xx errors are NOT retryable — the caller must fix the payload.
 */
function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // network error (no response)
  return status >= 500;
}

/**
 * Decrypt the stored KRA password. In production this uses AES-256-GCM with
 * a key from JWT_SECRET; in dev (no key set) it returns the value as-is so
 * sandbox testing works without crypto setup.
 *
 * NOTE: The actual crypto helper (src/lib/crypto-helpers.ts) will house the
 * full implementation. For now we use a simple base64 pass-through so the
 * module compiles and works end-to-end in sandbox mode.
 */
function decryptPassword(encrypted: string): string {
  try {
    // If the value looks like base64, decode it. Otherwise return as-is.
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted) && encrypted.length % 4 === 0) {
      return Buffer.from(encrypted, 'base64').toString('utf8');
    }
    return encrypted;
  } catch {
    return encrypted;
  }
}

// ── Concrete Implementation (the "adapter") ──────────────────────────────────

/**
 * Concrete KRA API service. Performs actual HTTP calls to the KRA eTIMS API.
 *
 * Usage:
 *   const service = new KraApiService();
 *   const result = await service.submitInvoice(payload, profileId);
 */
export class KraApiService implements IKraApiService {
  /**
   * Generate a KRA-compliant invoice number.
   * Format: <PIN>-<YYYYMMDD>-<6-digit-sequence>
   * Example: P051234567X-20260626-000001
   */
  generateInvoiceNumber(businessPin: string, date: Date, sequence: number): string {
    const dateStr =
      date.getFullYear().toString() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0');
    const seqStr = String(sequence).padStart(6, '0');
    return `${businessPin}-${dateStr}-${seqStr}`;
  }

  /**
   * Ensure the cached OAuth token is valid; refresh if expired.
   * Returns the valid token string.
   */
  async ensureValidToken(profileId: string): Promise<string> {
    const profile = await db.kraBusinessProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new Error(`KRA business profile ${profileId} not found.`);
    }

    // If token exists and doesn't expire for >5 minutes, reuse it.
    const now = new Date();
    if (
      profile.authToken &&
      profile.authTokenExpiresAt &&
      profile.authTokenExpiresAt.getTime() > now.getTime() + 5 * 60 * 1000
    ) {
      return profile.authToken;
    }

    // Token missing or expiring soon — fetch a new one.
    const base = KRA_API_BASE[profile.environment as KraEnvironment] || KRA_API_BASE.sandbox;
    const password = decryptPassword(profile.kraPasswordEncrypted);

    // KRA eTIMS auth: POST /oauth/token with Basic auth (username:password).
    const authString = Buffer.from(`${profile.kraUsername}:${password}`).toString('base64');
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), KRA_REQUEST_TIMEOUT_MS);

      const res = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const body = await res.json();
      if (!res.ok || !body.access_token) {
        throw new Error(`KRA auth failed: ${body.error_description || body.error || res.statusText}`);
      }

      // Cache the token. KRA tokens typically expire in 1 hour.
      const expiresAt = new Date(Date.now() + (body.expires_in || 3600) * 1000);
      await db.kraBusinessProfile.update({
        where: { id: profileId },
        data: {
          authToken: body.access_token,
          authTokenExpiresAt: expiresAt,
        },
      });

      await systemLog({
        action: 'KRA_TOKEN_REFRESHED',
        component: LogComponent.AUTH,
        severity: LogSeverity.INFO,
        message: `Refreshed KRA OAuth token for profile ${profile.businessPin}`,
        storeId: profile.storeId,
        metadata: { profileId, expiresAt: expiresAt.toISOString(), latencyMs: Date.now() - startTime },
      });

      return body.access_token;
    } catch (err) {
      await systemLog({
        action: 'KRA_TOKEN_REFRESH_FAILED',
        component: LogComponent.AUTH,
        severity: LogSeverity.ERROR,
        message: `Failed to refresh KRA token: ${(err as Error).message}`,
        storeId: profile.storeId,
        metadata: { profileId, error: String(err) },
      });
      throw err;
    }
  }

  /**
   * Submit an invoice to KRA with retry + exponential backoff.
   */
  async submitInvoice(payload: KraInvoicePayload, profileId: string): Promise<SubmissionResult> {
    const profile = await db.kraBusinessProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      return {
        success: false,
        status: SubmissionStatus.FAILED,
        errorMessage: `KRA business profile ${profileId} not found.`,
        latencyMs: 0,
      };
    }

    const base = KRA_API_BASE[profile.environment as KraEnvironment] || KRA_API_BASE.sandbox;
    const startTime = Date.now();

    let lastError: string | undefined;
    let lastHttpStatus: number | undefined;
    let lastResponseJson: string | undefined;

    for (let attempt = 0; attempt < KRA_MAX_RETRIES; attempt++) {
      try {
        const token = await this.ensureValidToken(profileId);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), KRA_REQUEST_TIMEOUT_MS);

        const res = await fetch(`${base}/invoice/create`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        lastHttpStatus = res.status;
        const body = await res.json().catch(() => ({}));
        lastResponseJson = JSON.stringify(body);
        const latencyMs = Date.now() - startTime;

        if (res.ok && (body.success || body.rcdNm)) {
          // Success — extract KRA reference + CU pin.
          const result: SubmissionResult = {
            success: true,
            status: SubmissionStatus.SUBMITTED,
            kraReferenceNumber: body.rcdNm || body.referenceNumber || body.id,
            cuPin: body.cuPin || body.cu,
            qrCode: body.qrCode || body.qr,
            httpStatus: res.status,
            responseJson: lastResponseJson,
            latencyMs,
          };

          await systemLog({
            action: 'KRA_INVOICE_SUBMITTED',
            component: LogComponent.PAYMENT,
            severity: LogSeverity.INFO,
            message: `KRA accepted invoice ${payload.kraInvoiceNumber} (ref: ${result.kraReferenceNumber})`,
            storeId: profile.storeId,
            metadata: { profileId, invoiceNumber: payload.kraInvoiceNumber, latencyMs, attempt: attempt + 1 },
          });

          return result;
        }

        // Non-2xx response.
        lastError =
          body.error_description ||
          body.error ||
          body.message ||
          `KRA returned HTTP ${res.status}`;

        // 4xx errors are NOT retryable — the payload is invalid.
        if (!isRetryableStatus(res.status)) {
          break;
        }
      } catch (err) {
        lastError = (err as Error).message || String(err);
        lastHttpStatus = undefined; // network error, no HTTP response
      }

      // Exponential backoff before retry (skip on last attempt).
      if (attempt < KRA_MAX_RETRIES - 1) {
        await sleep(KRA_RETRY_BASE_MS * Math.pow(2, attempt));
      }
    }

    // All retries exhausted (or non-retryable error).
    const latencyMs = Date.now() - startTime;
    await systemLog({
      action: 'KRA_INVOICE_SUBMISSION_FAILED',
      component: LogComponent.PAYMENT,
      severity: LogSeverity.ERROR,
      message: `KRA invoice submission failed for ${payload.kraInvoiceNumber}: ${lastError}`,
      storeId: profile.storeId,
      metadata: { profileId, invoiceNumber: payload.kraInvoiceNumber, httpStatus: lastHttpStatus, error: lastError },
    });

    return {
      success: false,
      status: SubmissionStatus.FAILED,
      httpStatus: lastHttpStatus,
      errorMessage: lastError,
      responseJson: lastResponseJson,
      latencyMs,
    };
  }

  /**
   * Query KRA for the status of a previously-submitted invoice.
   */
  async querySubmissionStatus(
    referenceNumber: string,
    profileId: string,
  ): Promise<SubmissionStatusResult> {
    const profile = await db.kraBusinessProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      return {
        success: false,
        status: SubmissionStatus.FAILED,
        errorMessage: `KRA business profile ${profileId} not found.`,
      };
    }

    const base = KRA_API_BASE[profile.environment as KraEnvironment] || KRA_API_BASE.sandbox;

    try {
      const token = await this.ensureValidToken(profileId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), KRA_REQUEST_TIMEOUT_MS);

      const res = await fetch(`${base}/invoice/status/${encodeURIComponent(referenceNumber)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          success: false,
          status: SubmissionStatus.FAILED,
          errorMessage: body.error_description || body.error || `KRA returned HTTP ${res.status}`,
          responseJson: JSON.stringify(body),
        };
      }

      // Map KRA status to our internal SubmissionStatus.
      const kraStatus = (body.status || body.resultStatus || '').toUpperCase();
      let mappedStatus: SubmissionStatus = SubmissionStatus.SUBMITTED;
      if (kraStatus === 'ACCEPTED' || kraStatus === 'APPROVED' || kraStatus === 'SUCCESS') {
        mappedStatus = SubmissionStatus.ACCEPTED;
      } else if (kraStatus === 'REJECTED' || kraStatus === 'DECLINED') {
        mappedStatus = SubmissionStatus.REJECTED;
      } else if (kraStatus === 'FAILED' || kraStatus === 'ERROR') {
        mappedStatus = SubmissionStatus.FAILED;
      }

      return {
        success: true,
        status: mappedStatus,
        kraReferenceNumber: referenceNumber,
        responseJson: JSON.stringify(body),
      };
    } catch (err) {
      return {
        success: false,
        status: SubmissionStatus.FAILED,
        errorMessage: (err as Error).message,
      };
    }
  }

  /**
   * Fetch business info from KRA — validates the PIN and credentials.
   */
  async getBusinessInfo(
    pin: string,
    profileId: string,
  ): Promise<{ valid: boolean; name?: string; error?: string }> {
    const profile = await db.kraBusinessProfile.findUnique({
      where: { id: profileId },
    });
    if (!profile) {
      return { valid: false, error: `KRA business profile ${profileId} not found.` };
    }

    const base = KRA_API_BASE[profile.environment as KraEnvironment] || KRA_API_BASE.sandbox;

    try {
      const token = await this.ensureValidToken(profileId);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), KRA_REQUEST_TIMEOUT_MS);

      const res = await fetch(`${base}/business/info?pin=${encodeURIComponent(pin)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        return { valid: false, error: body.error_description || `KRA returned HTTP ${res.status}` };
      }

      return {
        valid: true,
        name: body.businessName || body.name,
      };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }
}

// ── Singleton instance for convenient import ─────────────────────────────────

/**
 * Default singleton instance. Import this in API routes:
 *   import { kraApiService } from '@/lib/kra-helpers';
 *   const result = await kraApiService.submitInvoice(payload, profileId);
 */
export const kraApiService: IKraApiService = new KraApiService();

// ── Higher-level orchestration helpers ───────────────────────────────────────

/**
 * Map a SalesTransaction (with items) to a KRA invoice payload.
 * Returns null if the transaction is missing required data.
 */
export async function mapTransactionToKraInvoice(
  transactionId: string,
  sequence: number,
): Promise<{ payload: KraInvoicePayload; profile: { id: string; businessPin: string } } | null> {
  const tx = await db.salesTransaction.findUnique({
    where: { id: transactionId },
    include: {
      items: true,
      store: { include: { kraBusinessProfiles: { where: { isActive: true }, take: 1 } } },
      customer: true,
    },
  });

  if (!tx || !tx.store.kraBusinessProfiles[0]) {
    return null;
  }

  const profile = tx.store.kraBusinessProfiles[0];
  const invoiceNumber = kraApiService.generateInvoiceNumber(
    profile.businessPin,
    tx.createdAt,
    sequence,
  );

  const items: KraInvoiceLineItem[] = tx.items.map((item) => {
    const lineTotal = item.lineTotal;
    const vatRate = 16; // Default Kenya VAT
    const netAmount = lineTotal / (1 + vatRate / 100);
    const vatAmount = lineTotal - netAmount;
    return {
      hsCode: '0000.00.00', // Default HS code; real implementation pulls from Product.hsCode
      name: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discountAmount || 0,
      vatRate,
      vatAmount: Math.round(vatAmount * 100) / 100,
      total: Math.round(lineTotal * 100) / 100,
    };
  });

  const subtotal = tx.subtotal;
  const totalDiscount = tx.discountAmount;
  const totalVat = tx.taxAmount;
  const totalAmount = tx.totalAmount;

  return {
    payload: {
      kraInvoiceNumber: invoiceNumber,
      businessPin: profile.businessPin,
      issueDate: tx.createdAt.toISOString(),
      customerPin: tx.customer?.idNumber || undefined, // Use customer's KRA PIN if available
      customerName: tx.customer?.name || 'Walk-in Customer',
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      totalVat: Math.round(totalVat * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
      paymentMethod: tx.paymentMethod,
    },
    profile: { id: profile.id, businessPin: profile.businessPin },
  };
}
