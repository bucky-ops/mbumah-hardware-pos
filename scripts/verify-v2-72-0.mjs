#!/usr/bin/env node
// verify-v2-72-0.mjs — release gate for "the report reads the file".
//
// Contracts locked:
//   1. Version slots: package.json 2.72.0 (3 slots) + verify script
//      registered; What's-New 2.72.0 leads the feed.
//   2. The pure module carries the request drill-down filter
//      (deskReportRequestLedger: unknown id = honest empty, order preserved)
//      beside the reviewer one; the ledger itself is untouched.
//   3. The view: request rows are doors (toggle, aria-expanded), the drawer
//      lists the request's visits (EAT day + time, branch, reviewer, recheck
//      chip), honest empty state, ONE drawer across BOTH families, scope
//      change closes both, print:hidden so paper keeps the roll-up.
//   4. Prior anchors: reviewer drill-down, CSV voice, panel door, print
//      pipeline, morning-note family intact.

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
// This release's own pins — written atLeast from birth so the script keeps
// passing on later versions (every-round precedent).
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.72.0', atLeast(PKG.version, '2.72.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.72.0', atLeast(PKG.mbumah?.releaseVersion, '2.72.0'));
check('mbumah.baseVersion is >= 2.72.0', atLeast(PKG.mbumah?.baseVersion, '2.72.0'));
check('verify:v2-72-0 script registered', PKG.scripts?.['verify:v2-72-0'] === 'node scripts/verify-v2-72-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.72.0 entry first', WN.includes("version: '2.72.0'") && WN.indexOf("version: '2.72.0'") < WN.indexOf("version: '2.71.0'"));
check('whats-new leads with the request-drill-down story', WN.includes('The report reads the file'));
check('whats-new feed has grown to 72+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 72);

console.log('== The pure module: the request drill-down ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('module header tells the v2.72.0 story', MOD.includes('v2.72.0: the report reads the file'));
check('request drill-down is a pure filter (unknown = honest empty)', MOD.includes('export function deskReportRequestLedger(') && MOD.includes('ledger.filter((entry) => entry.requestId === requestId)'));
check('the filter preserves the ledger order (no re-sort)', !(MOD.split('export function deskReportRequestLedger(')[1] ?? '').includes('.sort('));
check('the reviewer drill-down survives beside it', MOD.includes('export function deskReportReviewerLedger('));
check('the ledger entries still carry requestId', MOD.split('export interface DeskReportVisitEntry {')[1]?.split('}')[0].includes('requestId: string;'));
check('the EAT wall clock helper survives', MOD.includes('export function deskReportVisitTime('));
check('the CSV builder stays the roll-up (filing format untouched)', MOD.includes("row(['Report', 'Desk report']);") && MOD.includes("lines.push('Most-visited requests');"));

console.log('== The view: request rows are doors ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('imports the request ledger helper', VIEW.includes('deskReportRequestLedger,'));
check('the openRequest state exists beside openReviewer', VIEW.includes('const [openReviewer, setOpenReviewer] = useState<string | null>(null);') && VIEW.includes('const [openRequest, setOpenRequest] = useState<string | null>(null);'));
check('request toggle: one drawer rule across families', VIEW.includes('const toggleRequest = (id: string)') && (VIEW.split('const toggleRequest =')[1] ?? '').includes('setOpenReviewer(null);'));
check('reviewer toggle: closes the request drawer too', (VIEW.split('const toggleReviewer =')[1] ?? '').includes('setOpenRequest(null);'));
check('a scope change closes BOTH drawers (window + branch)', (VIEW.split('const pickDays =')[1] ?? '').includes('setOpenRequest(null)') && (VIEW.split('const pickBranch =')[1] ?? '').includes('setOpenRequest(null)'));
check('the request door exposes aria-expanded', VIEW.includes('data-testid="desk-report-request-toggle"') && (VIEW.split('const open = openRequest === r.requestId;')[1] ?? '').split('data-testid="desk-report-request-toggle"')[0].includes('aria-expanded={open}'));
check('the request drawer renders beneath the door', VIEW.includes('data-testid="desk-report-request-panel"') && VIEW.includes('data-testid="desk-report-request-visits"') && VIEW.includes('data-testid="desk-report-request-visit"'));
check('drawer rows read day + EAT wall time', (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('{deskReportDayLabel(v.dayKey)} · {deskReportVisitTime(v.at)} EAT'));
check('drawer rows name the branch and the reviewer who came', (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('{deskReportShortStoreName(v.storeName)}') && (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('visited by {v.reviewer}'));
check('recheck-cleared chip rides the request rows', (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('recheck cleared'));
check('the count line names the request file', VIEW.includes("· {num(visits.length)} visit{visits.length === 1 ? '' : 's'} in this window"));
check('honest empty state instead of pretending', VIEW.includes('data-testid="desk-report-request-empty"') && VIEW.includes('No visits recorded for this request in this window.'));
check('the request chevron rotates when the drawer opens', VIEW.includes('rotate-180'));
check('the drawer never reaches paper (print:hidden)', (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').split('data-testid="desk-report-request-visits"')[0].includes('print:hidden'));
check('the header hints the interaction (screen-only)', VIEW.includes('click a request to read its visits'));
check('the drawer wears the emerald family in dark mode too', (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('dark:border-emerald-500/20 dark:bg-emerald-500/5') && (VIEW.split('data-testid="desk-report-request-panel"')[1] ?? '').includes('dark:bg-slate-900/60'));
check('the status chip still mirrors the panel language', VIEW.includes('REPORT_STATUS_CHIP[r.status] ?? STATUS_CHIP_FALLBACK'));

console.log('== Prior anchors ==');
const RT = read('src/app/api/org/desk-report/route.ts') ?? '';
check('the route is untouched: JSON default, CSV voice, READ-ONLY', RT.includes("url.searchParams.get('format') === 'csv'") && !RT.includes('createMany') && !RT.includes('notification.'));
check('the reviewer drill-down surfaces survive', VIEW.includes('data-testid="desk-report-reviewer-toggle"') && VIEW.includes('data-testid="desk-report-reviewer-panel"'));
check('the CSV button survives beside the doors', VIEW.includes('data-testid="desk-report-csv"'));
check('the print pipeline is untouched', VIEW.includes("printReceiptElement('desk-report-content')"));
const PAGE = read('src/app/(shell)/org/desk-report/page.tsx') ?? '';
check('the report page still renders the view', PAGE.includes('DeskReportView'));
const PANELS = read('src/components/org/panels.tsx') ?? '';
check('the panel door to the report survives', PANELS.includes('data-testid="desk-report-link"'));
check("yesterday's strip still greets the console", PANELS.includes('data-testid="desk-digest"'));
check('the morning-note family entries still lead the changelog archive', WN.includes('The desk files its report') && WN.includes('The report files itself') && WN.includes('The report opens its ledger'));

console.log(`\nv2.72.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) {
  failures.forEach((f) => console.log(`  FAILED: ${f}`));
  process.exit(1);
}
