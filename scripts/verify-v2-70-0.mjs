#!/usr/bin/env node
// verify-v2-70-0.mjs — release gate for "the report files itself".
//
// Contracts locked:
//   1. Version slots: package.json 2.70.0 (3 slots) + verify script
//      registered; What's-New 2.70.0 leads the feed.
//   2. The CSV builder in the pure module: shared csvCell escaper (OWASP
//      guard), house header block, Summary, Day by day (honest zeros), By
//      branch, Reviewers, Most-visited requests, CRLF + trailing CRLF,
//      EAT-wall-date filename with scope slug.
//   3. GET /api/org/desk-report?format=csv: text/csv + attachment
//      disposition + no-store, org name with digest fallback, READ-ONLY,
//      JSON stays the default voice.
//   4. The view: CSV button beside Print, credentials fetch, disposition
//      filename, object-URL cleanup, busy state, honest failure.
//   5. Prior anchors: report page, panel door, morning-note family intact.

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
check('package.json version is 2.70.0', PKG.version === '2.70.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.70.0', PKG.mbumah?.releaseVersion === '2.70.0');
check('mbumah.baseVersion is 2.70.0', PKG.mbumah?.baseVersion === '2.70.0');
check('verify:v2-70-0 script registered', PKG.scripts?.['verify:v2-70-0'] === 'node scripts/verify-v2-70-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.70.0 entry first', WN.includes("version: '2.70.0'") && WN.indexOf("version: '2.70.0'") < WN.indexOf("version: '2.69.0'"));
check('whats-new leads with the CSV story', WN.includes('The report files itself'));
check('whats-new feed has grown to 70+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 70);

console.log('== The CSV builder (pure module) ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('builder reuses the shared escaper (one guard for every filing file)', MOD.includes("import { csvCell } from '@/lib/hr/digest-csv';"));
check('import rides the file top (lint convention)', MOD.indexOf("import { csvCell }") < MOD.indexOf('export const DESK_REPORT_WINDOW_DAYS'));
check('opens with the house header block', MOD.includes("row(['Report', 'Desk report']);") && MOD.includes("row(['Organization', meta.organizationName]);") && MOD.includes("row(['Scope', meta.scopeLabel]);"));
check('window line carries the label + EAT days', MOD.includes('`${report.window.label} (${report.window.days} EAT days)`'));
check('Summary block with the four totals', MOD.includes("lines.push('Summary');") && MOD.includes("row(['Visits', report.totals.visits]);") && MOD.includes("row(['Requests touched', report.totals.requests]);"));
check('Day-by-day section files every window day', MOD.includes("lines.push('Day by day');") && MOD.includes("row(['Date', 'Day', 'Visits', 'Corrections answered']);") && MOD.includes('for (const p of report.series)'));
check('By-branch section with the six columns', MOD.includes("row(['Branch', 'Visits', 'Corrections answered', 'Reviewers', 'Requests', 'Last visit (UTC)']);"));
check('Reviewers section with the five columns', MOD.includes("row(['Name', 'Visits', 'Corrections answered', 'Branches', 'Last visit (UTC)']);"));
check('Most-visited requests section', MOD.includes("row(['Employee', 'Leave type', 'Branch', 'Status', 'Visits', 'Last visit (UTC)']);"));
check('RFC-4180: CRLF records, trailing CRLF', MOD.includes("lines.join('\\r\\n') + '\\r\\n'"));
check('filename uses EAT wall dates (desk days, not UTC slices)', MOD.includes('const start = deskReportDayKey(new Date(report.window.start));') && MOD.includes('deskReportDayKey(new Date(new Date(report.window.end).getTime() - DAY_MS))'));
check('filename scope: org-wide or branch slug', MOD.includes("'all-branches'") && MOD.includes('report.scope.branch.replace(/[^a-z0-9]+/gi, \'-\')'));
check('filename never overwrites: window bounds in the name', MOD.includes('mbumah-desk-report-${report.window.days}d-${start}_${end}-${scope}.csv'));

console.log('== The route: ?format=csv ==');
const RT = read('src/app/api/org/desk-report/route.ts') ?? '';
check('format=csv gate exists', RT.includes("url.searchParams.get('format') === 'csv'"));
check('CSV serializes the SAME derived payload (no second derivation)', RT.includes('deskReportToCsv(data, {') && RT.includes('const data: DeskReportPayload = {'));
check('JSON derivation still happens exactly once', (RT.match(/deriveDeskReport\(rows as DeskReportVisitRow\[\], \{ \.\.\.window, days \}\)/g) || []).length === 1);
check('text/csv charset + attachment disposition + no-store', RT.includes("'Content-Type': 'text/csv; charset=utf-8'") && RT.includes(`'Content-Disposition': \`attachment; filename="\${deskReportCsvFilename(data)}"\``) && RT.includes("'Cache-Control': 'no-store'"));
check('org name rides the digest fallback', RT.includes('rawDb.organization.findFirst({ select: { name: true } })') && RT.includes("?? 'MBUMAH Hardware'"));
check('scope label mirrors the page (Branch: X / All branches)', RT.includes("scopeLabel: branchName ? `Branch: ${branchName}` : 'All branches'"));
check('JSON stays the default voice', RT.includes('return Response.json({') && RT.indexOf('return Response.json({') > RT.indexOf('if (wantCsv)'));
check('still READ-ONLY: no bell, no writes', !RT.includes('createMany') && !RT.includes('ensureDeskDigestNote'));

console.log('== The view: the CSV button ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('CSV button sits beside Print in the toolbar', VIEW.includes('data-testid="desk-report-csv"') && VIEW.indexOf('desk-report-csv') < VIEW.indexOf('desk-report-print'));
check('download fetch carries the session cookie', VIEW.includes("fetch(`/api/org/desk-report${query}`, { credentials: 'include' })"));
check('query appends format=csv to days/branch', VIEW.includes("&format=csv`"));
check('filename honored from the Content-Disposition', VIEW.includes('/filename="(.+?)"/.exec(disposition)'));
check('object URL created and revoked', VIEW.includes('URL.createObjectURL(blob)') && VIEW.includes('URL.revokeObjectURL(href)'));
check('busy state keeps the button honest', VIEW.includes('disabled={csvBusy}') && VIEW.includes("'Filing…'"));
check('failure degrades to the honest error copy', VIEW.includes("'Desk report CSV unavailable.'"));
check('button excluded from the print clone (toolbar print:hidden)', VIEW.indexOf('print:hidden') < VIEW.indexOf('data-testid="desk-report-csv"'));
check('spreadsheet icon carries the metaphor', VIEW.includes('FileSpreadsheet'));
check('dark-mode classes on the button', VIEW.includes('dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'));

console.log('== Prior anchors ==');
const PANELS = read('src/components/org/panels.tsx') ?? '';
const RA = read('src/app/api/org/review-activity/route.ts') ?? '';
check('report page keeps its print door', VIEW.includes("printReceiptElement('desk-report-content')"));
check('panel door intact', PANELS.includes('data-testid="desk-report-link"') && PANELS.includes('href="/org/desk-report"'));
check('morning-note strip intact', PANELS.includes('data-testid="desk-digest"') && PANELS.includes('Yesterday at the desk'));
check('review-activity bell writer intact', RA.includes('await ensureDeskDigestNote({'));

console.log(`\nv2.70.0 verification: ${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}`);
if (fail > 0) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
