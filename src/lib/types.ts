// Type definitions

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  STORE_OWNER: 'STORE_OWNER',
  BRANCH_MANAGER: 'BRANCH_MANAGER',
  SALES_PERSON: 'SALES_PERSON',
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
    users: ['create', 'read', 'update', 'delete', 'manage_users'],
    vouchers: ['create', 'read', 'update', 'delete'],
    banking: ['create', 'read', 'update', 'delete', 'reconcile', 'approve'],
    loyalty: ['create', 'read', 'update', 'delete'],
    tax: ['create', 'read', 'update', 'delete', 'file', 'approve'],
    transfers: ['create', 'read', 'update', 'approve', 'receive'],
    crm: ['create', 'read', 'update', 'delete'],
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
    users: ['create', 'read', 'update'],
    vouchers: ['create', 'read', 'update', 'delete'],
    banking: ['create', 'read', 'update', 'reconcile', 'approve'],
    loyalty: ['create', 'read', 'update'],
    tax: ['create', 'read', 'update', 'file'],
    transfers: ['create', 'read', 'update', 'approve', 'receive'],
    crm: ['create', 'read', 'update', 'delete'],
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
    users: ['create', 'read'],
    vouchers: ['create', 'read', 'update'],
    banking: ['read', 'reconcile'],
    loyalty: ['read', 'update'],
    tax: ['read'],
    transfers: ['create', 'read', 'receive'],
    crm: ['create', 'read', 'update'],
  },
  SALES_PERSON: {
    products: ['read'],
    transactions: ['create', 'read'],
    customers: ['read', 'create'],
    financials: [],
    rentals: ['read'],
    admin: [],
    reports: [],
    debt: [],
    users: [],
    vouchers: ['read'],
    banking: [],
    loyalty: ['read'],
    tax: [],
    transfers: [],
    crm: ['create', 'read'],
    shifts: ['create', 'read', 'update'],
    messaging: ['create', 'read'],
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
    users: [],
    vouchers: ['read'],
    banking: ['read', 'reconcile', 'approve'],
    loyalty: ['read'],
    tax: ['read', 'file', 'approve'],
    transfers: ['read'],
    crm: ['read'],
  },
};

export function hasPermission(role: UserRole, resource: string, action: string): boolean {
  const rolePermissions = PERMISSION_MATRIX[role];
  if (!rolePermissions) return false;
  const resourcePermissions = rolePermissions[resource];
  if (!resourcePermissions) return false;
  return resourcePermissions.includes(action);
}

/**
 * Returns true only for roles that can create users:
 * SUPER_ADMIN, STORE_OWNER, and BRANCH_MANAGER.
 * CASHIER and ACCOUNTANT cannot create users.
 */
export function canCreateUsers(role: UserRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'STORE_OWNER' || role === 'BRANCH_MANAGER';
}

/**
 * Returns true for roles that require shift management (start/end shift).
 */
export function requiresShift(role: UserRole): boolean {
  return role === 'SALES_PERSON';
}

/**
 * Role display labels
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  STORE_OWNER: 'Shop Owner',
  BRANCH_MANAGER: 'Branch Manager',
  SALES_PERSON: 'Sales Person',
  ACCOUNTANT: 'Accountant',
};

/**
 * Role-specific default landing tab
 */
export const ROLE_DEFAULT_TAB: Record<UserRole, string> = {
  SUPER_ADMIN: 'dashboard',
  STORE_OWNER: 'dashboard',
  BRANCH_MANAGER: 'dashboard',
  SALES_PERSON: 'pos',
  ACCOUNTANT: 'financial',
};

/**
 * Navigation tabs accessible by each role
 */
export const ROLE_TABS: Record<UserRole, string[]> = {
  SUPER_ADMIN: ['dashboard', 'pos', 'catalog', 'inventory', 'customers', 'transactions', 'invoices', 'delivery-notes', 'gift-cards', 'vouchers', 'credits', 'loyalty', 'rentals', 'suppliers', 'financial', 'banking', 'tax', 'reports', 'transfers', 'messaging', 'admin'],
  STORE_OWNER: ['dashboard', 'pos', 'catalog', 'inventory', 'customers', 'transactions', 'invoices', 'delivery-notes', 'gift-cards', 'vouchers', 'credits', 'loyalty', 'rentals', 'suppliers', 'financial', 'banking', 'tax', 'reports', 'transfers', 'messaging', 'admin'],
  BRANCH_MANAGER: ['dashboard', 'pos', 'catalog', 'inventory', 'customers', 'transactions', 'invoices', 'delivery-notes', 'gift-cards', 'vouchers', 'credits', 'loyalty', 'rentals', 'suppliers', 'financial', 'banking', 'tax', 'reports', 'transfers', 'messaging', 'admin'],
  SALES_PERSON: ['dashboard', 'pos', 'catalog', 'customers', 'transactions', 'invoices', 'delivery-notes', 'gift-cards', 'vouchers', 'credits', 'loyalty', 'messaging'],
  ACCOUNTANT: ['dashboard', 'financial', 'banking', 'tax', 'reports', 'transactions', 'credits', 'invoices', 'suppliers', 'messaging'],
};

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

// ============================================================
// BRANCH MANAGEMENT
// ============================================================

export interface BranchItem {
  id: string;
  name: string;
  location: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'CLOSED' | 'RENOVATING';
  managerName?: string | null;
  managerId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBranchPayload {
  name: string;
  location?: string;
  address?: string;
  phone?: string;
  email?: string;
  organizationId?: string;
}

// ============================================================
// MESSAGING MODULE
// ============================================================

export interface MessageItem {
  id: string;
  storeId: string;
  customerId: string | null;
  customerName?: string | null;
  customerPhone: string | null;
  channel: 'SMS' | 'WHATSAPP' | 'BOTH';
  messageType: 'DEBT_REMINDER' | 'PAYMENT_CONFIRMATION' | 'BALANCE_UPDATE' | 'PROMOTION' | 'CUSTOM';
  subject: string | null;
  content: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'READ';
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  waLink?: string | null;
  errorMessage?: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SendMessagePayload {
  customerId?: string;
  phone: string;
  channel: 'SMS' | 'WHATSAPP' | 'BOTH';
  messageType: 'DEBT_REMINDER' | 'PAYMENT_CONFIRMATION' | 'BALANCE_UPDATE' | 'PROMOTION' | 'CUSTOM';
  subject?: string;
  content: string;
  storeId?: string;
}

export interface MessageTemplate {
  id: string;
  type: string;
  label: string;
  content: string;
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

// Sub-category
export interface SubCategoryItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Gift Card
export interface GiftCardItem {
  id: string;
  storeId: string;
  customerId: string | null;
  code: string;
  initialBalance: number;
  currentBalance: number;
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  issuedReason: string;
  minimumPurchase: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; phone: string | null };
}

// Delivery Note
export interface DeliveryNoteItem {
  id: string;
  storeId: string;
  transactionId: string | null;
  deliveryNumber: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  driverName: string | null;
  vehicleNumber: string | null;
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  scheduledDate: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items?: DeliveryNoteItemDetail[];
}

export interface DeliveryNoteItemDetail {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitType: string;
  notes: string | null;
}

// Invoice / Quotation
export interface InvoiceItem {
  id: string;
  storeId: string;
  invoiceNumber: string;
  invoiceType: 'INVOICE' | 'QUOTATION' | 'PROFORMA' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  issueDate: string;
  dueDate: string | null;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'INVOICED' | 'PAID' | 'CANCELLED' | 'EXPIRED';
  transactionId: string | null;
  notes: string | null;
  terms: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItemDetail[];
}

export interface InvoiceItemDetail {
  id: string;
  productId: string | null;
  productName: string;
  description: string | null;
  quantity: number;
  unitType: string;
  pricePerUnit: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
}

// Customer Credit
export interface CustomerCreditItem {
  id: string;
  storeId: string;
  customerId: string;
  amount: number;
  creditType: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT' | 'REFUND';
  reference: string | null;
  description: string | null;
  balance: number;
  createdBy: string | null;
  createdAt: string;
}

// Fast Moving Product
export interface FastMovingProduct {
  productId: string;
  productName: string;
  sku: string;
  totalQuantitySold: number;
  totalRevenue: number;
  saleCount: number;
  category: string | null;
  currentStock: number;
}

// ============================================================
// VOUCHERS & CAMPAIGNS
// ============================================================

// Voucher
export interface VoucherItem {
  id: string;
  storeId: string;
  code: string;
  voucherType: 'FIXED' | 'PERCENTAGE' | 'FREE_PRODUCT' | 'BUNDLE';
  name: string;
  description: string | null;
  value: number;
  minimumPurchase: number;
  maxDiscount: number | null;
  freeProductId: string | null;
  maxUses: number;
  currentUses: number;
  maxUsesPerUser: number;
  startDate: string;
  endDate: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
  campaignId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  redemptions?: VoucherRedemptionItem[];
  campaign?: VoucherCampaignItem;
}

// Voucher Campaign
export interface VoucherCampaignItem {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  campaignType: 'PROMOTION' | 'SEASONAL' | 'LOYALTY' | 'REFERRAL' | 'FLASH_SALE';
  startDate: string;
  endDate: string | null;
  budget: number;
  spentAmount: number;
  targetAudience: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  totalRedemptions: number;
  totalRevenue: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  vouchers?: VoucherItem[];
}

// Voucher Redemption
export interface VoucherRedemptionItem {
  id: string;
  voucherId: string;
  transactionId: string | null;
  customerId: string | null;
  redeemedBy: string | null;
  discountAmount: number;
  originalTotal: number;
  finalTotal: number;
  createdAt: string;
  voucher?: VoucherItem;
}

// ============================================================
// BANKING & RECONCILIATION
// ============================================================

// Bank Account
export interface BankAccountItem {
  id: string;
  storeId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
  swiftCode: string | null;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  accountType: 'CHECKING' | 'SAVINGS' | 'MPESA' | 'PETTY_CASH';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  transactions?: BankTransactionItem[];
  reconciliations?: BankReconciliationItem[];
}

// Bank Transaction
export interface BankTransactionItem {
  id: string;
  bankAccountId: string;
  transactionType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'FEE' | 'INTEREST';
  amount: number;
  balanceAfter: number;
  reference: string | null;
  description: string | null;
  transactionDate: string;
  isReconciled: boolean;
  reconciliationId: string | null;
  journalEntryId: string | null;
  createdAt: string;
  bankAccount?: BankAccountItem;
  reconciliation?: BankReconciliationItem;
}

// Bank Reconciliation
export interface BankReconciliationItem {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: number;
  bookBalance: number;
  difference: number;
  status: 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED';
  notes: string | null;
  approvedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  bankAccount?: BankAccountItem;
  transactions?: BankTransactionItem[];
}

// M-Pesa Reconciliation
export interface MpesaReconciliationItem {
  id: string;
  storeId: string;
  mpesaReceipt: string | null;
  phoneNumber: string | null;
  amount: number;
  transactionDate: string;
  status: 'PENDING' | 'MATCHED' | 'UNMATCHED' | 'DISPUTED';
  matchedTransactionId: string | null;
  matchedAt: string | null;
  notes: string | null;
  createdAt: string;
}

// ============================================================
// LOYALTY PROGRAM
// ============================================================

// Loyalty Tier
export interface LoyaltyTierItem {
  id: string;
  storeId: string;
  name: string;
  minPoints: number;
  maxPoints: number | null;
  discountPercent: number;
  pointsMultiplier: number;
  benefits: string | null;
  color: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  customerTiers?: CustomerLoyaltyItem[];
}

// Customer Loyalty
export interface CustomerLoyaltyItem {
  id: string;
  customerId: string;
  tierId: string;
  pointsBalance: number;
  lifetimePoints: number;
  totalRedeemed: number;
  tierAchievedAt: string;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  tier?: LoyaltyTierItem;
}

// Loyalty Transaction
export interface LoyaltyTransactionItem {
  id: string;
  storeId: string;
  customerId: string;
  points: number;
  transactionType: 'EARN' | 'REDEEM' | 'BONUS' | 'EXPIRE' | 'ADJUST';
  reference: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
}

// Loyalty Campaign
export interface LoyaltyCampaignItem {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  campaignType: 'BONUS_POINTS' | 'DOUBLE_POINTS' | 'TIER_UPGRADE' | 'SPECIAL_EVENT';
  bonusPoints: number;
  multiplier: number;
  startDate: string;
  endDate: string | null;
  targetTierId: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  totalPointsAwarded: number;
  totalParticipants: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// TAX MANAGEMENT / eTIMS
// ============================================================

// Tax Category
export interface TaxCategoryItem {
  id: string;
  storeId: string;
  name: string;
  rate: number;
  description: string | null;
  etimsCode: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  taxRates?: TaxRateItem[];
}

// Tax Rate
export interface TaxRateItem {
  id: string;
  taxCategoryId: string;
  name: string;
  rate: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string;
  taxCategory?: TaxCategoryItem;
}

// Tax Filing
export interface TaxFilingItem {
  id: string;
  storeId: string;
  filingPeriod: string;
  filingType: 'VAT' | 'WHT' | 'INCOME_TAX' | 'TURNOVER_TAX';
  totalSales: number;
  totalTax: number;
  totalWht: number;
  status: 'DRAFT' | 'FILED' | 'APPROVED' | 'PAID' | 'LATE';
  filingDate: string | null;
  dueDate: string | null;
  etimsReference: string | null;
  notes: string | null;
  filedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// STORE TRANSFERS (Inter-Store)
// ============================================================

// Store Transfer (header)
export interface StoreTransferItem {
  id: string;
  transferNumber: string;
  fromStoreId: string;
  toStoreId: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED' | 'PARTIAL';
  requestedBy: string | null;
  approvedBy: string | null;
  receivedBy: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items?: StoreTransferItemDetail[];
  fromStore?: { id: string; name: string };
  toStore?: { id: string; name: string };
}

// Store Transfer Item (line)
export interface StoreTransferItemDetail {
  id: string;
  transferId: string;
  productId: string;
  quantity: number;
  receivedQty: number;
  unitType: string;
  notes: string | null;
  product?: { id: string; name: string; sku: string };
}

// ============================================================
// EXPENSE BUDGETS & APPROVALS
// ============================================================

// Expense Budget
export interface ExpenseBudgetItem {
  id: string;
  storeId: string;
  category: 'RENT' | 'SALARIES' | 'UTILITIES' | 'TRANSPORT' | 'MAINTENANCE' | 'MARKETING' | 'OTHER';
  period: string;
  budgetAmount: number;
  spentAmount: number;
  remainingAmount: number;
  status: 'ACTIVE' | 'CLOSED' | 'EXCEEDED';
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  approvals?: ExpenseApprovalItem[];
}

// Expense Approval
export interface ExpenseApprovalItem {
  id: string;
  expenseId: string | null;
  budgetId: string | null;
  approvalType: 'EXPENSE' | 'BUDGET' | 'TRANSFER' | 'WRITE_OFF';
  amount: number;
  requestedBy: string;
  approvedBy: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approvalLevel: number;
  notes: string | null;
  requestedAt: string;
  approvedAt: string | null;
  budget?: ExpenseBudgetItem;
}

// ============================================================
// CUSTOMER INTERACTIONS (CRM)
// ============================================================

// Customer Interaction
export interface CustomerInteractionItem {
  id: string;
  storeId: string;
  customerId: string;
  interactionType: 'NOTE' | 'CALL' | 'EMAIL' | 'VISIT' | 'WHATSAPP' | 'COMPLAINT' | 'FEEDBACK';
  subject: string | null;
  content: string;
  followUpDate: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedTo: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; phone: string | null };
}
