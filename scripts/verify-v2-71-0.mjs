#!/usr/bin/env node
// verify-v2-71-0.mjs — release gate for "the report opens its ledger".
//
// Contracts locked:
//   1. Version slots: package.json 2.71.0 (3 slots) + verify script
//      registered; What's-New 2.71.0 leads the feed.
//   2. The pure module derives the visit-scale LEDGER in the same one pass
//      (newest first, deterministic), with the reviewer filter + EAT wall
//      clock time helpers; the CSV builder stays the roll-up.
//   3. GET /api/org/desk-report: the select carries the visit id, the JSON
//      payload carries the ledger, the CSV voice is untouched, READ-ONLY.
//   4. The view: reviewer rows are doors (toggle, aria-expanded), the
//      drawer lists the reviewer's visits (EAT day + time, branch, request,
//      status, recheck chip), honest empty state, scope change closes it,
//      print:hidden so paper keeps the deterministic roll-up.
//   5. Prior anchors: report page, panel door, CSV button, morning-note
//      family intact.

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
// v2.71.0: this release's own pins — written atLeast from birth so the
// script keeps passing on later versions (every-round precedent).
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.71.0', atLeast(PKG.version, '2.71.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.71.0', atLeast(PKG.mbumah?.releaseVersion, '2.71.0'));
check('mbumah.baseVersion is >= 2.71.0', atLeast(PKG.mbumah?.baseVersion, '2.71.0'));
check('verify:v2-71-0 script registered', PKG.scripts?.['verify:v2-71-0'] === 'node scripts/verify-v2-71-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.71.0 entry first', WN.includes("version: '2.71.0'") && WN.indexOf("version: '2.71.0'") < WN.indexOf("version: '2.70.0'"));
check('whats-new leads with the drill-down story', WN.includes('The report opens its ledger'));
check('whats-new feed has grown to 71+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 71);

console.log('== The pure module: the drill-down ledger ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('module header tells the v2.71.0 story', MOD.includes('v2.71.0: the report opens its ledger'));
check('the visit row carries its own id', MOD.includes('export interface DeskReportVisitRow {') && MOD.split('export interface DeskReportVisitRow {')[1].split('}')[0].includes('id: string'));
check('DeskReportVisitEntry shape: id/at/dayKey/store/reviewer/employee/type/status/cleared/request', ['id: string;', 'at: string;', 'dayKey: string;', 'storeId: string;', 'storeName: string;', 'reviewer: string;', 'employeeName: string;', 'leaveTypeName: string;', 'status: string;', 'cleared: boolean;', 'requestId: string;'].every((f) => MOD.split('export interface DeskReportVisitEntry {')[1]?.split('}')[0].includes(f)));
check('DeskReportData carries the ledger', MOD.split('export interface DeskReportData {')[1]?.split('\n}')[0].includes('ledger: DeskReportVisitEntry[]'));
check('the ledger grows in the SAME one pass', MOD.includes('const ledger: DeskReportVisitEntry[] = [];') && MOD.includes('ledger.push({'));
check('entry maps every row fact (employee, type, status, cleared, request)', MOD.includes('employeeName: `${row.leaveRequest.employee.firstName} ${row.leaveRequest.employee.lastName}`') && MOD.includes("leaveTypeName: row.leaveRequest.leaveType?.name ?? 'Leave'") && MOD.includes('status: row.leaveRequest.status') && MOD.includes('cleared: row.clearedRecheck') && MOD.includes('requestId: row.leaveRequestId'));
check('ledger sorts newest first, deterministic (id breaks ties)', MOD.includes('ledger.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));'));
check('derive returns the ledger', MOD.includes('topRequests,\n    ledger,'));
check('reviewer drill-down is a pure filter (unknown = honest empty)', MOD.includes('export function deskReportReviewerLedger(') && MOD.includes('ledger.filter((entry) => entry.reviewer === reviewer)'));
check('visit time reads the EAT wall clock (not a UTC slice)', MOD.includes('export function deskReportVisitTime(') && MOD.split('export function deskReportVisitTime(')[1].includes('EAT_OFFSET_MS') && MOD.split('export function deskReportVisitTime(')[1].includes('slice(11, 16)'));
check('the CSV builder stays the roll-up (filing format untouched)', MOD.includes("row(['Report', 'Desk report']);") && MOD.includes("lines.push('Most-visited requests');"));

console.log('== The route: the ledger rides the JSON payload ==');
const RT = read('src/app/api/org/desk-report/route.ts') ?? '';
check('the select carries the visit id', RT.includes('id: true,'));
check('JSON stays the default voice and carries the derived data', RT.match(/return Response\.json\(\{\s*success: true,\s*data,\s*\}\);/));
check('the CSV voice is untouched (?format=csv)', RT.includes("url.searchParams.get('format') === 'csv'") && RT.includes('deskReportToCsv(data, {'));
check('still READ-ONLY (printing never rings)', !RT.includes('createMany') && !RT.includes('notification.'));

console.log('== The view: reviewer rows are doors ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('imports the ledger helpers + the chevron', VIEW.includes('deskReportReviewerLedger,') && VIEW.includes('deskReportVisitTime,') && VIEW.includes('deskReportDayLabel,') && VIEW.includes('ChevronDown,'));
check('one drawer at a time (openReviewer state + toggle)', VIEW.includes('useState<string | null>(null)') && VIEW.includes('const toggleReviewer = (name: string)') && VIEW.includes('setOpenReviewer((cur) => (cur === name ? null : name));'));
check('a scope change closes the drawer (window + branch)', VIEW.split('const pickDays =')[1]?.split('const pickBranch =')[0].includes('setOpenReviewer(null)') && VIEW.split('const pickBranch =')[1]?.split('const toggleReviewer =')[0].includes('setOpenReviewer(null)'));
check('the toggle button exposes aria-expanded', VIEW.includes('aria-expanded={open}') && VIEW.includes('data-testid="desk-report-reviewer-toggle"'));
check('the drawer lists the reviewer visits', VIEW.includes('data-testid="desk-report-reviewer-panel"') && VIEW.includes('data-testid="desk-report-reviewer-visits"') && VIEW.includes('data-testid="desk-report-reviewer-visit"'));
check('visit rows read day + EAT wall time', VIEW.includes('{deskReportDayLabel(v.dayKey)} · {deskReportVisitTime(v.at)} EAT'));
check('visit rows name the branch, request, employee', VIEW.includes('{deskReportShortStoreName(v.storeName)}') && VIEW.includes("{v.employeeName}&apos;s {v.leaveTypeName}"));
check('recheck-cleared chip rides the visit rows', VIEW.includes('recheck cleared'));
check('status chips mirror the panel language (with fallback)', VIEW.includes('REPORT_STATUS_CHIP[v.status] ?? STATUS_CHIP_FALLBACK'));
check('honest empty state instead of pretending', VIEW.includes('data-testid="desk-report-reviewer-empty"') && VIEW.includes('No visits recorded for this reviewer in this window.'));
check('the drawer carries a count line for the window', VIEW.includes('visit{visits.length === 1 ? \'\' : \'s\'} in this window'));
check('the chevron rotates when the drawer opens', VIEW.includes("rotate-180"));
check('the drawer never reaches paper (print:hidden)', VIEW.split('data-testid="desk-report-reviewer-panel"')[1]?.split('data-testid="desk-report-reviewer-visits"')[0].includes('print:hidden'));
check('the header hints the interaction (screen-only)', VIEW.includes('click a reviewer to read their visits'));
check('the drawer wears the emerald family in dark mode too', VIEW.includes('dark:border-emerald-500/20 dark:bg-emerald-500/5') && VIEW.includes('dark:bg-slate-900/60'));
check('the CSV button survives beside the doors', VIEW.includes('data-testid="desk-report-csv"'));
check('the print pipeline is untouched', VIEW.includes("printReceiptElement('desk-report-content')"));

console.log('== Prior anchors ==');
const PAGE = read('src/app/(shell)/org/desk-report/page.tsx') ?? '';
check('the report page still renders the view', PAGE.includes('DeskReportView'));
const PANELS = read('src/components/org/panels.tsx') ?? '';
check('the panel door to the report survives', PANELS.includes('data-testid="desk-report-link"'));
check("yesterday's strip still greets the console", PANELS.includes('data-testid="desk-digest"'));
check('the morning-note family entries still lead the changelog archive', WN.includes('The desk files its report') && WN.includes('The report files itself'));

console.log(`\nv2.71.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) {
  failures.forEach((f) => console.log(`  FAILED: ${f}`));
  process.exit(1);
}
