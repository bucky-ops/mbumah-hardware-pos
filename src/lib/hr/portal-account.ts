// src/lib/hr/portal-account.ts
//
// v2.41.0: pure helpers for the "create & link a portal account" flow on the
// HR Employee directory (PortalLinkDialog). No imports, no client deps —
// fully deterministic for unit tests.
//
// The flow composes two EXISTING governed endpoints (POST /api/users —
// SUPER_ADMIN-only via settings.roles.manage, then POST
// /api/employees/[id]/portal-link) so no new API surface is needed; this
// module only carries the presentation logic:
//   - suggestPortalEmail: a first-run email proposal from the employee's
//     full name (editable in the dialog — the suggestion is just a starting
//     point, collisions surface as the API's 409).
//   - generateTempPassword: a readable, copyable temporary password
//     (three word-groups + digits, ≥ 12 chars) — the admin hands it to the
//     employee over a secure channel.
//   - PORTAL_CREATE_ROLE_OPTIONS: the least-privilege role picker. Privileged
//     roles (SUPER_ADMIN, ACCOUNTANT) are deliberately NOT offered here —
//     assigning them stays in Settings → Users where the segregation-of-
//     duties gate lives.

export const PORTAL_EMAIL_DOMAIN = 'mbumahhardware.co.ke';

/** Transliterate/strip everything that is not a plain ASCII letter or digit
 *  so the suggestion is a safe email local-part. */
function asciiSlug(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Build an email proposal from an employee's full name:
 *  "Grace Wanjiru" → "grace.wanjiru@mbumahhardware.co.ke",
 *  "David  O. Otieno-Jr" → "david.o.otieno-jr@…". Dots join the name parts;
 *  an empty result means the caller should leave the field empty instead. */
export function suggestPortalEmail(fullName: string): string {
  const slug = asciiSlug(fullName || '');
  if (!slug) return '';
  const parts = slug.split(/\s+/).filter(Boolean).slice(0, 4);
  const local = parts.join('.').slice(0, 48).replace(/^\.+|\.+$/g, '');
  if (!local) return '';
  return `${local}@${PORTAL_EMAIL_DOMAIN}`;
}

const PASSWORD_WORDS = [
  'harbor', 'ember', 'quartz', 'cedar', 'ridge', 'flint', 'grove',
  'summit', 'cobalt', 'meadow', 'thistle', 'bronze', 'canyon', 'drift',
  'falcon', 'ginger', 'hazel', 'indigo', 'juniper', 'kestrel', 'lagoon', 'marble',
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a readable temporary password: `Word-Word-99` pattern (≥ 12
 *  chars, letters + digits + separators). Shape is asserted by tests; the
 *  value is random per call. */
export function generateTempPassword(): string {
  const a = pick(PASSWORD_WORDS);
  const b = pick(PASSWORD_WORDS);
  const digits = String(Math.floor(10 + Math.random() * 90)); // 10-99
  return `${capitalize(a)}-${capitalize(b)}-${digits}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface PortalRoleOption {
  value: string;
  label: string;
  hint: string;
}

/** Least-privilege roles offered by the create-&-link flow. Store-bound by
 *  construction (the employee record fixes the store); privileged roles are
 *  intentionally absent (see module header). */
export const PORTAL_CREATE_ROLE_OPTIONS: readonly PortalRoleOption[] = [
  { value: 'CASHIER', label: 'Cashier', hint: 'Till, customers, transactions' },
  { value: 'INVENTORY_MANAGER', label: 'Inventory Manager', hint: 'Stock, catalog, purchase orders' },
  { value: 'BRANCH_MANAGER', label: 'Branch Manager', hint: 'Runs the branch, decides leave' },
  { value: 'STORE_OWNER', label: 'Store Owner', hint: 'Full branch ownership' },
];

/** Client-side mirror of the createUserSchema email check (the server stays
 *  the source of truth; this only disables the submit button early). */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export interface CreateLinkFormState {
  name: string;
  email: string;
  role: string;
  phone: string;
  password: string;
}

/** Submit-readiness mirror of the dialog's disabled logic (unit-testable). */
export function isCreateLinkFormReady(form: CreateLinkFormState): boolean {
  return (
    form.name.trim().length >= 2 &&
    isValidEmailFormat(form.email) &&
    PORTAL_CREATE_ROLE_OPTIONS.some((r) => r.value === form.role) &&
    form.password.length >= 6
  );
}
