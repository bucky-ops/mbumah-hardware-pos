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
  expiryDate?: string;
  autoAdjustItems?: boolean;
  isVisible?: boolean;
  notes?: string;
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
