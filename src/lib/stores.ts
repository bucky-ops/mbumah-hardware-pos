// Zustand state stores

import { create } from 'zustand';
import type { AuthUser, CartItem, UnitType } from './types';
import { authApi } from './api';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: typeof window !== 'undefined'
    ? (() => {
        try {
          const stored = localStorage.getItem('mbt_user');
          return stored ? JSON.parse(stored) : null;
        } catch {
          return null;
        }
      })()
    : null,
  token: typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null,
  isAuthenticated: typeof window !== 'undefined' ? !!localStorage.getItem('mbt_token') : false,
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
      }
    } catch {
      set({ user: null, token: null, isAuthenticated: false });
      localStorage.removeItem('mbt_token');
      localStorage.removeItem('mbt_user');
    }
  },

  setUser: (user) => set({ user, isAuthenticated: !!user }),
}));

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

function calculateLineTotal(item: Omit<CartItem, 'lineTotal'>): number {
  const base = item.pricePerUnit * item.quantity;
  const discount = base * (item.discountPercent / 100);
  return base - discount;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  discount: 0,

  setDiscount: (amount) => {
    // Cart-level flat discount (Ksh). Clamped to >= 0 and capped at the
    // pre-discount total so it can never make the total negative.
    const maxDiscount = get().getSubtotal() + get().getTax();
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
    return get().items.reduce((sum, item) => sum + item.lineTotal, 0);
  },

  getTax: () => {
    return get().items.reduce((sum, item) => {
      const taxable = item.lineTotal;
      return sum + (taxable * item.taxRate / 100);
    }, 0);
  },

  getTotal: () => {
    // Cart-level flat discount is subtracted from (subtotal + tax).
    // Never returns negative — discount is clamped in setDiscount, but we
    // guard here too for safety (ISO 9001 financial integrity).
    const preDiscount = get().getSubtotal() + get().getTax();
    return Math.max(0, preDiscount - get().discount);
  },

  getItemCount: () => {
    return get().items.reduce((sum, item) => sum + item.quantity, 0);
  },
}));

export type AppTab = 'dashboard' | 'pos' | 'catalog' | 'inventory' | 'customers' | 'rentals' | 'financial' | 'reports' | 'transactions' | 'suppliers' | 'gift-cards' | 'admin' | 'vouchers' | 'invoices' | 'delivery' | 'credits' | 'messaging' | 'transfers' | 'banking' | 'loyalty' | 'security';

interface AppState {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  currentStoreId: string;
  setCurrentStoreId: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'dashboard',
  setActiveTab: (tab) => set({ activeTab: tab }),
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  currentStoreId: 'store_juja_main',
  setCurrentStoreId: (id) => set({ currentStoreId: id }),
}));
