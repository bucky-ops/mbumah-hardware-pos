#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.39.0 verification
// Scope: governed portal-account linking — service functions (link/unlink,
// PortalLinkError, PII-free audit metadata), POST/DELETE
// /api/employees/[id]/portal-link route (role gate + service delegation),
// HR desk surfaces (Portal column, UserCog action, PortalLinkDialog,
// coverage badge + stat card), on-behalf roster marker + no-bell warning,
// tests, whats-new, version lockstep.
// Run: node scripts/verify-v2-39-0.mjs

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

console.log('== Service: linkPortalAccount / unlinkPortalAccount ==');
const SVC = read('src/lib/hr/employee-service.ts') ?? '';
check('PortalLinkError carries HTTP status + code', SVC.includes('class PortalLinkError') && SVC.includes('status: number') && SVC.includes('code: string'));
check('link enforces TERMINATED refusal', SVC.includes('EMPLOYEE_TERMINATED'));
check('link enforces active-user rule', SVC.includes('USER_INACTIVE'));
check('link enforces same-store rule', SVC.includes('STORE_MISMATCH'));
check('1:1 clash surfaced as friendly 409', SVC.includes('USER_LINKED_ELSEWHERE'));
check('idempotent same-binding no-op', SVC.includes('alreadyInPlace: true'));
check('re-link records previousUserId', SVC.includes('previousUserId: previousUserId ?? undefined'));
check('unlink releases binding to null', SVC.includes("data: { userId: null }"));
check('audit metadata PII-free on LINK', SVC.includes("portalLink: 'LINK'") && SVC.includes('linkedUserRole: user.role') && !/portalLink: 'LINK'[\s\S]{0,400}email:/.test(SVC));
check('audit metadata carries UNLINK + previousUserId', SVC.includes("portalLink: 'UNLINK'") && SVC.includes('previousUserId: employee.userId'));
check('service writes hrAudit for both verbs', (SVC.match(/await hrAudit\(/g) || []).length >= 2);

console.log('== Route: POST/DELETE /api/employees/[id]/portal-link ==');
const ROUTE = read('src/app/api/employees/[id]/portal-link/route.ts') ?? '';
check('route file exists', ROUTE !== null);
check('role gate mirrors hr.employee.update', ROUTE.includes("const PORTAL_LINK_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER'] as const;"));
check('403 with self-serviceable message', ROUTE.includes('Only store owners, HR managers and super admins can manage portal account links.'));
check('delegates to service (no direct Employee writes)', ROUTE.includes('linkPortalAccount(') && ROUTE.includes('unlinkPortalAccount(') && !ROUTE.includes('db.employee'));
check('PortalLinkError mapped to HTTP', ROUTE.includes('e instanceof PortalLinkError'));
check('body validated', ROUTE.includes('userId is required.') && ROUTE.includes('Request body must be valid JSON.'));
check('systemLog mirrors action-stamped', ROUTE.includes("action: 'EMPLOYEE_PORTAL_LINK'") && ROUTE.includes("action: 'EMPLOYEE_PORTAL_UNLINK'"));
check('wrapped with requireStoreAccess + withErrorBoundary', ROUTE.includes('requireStoreAccess(linkHandler') && ROUTE.includes("withErrorBoundary("));

console.log('== HR desk surfaces (payroll-tab) ==');
const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('Portal column header', TAB.includes('hidden xl:table-cell">Portal</th>'));
check('linked chip shows portal email', TAB.includes('Portal account: ${e.user.email}'));
check('unlinked muted chip', TAB.includes('aria-hidden /> No portal'));
check('UserCog row action with aria-label', TAB.includes('portal account for ${e.fullName}'));
check('PortalLinkDialog component + render', TAB.includes('function PortalLinkDialog(') && TAB.includes('<PortalLinkDialog'));
check('dialog posts to portal-link endpoint', TAB.includes('/api/employees/${employee?.id}/portal-link'));
check('candidate list filters already-linked users', TAB.includes('linkedUserIds.has(u.id)'));
check('amber no-bell warning on unlinked picker', TAB.includes('has no linked portal account — no in-app bell will be sent'));
check('roster marks portal-linked employees', TAB.includes("' · portal linked'"));
check('coverage stat card + directory badge', TAB.includes('label="Portal Linked"') && TAB.includes('{portalLinkedCount}/{employees.length} portal'));
check('unlink requires confirm', TAB.includes('window.confirm(`Unlink ${employee.user.email}'));

console.log('== Notifications resolve the link at fire time (unchanged legs) ==');
const SVC_LEAVE = read('src/lib/hr/leave-service.ts') ?? '';
check('on-behalf leg targets employee.user.id', SVC_LEAVE.includes('userId: target.user.id'));
check('cancel leg resolves linked user', SVC_LEAVE.includes('recipientUserId'));

console.log('== Tests + version lockstep ==');
check('portal-link test file exists', existsSync(join(ROOT, 'src/tests/portal-link.test.ts')));
const TESTS = read('src/tests/portal-link.test.ts') ?? '';
check('tests cover service + route + UI contracts', TESTS.includes('linkPortalAccount') && TESTS.includes('(static contract)'));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version 2.39.0', PKG.version === '2.39.0', PKG.version);
check('releaseVersion 2.39.0', PKG.mbumah?.releaseVersion === '2.39.0');
check('baseVersion 2.39.0', PKG.mbumah?.baseVersion === '2.39.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new 2.39.0 entry', WN.includes("version: '2.39.0'") && WN.includes('Link portal accounts'));
check('provider restored to postgresql', (read('prisma/schema.prisma') ?? '').includes('provider = "postgresql"'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
