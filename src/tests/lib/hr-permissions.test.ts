import { describe, it, expect } from 'vitest';
import { hasHrPermission, hrPermissionsForRole, HR_PERMISSIONS } from '@/lib/hr/permissions';
import { isKnownRole, ALL_ROLES, PII_UNMASK_ROLES, PAYROLL_APPROVER_ROLES, PAYROLL_PREPARER_ROLES } from '@/lib/hr/roles';

/**
 * RBAC contract tests for the EMS permission layer (docs/EMS_RBAC_MATRIX.md).
 * The matrix must stay fail-closed: unknown roles deny, unknown keys deny,
 * and the maker-checker role split is structurally impossible to collapse.
 */
describe('hr permission matrix', () => {
  it('denies unknown roles and empty roles', () => {
    expect(hasHrPermission(null, 'hr.employee.read.own_branch')).toBe(false);
    expect(hasHrPermission(undefined, 'hr.employee.read.own_branch')).toBe(false);
    expect(hasHrPermission('', 'hr.employee.read.own_branch')).toBe(false);
    expect(hasHrPermission('UNKNOWN_ROLE', 'hr.employee.read.own_branch')).toBe(false);
  });

  it('denies unknown keys even for privileged roles', () => {
    expect(hasHrPermission('SUPER_ADMIN', 'hr.nonexistent.key' as never)).toBe(false);
    expect(hasHrPermission('STORE_OWNER', 'hr.nonexistent.key' as never)).toBe(false);
  });

  it('gives SUPER_ADMIN everything known', () => {
    for (const key of Object.keys(HR_PERMISSIONS)) {
      expect(hasHrPermission('SUPER_ADMIN', key as never)).toBe(true);
    }
  });

  it('keeps branch managers out of payroll and PII', () => {
    expect(hasHrPermission('BRANCH_MANAGER', 'hr.payroll.prepare')).toBe(false);
    expect(hasHrPermission('BRANCH_MANAGER', 'hr.employee.unmask.pii')).toBe(false);
    expect(hasHrPermission('BRANCH_MANAGER', 'hr.employee.read.own_branch')).toBe(true);
    expect(hasHrPermission('BRANCH_MANAGER', 'hr.leave.approve.branch')).toBe(true);
  });

  it('keeps cashiers at self-service level', () => {
    expect(hasHrPermission('CASHIER', 'hr.attendance.record.own')).toBe(true);
    expect(hasHrPermission('CASHIER', 'hr.leave.request')).toBe(true);
    expect(hasHrPermission('CASHIER', 'hr.employee.create')).toBe(false);
    expect(hasHrPermission('CASHIER', 'hr.payroll.prepare')).toBe(false);
  });

  it('enforces the maker-checker role split', () => {
    // HR_MANAGER may prepare but never approve, post, or disburse.
    expect(hasHrPermission('HR_MANAGER', 'hr.payroll.prepare')).toBe(true);
    expect(hasHrPermission('HR_MANAGER', 'hr.payroll.approve')).toBe(false);
    expect(hasHrPermission('HR_MANAGER', 'hr.payroll.post')).toBe(false);
    expect(hasHrPermission('HR_MANAGER', 'hr.payroll.disburse')).toBe(false);
  });

  it('lists permissions per role without crashes', () => {
    const keys = hrPermissionsForRole('HR_MANAGER');
    expect(keys.length).toBeGreaterThan(10);
    expect(keys).toContain('hr.employee.create');
    expect(keys).not.toContain('hr.payroll.approve');
  });
});

describe('hr role constants', () => {
  it('knows the full platform role set', () => {
    expect(ALL_ROLES).toContain('HR_MANAGER');
    expect(ALL_ROLES).toContain('EMPLOYEE');
    expect(ALL_ROLES).toContain('CASHIER');
    expect(isKnownRole('HR_MANAGER')).toBe(true);
    expect(isKnownRole('hr_manager')).toBe(false); // case-sensitive, fail-closed
    expect(isKnownRole('NOT_A_ROLE')).toBe(false);
  });

  it('keeps unmask and payroll roles disjoint where maker-checker requires it', () => {
    // HR_MANAGER may unmask but not approve; approvers are owner-tier only.
    expect(PII_UNMASK_ROLES).toContain('HR_MANAGER');
    expect(PAYROLL_APPROVER_ROLES).not.toContain('HR_MANAGER');
    expect(PAYROLL_PREPARER_ROLES).toContain('HR_MANAGER');
    expect(PAYROLL_APPROVER_ROLES).toContain('STORE_OWNER');
  });
});

describe('hr report permissions (v2.22.0 QA fix)', () => {
  it('lets the org-scope roles reach the report routes', () => {
    // The report routes gate on hr.report.branch while resolveReportScope
    // grants ORG scope to STORE_OWNER/ACCOUNTANT. Before the fix the guard
    // denied both roles before the scope resolver ran, locking the store
    // owner and accountant out of /hr/reports entirely (regression caught in
    // QA when the owner tried to create a report schedule).
    expect(hasHrPermission('STORE_OWNER', 'hr.report.branch')).toBe(true);
    expect(hasHrPermission('ACCOUNTANT', 'hr.report.branch')).toBe(true);
    expect(hasHrPermission('HR_MANAGER', 'hr.report.branch')).toBe(true);
    expect(hasHrPermission('BRANCH_MANAGER', 'hr.report.branch')).toBe(true);
    expect(hasHrPermission('SUPER_ADMIN', 'hr.report.branch')).toBe(true);
  });

  it('still fails closed for roles without report access', () => {
    expect(hasHrPermission('CASHIER', 'hr.report.branch')).toBe(false);
    expect(hasHrPermission('WAREHOUSE_MANAGER', 'hr.report.branch')).toBe(false);
    expect(hasHrPermission(null, 'hr.report.branch')).toBe(false);
    expect(hasHrPermission('CASHIER', 'hr.report.all')).toBe(false);
  });
});
