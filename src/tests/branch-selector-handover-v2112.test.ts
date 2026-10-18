// v2.112.0 — the Branch Selector hand-over: a "People & payroll" affordance
// on every branch card that rides the v2.111.0 deep link
// (/?tab=people-payroll&branch=<id>) so a branch picker becomes a payroll
// launcher for org-summary roles. The link builder is pure and lives in
// lib/workspace/links.ts next to its sibling builders; the affordance is
// gated on exactly the roles the People & Payroll tab honors.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPeoplePayrollDeepLink } from '@/lib/workspace/links';
import { ORG_SUMMARY_ROLES, TAB_CONFIG } from '@/lib/app-config';

describe('buildPeoplePayrollDeepLink (v2.112.0 Branch Selector hand-over)', () => {
  it('builds the boot deep link with the people-payroll tab and the branch param', () => {
    expect(buildPeoplePayrollDeepLink('store_juja_main')).toBe(
      '/?tab=people-payroll&branch=store_juja_main',
    );
  });

  it('rides the exact tab id the shell knows — never a dead tab', () => {
    const url = buildPeoplePayrollDeepLink('store_nakuru');
    const tab = new URLSearchParams(url.split('?')[1] ?? '').get('tab');
    expect(TAB_CONFIG.some((t) => t.id === tab)).toBe(true);
    expect(tab).toBe('people-payroll');
  });

  it('carries the branch through as the branch param verbatim', () => {
    const url = buildPeoplePayrollDeepLink('store_thika_branch');
    const branch = new URLSearchParams(url.split('?')[1] ?? '').get('branch');
    expect(branch).toBe('store_thika_branch');
  });

  it('keeps an empty id to an honest (empty) branch param instead of dropping it', () => {
    const url = buildPeoplePayrollDeepLink('');
    expect(url).toBe('/?tab=people-payroll&branch=');
  });

  it('is deterministic and relative — the same input always yields the same path', () => {
    expect(buildPeoplePayrollDeepLink('store_x')).toBe(buildPeoplePayrollDeepLink('store_x'));
    expect(buildPeoplePayrollDeepLink('store_x').startsWith('/?')).toBe(true);
  });
});

describe('People & payroll hand-over gating (v2.112.0)', () => {
  it('gates on ORG_SUMMARY_ROLES — the same roles the People & Payroll tab honors', () => {
    expect(ORG_SUMMARY_ROLES).toContain('STORE_OWNER');
    expect(ORG_SUMMARY_ROLES).toContain('SUPER_ADMIN');
    expect(ORG_SUMMARY_ROLES).toContain('ACCOUNTANT');
    expect(ORG_SUMMARY_ROLES).not.toContain('CASHIER');
    expect(ORG_SUMMARY_ROLES).not.toContain('WAREHOUSE_MANAGER');
  });

  it('the people-payroll tab declares exactly those roles', () => {
    const tab = TAB_CONFIG.find((t) => t.id === 'people-payroll');
    expect(tab).toBeDefined();
    expect(tab?.roles).toEqual(ORG_SUMMARY_ROLES);
  });
});

describe('the hand-over wears TWO homes (v2.112.0)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('the Branch Selector renders the affordance behind the same role gate', () => {
    const sel = read('src/components/workspace/branch-selector.tsx');
    expect(sel.includes("ORG_SUMMARY_ROLES.includes(user?.role || '')")).toBe(true);
    expect(sel.includes('href={payrollHref}')).toBe(true);
    expect(sel.includes('target="_blank"')).toBe(true);
    expect(sel.includes('rel="noopener noreferrer"')).toBe(true);
  });

  it('the Organization Console wears the same hand-over in the Workspace column', () => {
    const oc = read('src/components/workspace/org-console.tsx');
    expect(oc.includes('buildPeoplePayrollDeepLink')).toBe(true);
    expect(oc.includes("ORG_SUMMARY_ROLES.includes(user?.role || '')")).toBe(true);
    expect(oc.includes('href={buildPeoplePayrollDeepLink(store.id)}')).toBe(true);
    // the org console is org-roles-only, but the gate keeps both homes honest
    expect(oc.indexOf('canSeePeoplePayroll')).toBeGreaterThan(-1);
  });
});
