// Single source of truth for lazy tab-module loading.
//
// AUDIT FIX (Finding 2.2 - lazy-loading overhead): the main page lazy-loads
// 30 tab components, so the FIRST switch to a tab pays a network round-trip
// for its chunk (100-200ms on mobile) before anything renders. There was no
// prefetch path, so users saw the loading skeleton on every cold tab switch.
//
// This map is shared by BOTH consumers of the dynamic imports:
//   • src/app/page.tsx - `lazy(TAB_LOADERS.xxx)` for rendering
//   • src/components/layout/app-sidebar.tsx - `preloadTab(id)` on
//     pointerenter/focus, which warms the browser cache while the user is
//     still moving the pointer toward the item, so the chunk is typically
//     ready by the time the click lands.
//
// The import specifiers are IDENTICAL to the ones previously inline in
// page.tsx, so webpack produces the same chunks - prefetching merely
// requests them earlier.

import type { ComponentType } from 'react';
import type { AppTab } from '@/lib/stores';

export type TabLoader = () => Promise<{ default: ComponentType<unknown> }>;

export const TAB_LOADERS: Record<AppTab, TabLoader> = {
  dashboard: () => import('../app/(shell)/tabs/dashboard-tab'),
  pos: () => import('../app/(shell)/tabs/pos-tab'),
  catalog: () => import('../app/(shell)/tabs/catalog-tab'),
  inventory: () => import('../app/(shell)/tabs/inventory-tab'),
  customers: () => import('../app/(shell)/tabs/customers-tab'),
  rentals: () => import('../app/(shell)/tabs/rentals-tab'),
  financial: () => import('../app/(shell)/tabs/financial-tab'),
  reports: () => import('../app/(shell)/tabs/reports-tab'),
  transactions: () => import('../app/(shell)/tabs/transactions-tab'),
  suppliers: () => import('../app/(shell)/tabs/suppliers-tab'),
  'gift-cards': () => import('../app/(shell)/tabs/gift-cards-tab'),
  admin: () => import('../app/(shell)/tabs/admin-tab'),
  vouchers: () => import('../app/(shell)/tabs/vouchers-tab'),
  invoices: () => import('../app/(shell)/tabs/invoices-tab'),
  delivery: () => import('../app/(shell)/tabs/delivery-notes-tab'),
  credits: () => import('../app/(shell)/tabs/credits-tab'),
  messaging: () => import('../app/(shell)/tabs/messaging-tab'),
  transfers: () => import('../app/(shell)/tabs/transfers-tab'),
  banking: () => import('../app/(shell)/tabs/banking-tab'),
  loyalty: () => import('../app/(shell)/tabs/loyalty-tab'),
  security: () => import('../app/(shell)/tabs/security-tab'),
  payroll: () => import('../app/(shell)/tabs/payroll-tab'),
  'people-payroll': () => import('../app/(shell)/tabs/people-payroll-tab'),
  etims: () => import('../app/(shell)/tabs/etims-tab'),
  'debt-management': () => import('../app/(shell)/tabs/debt-management-tab'),
  'debt-plans': () => import('../app/(shell)/tabs/debt-plans-tab'),
  conversations: () => import('../app/(shell)/tabs/conversations-tab'),
  'purchase-orders': () => import('../app/(shell)/tabs/purchase-orders-tab'),
  analytics: () => import('../app/(shell)/tabs/analytics-tab'),
  'data-exports': () => import('../app/(shell)/tabs/data-exports-tab'),
  'shift-scheduling': () => import('../app/(shell)/tabs/shift-scheduling-tab'),
};

/**
 * Warm the chunk for a tab without rendering it. Fire-and-forget: failures
 * (offline, chunk fetch race during a deploy) are swallowed - React.lazy
 * will simply fetch again on the real navigation.
 */
export function preloadTab(tab: AppTab): void {
  void TAB_LOADERS[tab]?.().catch(() => {
    /* prefetch is best-effort; the real navigation retries */
  });
}
