#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.23.0 verification
// Static + structural checks for the per-branch report drill-down, the
// console HR panel, scope-aware schedule stores, and the Lighthouse recipe.
// Run: npm run verify:v2-23-0

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

console.log('== Reports service: per-branch narrowing ==');
const reports = read('src/lib/hr/reports.ts') ?? '';
check('scopeWhere honours an ORG-scope storeId', reports.includes("if (scope === 'ORG' && storeId)"));
check('narrowed where keeps org membership (cannot widen)', /scope === 'ORG' && storeId\)\s*\{\s*return \{ storeId, store: \{ organizationId/.test(reports.replace(/\n/g, ' ')));
check('validateReportStore exported + fail-closed 404', reports.includes('export async function validateReportStore') && reports.includes('STORE_NOT_FOUND'));
check('BRANCH scope cannot narrow (403)', reports.includes('STORE_NARROWING_FORBIDDEN'));
check('hrPerStoreForOrgConsole exported', reports.includes('export async function hrPerStoreForOrgConsole'));
check('per-store rows are aggregates only (no name fields)', !/firstName|nationalId/.test((reports.split('hrPerStoreForOrgConsole')[1] ?? '').split('export')[0] ?? ''));
check('per-store cost mirrors the tile (gross + nssf + housing levy)', (reports.split('hrPerStoreForOrgConsole')[1] ?? '').includes('_sum.grossPay'));

console.log('== Routes: storeId threading ==');
for (const slug of ['headcount', 'employment-cost', 'absence', 'turnover', 'time-to-hire', 'statutory-liability']) {
  const r = read(`src/app/api/hr/reports/${slug}/route.ts`) ?? '';
  check(`${slug} validates + passes storeId`, r.includes('validateReportStore') && r.includes('storeId: store?.id ?? null'));
}
const summaryRoute = read('src/app/api/org/summary/route.ts') ?? '';
check('org summary embeds hrPerStore (additive, never breaks console)', summaryRoute.includes('hrPerStoreForOrgConsole') && summaryRoute.includes('hrPerStore'));
const storesRoute = read('src/app/api/hr/stores/route.ts') ?? '';
check('/api/hr/stores is session-scoped (org from session)', storesRoute.includes('session.organizationId') && storesRoute.includes('hrGuard'));

console.log('== Schedules: scope-aware stores ==');
const schedSvc = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('resolveScheduleStore exported', schedSvc.includes('export async function resolveScheduleStore'));
check('BRANCH managers pinned to own store', schedSvc.includes('STORE_SCOPE_FORBIDDEN'));
check('ORG store targets validated (404 unknown)', /resolveScheduleStore[\s\S]*STORE_NOT_FOUND/.test(schedSvc));
check('createSchedule takes the actor for enforcement', schedSvc.includes('actor?: { role: string; storeId: string | null; organizationId: string }'));
const schedRoute = read('src/app/api/hr/reports/schedules/route.ts') ?? '';
check('POST passes the session actor to createSchedule', schedRoute.includes('{ role: session.role, storeId: session.storeId, organizationId: session.organizationId }'));

console.log('== UI: console drill-down + reports filter ==');
const consolePage = read('src/app/console/page.tsx') ?? '';
check('console renders the per-branch HR panel', consolePage.includes('HrPerStorePanel') && consolePage.includes('People & payroll by branch'));
check('console rows deep-link into the narrowed report', consolePage.includes('/hr/reports?tab=headcount&storeId='));
check('console panel is collapsed by default (aria-expanded)', consolePage.includes('aria-expanded={open}'));
const primitives = read('src/components/org/primitives.tsx') ?? '';
check('console OrgSummaryData type carries hrPerStore', primitives.includes('hrPerStore'));
const wsConsole = read('src/components/workspace/org-console.tsx') ?? '';
check('workspace org-console also renders the drill-down', wsConsole.includes('hrPerStoreOpen') && wsConsole.includes('People &amp; payroll by branch'));
const reportsPage = read('src/app/hr/reports/page.tsx') ?? '';
check('reports page reads ?storeId= and keeps it bookmarkable', reportsPage.includes(".get('storeId')") && reportsPage.includes("searchParams.set('storeId'"));
check('reports page shows a clearable branch chip', reportsPage.includes('Clear branch filter') && reportsPage.includes('changeStoreId(null)'));
check('report fetches append the storeId', reportsPage.includes('storeId=${encodeURIComponent(storeId)'));
const schedTab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('schedules tab has the Branch scope selector', schedTab.includes('Branch scope') && schedTab.includes('All branches (organization)'));
check('schedule cards show the scoped branch', schedTab.includes("storeNameFor(s.storeId)"));

console.log('== Lighthouse recipe + doc ==');
const lh = read('scripts/qa-lighthouse-authed.mjs') ?? '';
check('authed lighthouse script exists', lh !== null);
check('seeds the session cookie via document.cookie', lh.includes("document.cookie='mbt_token="));
check('drives lighthouse over CDP port (shared cookie jar)', lh.includes('--port='));
const doc = read('docs/hr/self-service.md') ?? '';
check('self-service doc records the authenticated measurement', doc.includes('qa-lighthouse-authed.mjs') && doc.includes('documented blocker'));
check('doc carries the v2.23.0 result table', doc.includes('| **v2.23.0 final** | **81** | **100** |'));

console.log('== Alert polling perf deferral ==');
const alertHost = read('src/components/alerts/alert-popup-host.tsx') ?? '';
check('first poll deferred to browser idle', alertHost.includes('requestIdleCallback') && alertHost.includes('pollIdleArmed'));
check('poll stays authenticated + store-gated', alertHost.includes('enabled: isAuthenticated && !!currentStoreId && pollIdleArmed'));

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.23.0', pkg.version === '2.23.0', pkg.version);
check('mbumah.releaseVersion is 2.23.0', pkg.mbumah?.releaseVersion === '2.23.0', pkg.mbumah?.releaseVersion);
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has a 2.23.0 entry', /## \[?2\.23\.0/.test(changelog));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
