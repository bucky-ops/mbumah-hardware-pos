'use client';

/**
 * Custom hook for role-based permission checking across the app.
 * Provides convenient access to user permissions for auto-adjusting
 * UI visibility based on the current user's role.
 *
 * v2.12.2 (PR B — RBAC): adds the FEATURE permission layer built on
 * `hasFeaturePermission` (src/lib/permissions.ts) — dotted feature keys such
 * as 'pos.discount.gt5' or 'dashboard.view.revenue' that drive the LockedCard,
 * sidebar locks, the Manager Authorization modal and the cashier limited
 * dashboard. The resource→action `can(resource, action)` matrix is unchanged.
 */

import { useMemo } from 'react';
import { useAuthStore } from '@/lib/stores';
import { hasPermission, type UserRole } from '@/lib/types';
import { hasFeaturePermission, type FeaturePermissionKey } from '@/lib/permissions';

/**
 * Plain (non-hook) feature-permission check for call sites that already hold
 * the role string (e.g. event handlers, plain helpers, store selectors).
 * SUPER_ADMIN bypasses; unknown roles/keys fail closed.
 */
export function canFeature(
  role: string | null | undefined,
  key: FeaturePermissionKey
): boolean {
  return hasFeaturePermission(role, key);
}

export function usePermissions() {
  const user = useAuthStore((s) => s.user);
  const role = (user?.role || '') as UserRole;

  return useMemo(() => {
    const can = (resource: string, action: string) => hasPermission(role, resource, action);
    const featureCan = (key: FeaturePermissionKey) => hasFeaturePermission(role, key);

    return {
      role,
      user,

      // Core permission checks (user/role management is governed by the
      // 'settings.roles.manage' FEATURE key below — SUPER_ADMIN only, v2.12.2)
      can,
      canCreateUsers: hasFeaturePermission(role, 'settings.roles.manage'),

      // ── v2.12.2 FEATURE permission group (dotted keys, client-safe) ──
      // Same keys as FEATURE_PERMISSIONS; camelCased for ergonomics.
      feature: {
        posSell: featureCan('pos.sell'),
        posVoid: featureCan('pos.void'),
        posDiscountGt5: featureCan('pos.discount.gt5'),
        posDiscountGt10: featureCan('pos.discount.gt10'),
        posViewAllSales: featureCan('pos.view.all_sales'),
        dashboardRevenue: featureCan('dashboard.view.revenue'),
        dashboardProfitMargin: featureCan('dashboard.view.profit_margin'),
        dashboardDebtAging: featureCan('dashboard.view.debt_aging'),
        inventoryEdit: featureCan('inventory.edit'),
        inventoryViewCost: featureCan('inventory.view.cost'),
        customersViewDebt: featureCan('customers.view.debt'),
        customersCreate: featureCan('customers.create'),
        debtApproveHighRisk: featureCan('debt.approve.high_risk'),
        financialView: featureCan('financial.view'),
        settingsRolesManage: featureCan('settings.roles.manage'),
      },

      // Specific resource permissions (auto-adjusting visibility)
      products: {
        create: can('products', 'create'),
        read: can('products', 'read'),
        update: can('products', 'update'),
        delete: can('products', 'delete'),
      },
      transactions: {
        create: can('transactions', 'create'),
        read: can('transactions', 'read'),
        update: can('transactions', 'update'),
        delete: can('transactions', 'delete'),
        refund: can('transactions', 'refund'),
        void: can('transactions', 'void'),
      },
      customers: {
        create: can('customers', 'create'),
        read: can('customers', 'read'),
        update: can('customers', 'update'),
        delete: can('customers', 'delete'),
      },
      financials: {
        read: can('financials', 'read'),
        export: can('financials', 'export'),
        approve: can('financials', 'approve'),
        adjust: can('financials', 'adjust'),
      },
      rentals: {
        create: can('rentals', 'create'),
        read: can('rentals', 'read'),
        update: can('rentals', 'update'),
        delete: can('rentals', 'delete'),
      },
      admin: {
        read: can('admin', 'read'),
        update: can('admin', 'update'),
        manageUsers: can('admin', 'manage_users'),
        manageStores: can('admin', 'manage_stores'),
        systemConfig: can('admin', 'system_config'),
      },
      reports: {
        read: can('reports', 'read'),
        export: can('reports', 'export'),
      },
      debt: {
        create: can('debt', 'create'),
        read: can('debt', 'read'),
        update: can('debt', 'update'),
        writeOff: can('debt', 'write_off'),
        remind: can('debt', 'remind'),
      },
      users: {
        create: can('users', 'create'),
        read: can('users', 'read'),
        update: can('users', 'update'),
        delete: can('users', 'delete'),
        manageUsers: can('users', 'manage_users'),
      },
      vouchers: {
        create: can('vouchers', 'create'),
        read: can('vouchers', 'read'),
        update: can('vouchers', 'update'),
        delete: can('vouchers', 'delete'),
      },
      banking: {
        create: can('banking', 'create'),
        read: can('banking', 'read'),
        update: can('banking', 'update'),
        delete: can('banking', 'delete'),
        reconcile: can('banking', 'reconcile'),
        approve: can('banking', 'approve'),
      },
      loyalty: {
        create: can('loyalty', 'create'),
        read: can('loyalty', 'read'),
        update: can('loyalty', 'update'),
        delete: can('loyalty', 'delete'),
      },
      tax: {
        create: can('tax', 'create'),
        read: can('tax', 'read'),
        update: can('tax', 'update'),
        delete: can('tax', 'delete'),
        file: can('tax', 'file'),
        approve: can('tax', 'approve'),
      },
      transfers: {
        create: can('transfers', 'create'),
        read: can('transfers', 'read'),
        update: can('transfers', 'update'),
        approve: can('transfers', 'approve'),
        receive: can('transfers', 'receive'),
      },
      crm: {
        create: can('crm', 'create'),
        read: can('crm', 'read'),
        update: can('crm', 'update'),
        delete: can('crm', 'delete'),
      },
      shifts: {
        create: can('shifts', 'create'),
        read: can('shifts', 'read'),
        update: can('shifts', 'update'),
      },
      messaging: {
        create: can('messaging', 'create'),
        read: can('messaging', 'read'),
      },

      // Role shortcuts
      isAdmin: role === 'SUPER_ADMIN' || role === 'STORE_OWNER',
      isSuperAdmin: role === 'SUPER_ADMIN',
      isBranchManager: role === 'BRANCH_MANAGER',
      isSalesPerson: role === 'SALES_PERSON',
      isAccountant: role === 'ACCOUNTANT',
      requiresShift: role === 'SALES_PERSON',
    };
  }, [role, user]);
}
