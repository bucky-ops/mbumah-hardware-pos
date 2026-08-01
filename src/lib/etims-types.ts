// ════════════════════════════════════════════════════════════════════════════
// src/lib/etims-types.ts
// ════════════════════════════════════════════════════════════════════════════
//
// TypeScript types & enums for the KRA eTIMS (electronic Tax Invoice
// Management System) integration.
//
// These types describe the shapes exchanged with the KRA eTIMS API (register
// product, issue invoice, query status, search customer, stock master report,
// branch info) plus the internal representations stored on Product and
// SalesTransaction rows.
//
// The actual HTTP layer lives in `src/lib/etims-service.ts` and the format
// helpers (date / invoice-number / PIN validation / tax breakdown) live in
// `src/lib/etims-utils.ts`.
// ════════════════════════════════════════════════════════════════════════════

// ── Enums ────────────────────────────────────────────────────────────────────

/**
 * KRA eTIMS environments.
 *   sandbox    — etims-api-sbx.kra.go.ke (test)
 *   production — etims-api.kra.go.ke     (live)
 */
export const EtimsEnvironment = {
  SANDBOX: 'sandbox',
  PRODUCTION: 'production',
} as const;
export type EtimsEnvironment = (typeof EtimsEnvironment)[keyof typeof EtimsEnvironment];

/**
 * KRA item tax-type codes (Product.etimsTaxType).
 *   A — VAT (16% standard rate)
 *   B — Zero-rated (0% VAT, but VAT-registered)
 *   C — Exempt (no VAT charged)
 *   D — Not subject to VAT (out of scope)
 */
export const EtimsTaxType = {
  VAT: 'A',
  ZERO_RATED: 'B',
  EXEMPT: 'C',
  NOT_SUBJECT: 'D',
} as const;
export type EtimsTaxType = (typeof EtimsTaxType)[keyof typeof EtimsTaxType];

/**
 * Invoice lifecycle status (SalesTransaction.etimsStatus / InvoiceForKRA).
 *   PENDING  — Created locally, not yet submitted to KRA
 *   ISSUED   — Submitted and accepted by KRA (CU PIN + QR returned)
 *   CANCELLED — Cancelled after issue (credit note)
 *   FAILED   — Submission attempt failed (network / 4xx / 5xx)
 */
export const EtimsInvoiceStatus = {
  PENDING: 'PENDING',
  ISSUED: 'ISSUED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type EtimsInvoiceStatus = (typeof EtimsInvoiceStatus)[keyof typeof EtimsInvoiceStatus];

/**
 * eTIMS payment-method codes (KRA's PaymentMeansCd enum).
 * Mapped from internal PaymentMethod by `mapPaymentMethod` in etims-utils.
 */
export const EtimsPaymentCode = {
  CASH: '01',
  CHEQUE: '02',
  CREDIT: '03',
  CARD: '04',
  MOBILE_MONEY: '05',
  BANK_TRANSFER: '06',
  CREDIT_NOTE: '07',
  OTHER: '08',
} as const;
export type EtimsPaymentCode = (typeof EtimsPaymentCode)[keyof typeof EtimsPaymentCode];

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Configuration for an authenticated eTIMS client. Built from a store's
 * KraBusinessProfile (PIN + credentials) plus device-specific identifiers
 * (branchId, deviceSerial, BVSN) issued by KRA when the device is registered.
 */
export interface EtimsConfig {
  /** Base URL — sandbox or production. */
  baseUrl: string;
  /** Branch Verification Serial Number (issued by KRA on device registration). */
  bvsn: string;
  /** KRA PIN of the business (format: A + 9 digits + 1 letter). */
  tin: string;
  /** KRA branch ID for this store location. */
  branchId: string;
  /** Device serial number (the OSCU / SIGTU device issued by KRA). */
  deviceSerial: string;
  /** Sandbox or production. */
  environment: EtimsEnvironment;
  /** Optional pre-cached OAuth bearer token. */
  authToken?: string;
  /** Token expiry timestamp (ISO 8601). */
  authTokenExpiresAt?: string;
  /** Optional request timeout override (default 30s). */
  timeoutMs?: number;
}

// ── Product Registration ─────────────────────────────────────────────────────

/**
 * Payload for `registerProduct` — creates an item in the KRA item master.
 */
export interface EtimsProduct {
  /** Internal Product.id — used for traceability in logs. */
  productId?: string;
  /** Item name as it will appear on the KRA invoice. */
  name: string;
  /** Internal SKU / barcode. */
  sku?: string;
  /** KRA HS code (Harmonised System). Default 0000.00.00 if unknown. */
  hsCode?: string;
  /** Tax type — A/B/C/D. Defaults to A (VAT 16%). */
  taxType: EtimsTaxType;
  /** Unit of measure (PIECE, KILOGRAM, METER, etc.). */
  unitType: string;
  /** Selling price per unit (KES). */
  unitPrice: number;
  /** Optional cost price (used for stock valuation reports). */
  costPrice?: number;
  /** Optional product description. */
  description?: string;
  /** Optional manufacturer / brand. */
  manufacturer?: string;
  /** Optional country of origin (ISO 3166-1 alpha-2). */
  countryOfOrigin?: string;
}

/**
 * Response from `registerProduct`.
 */
export interface EtimsProductResponse {
  success: boolean;
  /** KRA-assigned item code (saved to Product.etimsItemCode). */
  itemCode?: string;
  /** Optional KRA reference number for the registration. */
  referenceNumber?: string;
  /** Raw KRA response for audit. */
  responseJson?: string;
  /** Error message on failure. */
  errorMessage?: string;
  /** HTTP status code from KRA. */
  httpStatus?: number;
  /** Round-trip latency in ms. */
  latencyMs: number;
}

// ── Customer ─────────────────────────────────────────────────────────────────

/**
 * Customer information for an eTIMS invoice.
 */
export interface EtimsCustomer {
  /** KRA PIN (A + 9 digits + letter). Required for B2B invoices. */
  tin?: string;
  /** Full legal name. */
  name: string;
  /** Physical address line. */
  address?: string;
  /** Email address. */
  email?: string;
  /** Phone number (Kenyan format 2547XXXXXXXX). */
  phone?: string;
  /** Optional city / town. */
  city?: string;
  /** Optional country (ISO 3166-1 alpha-2, default KE). */
  country?: string;
}

/**
 * Response from `customerSearch` (look up a customer by KRA PIN).
 */
export interface EtimsCustomerSearchResponse {
  success: boolean;
  customer?: EtimsCustomer;
  /** Raw KRA response for audit. */
  responseJson?: string;
  errorMessage?: string;
  httpStatus?: number;
  latencyMs: number;
}

// ── Invoice Items & Payments ─────────────────────────────────────────────────

/**
 * A single line item in an eTIMS invoice.
 */
export interface EtimsItem {
  /** KRA item code (from registerProduct). */
  itemCode?: string;
  /** Item name. */
  name: string;
  /** Quantity sold (supports fractional — KG, M, L). */
  qty: number;
  /** Unit price (KES, exclusive of VAT). */
  price: number;
  /** VAT rate percent (16 for A, 0 for B/C/D). */
  taxRate: number;
  /** Line discount amount (KES). */
  discount: number;
  /** HS code. */
  hsCode?: string;
  /** Tax type for this line. */
  taxType?: EtimsTaxType;
}

/**
 * A payment line in an eTIMS invoice (eTIMS supports split payments).
 */
export interface EtimsPayment {
  /** KRA payment code (EtimsPaymentCode). */
  method: EtimsPaymentCode;
  /** Amount paid in this tranche (KES). */
  amount: number;
  /** Optional reference (e.g. M-Pesa CheckoutRequestID). */
  reference?: string;
}

// ── Invoice ──────────────────────────────────────────────────────────────────

/**
 * Payload for `issueInvoice` — the full electronic tax invoice.
 */
export interface EtimsInvoice {
  /** KRA-compliant invoice number (format: <TIN>-<YYYYMMDD>-<seq>). */
  invoiceNumber: string;
  /** Issue date (ISO 8601). */
  issueDate: string;
  /** Customer details (walk-in if no TIN). */
  customer: EtimsCustomer;
  /** Line items. */
  items: EtimsItem[];
  /** Payment lines. */
  payments: EtimsPayment[];
  /** Subtotal (sum of line totals, pre-discount, pre-VAT). */
  subtotal: number;
  /** Total discount amount. */
  totalDiscount: number;
  /** Total VAT (sum of per-line VAT). */
  totalVat: number;
  /** Total invoice amount (subtotal - discount + VAT). */
  totalAmount: number;
  /** Optional currency code (default KES). */
  currency?: string;
  /** Optional POS receipt number for cross-reference. */
  receiptNumber?: string;
}

/**
 * Response from `issueInvoice`.
 */
export interface EtimsInvoiceResponse {
  success: boolean;
  /** The invoice number KRA accepted. */
  invoiceNumber?: string;
  /** CU PIN returned by KRA (printed on the receipt). */
  cuPin?: string;
  /** QR code data string (Base64 or URL-encoded). */
  qrCode?: string;
  /** Verification URL (e.g. https://verify.etims.kra.go.ke/...). */
  url?: string;
  /** KRA reference number for the submission. */
  referenceNumber?: string;
  /** Lifecycle status. */
  status: EtimsInvoiceStatus;
  /** Raw KRA response for audit. */
  responseJson?: string;
  errorMessage?: string;
  httpStatus?: number;
  latencyMs: number;
}

/**
 * Response from `getInvoiceStatus` (poll a submitted invoice).
 */
export interface EtimsInvoiceStatusResponse {
  success: boolean;
  invoiceNumber: string;
  status: EtimsInvoiceStatus;
  /** Optional reference / CU pin echoed back by KRA. */
  referenceNumber?: string;
  cuPin?: string;
  responseJson?: string;
  errorMessage?: string;
  httpStatus?: number;
  latencyMs: number;
}

/**
 * Response from `cancelInvoice`.
 */
export interface EtimsCancelResponse {
  success: boolean;
  invoiceNumber: string;
  status: EtimsInvoiceStatus;
  /** KRA cancellation reference (credit-note number). */
  cancellationReference?: string;
  responseJson?: string;
  errorMessage?: string;
  httpStatus?: number;
  latencyMs: number;
}

// ── Branch Info ──────────────────────────────────────────────────────────────

/**
 * Response from `branchInfo` — fetches metadata about the KRA-registered
 * branch (address, contact, registration status).
 */
export interface EtimsBranchInfo {
  success: boolean;
  branchId?: string;
  branchName?: string;
  address?: string;
  vatNumber?: string;
  status?: string;
  responseJson?: string;
  errorMessage?: string;
  httpStatus?: number;
  latencyMs: number;
}

// ── Stock Master Report ──────────────────────────────────────────────────────

/**
 * A single row in the KRA stock master report.
 */
export interface EtimsStockRow {
  itemCode: string;
  itemName: string;
  hsCode?: string;
  unitType: string;
  /** Opening stock quantity for the period. */
  openingStock: number;
  /** Closing stock quantity for the period. */
  closingStock: number;
  /** Quantity sold during the period. */
  quantitySold: number;
  /** Quantity purchased during the period. */
  quantityPurchased: number;
  /** Quantity adjusted (write-offs, transfers). */
  quantityAdjusted: number;
  /** Cost value of closing stock (KES). */
  closingStockValue: number;
}

/**
 * Response from `stockMasterReport`.
 */
export interface EtimsStockMasterResponse {
  success: boolean;
  storeId: string;
  startDate: string;
  endDate: string;
  rows: EtimsStockRow[];
  /** Summary totals. */
  summary: {
    totalItems: number;
    totalClosingValue: number;
    totalSold: number;
    totalPurchased: number;
  };
  responseJson?: string;
  errorMessage?: string;
  latencyMs: number;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Typed error for eTIMS operations. Carries the HTTP status (when available)
 * and an optional KRA error code so the API route can return a structured
 * 4xx/5xx response rather than a generic 500.
 */
export class EtimsError extends Error {
  public readonly code: string;
  public readonly httpStatus?: number;
  public readonly krapErrorCode?: string;
  public readonly responseJson?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      httpStatus?: number;
      krapErrorCode?: string;
      responseJson?: string;
    } = {},
  ) {
    super(message);
    this.name = 'EtimsError';
    this.code = options.code || 'ETIMS_ERROR';
    this.httpStatus = options.httpStatus;
    this.krapErrorCode = options.krapErrorCode;
    this.responseJson = options.responseJson;
  }

  /** True if the underlying cause is retryable (5xx or network). */
  isRetryable(): boolean {
    if (this.httpStatus === undefined) return true; // network error
    return this.httpStatus >= 500;
  }
}

// ── Client interface ─────────────────────────────────────────────────────────

/**
 * Abstract eTIMS client. API routes depend on this interface, not the
 * concrete `EtimsClient` class, so the KRA endpoint can be swapped or mocked
 * without touching the routes.
 */
export interface IEtimsClient {
  /** Register a product with KRA (item creation). */
  registerProduct(product: EtimsProduct): Promise<EtimsProductResponse>;

  /** Issue an electronic tax invoice. */
  issueInvoice(invoice: EtimsInvoice): Promise<EtimsInvoiceResponse>;

  /** Cancel an issued invoice (credit note). */
  cancelInvoice(invoiceNumber: string, reason: string): Promise<EtimsCancelResponse>;

  /** Query the status of a previously-submitted invoice. */
  getInvoiceStatus(invoiceNumber: string): Promise<EtimsInvoiceStatusResponse>;

  /** Generate a stock master report for the date range. */
  stockMasterReport(storeId: string, startDate: Date, endDate: Date): Promise<EtimsStockMasterResponse>;

  /** Fetch the KRA-registered branch info. */
  branchInfo(): Promise<EtimsBranchInfo>;

  /** Search a customer by KRA PIN. */
  customerSearch(tin: string): Promise<EtimsCustomerSearchResponse>;
}
