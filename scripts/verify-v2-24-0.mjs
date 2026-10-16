#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.24.0 verification
// Static + structural checks for the route-group bundle scoping, the
// server-rendered self-service home, digest send-now, and the in-app
// notification-center digest copies.
// Run: npm run verify:v2-24-0

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

console.log('== Route groups: shell vs selfservice split ==');
check('(shell) layout exists and mounts Providers', (() => {
  const s = read('src/app/(shell)/layout.tsx');
  return !!s && s.includes('Providers') && s.includes('@/lib/providers');
})());
check('(selfservice) layout exists and mounts SelfServiceProviders', (() => {
  const s = read('src/app/(selfservice)/layout.tsx');
  return !!s && s.includes('SelfServiceProviders');
})());
check('root layout no longer imports Providers', (() => {
  const s = read('src/app/layout.tsx');
  if (!s) return false;
  const code = s.replace(/\/\/[^\n]*/g, ''); // strip line comments
  return !/from\s+["']@\/lib\/providers["']/.test(code) && !code.includes('<Providers>');
})());
check('login page lives in (shell)', existsSync(join(ROOT, 'src/app/(shell)/page.tsx')));
check('self-service home lives in (selfservice)', existsSync(join(ROOT, 'src/app/(selfservice)/employees/me/page.tsx')));
check('workspace catch-all lives in (shell)', existsSync(join(ROOT, 'src/app/(shell)/stores/[slug]/[[...rest]]/page.tsx')));
check('path-dependent imports updated (payroll dialog)', (() => {
  const s = read('src/components/hr/payroll-run-dialog.tsx');
  return !!s && s.includes("@/app/(shell)/hr/payroll/page");
})());
check('tab-preload points into (shell)', (() => {
  const s = read('src/lib/tab-preload.ts');
  return !!s && s.includes("../app/(shell)/tabs/");
})());

console.log('== Slim providers: POS runtime excluded ==');
const slim = read('src/lib/providers-selfservice.tsx') ?? '';
check('slim providers keep the theme', slim.includes('ThemeProvider'));
check('slim providers keep a crash boundary', slim.includes('ErrorBoundary'));
check('slim providers exclude React Query', !slip(slim), 'no QueryClientProvider');
check('slim providers exclude the auth store', !slip(slim) && !slim.includes('@/lib/stores'));
check('slim providers exclude the alert popup host', !slim.includes('AlertPopupHost'));
check('slim providers exclude the toaster', !/from\s+["']sonner["']|<Toaster/.test(slim.replace(/\/\/[^\n]*/g, '')));
function slip(s) {
  return s.includes('react-query') || s.includes('QueryClient');
}

console.log('== SSR self-service home ==');
const home = read('src/app/(selfservice)/employees/me/page.tsx') ?? '';
check('home page is a server component (async, no use client)', home.includes('export default async function EmployeeHome') && !home.includes("'use client'"));
check('session resolves via cookies() path', home.includes('getSessionFromCookies'));
check('flag + permission gated before data', home.includes('isHrModuleEnabled') && home.includes('hasHrPermission'));
check('dashboard via the shared getMyDashboard service', home.includes('getMyDashboard'));
check('offline cache island kept', home.includes('SelfDashboardCacheWriter'));
const writer = read('src/app/(selfservice)/employees/me/cache-writer.tsx') ?? '';
check('cache island writes the legacy cache key', writer.includes('mbt_self_dashboard_cache_v1'));
const auth = read('src/lib/auth.ts') ?? '';
check('RSC session helper exported with expiry + lockout checks', auth.includes('export async function getSessionFromCookies') && /getSessionFromCookies[\s\S]*?expiresAt < new Date\(\)[\s\S]*?isAccountLocked/.test(auth.replace(/\n/g, ' ')));
const view = read('src/app/(selfservice)/employees/me/home-view.tsx') ?? '';
check('attendance times pinned to Africa/Nairobi', view.includes('Africa/Nairobi'));
check('formatters imported from the directive-free module', view.includes('self-service-format'));
const fmt = read('src/components/hr/self-service-format.ts') ?? '';
check('formatKes/formatDate extracted (no directive)', existsSync(join(ROOT, 'src/components/hr/self-service-format.ts')) && !fmt.trimStart().startsWith("'use client'"));
const ui = read('src/components/hr/self-service-ui.tsx') ?? '';
check('self-service-ui re-exports the formatters for client callers', ui.includes("export { formatKes, formatDate } from './self-service-format'"));

console.log('== Digest send-now ==');
const svc = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('sendScheduleNow exported', svc.includes('export async function sendScheduleNow'));
check('BRANCH scope pinned to own store (org-wide included)', svc.includes('actor.role === \'BRANCH_MANAGER\' && row.storeId !== actor.storeId'));
check('manual send never touches lastRunAt', (() => {
  const idx = svc.indexOf('export async function sendScheduleNow');
  const body = svc.slice(idx);
  const end = body.indexOf('\n}', 10);
  const fn = body.slice(0, end);
  return /lastStatus: 'SENT'/.test(fn) && !/lastRunAt:\s*now/.test(fn);
})());
check('schedule report keys map to deep-link tabs', svc.includes("REPORT_KEY_TO_TAB") && svc.includes("'employment-cost': 'cost'"));
check('audit carries manualSend + real actor', svc.includes('manualSend: true') && svc.includes('actorId: actor.id'));
const sendRoute = read('src/app/api/hr/reports/schedules/[id]/send-now/route.ts') ?? '';
check('send-now route exists with the schedule role set', sendRoute.includes('hrGuard') && sendRoute.includes("'BRANCH_MANAGER'") && sendRoute.includes('HrScheduleError'));
const tab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('schedules UI has the Send now button', tab.includes('Send now') && tab.includes('/send-now`'));
check('send result banner distinguishes delivered / failed / skipped', tab.includes("tone: 'ok'") && tab.includes("tone: 'warn'"));

console.log('== In-app digest copies ==');
check('sweep writes the creator copy on success + failure', (() => {
  const idx = svc.indexOf('export async function runDueHrReportSchedules');
  const body = svc.slice(idx);
  return body.includes('recipientUserId: schedule.createdByUserId') && body.split('writeDigestNotification').length >= 3;
})());
const feed = read('src/app/api/notifications/route.ts') ?? '';
check("feed exposes 'hr_digest' type", feed.includes("'hr_digest'"));
check('HR rows read user-addressed via runWithoutTenant', /category: 'HR',[\s\S]{0,80}userId: session\.userId[\s\S]{0,200}runWithoutTenant/.test(feed.replace(/\n/g, ' ')) || /runWithoutTenant\(\(\) =>[\s\S]{0,200}category: 'HR'/.test(feed.replace(/\n/g, ' ')));
check('failures surface at HIGH priority (popup host)', feed.includes("priority === 'HIGH' ? 'warning'"));
const apiTypes = read('src/lib/api.ts') ?? '';
check('client NotificationItem carries hr_digest + actionUrl', apiTypes.includes("'hr_digest'") && apiTypes.includes('actionUrl?'));
const center = read('src/components/notification-center.tsx') ?? '';
check('alerts panel renders hr_digest icon', center.includes("case 'hr_digest'"));
check('deep-link rows navigate via actionUrl', center.includes('notification.actionUrl') && center.includes('router.push'));

console.log('== QA fix: lean apiSend Content-Type ==');
const uiSrc = read('src/components/hr/self-service-ui.tsx') ?? '';
check('apiSend always declares Content-Type (bodyless POST fix)', /headers:\s*\{\s*'Content-Type':\s*'application\/json'\s*\}/.test(uiSrc));

console.log('== Committed Prisma provider contract ==');
check('schema restored to postgresql (v2.18.4.0 flip reverted)', (() => {
  const committed = execSync('git cat-file blob :prisma/schema.prisma', { cwd: ROOT }).toString();
  return /provider\s*=\s*"postgresql"/.test(committed) && !/provider\s*=\s*"sqlite"/.test(committed);
})());
check('CI guard blocks committed provider flips', (read('.github/workflows/ci-cd.yml') ?? '').includes('Verify committed Prisma provider'));

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package version 2.24.0', pkg.version === '2.24.0');
check('mbumah releaseVersion 2.24.0', pkg.mbumah?.releaseVersion === '2.24.0' && pkg.mbumah?.baseVersion === '2.24.0');
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has the 2.24.0 entry', changelog.includes('## [2.24.0]'));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
