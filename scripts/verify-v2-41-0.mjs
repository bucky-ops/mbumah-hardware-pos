#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.41.0 verification
// Scope: create-&-link portal account flow — pure helpers (email suggestion,
// temp password, least-privilege role picker, readiness mirror), the
// PortalLinkDialog two-tab composition over the EXISTING governed endpoints
// (POST /api/users SUPER_ADMIN-only + POST /api/employees/[id]/portal-link),
// copy/regenerate password UX, empty-state copy, tests, whats-new, version
// lockstep.
// Run: node scripts/verify-v2-41-0.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Helpers: portal-account.ts ==');
const H = read('src/lib/hr/portal-account.ts') ?? '';
check('module is pure (no imports)', !/\nimport /.test(H));
check('email suggestion joins name parts in the company domain', H.includes("export function suggestPortalEmail") && H.includes("export const PORTAL_EMAIL_DOMAIN = 'mbumahhardware.co.ke'"));
check('suggestion strips diacritics + caps local part', H.includes('.normalize(\'NFKD\')') && H.includes('slice(0, 48)'));
check('readable temp password Word-Word-DD', H.includes('export function generateTempPassword') && H.includes('capitalize(a)'));
check('least-privilege role picker excludes privileged roles', H.includes("value: 'CASHIER'") && H.includes("value: 'STORE_OWNER'") && !/SUPER_ADMIN'|'ACCOUNTANT'/.test(H.split('PORTAL_CREATE_ROLE_OPTIONS')[1]?.split('];')[0] ?? ''));
check('readiness mirror validates name/email/role/password', H.includes('export function isCreateLinkFormReady') && H.includes('form.password.length >= 6'));

console.log('== Dialog: two-tab create-&-link composition ==');
const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('helpers imported', TAB.includes("from '@/lib/hr/portal-account'"));
check('single chained mutation (users POST → portal-link POST)', TAB.includes("apiFetch<{ id: string }>('/api/users', {") && TAB.includes('{ userId: created.id }'));
check('create leg client-gated to SUPER_ADMIN', TAB.includes("sessionUser?.role === 'SUPER_ADMIN'") && TAB.includes('const canCreateAccounts = sessionUser'));
check('segmented account-source control', TAB.includes('aria-label="Account source"') && TAB.includes("setMode('create'"));
check('form prefilled from the employee on open', TAB.includes('name: employee.fullName') && TAB.includes('email: suggestPortalEmail(employee.fullName)') && TAB.includes('password: generateTempPassword()'));
check('email re-suggest button', TAB.includes('Re-suggest from the name') && TAB.includes('updCreate({ email: suggestPortalEmail(createForm.name) })'));
check('password regenerate + copy with feedback', TAB.includes('title="Generate a new temporary password"') && TAB.includes('handleCopyPassword') && TAB.includes("setPwCopied(true)"));
check('least-privilege hint rendered', TAB.includes('Privileged roles (SUPER_ADMIN, ACCOUNTANT) are provisioned from Settings → Users.'));
check('monospace temp-password field', TAB.includes('className="flex-1 font-mono text-xs"'));
check('readiness-gated Create & link CTA', TAB.includes('disabled={!isCreateLinkFormReady(createForm) || busy}') && TAB.includes('Create &amp; link account'));
check('link CTA only in link mode', TAB.includes("!employee?.userId && (mode === 'link' || !canCreateAccounts)"));
check('empty states point at the create tab for admins', TAB.includes('switch to “Create new account”'));
check('provisioning notice (immediate link + audit)', TAB.includes('created in this store and linked immediately') && TAB.includes('lands in the audit trail'));
check('users query invalidated after creation', TAB.includes("qc.invalidateQueries({ queryKey: ['portal-link-users', storeId] });"));
check('busy covers all three mutations', TAB.includes('linkMutation.isPending || unlinkMutation.isPending || createAndLinkMutation.isPending'));
check('prefill reset keyed on open+employee', TAB.includes('const createPrefillKey = `${open}-${employee?.id ?? \'\'}`'));

console.log('== Existing governance untouched ==');
const SVC = read('src/lib/hr/employee-service.ts') ?? '';
check('portal-link service rules intact (STORE_MISMATCH/TERMINATED/1:1)', SVC.includes('STORE_MISMATCH') && SVC.includes('EMPLOYEE_TERMINATED') && SVC.includes('USER_LINKED_ELSEWHERE'));
const ROUTE = read('src/app/api/users/route.ts') ?? '';
check('users API still SUPER_ADMIN-only (settings.roles.manage)', ROUTE.includes("'settings.roles.manage'"));
const API = read('src/app/api/employees/[id]/portal-link/route.ts') ?? '';
check('portal-link route role gate intact', API.includes('SUPER_ADMIN') || API.includes('requireRole'));

console.log('== Tests + docs + version ==');
const TEST = read('src/tests/portal-create-link.test.ts') ?? '';
check('helper + static contract tests present', TEST.includes('describe(\'suggestPortalEmail\'') && TEST.includes('v2.41.0 dialog static contracts'));
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new 2.41.0 entry present', WN.includes("version: '2.41.0'") && WN.includes('create & link in one step'));
check('whats-new ordering (2.41.0 above 2.40.0)', WN.indexOf("version: '2.41.0'") < WN.indexOf("version: '2.40.0'"));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json 2.41.0 lockstep', PKG.version === '2.41.0' && PKG.mbumah?.releaseVersion === '2.41.0' && PKG.mbumah?.baseVersion === '2.41.0');

console.log('');
if (failures === 0) {
  console.log('ALL PASS: v2.41.0 create-&-link verification complete.');
} else {
  console.log(`FAILURES: ${failures} check(s) failed.`);
  process.exit(1);
}
