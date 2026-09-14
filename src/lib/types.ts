// Shared domain types for Mbumah Hardware POS.
// Decimal values arrive over the wire as strings (Prisma Decimal JSON
// serialization) — always route them through src/lib/format.ts helpers.

export type Role = "OWNER" | "MANAGER" | "CASHIER";

export const ROLES: Role[] = ["OWNER", "MANAGER", "CASHIER"];

/** Route-prefix RBAC policy enforced in src/proxy.ts (Next 16 edge proxy —
 *  defense layer 1) and re-verified per-route (defense layer 2).
 *
 *  AUDIT ALIGNMENT (Task 23): every prefix below was cross-checked against the
 *  route-level requireRole() calls so layer 1 is exactly as strict as layer 2:
 *  • /api/v1/reports|stocktake|drawer + /api/inventory — all MANAGER+ routes.
 *  • Credit sub-prefixes are listed individually (NOT a blanket /api/v1/credit
 *    rule) because POST /api/v1/credit/repay is deliberately any-role (till
 *    operators record M-Pesa repayments).
 *  • /api/customers + /api/products stay OUT (GET is any-auth for the POS
 *    catalog / customer attach; the routes gate their own writes).
 */
export const ROLE_ROUTE_POLICY: Array<{
  prefix: string;
  minRole: Role;
}> = [
  { prefix: "/api/users", minRole: "MANAGER" },
  { prefix: "/api/branches", minRole: "MANAGER" },
  { prefix: "/api/audit", minRole: "MANAGER" },
  { prefix: "/api/reports", minRole: "MANAGER" }, // legacy shape (no /v1 routes exist)
  { prefix: "/api/admin", minRole: "OWNER" },
  { prefix: "/api/v1/reports", minRole: "MANAGER" }, // eod / reorder / sales-insights
  { prefix: "/api/v1/stocktake", minRole: "MANAGER" },
  { prefix: "/api/v1/drawer", minRole: "MANAGER" },
  { prefix: "/api/inventory", minRole: "MANAGER" }, // movements + adjust
  { prefix: "/api/v1/credit/aging", minRole: "MANAGER" },
  { prefix: "/api/v1/credit/guarantors", minRole: "MANAGER" },
  { prefix: "/api/v1/credit/remind", minRole: "MANAGER" },
  { prefix: "/api/v1/credit/debt-plans", minRole: "MANAGER" }, // aligned with layer 2 (was CASHIER)
  { prefix: "/api/v1/credit/customers", minRole: "MANAGER" }, // statements
];

const RANK: Record<Role, number> = { CASHIER: 0, MANAGER: 1, OWNER: 2 };
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** Authenticated principal embedded in the JWT (HttpOnly cookie). */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string;
  branchName?: string;
}

export type PaymentMethod =
  | "CASH"
  | "MPESA"
  | "BANK_TRANSFER"
  | "CARD"
  | "STORE_CREDIT";
export const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "MPESA",
  "BANK_TRANSFER",
  "CARD",
  "STORE_CREDIT",
];

export type ProductUnit = "PCS" | "KG" | "M" | "FT" | "BOX" | "LTR";

/** Client-facing product (decimals serialized as string). */
export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  sellingPrice: string;
  buyingPrice: string;
  stockQty: string;
  reorderLevel: string;
  hsCode: string | null;
  isTaxExempt: boolean;
  branchId: string;
}

export interface Customer {
  id: string;
  name: string;
  phoneMasked?: string | null;
  kraPin?: string | null;
  creditLimit: string;
  currentBalance: string;
  riskScore: number;
  branchId: string;
}

export interface CartLine {
  lineId: string;
  productId: string;
  sku: string;
  description: string;
  uom: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
  isTaxExempt?: boolean;
}

export interface CartTotals {
  grossSubtotal: number;
  lineDiscounts: number;
  orderDiscount: number;
  netTotal: number;
  vatAmount: number;
  netExclVat: number;
  grandTotal: number;
}

/** Receipt document — source of truth for preview, ESC/POS and PDF printing. */
export interface ReceiptLine {
  description: string;
  qty: number;
  uom: string;
  unitPrice: number;
  discountPct: number;
  lineNet: number;
  vatAmount: number;
}

export interface ReceiptData {
  ref: string;
  createdAt: string;
  branchName: string;
  branchLocation?: string | null;
  cashier: string;
  customerName?: string | null;
  lines: ReceiptLine[];
  grossSubtotal: number;
  discount: number;
  vat: number;
  total: number;
  vatInclusive: boolean;
  payments: Array<{ method: PaymentMethod; amount: number; reference?: string | null }>;
  balance: number;
  kraPin: string; // seller KRA PIN (eTIMS)
  buyerPin?: string | null; // buyer KRA PIN (required for B2B invoices)
  invoiceNumber: string;
  cuSerial: string; // eTIMS Control Unit serial number
  hsCodesSummary: string;
  taxCategories: string; // distinct item tax category codes, e.g. "A,B"
  /** Additive (Task 20-b): server Transaction.id — present on receipts returned
   *  by POST /api/v1/sales/checkout so CheckoutReceipt can target
   *  POST /api/v1/sales/[id]/receipt-sms. Optional so older producers
   *  (reprints, print-preview samples) stay valid without it. */
  transactionId?: string;
}

export interface SessionResponse {
  user: SessionUser;
}

/** Offline queue record (Dexie) — created client-side when a checkout fails offline. */
export interface PendingOrder {
  id: string; // uuid → used as Idempotency-Key on sync
  payload: unknown; // checkout request body
  label: string; // human summary e.g. "3 items · KES 1,234.00"
  attempts: number;
  createdAt: number;
}
