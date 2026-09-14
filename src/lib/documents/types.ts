// src/lib/documents/types.ts — shared contract for the Document & Workflow
// Correlation Engine (directive 2):
//
//   QUOTE ──→ PROFORMA ──→ ORDER ──→ SALE(invoice) → receipt / debt ledger
//      └──────────────┴───────────────┘
//
// Only the terminal SALE document moves stock and credit; upstream documents
// are priced snapshots. All wire money fields are STRINGS (project contract).

import type { PaymentMethod } from "@/lib/types";

// ── Document lifecycle unions ───────────────────────────────────────────────

export type DocumentType = "QUOTE" | "PROFORMA" | "ORDER" | "SALE";
export type DocumentStatus =
  | "OPEN" // awaiting conversion / fulfilment
  | "CONVERTED" // succeeded by a downstream document
  | "CANCELLED"
  | "EXPIRED"
  // SALE rows reuse the sale statuses:
  | "COMPLETED"
  | "CREDIT"
  | "PARTIAL"
  | "HELD";

export const DOCUMENT_TYPES: readonly DocumentType[] = ["QUOTE", "PROFORMA", "ORDER", "SALE"];

/**
 * Allowed conversion targets per source type. SALE is terminal.
 * Enforced server-side in convertDocument() — the UI mirrors it via
 * `nextTargets` (status OPEN) so dead options never render.
 */
export const CONVERSION_MATRIX: Readonly<Record<DocumentType, readonly DocumentType[]>> = {
  QUOTE: ["PROFORMA", "ORDER", "SALE"],
  PROFORMA: ["ORDER", "SALE"],
  ORDER: ["SALE"],
  SALE: [],
};

/** Ref prefixes keep document kinds human-identifiable on printouts. */
export const DOC_REF_PREFIX: Readonly<Record<Exclude<DocumentType, "SALE">, string>> = {
  QUOTE: "Q",
  PROFORMA: "PI",
  ORDER: "SO",
};

// ── Wire DTOs ───────────────────────────────────────────────────────────────

export interface DocumentItemDTO {
  id: string;
  productId: string | null;
  description: string;
  uom: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  lineDiscount: string;
  lineNet: string;
  vatAmount: string;
  lineTotal: string;
  taxCategory: string;
}

export interface DocumentPaymentDTO {
  method: PaymentMethod;
  amount: string;
  receivedAt: string;
}

export interface DocumentDTO {
  id: string;
  ref: string;
  type: DocumentType;
  status: DocumentStatus;
  branchId: string;
  branchCode: string;
  customerId: string | null;
  customerName: string | null;
  subtotal: string;
  discountAmount: string;
  vatAmount: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  vatInclusive: boolean;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  convertedFromId: string | null;
  convertedFromRef: string | null;
  createdBy: string;
  items: DocumentItemDTO[];
  payments: DocumentPaymentDTO[];
  /** Conversions allowed RIGHT NOW (state machine ∩ status OPEN). */
  nextTargets: DocumentType[];
}

/** Leaner shape for list views (items/payments omitted). */
export interface DocumentSummaryDTO extends Omit<DocumentDTO, "items" | "payments"> {
  itemCount: number;
}

// ── Service input types (validated by zod at the route boundary) ───────────

export interface CreateDocumentInput {
  type: Exclude<DocumentType, "SALE">; // only QUOTE | PROFORMA are created directly
  customerId?: string | null;
  items: { productId: string; qty: number; discountPct?: number }[];
  vatInclusive?: boolean;
  orderDiscountPct?: number;
  validUntil?: string | null;
  notes?: string | null;
}

export interface ConvertDocumentInput {
  sourceId: string;
  targetType: Exclude<DocumentType, "QUOTE">; // PROFORMA | ORDER | SALE
  validUntil?: string | null; // carried to PROFORMA/ORDER successors
  /** SALE conversions — defaults to full CASH payment. */
  paymentMethod?: Extract<PaymentMethod, "CASH" | "MPESA" | "BANK_TRANSFER">;
  paymentAmount?: number;
  useCredit?: boolean; // charge shortfall to the customer's store-credit account
  notes?: string | null;
}
