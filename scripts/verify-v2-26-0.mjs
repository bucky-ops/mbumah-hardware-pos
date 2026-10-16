#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.26.0 verification
// Static + structural checks for the delivery ops console round: the
// fail-closed write scope on schedule PATCH/DELETE, the admin email
// delivery log viewer, and the digest recipient management UI.
// Run: npm run verify:v2-26-0

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

console.log('== Fail-closed write scope on schedule PATCH/DELETE ==');
check('service: updateSchedule + deleteSchedule enforce the row scope', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  const upd = svc.slice(svc.indexOf('export async function updateSchedule'), svc.indexOf('function safeParseRecipients'));
  return upd.includes('assertScheduleScope(existing, actor)') && upd.includes('STORE_SCOPE_FORBIDDEN') && upd.includes("actor.role === 'BRANCH_MANAGER' && row.storeId !== actor.storeId");
})());
check('service: audit carries the REAL actor role (not SYSTEM)', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  const upd = svc.slice(svc.indexOf('export async function updateSchedule'), svc.indexOf('function safeParseRecipients'));
  return upd.includes('actorRole: actor.role') && upd.includes("actorId: actor.id");
})());
check('routes: PATCH + DELETE pass role/store to the service', (() => {
  const route = read('src/app/api/hr/reports/schedules/[id]/route.ts') ?? '';
  return route.includes("{ id: session.userId, role: session.role, storeId: session.storeId }") && (route.match(/role: session\.role/g) ?? []).length >= 2;
})());
check('tests: scope escalation + 404 + real-actor audit guarded', (() => {
  const t = read('src/tests/lib/hr-schedule-deliveries.test.ts') ?? '';
  return t.includes("updateSchedule / deleteSchedule fail-closed scope") && t.includes('STORE_SCOPE_FORBIDDEN') && t.includes('INVALID_RECIPIENT');
})());

console.log('== Admin email delivery log viewer ==');
check('section component exists', existsSync(join(ROOT, 'src/components/admin/email-delivery-log-section.tsx')));
check('viewer: status + type filters, pagination, expandable metadata', (() => {
  const s = read('src/components/admin/email-delivery-log-section.tsx') ?? '';
  return s.includes('/api/notifications/logs?') && s.includes('STATUS_FILTERS') && s.includes('TYPE_FILTERS') && s.includes('totalPages') && s.includes('aria-expanded');
})());
check('viewer mounted in the Admin tab (ADMIN_ROLES gated surface)', (read('src/app/(shell)/tabs/admin-tab.tsx') ?? '').includes('<EmailDeliveryLogSection />'));
check('viewer styling: status chips + dark variants + focus rings', (() => {
  const s = read('src/components/admin/email-delivery-log-section.tsx') ?? '';
  return s.includes('focus-visible:ring-2') && s.includes('dark:bg-rose-950/40') && s.includes('dark:bg-emerald-950/40');
})());

console.log('== Digest recipient management ==');
check('schedules tab: Recipients button + live-validation dialog', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  return tab.includes('Manage recipients') && tab.includes('parseRecipientsDraft') && tab.includes('Save recipients');
})());
check('schedules tab: client EMAIL_RE mirror + dedupe before PATCH', /RECIPIENT_RE/.test(read('src/components/hr/report-schedules-tab.tsx') ?? '') && /seen\.has/.test(read('src/components/hr/report-schedules-tab.tsx') ?? ''));
check('schedules tab: card recipient chips are clickable affordances', (read('src/components/hr/report-schedules-tab.tsx') ?? '').includes('click to manage recipients'));

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package version 2.26.0', pkg.version === '2.26.0');
check('mbumah releaseVersion 2.26.0', pkg.mbumah?.releaseVersion === '2.26.0' && pkg.mbumah?.baseVersion === '2.26.0');
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has the 2.26.0 entry', changelog.includes('## [2.26.0]'));
const whatsNew = read('src/lib/whats-new.ts') ?? '';
check("What's New has the 2.26.0 entry", whatsNew.includes("version: '2.26.0'"));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
