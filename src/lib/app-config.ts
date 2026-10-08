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
// v2.12.2 (PR B — RBAC): catalog-steward role — catalog/inventory + inbound
// supply-chain tabs only (NO financial/sales/HR tabs). User.role is a string
// column (no schema change); membership enforced via these role arrays.
export const INVENTORY_STAFF_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'INVENTORY_MANAGER'];

/**
 * Friendly role names for chips/tooltips (v2.12.5 RBAC sidebar locks).
 * SUPER_ADMIN intentionally renders "System Administrator".
 */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'System Administrator',
  STORE_OWNER: 'Store Owner',
  BRANCH_MANAGER: 'Branch Manager',
  ACCOUNTANT: 'Accountant',
  CASHIER: 'Cashier',
  INVENTORY_MANAGER: 'Inventory Manager',
};

/** Privilege tier order, lowest → highest (for "requires X" tooltips). */
const ROLE_TIER_ORDER = ['CASHIER', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'];

/**
 * Friendly label of the lowest-privilege role that can open a tab the current
 * user cannot (sidebar lock tooltips). Returns e.g. "Branch Manager".
 */
export function requiredRoleLabelFor(roles: string[]): string {
  for (const role of ROLE_TIER_ORDER) {
    if (roles.includes(role)) return ROLE_LABELS[role] ?? role;
  }
  return 'a higher role';
}

// ── Tab Configuration ───────────────────────────────────────────────────────

import {
  Home, ShoppingCart, Tag, Package, Users, ShoppingBag,
  KeyRound, Truck, ClipboardList, BarChart3, FileText,
  CreditCard, Ticket, Receipt, Building2,
  CircleDollarSign, BadgeDollarSign, MessageSquare, MessagesSquare,
  ArrowUpDown, Landmark, Award, Wallet, Shield, Settings,
  LineChart, Database, CalendarDays,
} from 'lucide-react';

export const TAB_CONFIG: { id: AppTab; label: string; icon: React.ElementType; roles: string[] }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Home, roles: ALL_ROLES },
  { id: 'pos', label: 'POS', icon: ShoppingCart, roles: ALL_ROLES },
  { id: 'catalog', label: 'Catalog', icon: Tag, roles: INVENTORY_STAFF_ROLES },
  { id: 'inventory', label: 'Inventory', icon: Package, roles: INVENTORY_STAFF_ROLES },
  { id: 'customers', label: 'Customers', icon: Users, roles: ALL_ROLES },
  { id: 'transactions', label: 'Transactions', icon: ShoppingBag, roles: ALL_ROLES },
  { id: 'rentals', label: 'Rentals', icon: KeyRound, roles: SENIOR_ROLES },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, roles: INVENTORY_STAFF_ROLES },
  { id: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList, roles: INVENTORY_STAFF_ROLES },
  { id: 'financial', label: 'Financial', icon: BarChart3, roles: MGMT_ROLES },
  { id: 'analytics', label: 'Analytics', icon: LineChart, roles: MGMT_ROLES },
  { id: 'reports', label: 'Reports', icon: FileText, roles: MGMT_ROLES },
  { id: 'gift-cards', label: 'Gift Cards', icon: CreditCard, roles: SENIOR_ROLES },
  { id: 'vouchers', label: 'Vouchers', icon: Ticket, roles: SENIOR_ROLES },
  { id: 'invoices', label: 'Invoices', icon: Receipt, roles: MGMT_ROLES },
  { id: 'etims', label: 'eTIMS', icon: Building2, roles: MGMT_ROLES },
  { id: 'delivery', label: 'Delivery', icon: Truck, roles: SENIOR_ROLES },
  { id: 'credits', label: 'Credits', icon: CircleDollarSign, roles: MGMT_ROLES },
  { id: 'debt-management', label: 'Debt Mgmt', icon: BadgeDollarSign, roles: MGMT_ROLES },
  { id: 'debt-plans', label: 'Debt Plans', icon: BadgeDollarSign, roles: MGMT_ROLES },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare, roles: MGMT_ROLES },
  { id: 'conversations', label: 'Chat', icon: MessagesSquare, roles: MGMT_ROLES },
  { id: 'transfers', label: 'Transfers', icon: ArrowUpDown, roles: INVENTORY_STAFF_ROLES },
  { id: 'banking', label: 'Banking', icon: Landmark, roles: ['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'] },
  { id: 'loyalty', label: 'Loyalty', icon: Award, roles: SENIOR_ROLES },
  { id: 'payroll', label: 'Payroll', icon: Wallet, roles: MGMT_ROLES },
  { id: 'data-exports', label: 'Data Exports', icon: Database, roles: MGMT_ROLES },
  { id: 'shift-scheduling', label: 'Shift Scheduling', icon: CalendarDays, roles: MGMT_ROLES },
  { id: 'security', label: 'Security', icon: Shield, roles: ADMIN_ROLES },
  { id: 'admin', label: 'Admin', icon: Settings, roles: ADMIN_ROLES },
];

// ── Navigation Groups (used by AppSidebar) ──────────────────────────────────

export const NAV_GROUPS: { label: string; ids: AppTab[] }[] = [
  { label: 'Main', ids: ['dashboard', 'pos', 'catalog', 'inventory', 'customers', 'transactions'] },
  { label: 'Sales & Credit', ids: ['invoices', 'delivery', 'credits', 'debt-management', 'debt-plans', 'vouchers', 'gift-cards', 'loyalty'] },
  { label: 'Finance & Insights', ids: ['financial', 'analytics', 'banking', 'payroll', 'transfers'] },
  { label: 'Operations', ids: ['rentals', 'suppliers', 'messaging', 'conversations', 'shift-scheduling'] },
  { label: 'Compliance & System', ids: ['etims', 'reports', 'data-exports', 'security', 'admin'] },
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

/**
 * v2.12.5 (RBAC): returns the tab's config when `role` can open it, otherwise
 * null. Locked (no-access) tabs are NOT silently hidden by the sidebar anymore
 * — they render with a Lock icon; use this to distinguish access vs lock.
 */
export function tabAccessFor(role: string | undefined, id: AppTab): typeof TAB_CONFIG[number] | null {
  const tab = TAB_CONFIG.find((t) => t.id === id);
  if (!tab || !role) return null;
  if (role === 'SUPER_ADMIN') return tab;
  return tab.roles.includes(role) ? tab : null;
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
