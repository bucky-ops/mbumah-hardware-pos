// Type definitions

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  STORE_OWNER: 'STORE_OWNER',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  CASHIER: 'CASHIER',
  ACCOUNTANT: 'ACCOUNTANT',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const PaymentMethod = {
  CASH: 'CASH',
  MPESA: 'MPESA',
  DEBT: 'DEBT',
  SPLIT: 'SPLIT',
  GIFT_CARD: 'GIFT_CARD',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIAL: 'PARTIAL',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const UnitType = {
  PIECE: 'PIECE',
  KILOGRAM: 'KILOGRAM',
  METER: 'METER',
  LITER: 'LITER',
  BAG: 'BAG',
  BOX: 'BOX',
  SET: 'SET',
} as const;

export type UnitType = (typeof UnitType)[keyof typeof UnitType];

export const DebtStatus = {
  OUTSTANDING: 'OUTSTANDING',
  PARTIAL: 'PARTIAL',
  SETTLED: 'SETTLED',
  OVERDUE: 'OVERDUE',
  WRITTEN_OFF: 'WRITTEN_OFF',
} as const;

export type DebtStatus = (typeof DebtStatus)[keyof typeof DebtStatus];

export const AgingBucket = {
  CURRENT: 'CURRENT',
  DAYS_30: 'DAYS_30',
  DAYS_60: 'DAYS_60',
  DAYS_90_PLUS: 'DAYS_90_PLUS',
} as const;

export type AgingBucket = (typeof AgingBucket)[keyof typeof AgingBucket];

export const RentalStatus = {
  ACTIVE: 'ACTIVE',
  RETURNED: 'RETURNED',
  OVERDUE: 'OVERDUE',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
} as const;

export type RentalStatus = (typeof RentalStatus)[keyof typeof RentalStatus];

export const TransactionType = {
  SALE: 'SALE',
  REFUND: 'REFUND',
  VOID: 'VOID',
} as const;

export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const StockMovementType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  ADJUSTMENT: 'ADJUSTMENT',
  TRANSFER: 'TRANSFER',
  RETURN: 'RETURN',
  RENTAL_OUT: 'RENTAL_OUT',
  RENTAL_RETURN: 'RENTAL_RETURN',
} as const;

export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

export const AccountType = {
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  EQUITY: 'EQUITY',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

// ── ISO 9001 / GAAP Accounting domain types (Phase 1 — Accounting Module) ────
//
// These string-union types mirror the Prisma schema models (Account,
// JournalEntry, JournalEntryLine, FinancialPeriod, TrialBalanceSnapshot,
// Budget, AuditLog) and are used throughout the accounting business logic
// (accounting-helpers.ts), the financial UI (financial-tab.tsx), and the
// API routes under /api/financial/**. Using const-objects (rather than
// Prisma `enum`) keeps the schema portable across SQLite (dev) and
// PostgreSQL (prod) and matches the existing codebase convention
// (PaymentMethod, StockMovementType, etc.).

/** Account sub-classification per GAAP. Optional on Account.subType. */
export const AccountSubType = {
  CURRENT_ASSET: 'CURRENT_ASSET',
  FIXED_ASSET: 'FIXED_ASSET',
  INVENTORY: 'INVENTORY',
  CASH_EQUIVALENT: 'CASH_EQUIVALENT',
  ACCOUNTS_RECEIVABLE: 'ACCOUNTS_RECEIVABLE',
  CURRENT_LIABILITY: 'CURRENT_LIABILITY',
  LONG_TERM_LIABILITY: 'LONG_TERM_LIABILITY',
  ACCOUNTS_PAYABLE: 'ACCOUNTS_PAYABLE',
  OWNERS_EQUITY: 'OWNERS_EQUITY',
  RETAINED_EARNINGS: 'RETAINED_EARNINGS',
  OPERATING_REVENUE: 'OPERATING_REVENUE',
  OTHER_REVENUE: 'OTHER_REVENUE',
  COGS: 'COGS',
  OPERATING_EXPENSE: 'OPERATING_EXPENSE',
  ADMIN_EXPENSE: 'ADMIN_EXPENSE',
  TAX_PAYABLE: 'TAX_PAYABLE',
} as const;
export type AccountSubType = (typeof AccountSubType)[keyof typeof AccountSubType];

/** Whether an account's normal balance is a debit or a credit. */
export const NormalBalance = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;
export type NormalBalance = (typeof NormalBalance)[keyof typeof NormalBalance];

/**
 * Financial period lifecycle.
 *   OPEN   — entries can be posted into this period.
 *   CLOSED — no new entries; period is being reviewed / audited. Existing
 *            posted entries remain visible and reportable.
 *   LOCKED — frozen permanently. No mutations of any kind permitted. This is
 *            the terminal state for a closed-and-audited period (ISO 9001).
 */
export const FinancialPeriodStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  LOCKED: 'LOCKED',
} as const;
export type FinancialPeriodStatus = (typeof FinancialPeriodStatus)[keyof typeof FinancialPeriodStatus];

/**
 * Actions recorded in the AuditLog. These are the verbatim values stored in
 * AuditLog.action and used for compliance reporting (ISO 27001 A.12.4.1).
 */
export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  POST: 'POST',
  VOID: 'VOID',
  APPROVE: 'APPROVE',
  CLOSE: 'CLOSE',
  LOCK: 'LOCK',
  REOPEN: 'REOPEN',
  RECONCILE: 'RECONCILE',
  BUDGET_SET: 'BUDGET_SET',
  SNAPSHOT: 'SNAPSHOT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/**
 * The type of external source document referenced by a JournalEntry. Distinct
 * from JournalEntry.referenceType (which is the internal system reference:
 * SALE, PAYMENT, REFUND, RENTAL, ADJUSTMENT).
 */
export const ReferenceDocumentType = {
  INVOICE: 'INVOICE',
  RECEIPT: 'RECEIPT',
  EXPENSE_VOUCHER: 'EXPENSE_VOUCHER',
  BANK_STATEMENT: 'BANK_STATEMENT',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  SUPPLIER_INVOICE: 'SUPPLIER_INVOICE',
  MANUAL: 'MANUAL',
} as const;
export type ReferenceDocumentType = (typeof ReferenceDocumentType)[keyof typeof ReferenceDocumentType];

/**
 * Derived journal-entry status for UI presentation. Computed from the
 * isPosted / isApproved / isVoided flags, NOT stored directly.
 *   DRAFT     — created, not submitted, not posted.
 *   SUBMITTED — created and saved pending approval (isApproved = false).
 *   APPROVED  — approved by an authorized user, ready to post.
 *   POSTED    — posted to the ledger (isPosted = true).
 *   VOIDED    — voided via a reversing entry (isVoided = true).
 */
export const JournalEntryStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  POSTED: 'POSTED',
  VOIDED: 'VOIDED',
} as const;
export type JournalEntryStatus = (typeof JournalEntryStatus)[keyof typeof JournalEntryStatus];

/** The entity types tracked by the AuditLog. */
export const AuditEntityType = {
  JOURNAL_ENTRY: 'JournalEntry',
  JOURNAL_ENTRY_LINE: 'JournalEntryLine',
  ACCOUNT: 'Account',
  FINANCIAL_PERIOD: 'FinancialPeriod',
  TRIAL_BALANCE_SNAPSHOT: 'TrialBalanceSnapshot',
  BUDGET: 'Budget',
  CUSTOMER: 'Customer',
  SUPPLIER: 'Supplier',
  EXPENSE: 'Expense',
} as const;
export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType];

export const NotificationChannel = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
  PRINT: 'PRINT',
} as const;

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const LogSeverity = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
} as const;

export type LogSeverity = (typeof LogSeverity)[keyof typeof LogSeverity];

export const LogComponent = {
  POS: 'POS',
  INVENTORY: 'INVENTORY',
  FINANCIAL: 'FINANCIAL',
  AUTH: 'AUTH',
  PAYMENT: 'PAYMENT',
  RENTAL: 'RENTAL',
  SYSTEM: 'SYSTEM',
  API: 'API',
  AUDIT: 'AUDIT',
} as const;

export type LogComponent = (typeof LogComponent)[keyof typeof LogComponent];


export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  storeId?: string;
  isActive: boolean;
}

export interface CartItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitType: UnitType;
  pricePerUnit: number;
  costPrice: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  isRentalItem: boolean;
  isBundle: boolean;
}

export interface CheckoutPayload {
  storeId: string;
  customerId?: string;
  cashierId: string;
  items: CartItem[];
  paymentMethod: PaymentMethod;
  paymentDetails: PaymentDetails;
  discountAmount?: number;
  notes?: string;
}

export interface PaymentDetails {
  cashAmount?: number;
  mpesaPhone?: string;
  debtAccountId?: string;
  giftCardId?: string;
  voucherId?: string;
  discountAmount?: number;
}

export interface SplitPayment {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface MpesaSTKRequest {
  phoneNumber: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
}

export interface MpesaCallbackResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: string;
  resultDesc: string;
  mpesaReceiptNumber?: string;
  transactionDate?: string;
  phoneNumber?: string;
  amount?: number;
}

export interface DebtAgingSummary {
  current: number;
  days30: number;
  days60: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface DashboardStats {
  todaySales: number;
  todayTransactions: number;
  todayRevenue: number;
  lowStockProducts: number;
  activeRentals: number;
  outstandingDebt: number;
  topProducts: TopProduct[];
  salesByHour: { hour: string; amount: number }[];
  paymentMethodBreakdown: { method: string; count: number; amount: number }[];
}

export interface TopProduct {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}

export interface StockAlert {
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  reorderLevel: number;
  unitType: UnitType;
}

export interface ReceiptData {
  storeName: string;
  storeLocation: string;
  storePhone: string;
  receiptNumber: string;
  date: string;
  cashier: string;
  customer?: string;
  items: ReceiptItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: string;
  mpesaReceipt?: string;
  footer: string;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitType: string;
  pricePerUnit: number;
  lineTotal: number;
}

export interface JournalEntryDTO {
  storeId: string;
  description: string;
  referenceType: string;
  referenceId: string;
  lines: { accountId: string; debit: number; credit: number; description?: string }[];
}

export interface ReportFilter {
  storeId: string;
  dateFrom: string;
  dateTo: string;
  paymentMethod?: PaymentMethod;
  categoryId?: string;
}

export interface PermissionCheck {
  role: UserRole;
  resource: string;
  action: string;
}

// RBAC Permission Matrix
export const PERMISSION_MATRIX: Record<UserRole, Record<string, string[]>> = {
  SUPER_ADMIN: {
    products: ['create', 'read', 'update', 'delete'],
    transactions: ['create', 'read', 'update', 'delete', 'refund', 'void'],
    customers: ['create', 'read', 'update', 'delete'],
    financials: ['read', 'export', 'approve', 'adjust'],
    rentals: ['create', 'read', 'update', 'delete'],
    admin: ['read', 'update', 'manage_users', 'manage_stores', 'system_config'],
    reports: ['read', 'export'],
    debt: ['create', 'read', 'update', 'write_off', 'remind'],
    purchase_orders: ['create', 'read', 'update', 'delete', 'approve', 'receive'],
  },
  STORE_OWNER: {
    products: ['create', 'read', 'update', 'delete'],
    transactions: ['create', 'read', 'update', 'refund', 'void'],
    customers: ['create', 'read', 'update', 'delete'],
    financials: ['read', 'export', 'approve'],
    rentals: ['create', 'read', 'update', 'delete'],
    admin: ['read', 'manage_users'],
    reports: ['read', 'export'],
    debt: ['create', 'read', 'update', 'write_off', 'remind'],
    purchase_orders: ['create', 'read', 'update', 'delete', 'approve', 'receive'],
  },
  BRANCH_MANAGER: {
    products: ['create', 'read', 'update'],
    transactions: ['create', 'read', 'refund'],
    customers: ['create', 'read', 'update'],
    financials: ['read', 'export'],
    rentals: ['create', 'read', 'update'],
    admin: ['read'],
    reports: ['read', 'export'],
    debt: ['read', 'remind'],
    purchase_orders: ['create', 'read', 'update', 'receive'],
  },
  CASHIER: {
    products: ['read'],
    transactions: ['create', 'read'],
    customers: ['read'],
    financials: [],
    rentals: ['read'],
    admin: [],
    reports: [],
    debt: [],
    purchase_orders: ['read'],
  },
  ACCOUNTANT: {
    products: ['read'],
    transactions: ['read'],
    customers: ['read'],
    financials: ['read', 'export', 'approve', 'adjust'],
    rentals: ['read'],
    admin: ['read'],
    reports: ['read', 'export'],
    debt: ['read', 'update', 'remind'],
    purchase_orders: ['read', 'approve'],
  },
};

export function hasPermission(role: UserRole, resource: string, action: string): boolean {
  const rolePermissions = PERMISSION_MATRIX[role];
  if (!rolePermissions) return false;
  const resourcePermissions = rolePermissions[resource];
  if (!resourcePermissions) return false;
  return resourcePermissions.includes(action);
}

// GIFT CARD TYPES

export const GiftCardReason = {
  CUSTOMER_LOYALTY: 'CUSTOMER_LOYALTY',
  PROMOTION: 'PROMOTION',
  REFUND_CREDIT: 'REFUND_CREDIT',
  STORE_CREDIT: 'STORE_CREDIT',
  GIFT: 'GIFT',
  EMPLOYEE_AWARD: 'EMPLOYEE_AWARD',
  COMPLAINT_RESOLUTION: 'COMPLAINT_RESOLUTION',
  OTHER: 'OTHER',
} as const;

export type GiftCardReason = (typeof GiftCardReason)[keyof typeof GiftCardReason];

export const GiftCardStatus = {
  ACTIVE: 'ACTIVE',
  REDEEMED: 'REDEEMED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  PARTIALLY_REDEEMED: 'PARTIALLY_REDEEMED',
} as const;

export type GiftCardStatus = (typeof GiftCardStatus)[keyof typeof GiftCardStatus];

export interface GiftCardItem {
  id: string;
  storeId: string;
  code: string;
  reason: GiftCardReason;
  status: GiftCardStatus;
  initialBalance: number;
  currentBalance: number;
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  customerId: string | null;
  expiryDate: string | null;
  autoAdjustItems: boolean;
  isVisible: boolean;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; phone: string | null; email: string | null } | null;
  createdBy?: { id: string; name: string } | null;
  redemptions?: GiftCardRedemption[];
}

export interface GiftCardRedemption {
  id: string;
  giftCardId: string;
  amount: number;
  transactionId: string | null;
  processedById: string | null;
  notes: string | null;
  createdAt: string;
  processedBy?: { id: string; name: string } | null;
  transaction?: { id: string; receiptNumber: string } | null;
}

export interface CreateGiftCardPayload {
  storeId: string;
  code?: string;
  reason: GiftCardReason;
  initialBalance: number;
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  customerId?: string;
  expiryDate?: string;
  autoAdjustItems?: boolean;
  notes?: string;
}

export interface UpdateGiftCardPayload {
  reason?: GiftCardReason;
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  expiryDate?: string | null;
  autoAdjustItems?: boolean;
  isVisible?: boolean;
  notes?: string;
  initialBalance?: number;
}

export interface RedeemGiftCardPayload {
  amount: number;
  transactionId?: string;
  notes?: string;
}

export interface AdjustGiftCardBalancePayload {
  amount: number;
  reason: string;
  notes?: string;
}

export const ShiftStatus = {
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
} as const;

export type ShiftStatus = (typeof ShiftStatus)[keyof typeof ShiftStatus];

export interface ShiftData {
  id: string;
  userId: string;
  userName?: string;
  storeId: string;
  startedAt: string;
  endedAt?: string | null;
  startingCash: number;
  endingCash?: number | null;
  countedCash?: number | null;
  cashDifference?: number | null;
  totalSales: number;
  totalTransactions: number;
  status: ShiftStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateShiftPayload {
  storeId: string;
  userId: string;
  startingCash: number;
}

export interface EndShiftPayload {
  endingCash: number;
  countedCash: number;
  notes?: string;
}


export interface MessageItem {
  id: string;
  storeId: string;
  customerId: string | null;
  channel: string;
  messageType: string;
  subject: string | null;
  content: string;
  status: string;
  waLink: string | null;
  sentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  customerName?: string;
  customerPhone?: string;
}
