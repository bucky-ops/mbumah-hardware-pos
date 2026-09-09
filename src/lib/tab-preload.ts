// Single source of truth for lazy tab-module loading.
//
// AUDIT FIX (Finding 2.2 — lazy-loading overhead): the main page lazy-loads
// 30 tab components, so the FIRST switch to a tab pays a network round-trip
// for its chunk (100–200ms on mobile) before anything renders. There was no
// prefetch path, so users saw the loading skeleton on every cold tab switch.
//
// This map is shared by BOTH consumers of the dynamic imports:
//   • src/app/page.tsx — `lazy(TAB_LOADERS.xxx)` for rendering
//   • src/components/layout/app-sidebar.tsx — `preloadTab(id)` on
//     pointerenter/focus, which warms the browser cache while the user is
//     still moving the pointer toward the item, so the chunk is typically
//     ready by the time the click lands.
//
// The import specifiers are IDENTICAL to the ones previously inline in
// page.tsx, so webpack produces the same chunks — prefetching merely
// requests them earlier.

import type { ComponentType } from 'react';
import type { AppTab } from '@/lib/stores';

export type TabLoader = () => Promise<{ default: ComponentType<unknown> }>;

export const TAB_LOADERS: Record<AppTab, TabLoader> = {
  dashboard: () => import('../app/tabs/dashboard-tab'),
  pos: () => import('../app/tabs/pos-tab'),
  catalog: () => import('../app/tabs/catalog-tab'),
  inventory: () => import('../app/tabs/inventory-tab'),
  customers: () => import('../app/tabs/customers-tab'),
  rentals: () => import('../app/tabs/rentals-tab'),
  financial: () => import('../app/tabs/financial-tab'),
  reports: () => import('../app/tabs/reports-tab'),
  transactions: () => import('../app/tabs/transactions-tab'),
  suppliers: () => import('../app/tabs/suppliers-tab'),
  'gift-cards': () => import('../app/tabs/gift-cards-tab'),
  admin: () => import('../app/tabs/admin-tab'),
  vouchers: () => import('../app/tabs/vouchers-tab'),
  invoices: () => import('../app/tabs/invoices-tab'),
  delivery: () => import('../app/tabs/delivery-notes-tab'),
  credits: () => import('../app/tabs/credits-tab'),
  messaging: () => import('../app/tabs/messaging-tab'),
  transfers: () => import('../app/tabs/transfers-tab'),
  banking: () => import('../app/tabs/banking-tab'),
  loyalty: () => import('../app/tabs/loyalty-tab'),
  security: () => import('../app/tabs/security-tab'),
  payroll: () => import('../app/tabs/payroll-tab'),
  etims: () => import('../app/tabs/etims-tab'),
  'debt-management': () => import('../app/tabs/debt-management-tab'),
  'debt-plans': () => import('../app/tabs/debt-plans-tab'),
  conversations: () => import('../app/tabs/conversations-tab'),
  'purchase-orders': () => import('../app/tabs/purchase-orders-tab'),
  analytics: () => import('../app/tabs/analytics-tab'),
  'data-exports': () => import('../app/tabs/data-exports-tab'),
  'shift-scheduling': () => import('../app/tabs/shift-scheduling-tab'),
};

/**
 * Warm the chunk for a tab without rendering it. Fire-and-forget: failures
 * (offline, chunk fetch race during a deploy) are swallowed — React.lazy
 * will simply fetch again on the real navigation.
 */
export function preloadTab(tab: AppTab): void {
  void TAB_LOADERS[tab]?.().catch(() => {
    /* prefetch is best-effort; the real navigation retries */
  });
}
