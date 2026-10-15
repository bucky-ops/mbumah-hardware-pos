// MBUMAH HARDWARE POS - EMS permission layer (v2.18.5)
//
// Follows the conventions of src/lib/permissions.ts (FEATURE_PERMISSIONS) and
// src/lib/types.ts (PERMISSION_MATRIX): dotted hr.* keys, pure module, safe to
// import from client and server. Server enforcement composes these keys with
// requireStoreAccess and the deny-and-audit pattern from src/lib/auth.ts.
//
// The full mapping table lives in docs/EMS_RBAC_MATRIX.md.

import type { PlatformRole } from './roles';

/**
 * hr.* permission keys and the roles allowed to exercise them.
 * SUPER_ADMIN bypasses programmatically (see hasHrPermission); the explicit
 * listing is documentation plus authority for every other role.
 */
export const HR_PERMISSIONS: Record<string, readonly PlatformRole[]> = {
  // Employee records
  'hr.employee.read.own_branch': ['HR_MANAGER', 'BRANCH_MANAGER'],
  'hr.employee.read.all': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.employee.create': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.employee.update': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.employee.archive': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.employee.read.pii': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.employee.unmask.pii': ['HR_MANAGER', 'STORE_OWNER'],

  // Recruitment and onboarding
  'hr.recruitment.read.branch': ['HR_MANAGER', 'BRANCH_MANAGER'],
  'hr.recruitment.read.all': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.recruitment.manage': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.offer.approve': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.onboarding.manage': ['HR_MANAGER', 'STORE_OWNER'],

  // Attendance
  'hr.attendance.record.own': ['HR_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'STORE_OWNER'],
  'hr.attendance.read.branch': ['HR_MANAGER', 'BRANCH_MANAGER'],
  'hr.attendance.approve.branch': ['BRANCH_MANAGER', 'STORE_OWNER'],
  'hr.attendance.adjust': ['HR_MANAGER', 'STORE_OWNER'],

  // Leave
  'hr.leave.read.own': ['HR_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'STORE_OWNER'],
  'hr.leave.read.branch': ['HR_MANAGER', 'BRANCH_MANAGER'],
  'hr.leave.request': ['HR_MANAGER', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER', 'EMPLOYEE', 'STORE_OWNER'],
  'hr.leave.approve.branch': ['BRANCH_MANAGER', 'STORE_OWNER'],
  'hr.leave.balance.manage': ['HR_MANAGER', 'STORE_OWNER'],

  // Payroll (maker-checker enforced separately at run time)
  'hr.payroll.prepare': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.payroll.approve': ['STORE_OWNER'],
  'hr.payroll.post': ['STORE_OWNER'],
  'hr.payroll.disburse': ['STORE_OWNER'],
  'hr.payroll.correct': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.payroll.read.own': ['CASHIER', 'EMPLOYEE', 'BRANCH_MANAGER', 'ACCOUNTANT', 'HR_MANAGER', 'STORE_OWNER'],
  'hr.payroll.read.branch': ['BRANCH_MANAGER', 'HR_MANAGER'],
  'hr.payroll.read.all': ['ACCOUNTANT', 'HR_MANAGER', 'STORE_OWNER'],

  // Performance, assets, discipline
  'hr.performance.manage': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.performance.review': ['BRANCH_MANAGER', 'HR_MANAGER', 'STORE_OWNER'],
  'hr.performance.read.own': ['CASHIER', 'EMPLOYEE', 'BRANCH_MANAGER', 'ACCOUNTANT', 'HR_MANAGER', 'STORE_OWNER'],
  'hr.asset.manage': ['HR_MANAGER', 'STORE_OWNER'],
  'hr.discipline.manage': ['HR_MANAGER', 'STORE_OWNER'],

  // Reports, settings, rate tables
  'hr.report.branch': ['HR_MANAGER', 'BRANCH_MANAGER'],
  'hr.report.all': ['HR_MANAGER', 'ACCOUNTANT', 'STORE_OWNER'],
  'hr.settings.manage': ['SUPER_ADMIN'],
  'hr.rate-table.manage': ['SUPER_ADMIN'],
};

export type HrPermissionKey = keyof typeof HR_PERMISSIONS & string;

/** Pure check: does this role hold the hr permission? Fail-closed. */
export function hasHrPermission(role: string | null | undefined, key: HrPermissionKey): boolean {
  if (!role) return false;
  const allowed = HR_PERMISSIONS[key];
  if (!allowed) return false; // unknown key denies EVERYONE (typo protection)
  if (role === 'SUPER_ADMIN') return true; // documented bypass, known keys only
  return (allowed as readonly string[]).includes(role);
}

/** All hr permission keys granted to a role (for UI affordances). */
export function hrPermissionsForRole(role: string): HrPermissionKey[] {
  return Object.keys(HR_PERMISSIONS).filter((key) => hasHrPermission(role, key));
}
