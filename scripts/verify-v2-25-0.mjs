#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.25.0 verification
// Static + structural checks for the digest delivery observability round:
// the NotificationLog model (the fix for the silently-dead email delivery
// log), the per-schedule delivery history API + UI, the dry-run preview,
// and the notification-bell a11y fix.
// Run: npm run verify:v2-25-0

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

console.log('== NotificationLog model (P0 fix: delivery log was silently dead) ==');
check('schema declares the NotificationLog model', (() => {
  const committed = execSync('git cat-file blob :prisma/schema.prisma', { cwd: ROOT }).toString();
  return /model NotificationLog \{/.test(committed) && /@@map\("notification_logs"\)/.test(committed);
})());
check('provider stays postgresql in the committed schema', (() => {
  const committed = execSync('git cat-file blob :prisma/schema.prisma', { cwd: ROOT }).toString();
  return /provider\s*=\s*"postgresql"/.test(committed) && !/provider\s*=\s*"sqlite"/.test(committed);
})());
check('model carries the User relation with onDelete: SetNull', (() => {
  const schema = read('prisma/schema.prisma') ?? '';
  const model = schema.slice(schema.indexOf('model NotificationLog'), schema.indexOf('@@map("notification_logs")'));
  return model.includes('user User? @relation(fields: [userId], references: [id], onDelete: SetNull)');
})());
check('User side exposes notificationLogs', (read('prisma/schema.prisma') ?? '').includes('notificationLogs        NotificationLog[]'));
check('migration SQL creates notification_logs + FK', (() => {
  const sql = read('prisma/migrations/20261016120000_add_notification_log/migration.sql') ?? '';
  return sql.includes('CREATE TABLE "notification_logs"') && sql.includes('notification_logs_user_id_fkey') && sql.includes('ON DELETE SET NULL');
})());
check('email service writes NotificationLog on every attempt', (() => {
  const svc = read('src/lib/email-service.ts') ?? '';
  return svc.includes('db.notificationLog.create') && svc.includes("status === 'SENT' ? new Date() : null");
})());
check('persistence contract is regression-guarded in vitest', existsSync(join(ROOT, 'src/tests/lib/email-delivery-log.test.ts')));

console.log('== Per-schedule delivery history ==');
check('service: listScheduleDeliveries scope fail-closed', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  return svc.includes('export async function listScheduleDeliveries') && svc.includes('SCHEDULE_NOT_FOUND') && svc.includes('STORE_SCOPE_FORBIDDEN');
})());
check('service: correlates rows via metadata.scheduleId', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  return svc.includes("type: 'HR_REPORT_DIGEST'") && svc.includes('metadata: { contains: `"scheduleId":"${row.id}"` }');
})());
check('service: caps limit 1..50 (default 10)', /Math\.min\(Math\.max\(Math\.trunc\(limit\) \|\| 10, 1\), 50\)/.test(read('src/lib/hr/report-schedule-service.ts') ?? ''));
check('route: GET /api/hr/reports/schedules/[id]/deliveries', (() => {
  const route = read('src/app/api/hr/reports/schedules/[id]/deliveries/route.ts') ?? '';
  return route.includes("hrGuard('hr.report.branch'") && route.includes('listScheduleDeliveries');
})());
check('UI: History button + inline panel with health dots', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  return tab.includes('Delivery history') && tab.includes('healthDots') && tab.includes('aria-expanded');
})());

console.log('== Dry-run digest preview ==');
check('service: previewScheduleDigest is a pure read', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  const idx = svc.indexOf('export async function previewScheduleDigest');
  const body = svc.slice(idx);
  return idx > 0 && body.includes('unavailableReason') && !body.includes('sendEmail') && !body.includes('db.hrReportSchedule.update') && !body.includes('writeDigestNotification');
})());
check('service: nextScheduleRunAt respects lastRunAt (cadence guard)', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  return svc.includes('export function nextScheduleRunAt') && svc.includes('schedule.lastRunAt?.getTime()');
})());
check('route: GET /api/hr/reports/schedules/[id]/preview', (() => {
  const route = read('src/app/api/hr/reports/schedules/[id]/preview/route.ts') ?? '';
  return route.includes('previewScheduleDigest') && route.includes('force-dynamic');
})());
check('UI: Preview dialog mirrors the email digest', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  return tab.includes('Digest preview') && tab.includes('dry run') && tab.includes('Next scheduled send') && tab.includes('Would email');
})());

console.log('== Notification bell a11y (QA-found gap) ==');
check('sidebar bell has an accessible name', (() => {
  const sidebar = read('src/components/layout/app-sidebar.tsx') ?? '';
  const count = (sidebar.match(/aria-label=\{`Notifications\$\{notificationCount\.unread/g) ?? []).length;
  return count >= 2; // expanded + collapsed variants
})());

console.log('== Tests ==');
check('delivery-history test file exists', existsSync(join(ROOT, 'src/tests/lib/hr-schedule-deliveries.test.ts')));
check('email persistence test file exists', existsSync(join(ROOT, 'src/tests/lib/email-delivery-log.test.ts')));

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package version 2.25.0', pkg.version === '2.25.0');
check('mbumah releaseVersion 2.25.0', pkg.mbumah?.releaseVersion === '2.25.0' && pkg.mbumah?.baseVersion === '2.25.0');
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has the 2.25.0 entry', changelog.includes('## [2.25.0]'));
const whatsNew = read('src/lib/whats-new.ts') ?? '';
check("What's New has the 2.25.0 entry", whatsNew.includes("version: '2.25.0'"));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
