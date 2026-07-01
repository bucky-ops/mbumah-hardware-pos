/**
 * MBUMAH HARDWARE POS — Application Configuration
 * Shared constants, role definitions, tab configuration, and utilities.
 */

import type { AppTab } from '@/lib/stores';

// ── Role Definitions ────────────────────────────────────────────────────────

export const ALL_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'];
export const MGMT_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'];
export const SENIOR_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];
export const ADMIN_ROLES = ['SUPER_ADMIN', 'STORE_OWNER'];

// ── Tab Configuration ───────────────────────────────────────────────────────

import {
  Home, ShoppingCart, Tag, Package, Users, ShoppingBag,
  KeyRound, Truck, ClipboardList, BarChart3, FileText,
  CreditCard, Ticket, Receipt, Building2,
  CircleDollarSign, BadgeDollarSign, MessageSquare, MessagesSquare,
  ArrowUpDown, Landmark, Award, Wallet, Shield, Settings,
} from 'lucide-react';

export const TAB_CONFIG: { id: AppTab; label: string; icon: React.ElementType; roles: string[] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, roles: ALL_ROLES },
  { id: 'pos', label: 'POS', icon: ShoppingCart, roles: ALL_ROLES },
  { id: 'catalog', label: 'Catalog', icon: Tag, roles: MGMT_ROLES },
  { id: 'inventory', label: 'Inventory', icon: Package, roles: MGMT_ROLES },
  { id: 'customers', label: 'Customers', icon: Users, roles: ALL_ROLES },
  { id: 'transactions', label: 'Transactions', icon: ShoppingBag, roles: ALL_ROLES },
  { id: 'rentals', label: 'Rentals', icon: KeyRound, roles: SENIOR_ROLES },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, roles: SENIOR_ROLES },
  { id: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList, roles: SENIOR_ROLES },
  { id: 'financial', label: 'Financial', icon: BarChart3, roles: MGMT_ROLES },
  { id: 'reports', label: 'Reports', icon: FileText, roles: MGMT_ROLES },
  { id: 'gift-cards', label: 'Gift Cards', icon: CreditCard, roles: SENIOR_ROLES },
  { id: 'vouchers', label: 'Vouchers', icon: Ticket, roles: SENIOR_ROLES },
  { id: 'invoices', label: 'Invoices', icon: Receipt, roles: MGMT_ROLES },
  { id: 'etims', label: 'eTIMS', icon: Building2, roles: MGMT_ROLES },
  { id: 'delivery', label: 'Delivery', icon: Truck, roles: SENIOR_ROLES },
  { id: 'credits', label: 'Credits', icon: CircleDollarSign, roles: MGMT_ROLES },
  { id: 'debt-management', label: 'Debt Mgmt', icon: BadgeDollarSign, roles: MGMT_ROLES },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare, roles: ALL_ROLES },
  { id: 'conversations', label: 'Chat', icon: MessagesSquare, roles: ALL_ROLES },
  { id: 'transfers', label: 'Transfers', icon: ArrowUpDown, roles: SENIOR_ROLES },
  { id: 'banking', label: 'Banking', icon: Landmark, roles: ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'] },
  { id: 'loyalty', label: 'Loyalty', icon: Award, roles: SENIOR_ROLES },
  { id: 'payroll', label: 'Payroll', icon: Wallet, roles: MGMT_ROLES },
  { id: 'security', label: 'Security', icon: Shield, roles: ADMIN_ROLES },
  { id: 'admin', label: 'Admin', icon: Settings, roles: ADMIN_ROLES },
];

// ── Navigation Groups (used by AppSidebar) ──────────────────────────────────

export const NAV_GROUPS: { label: string; ids: AppTab[] }[] = [
  { label: 'Main', ids: ['dashboard', 'pos', 'catalog', 'inventory', 'customers', 'transactions'] },
  { label: 'Sales & Credit', ids: ['invoices', 'delivery', 'credits', 'debt-management', 'vouchers', 'gift-cards', 'loyalty'] },
  { label: 'Finance', ids: ['financial', 'banking', 'payroll', 'transfers'] },
  { label: 'Operations', ids: ['rentals', 'suppliers', 'messaging', 'conversations'] },
  { label: 'Compliance & System', ids: ['etims', 'reports', 'security', 'admin'] },
];

// ── Demo Accounts ───────────────────────────────────────────────────────────

import { ShieldCheck, Store, ShoppingCart as ShoppingCartIcon, BarChart3 as BarChart3Icon } from 'lucide-react';

export const DEMO_ACCOUNTS = [
  { email: 'admin@mbumahhardware.co.ke', password: 'password123', role: 'Super Admin', icon: ShieldCheck, color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 hover:bg-red-100 dark:hover:bg-red-950/50' },
  { email: 'thika.manager@mbumahhardware.co.ke', password: 'password123', role: 'Branch Mgr (Thika)', icon: Store, color: 'text-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-900 hover:bg-purple-100 dark:hover:bg-purple-950/50' },
  { email: 'cashier@mbumahhardware.co.ke', password: 'password123', role: 'Cashier', icon: ShoppingCartIcon, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 hover:bg-green-100 dark:hover:bg-green-950/50' },
  { email: 'accountant@mbumahhardware.co.ke', password: 'password123', role: 'Accountant', icon: BarChart3Icon, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:hover:bg-amber-950/50' },
];

// ── Category Images ─────────────────────────────────────────────────────────

export const CATEGORY_IMAGES: Record<string, string> = {
  cat_cement: '/categories/cat_cement.png',
  cat_iron_sheets: '/categories/cat_iron.png',
  cat_paints: '/categories/cat_paints.png',
  cat_iron_bars: '/categories/cat_rebar.png',
  cat_wheelbarrows: '/categories/cat_wheelbarrow.png',
  cat_mesh_wires: '/categories/cat_mesh.png',
  cat_tools: '/categories/cat_tools.png',
  cat_plumbing: '/categories/cat_plumbing.png',
  cat_electrical: '/categories/cat_electrical.png',
  cat_nails_screws: '/categories/cat_nails.png',
};

// ── Utility Functions ───────────────────────────────────────────────────────

/** Returns the tabs visible to the given role. SUPER_ADMIN sees everything. */
export function filterTabsByRole(role: string | undefined): typeof TAB_CONFIG {
  if (!role) return [];
  if (role === 'SUPER_ADMIN') return TAB_CONFIG;
  return TAB_CONFIG.filter((t) => t.roles.includes(role));
}

/** Returns the category image path for a given category ID. */
export function getCategoryImage(categoryId: string | null | undefined): string | null {
  if (!categoryId) return null;
  return CATEGORY_IMAGES[categoryId] || null;
}

/** Safely map over a value that should be an array. Returns [] if value is not an array. */
export function safeMap<T, U>(value: unknown, fn: (item: T, index: number) => U): U[] {
  if (!Array.isArray(value)) return [];
  return value.map(fn);
}
