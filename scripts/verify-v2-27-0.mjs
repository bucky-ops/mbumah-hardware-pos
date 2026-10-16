#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.27.0 verification
// Static + structural checks for the delivery-intelligence round: per-recipient
// delivery expansion, the notification-center digest-row intelligence
// (delivery chip + manual marker + Manage-schedule deep link), and the
// Schedules tab deep-link highlight.
// Run: npm run verify:v2-27-0

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

console.log('== Per-recipient delivery expansion ==');
check('service: delivery rows carry recipientList parsed from the joined column', (() => {
  const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
  const rows = svc.slice(svc.indexOf('export interface ScheduleDeliveryRow'));
  return rows.includes('recipientList: string[]') && rows.includes(".split(',')") && rows.includes(".filter((r) => r.length > 0 && r.includes('@'))");
})());
check('UI: history rows are expandable with aria-expanded + per-recipient chips', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  const hist = tab.slice(tab.indexOf('v2.25.0: inline delivery-history panel'), tab.indexOf('<div className="flex items-center justify-end gap-1.5 border-t pt-2">'));
  return hist.includes('aria-expanded') && hist.includes('Per-recipient') && hist.includes('historyExpandedId') && hist.includes('recipientList.length');
})());
check('UI: expansion resets when the panel collapses or switches schedules', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  const t = tab.slice(tab.indexOf('const toggleHistory'), tab.indexOf('const toggleHistory') + 1400);
  return (t.match(/setHistoryExpandedId\(null\)/g) ?? []).length >= 2;
})());
check('tests: recipientList parsing guarded (multi/messy/single)', (() => {
  const t = read('src/tests/lib/hr-schedule-deliveries.test.ts') ?? '';
  return t.includes("trims spaces, drops empty and address-less fragments") && t.includes('single recipient yields a one-element list') && t.includes("recipientList: string[]") === false && t.includes("toEqual(['a@x.co.ke', 'b@y.co.ke'])");
})());

console.log('== Notification-center digest-row intelligence ==');
check('mapper: pure fail-soft metadata parser exists with shape guards', (() => {
  const m = read('src/lib/hr/digest-notification-view.ts') ?? '';
  return m.includes('export function parseDigestNotificationExtras') && m.includes('Array.isArray(parsed)') && m.includes("meta.emailStatus === 'SENT' || meta.emailStatus === 'FAILED'");
})());
check('route: /api/notifications flattens scheduleId/manual/emailStatus onto digest rows', (() => {
  const r = read('src/app/api/notifications/route.ts') ?? '';
  return r.includes('parseDigestNotificationExtras') && r.includes('scheduleId: extras.scheduleId') && r.includes('emailStatus: extras.emailStatus');
})());
check('api types: NotificationItem carries the optional extras', (() => {
  const a = read('src/lib/api.ts') ?? '';
  const item = a.slice(a.indexOf('export interface NotificationItem'), a.indexOf('export interface NotificationSummary'));
  return item.includes('scheduleId?: string;') && item.includes('manual?: boolean;') && item.includes("emailStatus?: 'SENT' | 'FAILED';");
})());
check('center: digest rows show delivery chip + manual marker + violet accent', (() => {
  const c = read('src/components/notification-center.tsx') ?? '';
  return c.includes("Email sent") && c.includes('Email failed') && c.includes("notification.type === 'hr_digest' ? 'border-l-[3px] border-l-violet-400 dark:border-l-violet-500' : ''") && c.includes('dark:bg-emerald-950/40');
})());
check('center: Manage-schedule affordance deep-links with stopPropagation + a11y name', (() => {
  const c = read('src/components/notification-center.tsx') ?? '';
  return c.includes('handleManageSchedule') && c.includes('e.stopPropagation()') && c.includes('/hr/reports?tab=schedules&schedule=') && c.includes('aria-label={`Manage the schedule behind ${notification.title}`}');
})());
check('tests: mapper guarded (valid / malformed / non-object / shape drops / allow-list)', (() => {
  const t = read('src/tests/lib/digest-notification-view.test.ts') ?? '';
  return t.includes('returns {} for malformed JSON') && t.includes('returns {} for JSON that is not an object') && t.includes('drops fields with an unexpected shape instead of coercing') && t.includes('keeps unrelated metadata keys out of the extras');
})());

console.log('== Schedules tab deep-link highlight ==');
check('page: reports page reads ?schedule= and passes it down', (() => {
  const p = read('src/app/(shell)/hr/reports/page.tsx') ?? '';
  return p.includes("get('schedule')") && p.includes('setHighlightScheduleId') && p.includes('<ReportSchedulesTab highlightScheduleId={highlightScheduleId} />');
})());
check('tab: card highlight ring + scrollIntoView + auto-clear timer', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  return tab.includes('schedule-card-${target.id}') && tab.includes("scrollIntoView({ behavior: 'smooth', block: 'center' })") && tab.includes("setHighlightId(null), 4000") && tab.includes("ring-2 ring-violet-400 dark:ring-violet-500");
})());
check('tab: card is anchorable (id on every schedule card)', (() => {
  const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
  return tab.includes('id={`schedule-card-${s.id}`}');
})());

console.log('== Version metadata ==');
check('package.json version is 2.27.0', (() => {
  const pkg = JSON.parse(read('package.json') ?? '{}');
  return pkg.version === '2.27.0' && pkg.mbumah?.releaseVersion === '2.27.0';
})());
check('CHANGELOG carries the [2.27.0] entry', ((read('CHANGELOG.md') ?? '').includes('## [2.27.0]')));
check('What\'s-New carries the 2.27.0 entry', ((read('src/lib/whats-new.ts') ?? '').includes("version: '2.27.0'")));
check('verify:v2-27-0 script registered', ((read('package.json') ?? '').includes('"verify:v2-27-0"')));

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nALL v2.27.0 CHECKS PASS');
