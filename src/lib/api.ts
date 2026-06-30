// API client

import type {
  AuthUser,
  CheckoutPayload,
  MpesaSTKRequest,
  MpesaCallbackResult,
  DashboardStats,
  ReportFilter,
  JournalEntryDTO,
  PaymentMethod,
  ShiftData,
  CreateShiftPayload,
  EndShiftPayload,
  GiftCardItem,
  GiftCardRedemption,
  CreateGiftCardPayload,
  UpdateGiftCardPayload,
  RedeemGiftCardPayload,
  AdjustGiftCardBalancePayload,
} from './types';

// Re-export types so consumers can import from this module
export type { GiftCardItem } from './types';


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

// CSRF token management
let csrfToken: string | null = null;

async function fetchCSRFToken(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/security/csrf-token`, { credentials: 'same-origin' });
    const json = await res.json();
    if (json.success && json.data?.token) {
      csrfToken = json.data.token;
      return csrfToken;
    }
    // Fallback: try reading from cookie
    const cookieMatch = document.cookie.match(/csrf_token=([^;]+)/);
    if (cookieMatch) {
      csrfToken = cookieMatch[1];
      return csrfToken;
    }
    return '';
  } catch {
    // Fallback: try reading from cookie
    if (typeof document !== 'undefined') {
      const cookieMatch = document.cookie.match(/csrf_token=([^;]+)/);
      if (cookieMatch) {
        csrfToken = cookieMatch[1];
        return csrfToken;
      }
    }
    return '';
  }
}

// Initialize CSRF token on app load
if (typeof window !== 'undefined') {
  fetchCSRFToken().catch(() => {});
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;

  // Include CSRF token for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  let csrfHeader: Record<string, string> = {};
  if (isStateChanging) {
    if (!csrfToken) {
      await fetchCSRFToken();
    }
    // Also try reading from cookie as backup
    if (!csrfToken && typeof document !== 'undefined') {
      const cookieMatch = document.cookie.match(/csrf_token=([^;]+)/);
      if (cookieMatch) csrfToken = cookieMatch[1];
    }
    if (csrfToken) {
      csrfHeader = { 'X-CSRF-Token': csrfToken };
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...csrfHeader,
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'same-origin', // Include cookies for CSRF validation
  });

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mbt_token');
      localStorage.removeItem('mbt_user');
      window.location.reload();
    }
    throw new Error('Session expired. Please login again.');
  }

  // Handle CSRF failure: retry once with a fresh token
  if (response.status === 403 && isStateChanging) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error || errorData.message || '';
    if (errorMsg.toLowerCase().includes('csrf')) {
      // Force refresh the CSRF token and retry once
      csrfToken = null;
      await fetchCSRFToken();
      if (!csrfToken && typeof document !== 'undefined') {
        const cookieMatch = document.cookie.match(/csrf_token=([^;]+)/);
        if (cookieMatch) csrfToken = cookieMatch[1];
      }
      const retryHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(options.headers as Record<string, string> || {}),
      };
      const retryResponse = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: retryHeaders,
        credentials: 'same-origin',
      });
      if (retryResponse.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('mbt_token');
          localStorage.removeItem('mbt_user');
          window.location.reload();
        }
        throw new Error('Session expired. Please login again.');
      }
      if (!retryResponse.ok) {
        let retryServerError = '';
        try {
          const retryErrorData = await retryResponse.json();
          retryServerError = retryErrorData.error || retryErrorData.message || '';
        } catch {
          // Non-JSON body — fall through
        }
        switch (retryResponse.status) {
          case 404:
            throw new Error(retryServerError || 'Resource not found');
          case 429:
            throw new Error(retryServerError || 'Too many requests. Please try again in a moment.');
          case 500:
            throw new Error(retryServerError || 'Server error. Please try again later.');
          case 502:
          case 503:
          case 504:
            throw new Error(retryServerError || 'Service temporarily unavailable. Please try again.');
          default:
            throw new Error(retryServerError || `Request failed: ${retryResponse.status}`);
        }
      }
      const retryJson = await retryResponse.json();
      // Apply same response-shape validation and nested unwrap as the main path
      if (retryJson && retryJson.success && retryJson.data === undefined && retryJson.error === undefined) {
        retryJson.data = null as unknown as T;
      }
      if (retryJson && retryJson.success && retryJson.data !== undefined && retryJson.data !== null) {
        if (!Array.isArray(retryJson.data) && typeof retryJson.data === 'object') {
          const d = retryJson.data as Record<string, unknown>;
          if (d.data !== undefined && Array.isArray(d.data)) {
            (retryJson as Record<string, unknown>).data = d.data;
          } else if (d.items !== undefined && Array.isArray(d.items)) {
            (retryJson as Record<string, unknown>).data = d.items;
          } else if (d.products !== undefined && Array.isArray(d.products)) {
            (retryJson as Record<string, unknown>).data = d.products;
          }
        }
      }
      return retryJson;
    }
    throw new Error(errorMsg || `Request failed: ${response.status}`);
  }

  if (!response.ok) {
    let serverError = '';
    try {
      const errorData = await response.json();
      serverError = errorData.error || errorData.message || '';
    } catch {
      // Response body is not JSON or empty — fall through to status-based messages
    }

    // Specific error messages for common HTTP status codes
    switch (response.status) {
      case 404:
        throw new Error(serverError || 'Resource not found');
      case 429:
        throw new Error(serverError || 'Too many requests. Please try again in a moment.');
      case 500:
        throw new Error(serverError || 'Server error. Please try again later.');
      case 502:
      case 503:
      case 504:
        throw new Error(serverError || 'Service temporarily unavailable. Please try again.');
      default:
        throw new Error(serverError || `Request failed: ${response.status}`);
    }
  }

  const json = await response.json();

  // Response-shape validation: ensure the response matches ApiResponse<T>
  if (!json || typeof json !== 'object') {
    // Response is not a valid object — return a safe default
    return { success: false, error: 'Invalid response from server' } as ApiResponse<T>;
  }

  if (json.success === undefined) {
    // `success` field is missing — attempt to infer from presence of data/error
    if (json.data !== undefined) {
      json.success = true;
    } else if (json.error) {
      json.success = false;
    } else {
      // Neither data nor error — treat as success with no data
      json.success = true;
    }
    console.warn(
      `[API] Response from ${endpoint} missing "success" field; inferred as ${json.success}`
    );
  }

  if (json.success && json.data === undefined && json.error === undefined) {
    // Successful response but no data field at all — set null
    // Components must use null checks / Array.isArray() before .map() calls.
    json.data = null as unknown as T;
  }

  // Nested-structure unwrap: if the API wrapped the array inside an object
  // (e.g. { data: { items: [...] } }), unwrap it to a flat array.
  if (json.success && json.data !== undefined && json.data !== null) {
    if (!Array.isArray(json.data) && typeof json.data === 'object') {
      const d = json.data as Record<string, unknown>;
      if (d.data !== undefined && Array.isArray(d.data)) {
        // API returned { success: true, data: { data: [...items...] } }
        (json as Record<string, unknown>).data = d.data;
      } else if (d.items !== undefined && Array.isArray(d.items)) {
        // API returned { success: true, data: { items: [...items...] } }
        (json as Record<string, unknown>).data = d.items;
      } else if (d.products !== undefined && Array.isArray(d.products)) {
        // API returned { success: true, data: { products: [...items...] } }
        (json as Record<string, unknown>).data = d.products;
      }
    }
  }

  return json;
}

/**
 * Safely extract an array from an API response.
 * Returns the data if it's an array, otherwise returns an empty array.
 * Use this in queryFn to prevent "D.map is not a function" errors.
 */
export function safeArray<T>(response: ApiResponse<T[]> | undefined | null): T[] {
  if (!response) return [];
  if (Array.isArray(response.data)) return response.data;
  // Try to extract from nested structure
  if (response.data && typeof response.data === 'object') {
    const d = response.data as unknown as Record<string, unknown>;
    if (Array.isArray(d.data)) return d.data as T[];
    if (Array.isArray(d.items)) return d.items as T[];
    if (Array.isArray(d.products)) return d.products as T[];
  }
  return [];
}

/**
 * Safely extract data from an API response, with a fallback.
 * Returns the data if it exists, otherwise returns the fallback.
 */
export function safeData<T>(response: ApiResponse<T> | undefined | null, fallback: T): T {
  if (!response) return fallback;
  if (response.data !== undefined && response.data !== null) return response.data;
  return fallback;
}

/**
 * Perform an API request that is expected to return an array of items.
 * Always returns the data as an array, even if the response shape is unexpected.
 * Use this for all list endpoints to prevent "X.map is not a function" errors.
 */
export async function safeListRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T[]>> {
  try {
    const res = await request<T[]>(endpoint, options);
    // Ensure data is always an array
    if (!res.data) {
      return { ...res, data: [] };
    }
    if (!Array.isArray(res.data)) {
      // Try to extract array from nested structure
      const d = res.data as unknown as Record<string, unknown>;
      if (Array.isArray(d.data)) return { ...res, data: d.data as T[] };
      if (Array.isArray(d.items)) return { ...res, data: d.items as T[] };
      if (Array.isArray(d.products)) return { ...res, data: d.products as T[] };
      if (Array.isArray(d.customers)) return { ...res, data: d.customers as T[] };
      if (Array.isArray(d.transactions)) return { ...res, data: d.transactions as T[] };
      // Can't extract — return empty array
      console.warn(`[safeListRequest] Expected array but got ${typeof res.data} from ${endpoint}`);
      return { ...res, data: [] };
    }
    return res;
  } catch (error) {
    // Return safe empty response on error
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}


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

  /**
   * Fetch a unified, chronological timeline + summary stats for a customer
   * covering sales, invoices, credits, gift-card / voucher redemptions,
   * debt payments and delivery notes.
   */
  getHistory: async (id: string) => {
    return request<CustomerHistoryResult>(`/customers/${id}/history`);
  },
};

// ── Customer history (response shape returned by customersApi.getHistory) ──
export interface CustomerHistoryTimelineEntry {
  type:
    | 'SALE'
    | 'INVOICE'
    | 'CREDIT'
    | 'GIFT_CARD_REDEMPTION'
    | 'VOUCHER_REDEMPTION'
    | 'DEBT_PAYMENT'
    | 'DELIVERY_NOTE';
  id: string;
  timestamp: string;
  ref: string;
  [key: string]: unknown;
}

export interface CustomerHistorySummary {
  totalSpent: number;
  outstandingDebt: number;
  lastVisit: string | null;
  loyaltyPoints: number;
  transactionCount: number;
  avgOrderValue: number;
  invoiceCount: number;
  outstandingInvoices: number;
  creditsTotal: number;
  deliveryNotesCount: number;
}

export interface CustomerHistoryResult {
  customer: CustomerItem;
  summary: CustomerHistorySummary;
  timeline: CustomerHistoryTimelineEntry[];
  sections: Record<string, unknown>;
}

export interface CustomerCreditItem {
  id: string;
  storeId: string;
  customerId: string;
  amount: number;
  creditType: string;
  balance: number;
  reference: string | null;
  description: string | null;
  status: string;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { id: string; name: string; phone: string | null };
}

export const customerCreditsApi = {
  list: async (params?: { storeId?: string; customerId?: string; creditType?: string; status?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.customerId) query.set('customerId', params.customerId);
    if (params?.creditType) query.set('creditType', params.creditType);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<CustomerCreditItem[]>(`/customer-credits?${query.toString()}`);
  },

  get: async (id: string) => {
    return request<CustomerCreditItem>(`/customer-credits/${id}`);
  },

  create: async (data: { storeId: string; customerId: string; amount: number; creditType: string; reference?: string; description?: string; createdBy?: string }) => {
    return request<CustomerCreditItem>('/customer-credits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: { amount?: number; creditType?: string; reference?: string | null; description?: string | null }) => {
    return request<CustomerCreditItem>(`/customer-credits/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string) => {
    return request<CustomerCreditItem>(`/customer-credits/${id}`, {
      method: 'DELETE',
    });
  },
};


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

  distributeReceipt: async (params: {
    transactionId: string;
    channel: 'EMAIL' | 'WHATSAPP';
    email?: string;
    phone?: string;
    customMessage?: string;
    storeId?: string;
  }) => {
    return request<ReceiptDistributionResult>(`/reports/export`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
};

// ── Receipt Distribution (Phase 4 — Email via Resend + WhatsApp via Twilio) ──

export interface ReceiptDistributionResult {
  success: boolean;
  channel: 'EMAIL' | 'WHATSAPP';
  recipient: string; // masked for PII
  simulated: boolean; // true when provider API key was absent
  providerId: string | null;
  message: string;
}


export const paymentsApi = {
  initiateMpesa: async (data: MpesaSTKRequest) => {
    return request<MpesaCallbackResult>('/payments/mpesa/stkpush', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Initiate a Daraja STK push (real or simulated depending on env). Accepts
   * the enhanced payload — `phone`, `amount`, `accountReference`,
   * `transactionDesc`, `storeId`.
   */
  darajaStk: async (payload: {
    phone: string;
    amount: number;
    accountReference?: string;
    transactionDesc?: string;
    storeId?: string;
    transactionId?: string;
  }) => {
    return request<DarajaStkResult>('/payments/mpesa/stkpush', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Poll the status of a previously-initiated STK push by its
   * CheckoutRequestID. When Daraja credentials are configured this hits the
   * live STK query endpoint; otherwise it returns the stored status.
   */
  checkStkStatus: async (checkoutRequestId: string) => {
    return request<MpesaStkStatus>(`/payments/mpesa/status/${encodeURIComponent(checkoutRequestId)}`);
  },
};

export interface DarajaStkResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: string;
  message: string;
  status: string;
  mode?: 'daraja' | 'mock' | 'simulated';
}

export interface MpesaStkStatus {
  checkoutRequestId: string;
  merchantRequestId: string | null;
  status: string;
  resultCode: string | null;
  resultDesc: string | null;
  mpesaReceiptNumber: string | null;
  amount: number;
  phoneNumber: string | null;
  source: 'local' | 'daraja';
}


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

  makePayment: async (data: { storeId: string; debtLedgerId: string; amount: number; paymentMethod: string; reference?: string; receivedBy?: string; notes?: string }) => {
    return request<DebtLedgerItem>('/debt', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};


export interface ExpenseItem {
  id: string;
  storeId: string;
  description: string;
  amount: number;
  category: string;
  paidBy: string;
  paymentMethod: string;
  status: string;
  journalEntryId: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  createdAt: string;
  updatedAt: string;
  store?: { id: string; name: string; location: string | null };
}

export const expensesApi = {
  list: async (params?: { storeId?: string; category?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.category) query.set('category', params.category);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<ExpenseItem[]>(`/expenses?${query.toString()}`);
  },

  create: async (data: { storeId: string; description: string; amount: number; category: string; paidBy: string; paymentMethod?: string; notes?: string }) => {
    return request<ExpenseItem>('/expenses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: { description?: string; amount?: number; category?: string; paymentMethod?: string; notes?: string }) => {
    return request<ExpenseItem>(`/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string, hardDelete?: boolean) => {
    const query = hardDelete ? '?hardDelete=true' : '';
    return request<ExpenseItem>(`/expenses/${id}${query}`, {
      method: 'DELETE',
    });
  },
};


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

export const messagesApi = {
  list: async (params?: { storeId?: string; customerId?: string; channel?: string; messageType?: string; status?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.customerId) query.set('customerId', params.customerId);
    if (params?.channel) query.set('channel', params.channel);
    if (params?.messageType) query.set('messageType', params.messageType);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    return request<MessageItem[]>(`/messages?${query.toString()}`);
  },

  send: async (data: { storeId: string; customerId?: string; phone?: string; channel: string; messageType: string; subject?: string; content: string; createdBy?: string }) => {
    return request<MessageItem>('/messages', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  sendDebtReminder: async (customerId: string, phone: string, storeId: string, debtAmount: number) => {
    return request<MessageItem>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        storeId,
        customerId,
        phone,
        channel: 'WHATSAPP',
        messageType: 'DEBT_REMINDER',
        content: `Hello, this is a friendly reminder from MBUMAH HARDWARE that you have an outstanding balance of KES ${debtAmount.toLocaleString()}. Please settle your account at your earliest convenience. Thank you!`,
      }),
    });
  },

  sendBalanceUpdate: async (customerId: string, phone: string, storeId: string, balance: number) => {
    return request<MessageItem>('/messages', {
      method: 'POST',
      body: JSON.stringify({
        storeId,
        customerId,
        phone,
        channel: 'WHATSAPP',
        messageType: 'BALANCE_UPDATE',
        content: `Hello, your current account balance at MBUMAH HARDWARE is KES ${balance.toLocaleString()}. Thank you for your continued business!`,
      }),
    });
  },
};


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

  update: async (id: string, data: { expectedReturnDate?: string; securityDeposit?: number; ratePerDay?: number; ratePerWeek?: number; ratePerMonth?: number; notes?: string }) => {
    return request<RentalItem>(`/rentals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string) => {
    return request<RentalItem>(`/rentals/${id}`, {
      method: 'DELETE',
    });
  },
};

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
  isVoided: boolean;
  postedAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
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
  account?: { id: string; code: string; name: string; type: string; subType?: string | null };
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

// ── Phase 3 — Accounting Module types ───────────────────────────────────────
//
// These mirror the Phase 1 Prisma models (FinancialPeriod, Budget,
// TrialBalanceSnapshot, AuditLog) for use in the financial-tab UI sub-tabs.

export interface FinancialPeriodItem {
  id: string;
  organizationId: string;
  storeId: string;
  periodName: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  closedAt: string | null;
  closedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriched counts (added by /api/financial/periods GET handler).
  entryCount?: number;
  budgetCount?: number;
  snapshotCount?: number;
  postedEntryCount?: number;
  postedTotalDebit?: number;
  postedTotalCredit?: number;
}

export interface BudgetItem {
  id: string;
  storeId: string;
  periodId: string;
  accountId: string;
  budgetedAmount: number;
  actualAmount: number;
  variance: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdById?: string | null;
  account?: {
    id: string;
    code: string;
    name: string;
    type: string;
    normalBalance: string;
    subType?: string | null;
  };
  period?: {
    id: string;
    periodName: string;
    startDate: string;
    endDate: string;
    status: string;
  };
}

export interface TrialBalanceSnapshotItem {
  id: string;
  storeId: string;
  periodId: string | null;
  snapshotDate: string;
  balances: unknown;
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
  generatedByUserId: string | null;
  createdAt: string;
  period?: {
    id: string;
    periodName: string;
    startDate: string;
    endDate: string;
    status: string;
  } | null;
}

export interface AuditLogItem {
  id: string;
  storeId: string | null;
  organizationId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  userId: string | null;
  oldValues: unknown;
  newValues: unknown;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: string;
  user?: { id: string; name: string | null; email: string | null } | null;
}

export const financialApi = {
  listJournalEntries: async (params?: { storeId?: string; page?: number; limit?: number; dateFrom?: string; dateTo?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    return request<JournalEntryItem[]>(`/financial/journal?${query.toString()}`);
  },

  createJournalEntry: async (data: JournalEntryDTO) => {
    return request<JournalEntryItem>('/financial/journal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  voidJournalEntry: async (id: string) => {
    return request<JournalEntryItem>(`/financial/journal/${id}`, {
      method: 'PUT',
    });
  },

  voidPayment: async (id: string) => {
    return request(`/financial/payments/${id}`, {
      method: 'PUT',
    });
  },

  listAccounts: async (storeId?: string) => {
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    params.set('includeBalances', 'true');
    return request<AccountItem[]>(`/financial/accounts?${params.toString()}`);
  },

  getRevenueTrend: async (params: { storeId: string; days?: number }) => {
    const query = new URLSearchParams();
    query.set('storeId', params.storeId);
    if (params.days) query.set('days', String(params.days));
    return request<{
      daily: { date: string; label: string; revenue: number; expenses: number; transactions: number; margin: number; byMethod: Record<string, number> }[];
      summary: {
        totalRevenue: number;
        totalExpenses: number;
        grossProfit: number;
        profitMargin: number;
        avgDailyRevenue: number;
        peakDayRevenue: number;
        peakDayLabel: string;
        totalTransactions: number;
        isDemo: boolean;
      };
    }>(`/financial/revenue-trend?${query.toString()}`);
  },

  // ── Phase 3 — Accounting Module CRUD ──────────────────────────────────────

  createAccount: async (data: {
    organizationId: string;
    code: string;
    name: string;
    type: string;
    subType?: string;
    normalBalance?: string;
    description?: string;
    isActive?: boolean;
    createdByUserId: string;
  }) => {
    return request<AccountItem>('/financial/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateAccount: async (id: string, data: {
    name?: string;
    description?: string;
    subType?: string;
    isActive?: boolean;
    updatedByUserId: string;
  }) => {
    return request<AccountItem>(`/financial/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deactivateAccount: async (id: string, userId: string) => {
    return request<AccountItem>(`/financial/accounts/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId }),
    });
  },

  listPeriods: async (storeId: string) => {
    const query = new URLSearchParams();
    query.set('storeId', storeId);
    return request<FinancialPeriodItem[]>(`/financial/periods?${query.toString()}`);
  },

  createPeriod: async (data: {
    organizationId: string;
    storeId: string;
    periodName: string;
    startDate: string;
    endDate: string;
    createdByUserId: string;
  }) => {
    return request<FinancialPeriodItem>('/financial/periods', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updatePeriodAction: async (id: string, data: {
    action: 'CLOSE' | 'LOCK' | 'REOPEN';
    userId: string;
    reason?: string;
  }) => {
    return request<FinancialPeriodItem>(`/financial/periods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  listBudgets: async (storeId: string, periodId?: string) => {
    const params = new URLSearchParams();
    params.set('storeId', storeId);
    if (periodId) params.set('periodId', periodId);
    return request<BudgetItem[]>(`/financial/budgets?${params.toString()}`);
  },

  setBudget: async (data: {
    storeId: string;
    periodId: string;
    accountId: string;
    budgetedAmount: number | string;
    notes?: string;
    createdById: string;
  }) => {
    return request<BudgetItem>('/financial/budgets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateBudget: async (id: string, data: {
    budgetedAmount?: number | string;
    notes?: string;
    updatedById: string;
  }) => {
    return request<BudgetItem>(`/financial/budgets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteBudget: async (id: string) => {
    return request<{ success: boolean; message: string }>(`/financial/budgets/${id}`, {
      method: 'DELETE',
    });
  },

  recalculateBudgets: async (storeId: string, periodId: string) => {
    return request<{ updated: number; budgets: BudgetItem[] }>(
      '/financial/budgets/recalculate',
      {
        method: 'POST',
        body: JSON.stringify({ storeId, periodId }),
      },
    );
  },

  captureSnapshot: async (data: {
    storeId: string;
    periodId?: string;
    generatedByUserId: string;
    snapshotDate?: string;
  }) => {
    return request<TrialBalanceSnapshotItem>('/financial/trial-balance/snapshot', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  listSnapshots: async (storeId: string) => {
    const query = new URLSearchParams();
    query.set('storeId', storeId);
    return request<TrialBalanceSnapshotItem[]>(
      `/financial/trial-balance/snapshot?${query.toString()}`,
    );
  },

  listAuditTrail: async (params: {
    storeId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.storeId) query.set('storeId', params.storeId);
    if (params.entityType) query.set('entityType', params.entityType);
    if (params.entityId) query.set('entityId', params.entityId);
    if (params.action) query.set('action', params.action);
    if (params.userId) query.set('userId', params.userId);
    if (params.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params.dateTo) query.set('dateTo', params.dateTo);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    return request<AuditLogItem[]>(`/financial/audit-trail?${query.toString()}`);
  },
};


export const dashboardApi = {
  getStats: async (storeId?: string) => {
    const params = new URLSearchParams();
    if (storeId) params.set('storeId', storeId);
    const qs = params.toString();
    return request<DashboardStats>(`/dashboard${qs ? `?${qs}` : ''}`);
  },
};


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

// ─── Store Transfers ────────────────────────────────────────

export interface StoreTransferItemDetail {
  id: string;
  storeTransferId: string;
  productId: string;
  quantity: number;
  receivedQty: number;
  unitType: string;
  notes: string | null;
  product?: { id: string; name: string; sku: string; quantityInStock?: number };
}

export interface StoreTransferItem {
  id: string;
  transferNumber: string;
  fromStoreId: string;
  toStoreId: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED' | 'PARTIAL';
  requestedBy: string | null;
  approvedBy: string | null;
  shippedAt: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  fromStore?: { id: string; name: string; location?: string };
  toStore?: { id: string; name: string; location?: string };
  items?: StoreTransferItemDetail[];
}

export const storeTransfersApi = {
  list: async (params?: { storeId?: string; status?: string; fromStoreId?: string; toStoreId?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.status) query.set('status', params.status);
    if (params?.fromStoreId) query.set('fromStoreId', params.fromStoreId);
    if (params?.toStoreId) query.set('toStoreId', params.toStoreId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<StoreTransferItem[]>(`/store-transfers${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<StoreTransferItem>(`/store-transfers/${id}`);
  },

  create: async (data: {
    fromStoreId: string;
    toStoreId: string;
    items: { productId: string; quantity: number; unitType?: string; notes?: string }[];
    requestedBy?: string;
    notes?: string;
  }) => {
    return request<StoreTransferItem>('/store-transfers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Record<string, unknown>) => {
    return request<StoreTransferItem>(`/store-transfers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

export interface AuditLogItem {
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
  user?: { id: string; name: string; email: string; role: string };
}

export const auditLogsApi = {
  list: async (params?: { storeId?: string; type?: string; severity?: string; dateFrom?: string; dateTo?: string; search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.type) query.set('type', params.type);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<AuditLogItem[]>(`/audit-logs?${query.toString()}`);
  },
};

export interface SystemConfigItem {
  id: string;
  key: string;
  value: string;
  description: string | null;
  isEncrypted: boolean;
  updatedAt: string;
}

export const systemConfigApi = {
  list: async (category?: string) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    return request<Record<string, SystemConfigItem[]>>(`/system-config?${params.toString()}`);
  },

  update: async (data: { id?: string; key?: string; value: string }) => {
    return request<SystemConfigItem>('/system-config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

export interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  storeId: string | null;
  store?: { id: string; name: string };
}

export const usersApi = {
  list: async (params?: { storeId?: string; role?: string; isActive?: boolean; search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.role) query.set('role', params.role);
    if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return request<UserItem[]>(`/users?${query.toString()}`);
  },

  create: async (data: { name: string; email: string; role: string; password: string; phone?: string; storeId?: string; organizationId?: string }) => {
    return request<UserItem>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};


export interface InvoiceItem {
  id: string;
  storeId: string;
  invoiceNumber: string;
  invoiceType: string;
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
  status: string;
  notes: string | null;
  terms: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItemDetail[];
  itemCount?: number;
}

export interface InvoiceItemDetail {
  id: string;
  invoiceId: string;
  productId: string | null;
  productName: string;
  description: string | null;
  quantity: number;
  unitType: string;
  pricePerUnit: number;
  discountPercent: number;
  taxRate: number;
  lineTotal: number;
  product?: { id: string; name: string; sku: string; quantityInStock: number };
}

export const invoicesApi = {
  list: async (params?: { storeId?: string; invoiceType?: string; status?: string; customerId?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.invoiceType) query.set('invoiceType', params.invoiceType);
    if (params?.status) query.set('status', params.status);
    if (params?.customerId) query.set('customerId', params.customerId);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<InvoiceItem[]>(`/invoices${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<InvoiceItem>(`/invoices/${id}`);
  },

  create: async (data: {
    storeId: string;
    invoiceType?: string;
    customerId?: string | null;
    customerName: string;
    customerPhone?: string | null;
    customerEmail?: string | null;
    customerAddress?: string | null;
    issueDate?: string;
    dueDate?: string | null;
    discountAmount?: number;
    notes?: string | null;
    terms?: string | null;
    createdBy?: string;
    items: { productId?: string | null; productName: string; description?: string | null; quantity: number; unitType?: string; pricePerUnit: number; discountPercent?: number; taxRate?: number }[];
  }) => {
    return request<InvoiceItem>('/invoices', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Record<string, unknown>) => {
    return request<InvoiceItem>(`/invoices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};


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
  status: string;
  scheduledDate: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  items?: DeliveryNoteItemDetail[];
  itemCount?: number;
}

export interface DeliveryNoteItemDetail {
  id: string;
  deliveryNoteId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitType: string;
  notes: string | null;
}

export const deliveryNotesApi = {
  list: async (params?: { storeId?: string; status?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<DeliveryNoteItem[]>(`/delivery-notes${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<DeliveryNoteItem>(`/delivery-notes/${id}`);
  },

  create: async (data: {
    storeId: string;
    transactionId?: string;
    customerId?: string;
    customerName: string;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    driverName?: string | null;
    vehicleNumber?: string | null;
    scheduledDate?: string | null;
    notes?: string | null;
    createdBy?: string;
    items: { productId?: string | null; productName: string; quantity: number; unitType?: string; notes?: string | null }[];
  }) => {
    return request<DeliveryNoteItem>('/delivery-notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Record<string, unknown>) => {
    return request<DeliveryNoteItem>(`/delivery-notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};


export interface SupplierItem {
  id: string;
  storeId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  contactPerson: string | null;
  taxPin: string | null;
  paymentTerms: string;
  rating: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseOrderCount?: number;
  summary?: {
    totalPOs: number;
    totalPOValue: number;
    pendingPOs: number;
  };
  purchaseOrders?: PurchaseOrderListItem[];
}

export interface PurchaseOrderListItem {
  id: string;
  storeId: string;
  poNumber: string;
  supplierId: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  subTotal: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  receivedById: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: { id: string; name: string; phone?: string | null; email?: string | null };
  createdBy?: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
  receivedBy?: { id: string; name: string } | null;
  cancelledBy?: { id: string; name: string } | null;
  items?: PurchaseOrderItemDetail[];
  itemCount?: number;
}

export interface PurchaseOrderItemDetail {
  id: string;
  purchaseOrderId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  receivedQty: number;
  notes: string | null;
  product?: { id: string; name: string; sku: string; unitType: string; quantityInStock?: number; costPrice?: number };
}

export const suppliersApi = {
  list: async (params?: { storeId?: string; search?: string; isActive?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.search) query.set('search', params.search);
    if (params?.isActive) query.set('isActive', params.isActive);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
    const qs = query.toString();
    return request<SupplierItem[]>(`/suppliers${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<SupplierItem>(`/suppliers/${id}`);
  },

  create: async (data: {
    storeId: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    contactPerson?: string;
    taxPin?: string;
    paymentTerms?: string;
    rating?: number;
    isActive?: boolean;
    notes?: string;
  }) => {
    return request<SupplierItem>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Partial<SupplierItem>) => {
    return request<SupplierItem>(`/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string) => {
    return request<void>(`/suppliers/${id}`, { method: 'DELETE' });
  },

  /**
   * Send a purchase order (or a custom message) to a supplier via WhatsApp
   * or email. Generates a wa.me / mailto: deep link and logs a Message
   * record for audit.
   */
  sendOrder: async (id: string, payload: {
    purchaseOrderId?: string;
    message?: string;
    channel?: 'WHATSAPP' | 'EMAIL';
  }) => {
    return request<SupplierSendOrderResult>(`/suppliers/${id}/send-order`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export interface SupplierSendOrderResult {
  waLink: string;
  channel: 'WHATSAPP' | 'EMAIL';
  recipient: string | null;
  message: string;
  subject: string;
}

export const purchaseOrdersApi = {
  list: async (params?: { storeId?: string; supplierId?: string; status?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.supplierId) query.set('supplierId', params.supplierId);
    if (params?.status) query.set('status', params.status);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<PurchaseOrderListItem[]>(`/purchase-orders${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<PurchaseOrderListItem>(`/purchase-orders/${id}`);
  },

  create: async (data: {
    storeId: string;
    supplierId: string;
    items: { productId: string; quantity: number; unitCost: number; notes?: string }[];
    notes?: string;
    expectedDate?: string;
    createdById?: string;
  }) => {
    return request<PurchaseOrderListItem>('/purchase-orders', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateStatus: async (id: string, status: string, data?: { notes?: string; approvedById?: string; cancelledById?: string }) => {
    return request<PurchaseOrderListItem>(`/purchase-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status, ...data }),
    });
  },

  receiveItems: async (id: string, receivedItems: { itemId: string; receivedQty: number }[], receivedById?: string) => {
    return request<PurchaseOrderListItem>(`/purchase-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'receive', receivedItems, receivedById }),
    });
  },

  delete: async (id: string) => {
    return request<{ id: string; deleted: boolean }>(`/purchase-orders/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'delete' }),
    });
  },
};

export interface NotificationItem {
  id: string;
  type: 'out_of_stock' | 'low_stock' | 'overdue_rental' | 'large_debt' | 'new_customer' | 'recent_transaction';
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  isRead: boolean;
  targetTab: string;
}

export interface NotificationSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export const notificationsApi = {
  list: async (storeId: string) => {
    const query = new URLSearchParams();
    query.set('storeId', storeId);
    return request<NotificationItem[]>(`/notifications?${query.toString()}`);
  },
};


export const shiftsApi = {
  list: async (storeId: string, status?: string, userId?: string) => {
    const query = new URLSearchParams();
    query.set('storeId', storeId);
    if (status) query.set('status', status);
    if (userId) query.set('userId', userId);
    return request<ShiftData[]>(`/shifts?${query.toString()}`);
  },

  getCurrent: async (storeId: string, userId: string) => {
    const query = new URLSearchParams();
    query.set('storeId', storeId);
    query.set('userId', userId);
    return request<ShiftData | null>(`/shifts/current?${query.toString()}`);
  },

  start: async (payload: CreateShiftPayload) => {
    return request<ShiftData>('/shifts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  end: async (shiftId: string, payload: EndShiftPayload) => {
    return request<ShiftData>(`/shifts/${shiftId}/end`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const giftCardsApi = {
  list: async (params?: { storeId?: string; status?: string; reason?: string; search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.status) query.set('status', params.status);
    if (params?.reason) query.set('reason', params.reason);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<GiftCardItem[]>(`/gift-cards${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<GiftCardItem>(`/gift-cards/${id}`);
  },

  create: async (data: CreateGiftCardPayload) => {
    return request<GiftCardItem>('/gift-cards', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: UpdateGiftCardPayload) => {
    return request<GiftCardItem>(`/gift-cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string, hardDelete = false) => {
    return request<GiftCardItem>(`/gift-cards/${id}${hardDelete ? '?hardDelete=true' : ''}`, { method: 'DELETE' });
  },

  redeem: async (id: string, data: RedeemGiftCardPayload) => {
    return request<{ giftCard: GiftCardItem; redemption: GiftCardRedemption }>(`/gift-cards/${id}/redeem`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  adjust: async (id: string, data: AdjustGiftCardBalancePayload) => {
    return request<GiftCardItem>(`/gift-cards/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  cancel: async (id: string) => {
    return request<GiftCardItem>(`/gift-cards/${id}`, { method: 'DELETE' });
  },

  toggleVisibility: async (id: string) => {
    return request<GiftCardItem>(`/gift-cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ toggleVisibility: true }),
    });
  },
};

// ─── Vouchers API ────────────────────────────────────────────────────────────

export interface VoucherItem {
  id: string;
  storeId: string;
  code: string;
  name: string;
  voucherType: string;
  value: number;
  description: string | null;
  minimumPurchase: number;
  maxDiscount: number | null;
  freeProductId: string | null;
  maxUses: number;
  currentUses: number;
  maxUsesPerUser: number;
  startDate: string;
  endDate: string | null;
  status: string;
  campaignId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  campaign?: { id: string; name: string; campaignType: string; status: string } | null;
  redemptions?: { id: string; discountAmount: number; createdAt: string }[];
}

export interface VoucherCampaignItem {
  id: string;
  storeId: string;
  name: string;
  campaignType: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  budget: number;
  spentAmount: number;
  targetAudience: string | null;
  status: string;
  totalRedemptions: number;
  totalRevenue: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  vouchers?: VoucherItem[];
}

export const vouchersApi = {
  list: async (params?: { storeId?: string; status?: string; voucherType?: string; campaignId?: string; search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.status) query.set('status', params.status);
    if (params?.voucherType) query.set('voucherType', params.voucherType);
    if (params?.campaignId) query.set('campaignId', params.campaignId);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
    const qs = query.toString();
    return request<VoucherItem[]>(`/vouchers${qs ? `?${qs}` : ''}`);
  },

  get: async (id: string) => {
    return request<VoucherItem>(`/vouchers/${id}`);
  },

  create: async (data: { storeId: string; name: string; voucherType?: string; value: number; description?: string; minimumPurchase?: number; maxDiscount?: number; freeProductId?: string; maxUses?: number; maxUsesPerUser?: number; startDate?: string; endDate?: string; campaignId?: string; createdBy?: string }) => {
    return request<VoucherItem>('/vouchers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: async (id: string, data: Partial<VoucherItem>) => {
    return request<VoucherItem>(`/vouchers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete: async (id: string) => {
    return request<VoucherItem>(`/vouchers/${id}`, { method: 'DELETE' });
  },

  /**
   * Redeem a voucher by its human-readable code (case-insensitive). Returns
   * the discount amount that should be applied, the updated voucher and
   * (for FIXED vouchers) the remaining balance.
   */
  redeemByCode: async (payload: {
    code: string;
    storeId: string;
    customerId?: string;
    transactionId?: string;
    amount?: number;
  }) => {
    return request<VoucherRedeemByCodeResult>('/vouchers/redeem', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export interface VoucherRedeemByCodeResult {
  discountAmount: number;
  voucher: VoucherItem;
  redemption: {
    id: string;
    voucherId: string;
    transactionId: string | null;
    redeemedBy: string | null;
    originalTotal: number;
    discountAmount: number;
    finalTotal: number;
    createdAt: string;
  };
  newBalance?: number;
}

export const voucherCampaignsApi = {
  list: async (params?: { storeId?: string; status?: string; campaignType?: string; search?: string; page?: number; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.storeId) query.set('storeId', params.storeId);
    if (params?.status) query.set('status', params.status);
    if (params?.campaignType) query.set('campaignType', params.campaignType);
    if (params?.search) query.set('search', params.search);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<VoucherCampaignItem[]>(`/voucher-campaigns${qs ? `?${qs}` : ''}`);
  },

  create: async (data: { storeId: string; name: string; campaignType?: string; description?: string; startDate?: string; endDate?: string; budget?: number; targetAudience?: string; createdBy?: string }) => {
    return request<VoucherCampaignItem>('/voucher-campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ─── WhatsApp API ───────────────────────────────────────────────────────────

export const whatsappApi = {
  send: async (params: { phone: string; message: string; storeId?: string; customerId?: string; messageType?: string }) => {
    return request<{ phone: string; waLink: string; messageType: string }>('/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },
  sendDocument: async (data: { type: string; documentId?: string; storeId: string; phone?: string; message?: string; customerId?: string }) => {
    return request<{ waLink: string; phone: string; message: string; documentTitle: string }>('/whatsapp/send-document', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

/**
 * Open a WhatsApp chat with a pre-filled message.
 * Uses the wa.me deep link which works on both mobile and desktop.
 */
export function openWhatsApp(phone: string, message: string): void {
  let normalizedPhone = phone.replace(/[\s\-()]/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '254' + normalizedPhone.substring(1);
  }
  if (normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.substring(1);
  }
  const encodedMessage = encodeURIComponent(message);
  const waLink = `https://wa.me/${normalizedPhone}?text=${encodedMessage}`;
  window.open(waLink, '_blank');
}

/**
 * Send via email using mailto: link
 */
export function openEmail(to: string, subject: string, body: string): void {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  window.open(`mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`, '_blank');
}

/**
 * Send via SMS using sms: link
 */
export function openSMS(phone: string, message: string): void {
  let normalizedPhone = phone.replace(/[\s\-()]/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '254' + normalizedPhone.substring(1);
  }
  if (normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.substring(1);
  }
  const encodedMessage = encodeURIComponent(message);
  window.open(`sms:${normalizedPhone}?body=${encodedMessage}`, '_blank');
}


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

// ─── Loyalty API ────────────────────────────────────────────

export interface LoyaltyTierItem {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  pointsThreshold: number;
  discountPercent: number;
  benefits: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyTransactionItem {
  id: string;
  storeId: string;
  customerId: string;
  tierId: string | null;
  transactionType: 'EARN' | 'REDEEM' | 'ADJUST' | 'EXPIRE';
  points: number;
  balanceAfter: number;
  referenceId: string | null;
  referenceType: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  customer?: { id: string; name: string; phone: string | null; email: string | null };
  tier?: { id: string; name: string; color: string | null };
}

export interface LoyaltyCampaignItem {
  id: string;
  storeId: string;
  name: string;
  description: string | null;
  campaignType: string;
  pointsMultiplier: number;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const loyaltyApi = {
  tiers: {
    list: async (params?: { storeId?: string; isActive?: string; search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) => {
      const query = new URLSearchParams();
      if (params?.storeId) query.set('storeId', params.storeId);
      if (params?.isActive) query.set('isActive', params.isActive);
      if (params?.search) query.set('search', params.search);
      if (params?.page) query.set('page', String(params.page));
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.sortBy) query.set('sortBy', params.sortBy);
      if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
      const qs = query.toString();
      return request<LoyaltyTierItem[]>(`/loyalty/tiers${qs ? `?${qs}` : ''}`);
    },
    create: async (data: { storeId: string; name: string; description?: string; pointsThreshold: number; discountPercent: number; benefits?: string; color?: string; icon?: string; sortOrder?: number; isActive?: boolean }) => {
      return request<LoyaltyTierItem>('/loyalty/tiers', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  transactions: {
    list: async (params?: { storeId?: string; customerId?: string; transactionType?: string; dateFrom?: string; dateTo?: string; search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) => {
      const query = new URLSearchParams();
      if (params?.storeId) query.set('storeId', params.storeId);
      if (params?.customerId) query.set('customerId', params.customerId);
      if (params?.transactionType) query.set('transactionType', params.transactionType);
      if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
      if (params?.dateTo) query.set('dateTo', params.dateTo);
      if (params?.search) query.set('search', params.search);
      if (params?.page) query.set('page', String(params.page));
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.sortBy) query.set('sortBy', params.sortBy);
      if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
      const qs = query.toString();
      return request<LoyaltyTransactionItem[]>(`/loyalty/transactions${qs ? `?${qs}` : ''}`);
    },
    create: async (data: { storeId: string; customerId: string; transactionType: string; points: number; description?: string; referenceId?: string; referenceType?: string; tierId?: string }) => {
      return request<LoyaltyTransactionItem>('/loyalty/transactions', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  campaigns: {
    list: async (params?: { storeId?: string; status?: string; campaignType?: string; search?: string; page?: number; limit?: number; sortBy?: string; sortOrder?: string }) => {
      const query = new URLSearchParams();
      if (params?.storeId) query.set('storeId', params.storeId);
      if (params?.status) query.set('status', params.status);
      if (params?.campaignType) query.set('campaignType', params.campaignType);
      if (params?.search) query.set('search', params.search);
      if (params?.page) query.set('page', String(params.page));
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.sortBy) query.set('sortBy', params.sortBy);
      if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
      const qs = query.toString();
      return request<LoyaltyCampaignItem[]>(`/loyalty/campaigns${qs ? `?${qs}` : ''}`);
    },
    create: async (data: { storeId: string; name: string; description?: string; campaignType: string; pointsMultiplier?: number; startDate: string; endDate?: string; isActive?: boolean }) => {
      return request<LoyaltyCampaignItem>('/loyalty/campaigns', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
};

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} min${diffMin !== 1 ? 's' : ''} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  if (diffWeek < 4) return `${diffWeek} week${diffWeek !== 1 ? 's' : ''} ago`;
  return formatDate(date);
}

// ── Banking API ────────────────────────────────────────────

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
  accountType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankTransactionItem {
  id: string;
  bankAccountId: string;
  transactionDate: string;
  transactionType: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  reference: string | null;
  isReconciled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankReconciliationItem {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: number;
  bookBalance: number;
  difference: number;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MpesaReconciliationItem {
  id: string;
  bankTransactionId: string;
  mpesaTransactionId: string;
  matchedAmount: number;
  matchStatus: string;
  createdAt: string;
}

export const bankingApi = {
  accounts: {
    list: async (params?: { storeId?: string; accountType?: string; isActive?: boolean; search?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.storeId) query.set('storeId', params.storeId);
      if (params?.accountType) query.set('accountType', params.accountType);
      if (params?.isActive !== undefined) query.set('isActive', String(params.isActive));
      if (params?.search) query.set('search', params.search);
      if (params?.page) query.set('page', String(params.page));
      if (params?.limit) query.set('limit', String(params.limit));
      return request<BankAccountItem[]>(`/banking/accounts?${query.toString()}`);
    },
    create: async (data: { storeId: string; bankName: string; accountName: string; accountNumber: string; branch?: string; swiftCode?: string; currency?: string; openingBalance?: number; accountType?: string }) => {
      return request<BankAccountItem>('/banking/accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  transactions: {
    list: async (params?: { bankAccountId?: string; storeId?: string; transactionType?: string; isReconciled?: boolean; dateFrom?: string; dateTo?: string; search?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.bankAccountId) query.set('bankAccountId', params.bankAccountId);
      if (params?.storeId) query.set('storeId', params.storeId);
      if (params?.transactionType) query.set('transactionType', params.transactionType);
      if (params?.isReconciled !== undefined) query.set('isReconciled', String(params.isReconciled));
      if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
      if (params?.dateTo) query.set('dateTo', params.dateTo);
      if (params?.search) query.set('search', params.search);
      if (params?.page) query.set('page', String(params.page));
      if (params?.limit) query.set('limit', String(params.limit));
      return request<BankTransactionItem[]>(`/banking/transactions?${query.toString()}`);
    },
    create: async (data: { bankAccountId: string; transactionDate: string; transactionType: string; amount: number; description?: string; reference?: string }) => {
      return request<BankTransactionItem>('/banking/transactions', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
  reconciliations: {
    list: async (params?: { bankAccountId?: string; storeId?: string; status?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.bankAccountId) query.set('bankAccountId', params.bankAccountId);
      if (params?.storeId) query.set('storeId', params.storeId);
      if (params?.status) query.set('status', params.status);
      if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
      if (params?.dateTo) query.set('dateTo', params.dateTo);
      if (params?.page) query.set('page', String(params.page));
      if (params?.limit) query.set('limit', String(params.limit));
      return request<BankReconciliationItem[]>(`/banking/reconciliations?${query.toString()}`);
    },
    create: async (data: { bankAccountId: string; statementDate: string; statementBalance: number; bookBalance: number; notes?: string }) => {
      return request<BankReconciliationItem>('/banking/reconciliations', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  },
};

// ── Security API ──────────────────────────────────────────────────────────────

export interface SecurityDashboardOverview {
  securityScore: number;
  eventsLast24h: number;
  eventsLast7d: number;
  eventsLast30d: number;
  blockedAttempts24h: number;
  criticalEvents24h: number;
  activeSessions: number;
  lockedAccounts: number;
}

export interface SecurityEventItem {
  id: string;
  eventType: string;
  severity: string;
  ipAddress: string | null;
  userId: string | null;
  storeId: string | null;
  resource: string | null;
  action: string | null;
  details: unknown;
  userAgent: string | null;
  blocked: boolean;
  createdAt: string;
}

export const securityApi = {
  dashboard: async (storeId?: string) => {
    const query = storeId ? `?storeId=${storeId}` : '';
    return request<{
      overview: SecurityDashboardOverview;
      breakdown: {
        byType: { type: string; count: number }[];
        bySeverity: { severity: string; count: number }[];
      };
      topTargets: {
        ips: { ip: string; count: number }[];
        resources: { resource: string; count: number }[];
      };
      recentCritical: SecurityEventItem[];
      timeline: { hour: string; count: number }[];
    }>(`/security/dashboard${query}`);
  },

  events: async (params?: {
    page?: number;
    limit?: number;
    eventType?: string;
    severity?: string;
    ipAddress?: string;
    blocked?: string;
    dateFrom?: string;
    dateTo?: string;
    storeId?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.eventType) query.set('eventType', params.eventType);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.ipAddress) query.set('ipAddress', params.ipAddress);
    if (params?.blocked) query.set('blocked', params.blocked);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.storeId) query.set('storeId', params.storeId);
    return request<SecurityEventItem[]>(`/security/events?${query.toString()}`);
  },

  blockIp: async (ipAddress: string, duration?: number, reason?: string) => {
    return request('/security/block-ip', {
      method: 'POST',
      body: JSON.stringify({ ipAddress, duration, reason }),
    });
  },

  unblockIp: async (ipAddress: string) => {
    return request('/security/block-ip', {
      method: 'DELETE',
      body: JSON.stringify({ ipAddress }),
    });
  },
};

// ── Product Recommendations API ─────────────────────────────────────────────

export interface RecommendationItem {
  productId: string;
  name: string;
  sku: string;
  pricePerUnit: number;
  quantityInStock: number;
  coOccurrenceCount: number;
  categoryName: string | null;
}

export const recommendationsApi = {
  /**
   * Returns up to N (default 8) products that are most frequently bought
   * together with the supplied product(s). Pass `productIds` for cart-mode
   * (any-of) recommendations; pass `productId` for a single-product lookup.
   */
  frequentlyBought: async (params: {
    productId?: string;
    productIds?: string;
    storeId?: string;
    limit?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.productId) query.set('productId', params.productId);
    if (params.productIds) query.set('productIds', params.productIds);
    if (params.storeId) query.set('storeId', params.storeId);
    if (params.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return request<RecommendationItem[]>(
      `/recommendations/frequently-bought${qs ? `?${qs}` : ''}`,
    );
  },
};

// ── Trends & Prediction API ─────────────────────────────────────────────────

export interface ProductTrendItem {
  productId: string;
  productName: string;
  sku: string;
  categoryName: string | null;
  recentQty: number;
  previousQty: number;
  recentRevenue: number;
  previousRevenue: number;
  qtyGrowthPct: number | null;
  revenueGrowthPct: number | null;
  direction: 'up' | 'down' | 'stable' | 'new';
  projectedNext7dQty: number;
}

export interface CategoryTrendItem {
  categoryId: string | null;
  categoryName: string | null;
  recentQty: number;
  recentRevenue: number;
  previousQty: number;
  previousRevenue: number;
  direction: 'up' | 'down' | 'stable' | 'new';
  growthPct: number | null;
}

export interface TrendsAnalysisResult {
  range: '7d' | '30d' | '90d';
  windowDays: number;
  recentStart: string;
  previousStart: string;
  summary: {
    totalProductsAnalyzed: number;
    totalRecentQty: number;
    totalRecentRevenue: number;
    totalPreviousRevenue: number;
    overallRevenueGrowthPct: number | null;
    projectedNext7dQty: number;
  };
  topGrowing: ProductTrendItem[];
  topDeclining: ProductTrendItem[];
  categoryTrends: CategoryTrendItem[];
  allProducts: ProductTrendItem[];
}

export const trendsApi = {
  /**
   * Returns per-product sales trend analysis (growth direction, growth %,
   * projected next-7-days qty) plus category-level aggregates and the top
   * growing / declining products for the supplied range.
   */
  analysis: async (params: { storeId: string; range?: '7d' | '30d' | '90d' }) => {
    const query = new URLSearchParams();
    query.set('storeId', params.storeId);
    if (params.range) query.set('range', params.range);
    return request<TrendsAnalysisResult>(`/trends/analysis?${query.toString()}`);
  },
};

// ── Messaging API (bulk + document-sending wrappers) ────────────────────────

export interface BulkMessageRecipient {
  customerId: string;
  name: string;
  phone: string;
  waLink: string | null;
}

export interface BulkMessageSkipped {
  customerId?: string;
  name?: string;
  phone?: string;
  reason: string;
}

export interface BulkMessageResult {
  totalRecipients: number;
  sent: BulkMessageRecipient[];
  skipped: BulkMessageSkipped[];
  broadcastSummary: {
    channel: 'WHATSAPP' | 'SMS';
    audience: 'ALL' | 'CUSTOMERS_WITH_PHONES' | 'DEBTORS' | 'LOYALTY_MEMBERS';
    subject: string;
    scheduledAt: string | null;
    totalCandidates: number;
    sentCount: number;
    skippedCount: number;
  };
}

export const messagingApi = {
  /**
   * Bulk / holiday messaging — generates wa.me deep links (one per
   * recipient) and logs a Message record per recipient. RBAC: SUPER_ADMIN,
   * STORE_OWNER, BRANCH_MANAGER only.
   */
  bulk: async (payload: {
    storeId: string;
    message: string;
    channel: 'WHATSAPP' | 'SMS';
    audience: 'ALL' | 'CUSTOMERS_WITH_PHONES' | 'DEBTORS' | 'LOYALTY_MEMBERS';
    subject?: string;
    scheduledAt?: string;
  }) => {
    return request<BulkMessageResult>('/messaging/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Convenience wrapper around the existing /whatsapp/send-document endpoint
   * (supports 10 document types: invoice, receipt, quotation, voucher,
   * inventory, delivery_note, gift_card, credit_note, purchase_order,
   * statement).
   */
  sendDocument: async (data: {
    type: string;
    documentId?: string;
    storeId: string;
    phone?: string;
    message?: string;
    customerId?: string;
  }) => {
    return request<{
      waLink: string;
      phone: string;
      message: string;
      documentTitle: string;
    }>('/whatsapp/send-document', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};


// ════════════════════════════════════════════════════════════════════════════
// v2.0.0 — KRA eTIMS API client
// ════════════════════════════════════════════════════════════════════════════

export interface KraBusinessProfileItem {
  id: string;
  storeId: string;
  businessPin: string;
  businessName: string;
  registrationDate: string;
  kraUsername: string;
  environment: 'sandbox' | 'production';
  isActive: boolean;
  passwordConfigured: boolean;
  tokenConfigured?: boolean;
  tokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceForKraItem {
  id: string;
  storeId: string;
  transactionId: string;
  kraInvoiceNumber: string;
  kraTaxBreakdown: string;
  submissionStatus: 'PENDING' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  kraSubmissionId: string | null;
  cuPin: string | null;
  qrCode: string | null;
  submittedAt: string | null;
  acceptedAt: string | null;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  transaction?: {
    id: string;
    receiptNumber: string;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
    customer: { id: string; name: string; phone: string | null } | null;
  } | null;
  _count?: { submissions: number };
}

export interface KraSubmissionItem {
  id: string;
  storeId: string;
  invoiceForKraId: string;
  kraReferenceNumber: string | null;
  status: string;
  responseJson: string | null;
  httpStatus: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  submittedAt: string;
  processedAt: string | null;
  invoiceForKra?: {
    id: string;
    kraInvoiceNumber: string;
    submissionStatus: string;
    transaction: { id: string; receiptNumber: string } | null;
  } | null;
}

export const kraApi = {
  getProfile: async (storeId: string) => {
    const query = new URLSearchParams({ storeId });
    return request<KraBusinessProfileItem | null>(`/kra/profile?${query.toString()}`);
  },

  upsertProfile: async (data: {
    storeId: string;
    businessPin: string;
    businessName: string;
    registrationDate?: string;
    kraUsername: string;
    kraPassword: string;
    environment?: 'sandbox' | 'production';
    isActive?: boolean;
  }) => {
    return request<KraBusinessProfileItem>('/kra/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  submitInvoice: async (data: { transactionId: string; storeId: string; dryRun?: boolean }) => {
    return request<{ invoiceForKra: InvoiceForKraItem; result?: unknown; dryRun?: boolean }>(
      '/kra/submit',
      { method: 'POST', body: JSON.stringify(data) },
    );
  },

  queryStatus: async (invoiceForKraId: string) => {
    const query = new URLSearchParams({ invoiceForKraId });
    return request<InvoiceForKraItem>(`/kra/status?${query.toString()}`);
  },

  listInvoices: async (params: {
    storeId: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) => {
    const query = new URLSearchParams();
    query.set('storeId', params.storeId);
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    return request<InvoiceForKraItem[]>(`/kra/invoices?${query.toString()}`);
  },

  listSubmissions: async (params: { storeId: string; invoiceForKraId?: string; status?: string; limit?: number }) => {
    const query = new URLSearchParams();
    query.set('storeId', params.storeId);
    if (params.invoiceForKraId) query.set('invoiceForKraId', params.invoiceForKraId);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));
    return request<KraSubmissionItem[]>(`/kra/submissions?${query.toString()}`);
  },
};


// ════════════════════════════════════════════════════════════════════════════
// v2.0.0 — Debt Reminders API client
// ════════════════════════════════════════════════════════════════════════════

export interface DebtReminderItem {
  id: string;
  storeId: string;
  customerId: string;
  debtLedgerId: string;
  reminderType: 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED';
  message: string;
  providerMessageId: string | null;
  errorMessage: string | null;
  sentAt: string;
  deliveredAt: string | null;
  customer?: { id: string; name: string; phone: string | null; email: string | null };
  debtLedger?: {
    id: string;
    balance: number;
    dueDate: string;
    agingBucket: string;
  };
}

export interface OverdueCustomerItem {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  totalOverdue: number;
  oldestDueDate: string;
  agingBucket: 'CURRENT' | 'DAYS_30' | 'DAYS_60' | 'DAYS_90_PLUS';
  debts: Array<{
    debtLedgerId: string;
    balance: number;
    dueDate: string;
    agingBucket: string;
  }>;
  pendingReminders: number;
}

export interface ReminderScheduleResult {
  totalEligible: number;
  scheduled: number;
  skipped: number;
  errors: number;
  details: Array<{ customerId: string; debtLedgerId: string; scheduled: boolean; reason?: string }>;
}

export const debtRemindersApi = {
  list: async (params: {
    storeId: string;
    status?: string;
    reminderType?: string;
    customerId?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) => {
    const query = new URLSearchParams();
    query.set('storeId', params.storeId);
    if (params.status) query.set('status', params.status);
    if (params.reminderType) query.set('reminderType', params.reminderType);
    if (params.customerId) query.set('customerId', params.customerId);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    return request<DebtReminderItem[]>(`/reminders/debt?${query.toString()}`);
  },

  listOverdue: async (storeId: string, daysThreshold = 1, limit = 50) => {
    const query = new URLSearchParams({
      storeId,
      daysThreshold: String(daysThreshold),
      limit: String(limit),
    });
    return request<OverdueCustomerItem[]>(`/reminders/debt/overdue?${query.toString()}`);
  },

  schedule: async (storeId: string) => {
    return request<ReminderScheduleResult>('/reminders/debt/schedule', {
      method: 'POST',
      body: JSON.stringify({ storeId }),
    });
  },

  process: async (storeId: string) => {
    return request<{ sent: number; failed: number; total: number }>(
      '/reminders/debt/process',
      { method: 'POST', body: JSON.stringify({ storeId }) },
    );
  },
};


// ════════════════════════════════════════════════════════════════════════════
// v2.0.0 — Conversations API client (internal staff chat)
// ════════════════════════════════════════════════════════════════════════════

export interface ConversationItem {
  id: string;
  storeId: string;
  type: 'INTERNAL' | 'CUSTOMER_SUPPORT';
  title: string | null;
  participantIds: string[];
  participants?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    storeId?: string;
  }>;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  sender?: { id: string; name: string; email: string; role: string };
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM';
  attachmentUrl: string | null;
  sentAt: string;
  readBy: string[];
  isOwn: boolean;
}

export const conversationsApi = {
  list: async (storeId: string, type?: string, limit = 50) => {
    const query = new URLSearchParams({ storeId, limit: String(limit) });
    if (type) query.set('type', type);
    return request<ConversationItem[]>(`/messages/conversations?${query.toString()}`);
  },

  create: async (data: {
    storeId: string;
    type?: 'INTERNAL' | 'CUSTOMER_SUPPORT';
    title?: string;
    participantIds: string[];
  }) => {
    return request<ConversationItem>('/messages/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  get: async (conversationId: string) => {
    return request<ConversationItem>(`/messages/conversations/${conversationId}`);
  },

  update: async (conversationId: string, data: {
    title?: string;
    type?: 'INTERNAL' | 'CUSTOMER_SUPPORT';
    addParticipantIds?: string[];
    removeParticipantIds?: string[];
  }) => {
    return request<ConversationItem>(`/messages/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  delete: async (conversationId: string) => {
    return request<void>(`/messages/conversations/${conversationId}`, { method: 'DELETE' });
  },

  listMessages: async (conversationId: string, params?: { limit?: number; before?: string; order?: 'asc' | 'desc' }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.before) query.set('before', params.before);
    if (params?.order) query.set('order', params.order);
    const qs = query.toString();
    return request<ConversationMessageItem[]>(
      `/messages/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
    );
  },

  postMessage: async (conversationId: string, data: { content: string; messageType?: string; attachmentUrl?: string }) => {
    return request<ConversationMessageItem>(`/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
