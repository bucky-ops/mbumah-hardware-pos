import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.41.0 create-&-link portal account flow.
 *
 * The feature composes two EXISTING governed endpoints (POST /api/users —
 * SUPER_ADMIN-only via settings.roles.manage, then POST
 * /api/employees/[id]/portal-link), so the new surface is pure presentation:
 * a pure helper module (email suggestion, temp password, least-privilege
 * role picker, submit-readiness) plus the dialog's two-tab composition with
 * a single chained mutation. These tests pin the helper contracts and the
 * dialog's static structure.
 */

import {
  suggestPortalEmail,
  generateTempPassword,
  PORTAL_CREATE_ROLE_OPTIONS,
  isValidEmailFormat,
  isCreateLinkFormReady,
  PORTAL_EMAIL_DOMAIN,
} from '@/lib/hr/portal-account';

const ROOT = join(process.cwd(), 'src');

describe('suggestPortalEmail', () => {
  it('joins name parts with dots inside the company domain', () => {
    expect(suggestPortalEmail('Grace Wanjiru')).toBe(`grace.wanjiru@${PORTAL_EMAIL_DOMAIN}`);
  });

  it('handles multi-part and hyphenated names (hyphens normalize to dots)', () => {
    expect(suggestPortalEmail('David O. Otieno-Jr')).toBe(`david.o.otieno.jr@${PORTAL_EMAIL_DOMAIN}`);
  });

  it('strips diacritics and non-ASCII noise', () => {
    expect(suggestPortalEmail('José Muñoz')).toBe(`jose.munoz@${PORTAL_EMAIL_DOMAIN}`);
  });

  it('caps the local part and never returns a bare @', () => {
    const long = suggestPortalEmail('Aa Bb Cc Dd Ee Ff Gg Hh Ii Jj Kk Ll Mm');
    expect(long.endsWith(`@${PORTAL_EMAIL_DOMAIN}`)).toBe(true);
    expect(long.split('@')[0].length).toBeLessThanOrEqual(48);
    expect(suggestPortalEmail('   ')).toBe('');
    expect(suggestPortalEmail('*** --- ***')).toBe('');
  });
});

describe('generateTempPassword', () => {
  it('produces the readable Word-Word-DD shape with enough entropy', () => {
    for (let i = 0; i < 25; i++) {
      const pw = generateTempPassword();
      expect(pw.length).toBeGreaterThanOrEqual(12);
      expect(pw).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{2}$/);
    }
  });

  it('is random per call', () => {
    const set = new Set(Array.from({ length: 12 }, () => generateTempPassword()));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe('role picker + readiness', () => {
  it('offers least-privilege roles only — privileged assignment stays in Settings', () => {
    const values = PORTAL_CREATE_ROLE_OPTIONS.map((r) => r.value);
    expect(values).toEqual(['CASHIER', 'INVENTORY_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER']);
    expect(values).not.toContain('SUPER_ADMIN');
    expect(values).not.toContain('ACCOUNTANT');
    expect(PORTAL_CREATE_ROLE_OPTIONS.every((r) => r.hint.length > 3)).toBe(true);
  });

  it('validates email format and the full form readiness gate', () => {
    expect(isValidEmailFormat('grace@mbumahhardware.co.ke')).toBe(true);
    expect(isValidEmailFormat('grace@mbumahhardware')).toBe(false);
    expect(isValidEmailFormat(' grace x ')).toBe(false);

    const base = { name: 'Grace Wanjiru', email: 'grace.wanjiru@mbumahhardware.co.ke', role: 'CASHIER', phone: '', password: 'Harbor-Ember-42' };
    expect(isCreateLinkFormReady(base)).toBe(true);
    expect(isCreateLinkFormReady({ ...base, name: 'G' })).toBe(false);
    expect(isCreateLinkFormReady({ ...base, email: 'nope' })).toBe(false);
    expect(isCreateLinkFormReady({ ...base, role: 'SUPER_ADMIN' })).toBe(false);
    expect(isCreateLinkFormReady({ ...base, password: 'short' })).toBe(false);
  });
});

describe('v2.41.0 dialog static contracts', () => {
  const tab = readFileSync(join(ROOT, 'app/(shell)/tabs/payroll-tab.tsx'), 'utf8');

  it('the dialog composes BOTH existing governed endpoints in one mutation', () => {
    expect(tab).toContain("apiFetch<{ id: string }>('/api/users', {");
    expect(tab).toContain("apiFetch(`/api/employees/${employee?.id}/portal-link`, { method: 'POST', body: JSON.stringify({ userId: created.id }) })");
    expect(tab).toContain('createAndLinkMutation');
  });

  it('the create leg is gated to SUPER_ADMIN client-side', () => {
    expect(tab).toContain("sessionUser?.role === 'SUPER_ADMIN'");
    expect(tab).toContain('canCreateAccounts');
  });

  it('the segmented control + prefilled form + copy/regenerate password UX exist', () => {
    expect(tab).toContain('aria-label="Account source"');
    expect(tab).toContain('name: employee.fullName');
    expect(tab).toContain('email: suggestPortalEmail(employee.fullName)');
    expect(tab).toContain('password: generateTempPassword()');
    expect(tab).toContain('handleCopyPassword');
    expect(tab).toContain('title="Generate a new temporary password"');
    expect(tab).toContain('Create &amp; link account');
  });

  it('the submit button honors the readiness mirror and role hint', () => {
    expect(tab).toContain('disabled={!isCreateLinkFormReady(createForm) || busy}');
    expect(tab).toContain('Privileged roles (SUPER_ADMIN, ACCOUNTANT) are provisioned from Settings → Users.');
    expect(tab).toContain("qc.invalidateQueries({ queryKey: ['portal-link-users', storeId] });");
  });
});
