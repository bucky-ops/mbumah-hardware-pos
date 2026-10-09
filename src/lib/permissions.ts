// MBUMAH HARDWARE POS - Feature-Level Permission Keys (v2.12.2, PR B phase 1)
//
// This module is the FEATURE permission layer. It COMPLEMENTS the resource→
// action PERMISSION_MATRIX in src/lib/types.ts (which stays authoritative for
// CRUD-style `hasPermission(role, resource, action)` checks):
//
//   • PERMISSION_MATRIX - "can this role UPDATE products?" (resource/action)
//   • FEATURE_PERMISSIONS - "can this role void a sale at all?" (feature key)
//
// IMPORTANT - IMPORT SAFETY: this file is deliberately PURE. It imports
// NOTHING from server-only modules (no db, no auth, no next/server) so the
// client bundle can import it too (phase 2 UI: LockedCard, sidebar locks,
// Manager PIN modal all call `hasFeaturePermission` directly). The server-side
// enforcement wrappers live in src/lib/auth.ts (requireFeaturePermission,
// recordPermissionDenied, noteDeniedAndMaybeLock).
//
// Role-tier interpretation (business decision, v2.12.2)
//
//   SUPER_ADMIN - platform administrator: implicitly allowed on EVERY
//                      feature (hasFeaturePermission short-circuits; the
//                      explicit listing below is documentation, not authority).
//   STORE_OWNER - the business owner: sits at the MANAGER tier everywhere.
//                      The owner ultimately owns the money, so any feature a
//                      Branch Manager can exercise, the owner can too. This is
//                      reflected by listing STORE_OWNER beside BRANCH_MANAGER
//                      on every manager-tier key.
//   BRANCH_MANAGER - operational manager tier (voids, 5-10% discounts,
//                      high-risk debt approval, revenue/debt visibility).
//   ACCOUNTANT - finance-visibility tier (sees sales/debt/revenue numbers
//                      but has NO operational override powers and never sees
//                      product COST/margin data).
//   CASHIER - sell + create customers only. Never sees revenue trends,
//                      debt totals, cost prices, or other cashiers' sales.
//   INVENTORY_MANAGER - catalog/inventory steward (v2.12.2): may edit products
//                      and see cost prices, but has NO sales-override powers.
//
// Keys are dotted `domain.subject.qualifier` strings so phase 2 can render a
// friendly "Requires Branch Manager" chip straight from the key.

/**
 * Feature permission → the roles allowed to exercise it.
 *
 * SUPER_ADMIN is listed explicitly on every key for readability, but
 * `hasFeaturePermission` also enforces the bypass programmatically so a
 * future key that forgets to list SUPER_ADMIN can never lock out admins.
 */
export const FEATURE_PERMISSIONS: Record<string, readonly string[]> = {
  // POS / sales floor
  /** Selling itself - every store-facing role. */
  'pos.sell': ['CASHIER', 'BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Voiding a sale (sales-transaction void). Manager tier only. */
  'pos.void': ['BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Cart/line discounts above 5% (≤5% needs no gate). Manager override can authorize the 5-10% band. */
  'pos.discount.gt5': ['BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Discounts above 10% - owner tier. A cashier can NEVER bypass this, even with a manager override. */
  'pos.discount.gt10': ['STORE_OWNER', 'SUPER_ADMIN'],
  /** Viewing transactions/sales that are not one's own (or revenue-bearing lists). */
  'pos.view.all_sales': ['BRANCH_MANAGER', 'ACCOUNTANT', 'STORE_OWNER', 'SUPER_ADMIN'],

  // Dashboard
  /** Revenue numbers: trends, revenue KPI, payment-method amounts. */
  'dashboard.view.revenue': ['BRANCH_MANAGER', 'ACCOUNTANT', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Profit-margin analytics (cost-based). */
  'dashboard.view.profit_margin': ['BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Debt-aging / receivables visibility. */
  'dashboard.view.debt_aging': ['BRANCH_MANAGER', 'ACCOUNTANT', 'STORE_OWNER', 'SUPER_ADMIN'],

  // Inventory
  /** Catalog/inventory edits (INVENTORY_MANAGER's core mandate). */
  'inventory.edit': ['INVENTORY_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Supplier cost / margin data on products. */
  'inventory.view.cost': ['INVENTORY_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],

  // Customers & credit
  /** Seeing customer debt balances/aging. */
  'customers.view.debt': ['BRANCH_MANAGER', 'ACCOUNTANT', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Registering a new customer at the counter. */
  'customers.create': ['CASHIER', 'BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Approving a high-risk credit sale (outstanding balance > KES 150,000). */
  'debt.approve.high_risk': ['BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],

  // Financials & administration
  /** Financial reports/statements. */
  'financial.view': ['ACCOUNTANT', 'BRANCH_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'],
  /** Creating users / changing user roles. SUPER_ADMIN only (segregation of duties). */
  'settings.roles.manage': ['SUPER_ADMIN'],
};

export type FeaturePermissionKey = keyof typeof FEATURE_PERMISSIONS & string;

/**
 * Pure feature-permission check. Safe to call from client or server.
 *
 * SUPER_ADMIN bypasses everything (defence-in-depth: even if a key forgets to
 * list SUPER_ADMIN, admins are never locked out - mirrors assertPermission()
 * in src/lib/auth.ts). Unknown roles (e.g. a legacy DB row) are denied.
 */
export function hasFeaturePermission(
  role: string | null | undefined,
  key: FeaturePermissionKey
): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  const allowed = FEATURE_PERMISSIONS[key];
  if (!allowed) return false; // unknown key → deny (fail closed)
  return allowed.includes(role);
}

// Friendly denial copy (shown in toasts / LockedCard)

/**
 * Human-readable message per permission key, used in the 403 body
 * (`PERMISSION_DENIED`) and by the phase-2 UI. Written for a shop-floor
 * audience: say what is blocked, who can unblock it, and what to do next.
 */
export const PERMISSION_DENIED_MESSAGES: Record<string, string> = {
  'pos.sell': 'Your account cannot record sales. Contact your store administrator.',
  'pos.void': "You don't have permission to void sales. Ask your Branch Manager.",
  'pos.discount.gt5':
    "Discounts above 5% need Branch Manager approval. Ask your Branch Manager to authorize this sale, or reduce the discount to 5% or less.",
  'pos.discount.gt10':
    "Discounts above 10% can only be approved by the Store Owner. This limit cannot be overridden at the counter.",
  'pos.view.all_sales': "You can only view your own sales. Ask your Branch Manager for the full transactions list.",
  'dashboard.view.revenue': "Your dashboard is limited to your own activity. Revenue figures are hidden — ask your Branch Manager.",
  'dashboard.view.profit_margin': 'Profit margins are visible to managers only.',
  'dashboard.view.debt_aging': "You don't have permission to view customer debt aging. Ask your Branch Manager.",
  'inventory.edit': "You don't have permission to edit catalog or inventory items. Ask your Branch Manager.",
  'inventory.view.cost': 'Supplier cost prices are hidden for your role.',
  'customers.view.debt': "You don't have permission to view customer debt. Ask your Branch Manager.",
  'customers.create': "You don't have permission to add new customers. Ask your Branch Manager.",
  'debt.approve.high_risk':
    'This customer already owes more than KES 150,000. A Branch Manager must approve any further credit sale.',
  'financial.view': "You don't have permission to view financial reports.",
  'settings.roles.manage': 'Only a Super Admin can create users or change roles.',
};

/**
 * Short role label per permission key - what the phase-2 LockedCard renders
 * ("Requires Branch Manager"). Falls back to a generic admin label.
 */
export const PERMISSION_REQUIRED_ROLE_LABEL: Record<string, string> = {
  'pos.sell': 'Store Administrator',
  'pos.void': 'Branch Manager',
  'pos.discount.gt5': 'Branch Manager',
  'pos.discount.gt10': 'Store Owner',
  'pos.view.all_sales': 'Branch Manager',
  'dashboard.view.revenue': 'Branch Manager',
  'dashboard.view.profit_margin': 'Branch Manager',
  'dashboard.view.debt_aging': 'Branch Manager',
  'inventory.edit': 'Branch Manager',
  'inventory.view.cost': 'Branch Manager',
  'customers.view.debt': 'Branch Manager',
  'customers.create': 'Cashier',
  'debt.approve.high_risk': 'Branch Manager',
  'financial.view': 'Branch Manager',
  'settings.roles.manage': 'Super Admin',
};
