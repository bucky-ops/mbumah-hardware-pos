// Zustand state stores

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser, CartItem } from './types';
import { authApi } from './api';
// FINANCIAL MATH AUDIT: cart money math is Decimal-based (never float) and
// uses the SAME line formula as the server (financialMath.calculateLineItem,
// VAT-INCLUSIVE retail pricing) so what the cashier sees is exactly what
// POST /api/transactions persists. financialMath is isomorphic (no node
// imports) — safe in the client bundle.
import { calculateLineItem, toDec, round2, max0 } from '@/lib/utils/financialMath';
import Decimal from 'decimal.js';
const Decimal0 = new Decimal(0);

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  /** Hydrate auth state from localStorage (called once on client mount). */
  hydrateFromStorage: () => void;
}

/**
 * SECURITY (QA 2026-09, v2.4.1): keep `currentStoreId` aligned with the
 * authenticated user's OWN store for everyone except SUPER_ADMIN.
 *
 * `currentStoreId` is persisted in localStorage (`mbt_app_store`) and defaults
 * to `store_juja_main` — previously a non-admin user (who cannot switch
 * branches) silently kept whatever store id the last browser session had.
 * Every tab then queried `/api/...?storeId=<that store>` so a Nakuru cashier
 * could end up reading ANOTHER branch's customers, debts and transactions.
 *
 * SUPER_ADMIN is exempt: they legitimately switch branches and the sidebar
 * persists their choice. Users without a store assignment (org-level roles)
 * keep the persisted value — the server treats them as unscoped.
 */
function syncStoreScopeToUser(user: AuthUser | null | undefined): void {
  try {
    if (!user || user.role === 'SUPER_ADMIN' || !user.storeId) return;
    const app = useAppStore.getState();
    if (app.currentStoreId !== user.storeId) {
      app.setCurrentStoreId(user.storeId);
    }
  } catch {
    // Never block authentication flow on UI state syncing.
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  // Initialize with server-safe defaults (null/false) to avoid hydration
  // mismatch. The store is hydrated from localStorage in the first
  // client-side useEffect (see page.tsx useHasMounted pattern).
  // Previously, reading localStorage at module level caused SSR/client
  // state divergence and React hydration warnings.
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (email: string, password: string) => {
    set({ isLoading: true });
    try {
      const res = await authApi.login(email, password);
      if (res.data) {
        set({
          user: res.data.user,
          token: res.data.token,
          isAuthenticated: true,
          isLoading: false,
        });
        syncStoreScopeToUser(res.data.user);
      } else {
        throw new Error(res.error || 'Login failed');
      }
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      set({ user: null, token: null, isAuthenticated: false });
    }
  },

  fetchUser: async () => {
    try {
      const res = await authApi.getMe();
      if (res.data) {
        set({ user: res.data, isAuthenticated: true });
        localStorage.setItem('mbt_user', JSON.stringify(res.data));
        syncStoreScopeToUser(res.data);
      }
    } catch {
      set({ user: null, token: null, isAuthenticated: false });
      localStorage.removeItem('mbt_token');
      localStorage.removeItem('mbt_user');
    }
  },

  setUser: (user) => {
    set({ user, isAuthenticated: !!user });
    syncStoreScopeToUser(user);
  },

  hydrateFromStorage: () => {
    try {
      const token = localStorage.getItem('mbt_token');
      const storedUser = localStorage.getItem('mbt_user');
      let user: AuthUser | null = null;
      if (token) {
        user = storedUser ? JSON.parse(storedUser) : null;
        set({
          token,
          user,
          isAuthenticated: true,
        });
      }
      // SECURITY: re-align the persisted branch choice with the user's own
      // store on every boot (see syncStoreScopeToUser docstring).
      syncStoreScopeToUser(user);
    } catch {
      // Corrupted localStorage — clear and start fresh
      localStorage.removeItem('mbt_token');
      localStorage.removeItem('mbt_user');
    }
  },
}));

// R10 FIX (v2.5.1 — login flash/reload loop): the API layer dispatches
// `mbt:session-expired` instead of calling window.location.reload() when a
// request comes back 401 (see api.ts handleSessionExpired). React by flipping
// the SPA to the LoginScreen in place — no reload, no flash loop, cart and
// UI state simply reset alongside the session.
if (typeof window !== 'undefined') {
  window.addEventListener('mbt:session-expired', () => {
    try {
      const s = useAuthStore.getState();
      if (s.isAuthenticated || s.token) {
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
        useCartStore.getState().clearCart();
      }
    } catch {
      // Never crash the page from a session-event handler.
    }
  });
}

interface CartState {
  items: CartItem[];
  discount: number;
  setDiscount: (amount: number) => void;
  addItem: (item: Omit<CartItem, 'lineTotal'>) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  applyDiscount: (productId: string, discountPercent: number) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTax: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

/**
 * FINANCIAL MATH AUDIT: identical formula to the server-side
 * calculateLineTotal — HALF_UP 2dp, VAT-INCLUSIVE retail pricing.
 * `lineTotal` is the VAT-INCLUSIVE gross the customer pays for the line
 * (pricePerUnit is the shelf price; the VAT component lives inside it).
 */
function calculateLineTotal(item: Omit<CartItem, 'lineTotal'>): number {
  return calculateLineItem(item.quantity, item.pricePerUnit, item.discountPercent, true, item.taxRate).lineGrossTotal;
}

/**
 * The VAT component of a cart line — extracted FROM the VAT-inclusive
 * lineTotal (net = gross / (1 + rate)); 0 for exempt lines. Decimal-exact.
 */
function lineVatComponent(item: CartItem): number {
  const rate = Math.min(100, Math.max(0, item.taxRate || 0));
  if (rate === 0) return 0;
  const gross = toDec(item.lineTotal);
  const net = gross.div(1 + rate / 100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return round2(gross.minus(net));
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  discount: 0,

  setDiscount: (amount) => {
    // Cart-level flat discount (Ksh). Clamped to >= 0 and capped at the
    // pre-discount GROSS total (VAT is inside the line totals now) so it
    // can never make the total negative.
    const maxDiscount = get().getSubtotal();
    const safe = Math.max(0, Math.min(amount, maxDiscount));
    set({ discount: Number.isFinite(safe) ? safe : 0 });
  },

  addItem: (item) => {
    const { items } = get();
    const existingIndex = items.findIndex((i) => i.productId === item.productId);

    if (existingIndex >= 0) {
      const updated = [...items];
      const existing = updated[existingIndex];
      const newQuantity = existing.quantity + item.quantity;
      const lineTotal = calculateLineTotal({ ...existing, quantity: newQuantity });
      updated[existingIndex] = { ...existing, quantity: newQuantity, lineTotal };
      set({ items: updated });
    } else {
      const lineTotal = calculateLineTotal(item);
      set({ items: [...items, { ...item, lineTotal }] });
    }
  },

  removeItem: (productId) => {
    set({ items: get().items.filter((i) => i.productId !== productId) });
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    const { items } = get();
    const updated = items.map((item) => {
      if (item.productId === productId) {
        const lineTotal = calculateLineTotal({ ...item, quantity });
        return { ...item, quantity, lineTotal };
      }
      return item;
    });
    set({ items: updated });
  },

  applyDiscount: (productId, discountPercent) => {
    const { items } = get();
    const updated = items.map((item) => {
      if (item.productId === productId) {
        const lineTotal = calculateLineTotal({ ...item, discountPercent });
        return { ...item, discountPercent, lineTotal };
      }
      return item;
    });
    set({ items: updated });
  },

  clearCart: () => set({ items: [], discount: 0 }),

  getSubtotal: () => {
    // Σ lineTotal — each line is exact at 2dp and the sum runs in Decimal,
    // so this is the exact VAT-inclusive merchandise value.
    return round2(get().items.reduce((sum, item) => sum.plus(toDec(item.lineTotal)), Decimal0));
  },

  getTax: () => {
    // Σ per-line VAT components EXTRACTED from the VAT-inclusive line
    // totals (never `lineTotal × rate%` on top — that would double-count
    // VAT under inclusive pricing). Matches the server's taxAmount exactly.
    return round2(get().items.reduce((sum, item) => sum.plus(toDec(lineVatComponent(item))), Decimal0));
  },

  getTotal: () => {
    // Cart-level flat discount is subtracted from the gross (VAT-inclusive)
    // subtotal. Never returns negative — discount is clamped in setDiscount,
    // but we guard here too for safety (ISO 9001 financial integrity).
    return round2(max0(toDec(get().getSubtotal()).minus(toDec(get().discount))));
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));

export type AppTab = 'dashboard' | 'pos' | 'catalog' | 'inventory' | 'customers' | 'rentals' | 'financial' | 'reports' | 'transactions' | 'suppliers' | 'gift-cards' | 'admin' | 'vouchers' | 'invoices' | 'delivery' | 'credits' | 'messaging' | 'transfers' | 'banking' | 'loyalty' | 'security' | 'payroll' | 'etims' | 'debt-management' | 'debt-plans' | 'conversations' | 'purchase-orders' | 'analytics' | 'data-exports' | 'shift-scheduling';

export type SidebarState = 'expanded' | 'collapsed' | 'mobile-overlay';

interface AppState {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  /** Desktop sidebar collapsed state — true = icon-only (w-16), false = full (w-64) */
  isSidebarCollapsed: boolean;
  toggleSidebarCollapse: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  currentStoreId: string;
  setCurrentStoreId: (id: string) => void;
  /**
   * Derive the visual sidebar state from the store + viewport.
   * Returns 'expanded' | 'collapsed' | 'mobile-overlay'.
   */
  getSidebarState: (isDesktop: boolean) => SidebarState;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      activeTab: 'dashboard',
      setActiveTab: (tab) => set({ activeTab: tab }),
      sidebarOpen: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      isSidebarCollapsed: false,
      toggleSidebarCollapse: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
      currentStoreId: 'store_juja_main',
      setCurrentStoreId: (id) => set({ currentStoreId: id }),
      getSidebarState: (isDesktop: boolean): SidebarState => {
        const state = get();
        if (!isDesktop) {
          return state.sidebarOpen ? 'mobile-overlay' : 'collapsed';
        }
        return state.isSidebarCollapsed ? 'collapsed' : 'expanded';
      },
    }),
    {
      name: 'mbt_app_store',
      // skipHydration prevents auto-rehydration on the server (SSR safety).
      // We manually call useAppStore.persist.rehydrate() in a client-only
      // useEffect in page.tsx — see the hydrateFromStorage effect.
      skipHydration: true,
      // Only persist these fields — exclude transient state like sidebarOpen
      // (mobile overlay should never persist across sessions).
      partialize: (state) => ({
        activeTab: state.activeTab,
        isSidebarCollapsed: state.isSidebarCollapsed,
        currentStoreId: state.currentStoreId,
      }),
    },
  ),
);
