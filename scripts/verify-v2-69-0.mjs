#!/usr/bin/env node
// verify-v2-69-0.mjs — release gate for "the desk files its report".
//
// Contracts locked:
//   1. Version slots: package.json 2.69.0 (3 slots) + verify script
//      registered; What's-New 2.69.0 leads the feed.
//   2. Pure module (src/lib/hr/desk-report.ts): window resolution
//      (7/14/30, fallback 7), EAT window math (today included), day keys /
//      labels, scope contract comment, one-pass derivation with honest
//      zeros, capped top requests, avatar hues, short store names.
//   3. GET /api/org/desk-report: ORG_ROLES gate, rawDb + runWithoutTenant,
//      explicit branch narrow, READ-ONLY (no bell — printing never rings),
//      scope line naming the branch, force-dynamic.
//   4. The view (/org/desk-report): window + branch chips, totals tiles,
//      per-branch table, day-by-day bar strip, reviewers, top requests,
//      honest empty state, print via printReceiptElement, dark complete,
//      back link, 401/403 copies.
//   5. The Desk activity panel carries the Report door; the morning-note
//      surfaces are untouched.

import { readFileSync } from 'node:fs';

const read = (p) => {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
};

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.69.0', PKG.version === '2.69.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.69.0', PKG.mbumah?.releaseVersion === '2.69.0');
check('mbumah.baseVersion is 2.69.0', PKG.mbumah?.baseVersion === '2.69.0');
check('verify:v2-69-0 script registered', PKG.scripts?.['verify:v2-69-0'] === 'node scripts/verify-v2-69-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.69.0 entry first', WN.includes("version: '2.69.0'") && WN.indexOf("version: '2.69.0'") < WN.indexOf("version: '2.68.0'"));
check('whats-new leads with the report story', WN.includes('The desk files its report'));
check('whats-new feed has grown to 69+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 69);

console.log('== The pure module: src/lib/hr/desk-report.ts ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('window days are exactly 7/14/30', MOD.includes("export const DESK_REPORT_WINDOW_DAYS = [7, 14, 30] as const;"));
check('default window is 7', MOD.includes('export const DESK_REPORT_DEFAULT_DAYS: number = 7;'));
check('top requests cap is 5', MOD.includes('export const DESK_REPORT_TOP_REQUESTS_LIMIT = 5;'));
check('audience = the review-activity gate roles', MOD.includes("export const DESK_REPORT_ORG_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'] as const;"));
check('EAT offset is the desk calendar (+3h)', MOD.includes('const EAT_OFFSET_MS = 3 * 3_600_000;'));
check('resolve falls back to the default on anything else', /return \(DESK_REPORT_WINDOW_DAYS as readonly number\[\]\)\.includes\(n\)\s*\? n\s*: DESK_REPORT_DEFAULT_DAYS;/.test(MOD));
check('window end = EAT-midnight of tomorrow (today included)', MOD.includes('const end = new Date(todayStartEAT + DAY_MS - EAT_OFFSET_MS);') && MOD.includes('const start = new Date(end.getTime() - days * DAY_MS);'));
check('day key renders the EAT wall date', /export function deskReportDayKey\(at: Date\): string \{\s*return new Date\(at\.getTime\(\) \+ EAT_OFFSET_MS\)\.toISOString\(\)\.slice\(0, 10\);\s*\}/.test(MOD));
check('window label joins the two ends with an arrow', MOD.includes('export function deskReportWindowLabel(start: Date, end: Date)') && MOD.includes('deskReportDayLabel(deskReportDayKey(start))'));
check('scope contract: the report re-keys, the note never does', MOD.includes('explicit scope the caller chooses') && MOD.includes('printing a report never rings anything'));
check('derivation is one pass (single for over rows)', (MOD.match(/for \(const row of rows\)/g) || []).length === 1);
check('series keeps every day with honest zeros', MOD.includes('dayVisits.set(dayKey, (dayVisits.get(dayKey) ?? 0) + 1);') && MOD.includes('dayVisits.has(dayKey)'));
check('branches sort visits desc then name', MOD.includes('.sort((a, b) => b.visits - a.visits || a.storeName.localeCompare(b.storeName))'));
check('reviewers sort visits desc then name', MOD.includes('.sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name))'));
check('top requests capped and sorted visits desc then recency', MOD.includes('.slice(0, DESK_REPORT_TOP_REQUESTS_LIMIT)') && MOD.includes("(b.lastVisitAt ?? '').localeCompare(a.lastVisitAt ?? '')"));
check('avatar hues: six deterministic duotones', MOD.includes('export const DESK_REPORT_AVATAR_HUES = [') && MOD.includes('% DESK_REPORT_AVATAR_HUES.length]'));
check('store chips share the strip shortening', MOD.includes("name.replace(/^MBUMAH HARDWARE\\s*-\\s*/i, '') || name"));
check('module stays pure (no db, no env, no network)', !MOD.includes('@/lib/db') && !MOD.includes('process.env') && !MOD.includes('fetch('));

console.log('== The route: /api/org/desk-report ==');
const RT = read('src/app/api/org/desk-report/route.ts') ?? '';
check('gate = DESK_REPORT_ORG_ROLES spread into requireAuth', RT.includes('roles: [...DESK_REPORT_ORG_ROLES]'));
check('reads through rawDb inside runWithoutTenant', RT.includes("import { rawDb, runWithoutTenant } from '@/lib/db';") && RT.includes('runWithoutTenant(async () => {'));
check('window + days resolved by the pure module', RT.includes('resolveDeskReportDays(url.searchParams.get(\'days\'))') && RT.includes('deskReportWindow(now, days)'));
check('branch narrow only on explicit caller choice', RT.includes('...(branch ? { leaveRequest: { storeId: branch } } : {})'));
check('READ-ONLY: no bell, no notification writes', !RT.includes('createMany') && !RT.includes('ensureDeskDigestNote') && RT.includes('READ-ONLY by contract'));
check('scope line names the branch from the rows', RT.includes('scope: { branch, branchName }') && RT.includes("rows.find((r) => r.leaveRequest.storeId === branch)"));
check('payload spreads the derived report', RT.includes('...report,') && RT.includes('generatedAt: now.toISOString()'));
check('force-dynamic behind the error boundary', RT.includes("export const dynamic = 'force-dynamic';") && RT.includes('withErrorBoundary(') && RT.includes('LogComponent.API'));

console.log('== The view: /org/desk-report ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
const PAGE = read('src/app/(shell)/org/desk-report/page.tsx') ?? '';
check('page mounts the view behind force-dynamic', PAGE.includes('export const dynamic = \'force-dynamic\';') && PAGE.includes('<DeskReportView />'));
check('fetch rides authorizedFetchJson with the explicit scope', VIEW.includes("authorizedFetchJson(`/api/org/desk-report${query}`)") && VIEW.includes('encodeURIComponent(b)'));
check('window chips render the pure-module list', VIEW.includes('DESK_REPORT_WINDOW_DAYS.map') && VIEW.includes('data-testid="desk-report-window-chips"'));
check('branch chips include All branches + per-store rows', VIEW.includes('data-testid="desk-report-branch-chip-all"') && VIEW.includes('data-testid={`desk-report-branch-chip-${b.storeId}`}'));
check('four totals tiles with stable testids', VIEW.includes('data-testid="desk-report-totals"') && VIEW.includes('data-testid={`desk-report-tot-${id}`}') && VIEW.includes("'Corrections answered'"));
check('per-branch table is the heart of the report', VIEW.includes('data-testid="desk-report-branches"') && VIEW.includes('data-testid="desk-report-branch-row"'));
check('day-by-day bar strip, dawn gradient on active days', VIEW.includes('data-testid="desk-report-series"') && VIEW.includes('data-testid={`desk-report-day-${p.key}`}') && VIEW.includes('bg-gradient-to-t from-amber-400 to-emerald-500'));
check('reviewers + top requests sections', VIEW.includes('data-testid="desk-report-reviewer-row"') && VIEW.includes('data-testid="desk-report-request-row"'));
check('quiet window says so honestly', VIEW.includes('data-testid="desk-report-empty"') && VIEW.includes('The desk was quiet for this window'));
check('print isolates #desk-report-content via printReceiptElement', VIEW.includes("printReceiptElement('desk-report-content')") && VIEW.includes('id="desk-report-content"') && VIEW.includes("import { printReceiptElement } from '@/lib/receipt-pdf';"));
check('401/403 degrade to honest copies', VIEW.includes('Sign in to file the desk report.') && VIEW.includes('The desk report is limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).'));
check('dark-mode complete (dawn header + slate surfaces)', VIEW.includes('dark:from-amber-500/10 dark:via-slate-900 dark:to-emerald-500/10') && VIEW.includes('dark:border-slate-800 dark:bg-slate-900'));
check('back link to the desk activity panel', VIEW.includes('data-testid="desk-report-back"') && VIEW.includes('href="/console"'));

console.log('== The panel door + prior anchors ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
const RA = read('src/app/api/org/review-activity/route.ts') ?? '';
const NOTE = read('src/lib/hr/desk-digest-note.ts') ?? '';
check('panel header carries the Report door', PANELS.includes('data-testid="desk-report-link"') && PANELS.includes('href="/org/desk-report"'));
check('morning-note strip untouched', PANELS.includes('data-testid="desk-digest"') && PANELS.includes('Yesterday at the desk'));
check('review-activity bell writer untouched', RA.includes('await ensureDeskDigestNote({') && RA.includes('const EAT_OFFSET_MS = 3 * 3_600_000;'));
check('bell note module untouched', NOTE.includes("export const DESK_DIGEST_METADATA_MARKER = 'desk_digest';"));

console.log(`\nv2.69.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
