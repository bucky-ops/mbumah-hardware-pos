/**
 * MBUMAH HARDWARE POS & ERP - API Client
 * Complete fetch wrappers for all backend endpoints
 */

import type {
  AuthUser,
  CartItem,
  CheckoutPayload,
  MpesaSTKRequest,
  MpesaCallbackResult,
  DashboardStats,
  DebtAgingSummary,
  ReportFilter,
  JournalEntryDTO,
  PaymentMethod,
} from './types';

// ============================================================================
// BASE CONFIG
// ============================================================================

const API_BASE = '/api';

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mbt_token');
      localStorage.removeItem('mbt_user');
      window.location.reload();
    }
    throw new Error('Session expired. Please login again.');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `Request failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// AUTH API
// ============================================================================

export const authApi = {
  login: async (email: string, password: string) => {
    const res = await request<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.data?.token) {
      localStorage.setItem('mbt_token', res.data.token);
      localStorage.setItem('mbt_user', JSON.stringify(res.data.user));
    }
    return res;
  },

  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      localStorage.removeItem('mbt_token');
      localStorage.removeItem('mbt_user');
    }
  },

  getMe: async () => {
    return request<AuthUser>('/auth/me');
  },
};

// ============================================================================
// PRODUCTS API
// ============================================================================

export interface ProductListItem {
  id: string;
  storeId: string;
  categoryId: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  unitType: string;
  quantityInStock: number;
  reorderLevel: number;
  pricePerUnit: number;
  costPrice: number;
  taxRate: number;
  isRental: boolean;
  isBundle: boolean;
  isActive: boolean;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  category?: { id: string; name: string; color?: string; icon?: string };
  bundleItems?: { childProductId: string; quantityRequired: number; childProduct?: { id: string; name: string; sku: string; quantityInStock: number; pricePerUnit: number } }[];
}

export interface CreateProductPayload {
  storeId: string;
  categoryId?: string;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  unitType?: string;
  quantityInStock?: number;
  reorderLevel?: number;
  pricePerUnit: number;
  costPrice: number;
  taxRate?: number;
  isRental?: boolean;
  isBundle?: boolean;
  imageUrl?: string;
}

export const productsApi = {
  list: async (params?: { storeId?: string; page?: number; limit?: number; categoryId?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.categoryId) query.set('categoryId', params.categoryId);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<ProductListItem[]>(`/products${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<ProductListItem>(`/products/${id}`);
  },

  create: async (data: CreateProductPayload) => {
    return request<ProductListItem>('/products', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Partial<CreateProductPayload>) => {
    return request<ProductListItem>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string) => {
    return request<void>(`/products/${id}`, { method: 'DELETE' });
  },

  search: async (query: string, storeId?: string) => {
    const params = new URLSearchParams({ q: query });
    if (storeId) params.set('storeId', storeId);
    return request<ProductListItem[]>(`/products/search?${params.toString()}`);
  },

  listBundles: async (storeId?: string) => {
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    return request<ProductListItem[]>(`/products/bundles?${params.toString()}`);
  },
};

// ============================================================================
// CATEGORIES API
// ============================================================================

export interface CategoryItem {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
}

export const categoriesApi = {
  list: async (storeId?: string) => {
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    return request<CategoryItem[]>(`/categories?${params.toString()}`);
  },

  create: async (data: { storeId: string; name: string; description?: string; icon?: string; color?: string }) => {
    return request<CategoryItem>('/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// CUSTOMERS API
// ============================================================================

export interface CustomerItem {
  id: string;
  storeId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  idNumber: string | null;
  currentDebtBalance: number;
  debtLimit: number;
  loyaltyPoints: number;
  preferredChannel: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const customersApi = {
  list: async (params?: { storeId?: string; page?: number; limit?: number; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    return request<CustomerItem[]>(`/customers?${query.toString()}`);
  },

  get: async (id: string) => {
    return request<CustomerItem>(`/customers/${id}`);
  },

  create: async (data: { storeId: string; name: string; phone?: string; email?: string; address?: string; idNumber?: string; debtLimit?: number }) => {
    return request<CustomerItem>('/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Partial<CustomerItem>) => {
    return request<CustomerItem>(`/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  search: async (query: string, storeId?: string) => {
    const params = new URLSearchParams({ q: query });
    if (storeId) params.set('storeId', storeId);
    return request<CustomerItem[]>(`/customers/search?${params.toString()}`);
  },
};

// ============================================================================
// TRANSACTIONS API
// ============================================================================

export interface TransactionItem {
  id: string;
  storeId: string;
  receiptNumber: string;
  customerId: string | null;
  cashierId: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  transactionType: string;
  notes: string | null;
  isOffline: boolean;
  createdAt: string;
  updatedAt: string;
  items?: SaleItemDetail[];
  customer?: CustomerItem;
  cashier?: { id: string; name: string };
}

export interface SaleItemDetail {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitType: string;
  pricePerUnit: number;
  costPrice: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  isRentalItem: boolean;
}

export const transactionsApi = {
  list: async (params?: { storeId?: string; page?: number; limit?: number; paymentMethod?: string; dateFrom?: string; dateTo?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.paymentMethod) query.set('paymentMethod', params.paymentMethod);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    return request<TransactionItem[]>(`/transactions?${query.toString()}`);
  },

  get: async (id: string) => {
    return request<TransactionItem>(`/transactions/${id}`);
  },

  create: async (data: CheckoutPayload) => {
    return request<TransactionItem>('/transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// PAYMENTS API
// ============================================================================

export const paymentsApi = {
  initiateMpesa: async (data: MpesaSTKRequest) => {
    return request<MpesaCallbackResult>('/payments/mpesa/stkpush', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// DEBT API
// ============================================================================

export interface DebtLedgerItem {
  id: string;
  storeId: string;
  customerId: string;
  transactionId: string | null;
  amountOwed: number;
  amountPaid: number;
  balance: number;
  dueDate: string;
  status: string;
  agingBucket: string;
  lastReminderAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: CustomerItem;
}

export const debtApi = {
  list: async (params?: { storeId?: string; customerId?: string; status?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.customerId) query.set('customerId', params.customerId);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<DebtLedgerItem[]>(`/debt?${query.toString()}`);
  },

  makePayment: async (data: { debtLedgerId: string; amount: number; paymentMethod: string; reference?: string }) => {
    return request<DebtLedgerItem>('/debt/payment', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// RENTALS API
// ============================================================================

export interface RentalItem {
  id: string;
  storeId: string;
  productId: string;
  customerId: string;
  status: string;
  rentalStartDate: string;
  expectedReturnDate: string;
  actualReturnDate: string | null;
  securityDeposit: number;
  ratePerDay: number;
  ratePerWeek: number | null;
  ratePerMonth: number | null;
  totalRentalCharge: number;
  lateFeeAccumulated: number;
  damageAssessment: string | null;
  damageCharge: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  product?: ProductListItem;
  customer?: CustomerItem;
}

export const rentalsApi = {
  list: async (params?: { storeId?: string; status?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<RentalItem[]>(`/rentals?${query.toString()}`);
  },

  create: async (data: { storeId: string; productId: string; customerId: string; expectedReturnDate: string; securityDeposit: number; ratePerDay: number; ratePerWeek?: number; ratePerMonth?: number; notes?: string }) => {
    return request<RentalItem>('/rentals', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  returnRental: async (id: string, data: { damageAssessment?: string; damageCharge?: number; notes?: string }) => {
    return request<RentalItem>(`/rentals/${id}/return`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// FINANCIAL API
// ============================================================================

export interface JournalEntryItem {
  id: string;
  storeId: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  totalDebit: number;
  totalCredit: number;
  isPosted: boolean;
  postedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  lines?: JournalEntryLineItem[];
}

export interface JournalEntryLineItem {
  id: string;
  accountId: string;
  debit: number;
  credit: number;
  description: string | null;
  account?: { id: string; code: string; name: string; type: string };
}

export interface AccountItem {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  normalBalance: string;
  isActive: boolean;
}

export const financialApi = {
  listJournalEntries: async (params?: { storeId?: string; page?: number; limit?: number; dateFrom?: string; dateTo?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    return request<JournalEntryItem[]>(`/financial/journal-entries?${query.toString()}`);
  },

  listAccounts: async (organizationId?: string) => {
    const params = new URLSearchParams();
    if (organizationId) params.set('organizationId', organizationId);
    return request<AccountItem[]>(`/financial/accounts?${params.toString()}`);
  },
};

// ============================================================================
// DASHBOARD API
// ============================================================================

export const dashboardApi = {
  getStats: async (storeId?: string) => {
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    const qs = params.toString();
    return request<DashboardStats>(`/dashboard${qs ? `?${qs}` : ''}`);
  },
};

// ============================================================================
// REPORTS API
// ============================================================================

export interface SalesReportData {
  period: string;
  totalSales: number;
  totalRevenue: number;
  totalTax: number;
  totalDiscount: number;
  transactionCount: number;
  avgTransactionValue: number;
  byPaymentMethod: { method: PaymentMethod; count: number; amount: number }[];
}

export interface InventoryReportData {
  totalProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalInventoryValue: number;
  categories: { name: string; productCount: number; totalValue: number }[];
  topSelling: { productId: string; productName: string; quantitySold: number; revenue: number }[];
}

export const reportsApi = {
  getSalesReport: async (filter: ReportFilter) => {
    const params = new URLSearchParams();
    params.set('storeId', filter.storeId);
    params.set('dateFrom', filter.dateFrom);
    params.set('dateTo', filter.dateTo);
    if (filter.paymentMethod) params.set('paymentMethod', filter.paymentMethod);
    if (filter.categoryId) params.set('categoryId', filter.categoryId);
    return request<SalesReportData>(`/reports/sales?${params.toString()}`);
  },

  getInventoryReport: async (storeId: string) => {
    return request<InventoryReportData>(`/reports/inventory?storeId=${storeId}`);
  },

  exportCSV: async (filter: ReportFilter & { type: 'sales' | 'inventory' }) => {
    const params = new URLSearchParams();
    params.set('storeId', filter.storeId);
    params.set('type', filter.type);
    params.set('dateFrom', filter.dateFrom);
    params.set('dateTo', filter.dateTo);
    if (filter.paymentMethod) params.set('paymentMethod', filter.paymentMethod);
    if (filter.categoryId) params.set('categoryId', filter.categoryId);
    return request<{ url: string }>(`/reports/export?${params.toString()}`);
  },
};

// ============================================================================
// SYSTEM LOGS API
// ============================================================================

export interface SystemLogItem {
  id: string;
  storeId: string | null;
  userId: string | null;
  action: string;
  component: string;
  severity: string;
  message: string;
  metadata: string | null;
  stackTrace: string | null;
  ipAddress: string | null;
  createdAt: string;
  user?: { id: string; name: string };
}

export const systemLogsApi = {
  list: async (params?: { storeId?: string; component?: string; severity?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.component) query.set('component', params.component);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<SystemLogItem[]>(`/system-logs?${query.toString()}`);
  },
};

// ============================================================================
// STOCK MOVEMENTS API
// ============================================================================

export interface StockMovementItem {
  id: string;
  storeId: string;
  productId: string;
  movementType: string;
  quantity: number;
  referenceId: string | null;
  notes: string | null;
  performedBy: string | null;
  createdAt: string;
  product?: ProductListItem;
}

export const stockMovementsApi = {
  list: async (params?: { storeId?: string; productId?: string; movementType?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.productId) query.set('productId', params.productId);
    if (params?.movementType) query.set('movementType', params.movementType);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<StockMovementItem[]>(`/stock-movements?${query.toString()}`);
  },

  createAdjustment: async (data: { storeId: string; productId: string; quantity: number; notes?: string }) => {
    return request<StockMovementItem>('/stock-movements/adjustment', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// HELPERS
// ============================================================================

export function formatKES(amount: number): string {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
