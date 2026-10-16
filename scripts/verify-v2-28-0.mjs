#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.28.0 verification
// Static + structural checks for the self-service SSR completion round:
// five server-rendered portal pages behind one shared guard, preserved
// offline contracts (payslips cache island + cache-first dialog), the
// notification-center "Email failed" filter, and version metadata.
// Run: npm run verify:v2-28-0

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

console.log('== Shared portal guard ==');
check('self-portal: loadSelfPortal guard + PortalNote + SelfPageHeader exist', (() => {
  const s = read('src/app/(selfservice)/employees/me/self-portal.tsx') ?? '';
  return s.includes('export async function loadSelfPortal') && s.includes('export function PortalNote') && s.includes('export function SelfPageHeader');
})());
check('self-portal: guard checks module enablement AND permission AND employee', (() => {
  const s = read('src/app/(selfservice)/employees/me/self-portal.tsx') ?? '';
  return s.includes('isHrModuleEnabled(session.organizationId)') && s.includes('hasHrPermission(session.role, permission)') && s.includes('resolveSelfEmployee(session)');
})());
check('home page uses the shared guard (no inline duplicate)', (() => {
  const p = read('src/app/(selfservice)/employees/me/page.tsx') ?? '';
  return p.includes('loadSelfPortal') && !p.includes('const session = await getSessionFromCookies()');
})());

console.log('== SSR pages ==');
for (const [page, perm, service] of [
  ['payslips', 'hr.payroll.read.own', 'listMyPayslips'],
  ['attendance', 'hr.attendance.record.own', 'listMyAttendance'],
  ['leave', 'hr.leave.read.own', 'listMyLeave'],
  ['goals', 'hr.performance.read.own', 'listMyGoalProgress'],
  ['documents', 'hr.documents.read.own', 'listMyDocuments'],
]) {
  const src = read(`src/app/(selfservice)/employees/me/${page}/page.tsx`) ?? '';
  check(`${page}: server component (no 'use client') with dynamic=force-dynamic`, !src.includes("'use client'") && src.includes("export const dynamic = 'force-dynamic'"));
  check(`${page}: guard uses ${perm}`, src.includes(`loadSelfPortal('${perm}')`));
  check(`${page}: renders through ${service}`, src.includes(service));
}

console.log('== Offline contracts preserved ==');
check('payslips: cache-writer island mirrors the SAME list cache key', (() => {
  const w = read('src/app/(selfservice)/employees/me/payslips/payslips-cache-writer.tsx') ?? '';
  return w.includes("'use client'") && w.includes("'mbt_self_payslips_cache_v1'");
})());
check('payslips: dialog keeps the cache-first detail path', (() => {
  const v = read('src/app/(selfservice)/employees/me/payslips/payslips-view.tsx') ?? '';
  return v.includes("'use client'") && v.includes("'mbt_self_payslip_v1:'") && v.includes('readJsonCache') && v.includes('detailOffline');
})());
check('payslips: offline banner tracks the browser connection', (() => {
  const v = read('src/app/(selfservice)/employees/me/payslips/payslips-view.tsx') ?? '';
  return v.includes("window.addEventListener('online'") && v.includes("window.addEventListener('offline'");
})());
check('leave view: POST then router.refresh() (no manual JSON re-fetch)', (() => {
  const v = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
  return v.includes("apiSend('/api/self-service/me/leave', 'POST'") && v.includes('router.refresh()');
})());
check('goals view: acknowledge POST then router.refresh()', (() => {
  const v = read('src/app/(selfservice)/employees/me/goals/goals-view.tsx') ?? '';
  return v.includes('/acknowledge') && v.includes('router.refresh()');
})());

console.log('== Shared header (styling pass) ==');
check('all five new pages render SelfPageHeader with a gradient tone', (() => {
  let ok = true;
  for (const page of ['payslips', 'attendance', 'leave', 'goals', 'documents']) {
    const src = read(`src/app/(selfservice)/employees/me/${page}/page.tsx`) ?? '';
    if (!src.includes('<SelfPageHeader') || !src.includes('tone="from-')) ok = false;
  }
  return ok;
})());
check('SelfPageHeader carries the action slot used by leave', (() => {
  const s = read('src/app/(selfservice)/employees/me/self-portal.tsx') ?? '';
  return s.includes('action?: React.ReactNode') && s.includes('{action ?');
})());

console.log('== Notification-center email-failed filter ==');
check('mapper: pure fail-soft isFailedEmailDigest predicate exists', (() => {
  const m = read('src/lib/hr/digest-notification-view.ts') ?? '';
  return m.includes('export function isFailedEmailDigest') && m.includes("row.type === 'hr_digest' && row.emailStatus === 'FAILED'");
})());
check('center: email_failed filter narrows both active and dismissed lists', (() => {
  const c = read('src/components/notification-center.tsx') ?? '';
  return (c.match(/isFailedEmailDigest/g) ?? []).length >= 4 && c.includes("filter === 'email_failed'");
})());
check('center: tab appears only when digest rows exist, with MailX marker', (() => {
  const c = read('src/components/notification-center.tsx') ?? '';
  return c.includes("activeNotifications.some((n) => n.type === 'hr_digest')") && c.includes('MailX');
})());
check('tests: isFailedEmailDigest covered (match / non-match / fail-soft / junk)', (() => {
  const t = read('src/tests/lib/digest-notification-view.test.ts') ?? '';
  return t.includes('isFailedEmailDigest') && t.includes('is fail-soft on malformed rows') && t.includes('ignores extra truthy junk');
})());

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.28.0', pkg.version === '2.28.0', pkg.version);
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has a [2.28.0] entry', changelog.includes('[2.28.0]'));
const wn = read('src/lib/whats-new.ts') ?? '';
check("What's-New has the 2.28.0 entry", wn.includes("version: '2.28.0'"));
check('verify script registered in package.json', (pkg.scripts ?? {})['verify:v2-28-0'] === 'node scripts/verify-v2-28-0.mjs');

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll v2.28.0 checks PASS');
