// MBUMAH HARDWARE POS - Employee Management System (EMS) foundation
//
// hr/roles.ts: typed role constants for EMS. Roles are plain strings on
// User.role (no enum), so HR_MANAGER and EMPLOYEE are additive data: no
// migration of the POS roles happens. Every EMS code path must use these
// constants instead of raw literals so a typo cannot create silent privilege
// drift (see docs/EMS_RBAC_MATRIX.md).
//
// IMPORT SAFETY: pure module. No server imports.

export const POS_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER', 'ACCOUNTANT'] as const;

export const HR_ROLES = ['HR_MANAGER', 'EMPLOYEE'] as const;

/** All roles known to the platform (POS + HR). */
export const ALL_ROLES = [...POS_ROLES, ...HR_ROLES] as const;

export type PosRole = (typeof POS_ROLES)[number];
export type HrRole = (typeof HR_ROLES)[number];
export type PlatformRole = (typeof ALL_ROLES)[number];

export const ROLE_HR_MANAGER: PlatformRole = 'HR_MANAGER';
export const ROLE_EMPLOYEE: PlatformRole = 'EMPLOYEE';

/** Roles that may see and unmask employee PII (HR unmask permission). */
export const PII_UNMASK_ROLES: readonly PlatformRole[] = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER'];

/** Roles that may prepare payroll runs. */
export const PAYROLL_PREPARER_ROLES: readonly PlatformRole[] = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER'];

/** Roles that may approve payroll runs (maker-checker: never the preparer). */
export const PAYROLL_APPROVER_ROLES: readonly PlatformRole[] = ['SUPER_ADMIN', 'STORE_OWNER'];

/** Roles with branch-scoped employee read access. */
export const EMPLOYEE_BRANCH_READ_ROLES: readonly PlatformRole[] = [
  'HR_MANAGER',
  'BRANCH_MANAGER',
  'SUPER_ADMIN',
  'STORE_OWNER',
];

export function isKnownRole(role: string): role is PlatformRole {
  return (ALL_ROLES as readonly string[]).includes(role);
}
