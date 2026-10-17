#!/usr/bin/env node
// verify-v2-79-0.mjs — release gate for "the drawers file themselves".
//
// Contracts locked:
//   1. Version slots: package.json 2.79.0 (3 slots) + verify script
//      registered; What's-New 2.79.0 leads the feed.
//   2. Pure module: deskReportSliceToCsv (one column voice for both
//      families, ledger order preserved, escaper-guarded, RFC-4180 CRLF)
//      and deskReportSliceCsvFilename (kind + subject + window + scope,
//      kind fallback for an all-punctuation subject).
//   3. The view: both drawers carry a screen-only CSV button wired to a
//      client-side Blob builder reading the SAME ledger (no fetch); the
//      buttons are action buttons, NOT walk doors.
//   4. The print footer names its scope in the header's own words.
//   5. Prior anchors: walk, announcers, scope chips, drawers, report CSV.

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
const atLeast = (v, base) => {
  if (typeof v !== 'string') return false;
  const [a, b, c] = v.split('.').map(Number);
  const [x, y, z] = base.split('.').map(Number);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
};
check('package.json version is >= 2.79.0', atLeast(PKG.version, '2.79.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.79.0', atLeast(PKG.mbumah?.releaseVersion, '2.79.0'));
check('mbumah.baseVersion is >= 2.79.0', atLeast(PKG.mbumah?.baseVersion, '2.79.0'));
check('verify:v2-79-0 script registered', PKG.scripts?.['verify:v2-79-0'] === 'node scripts/verify-v2-79-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.79.0 entry first', WN.includes("version: '2.79.0'") && WN.indexOf("version: '2.79.0'") < WN.indexOf("version: '2.78.0'"));
check('whats-new leads with the drawers-file story', WN.includes('The drawers file themselves'));
check('whats-new feed has grown to 79+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 79);

console.log('== Pure module: the slice files itself ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check('DeskReportSliceKind covers both drawer families and the whole ledger (v2.82.0 grew it)', MOD.includes("export type DeskReportSliceKind = 'reviewer' | 'request' | 'all';"));
check('deskReportSliceToCsv is exported', MOD.includes('export function deskReportSliceToCsv('));
check('the report voice names the family', MOD.includes("'Desk report — reviewer visits'") && MOD.includes("'Desk report — request visits'"));
check('the filing meta stamps scope, window and generated-at', MOD.includes("row(['Scope', meta.scopeLabel]);") && MOD.includes('row([\'Window\', `${meta.windowLabel} (${meta.windowDays} EAT days)`]);') && MOD.includes("row(['Generated (UTC)', generatedAt.toISOString()]);"));
check('one column voice for both families', MOD.includes("row(['Date', 'Day', 'Time (EAT)', 'Branch', 'Reviewer', 'Employee', 'Leave type', 'Status', 'Recheck cleared']);"));
check('rows file in the LEDGER\'s own order (never re-sorted)', /for \(const v of entries\) \{/.test(MOD) && !/entries\.(sort|toSorted|slice\(\)\.sort)/.test(MOD));
check('the recheck flag files as yes/no', MOD.includes("v.cleared ? 'yes' : 'no',"));
check('RFC-4180: CRLF records, trailing CRLF', MOD.includes("return lines.join('\\r\\n') + '\\r\\n';"));
check('deskReportSliceCsvFilename is exported', MOD.includes('export function deskReportSliceCsvFilename('));
check('the filename stamps kind + subject + window + scope (v2.82.0: the stamp is shared)', MOD.includes('return `mbumah-desk-${kind}-${slug}-${deskReportFileStamp(report)}.csv`;'));
check('an all-punctuation subject falls back to the kind', MOD.includes(".toLowerCase() || kind;"));
check('EAT wall bounds, same rule as the report filename (v2.82.0: ONE stamp helper carries them)', MOD.includes('function deskReportFileStamp(report: DeskReportPayload): string {') && (MOD.match(/deskReportDayKey\(new Date\(new Date\(report\.window\.end\)\.getTime\(\) - DAY_MS\)\)/g) || []).length >= 1);

console.log('== The view: the drawer carries its CSV ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('the view imports the slice builders and types', VIEW.includes('deskReportSliceCsvFilename,') && VIEW.includes('deskReportSliceToCsv,') && VIEW.includes('type DeskReportSliceKind,'));
const dl = VIEW.split('const downloadSliceCsv = useCallback(')[1]?.split('[data],')[0] ?? '';
check('the downloader guards on data before building', dl.includes('if (!data) return;'));
check('the downloader rides the report\u2019s own scope voice', dl.includes("scopeLabel: data.scope.branchName ? `Branch: ${data.scope.branchName}` : 'All branches'"));
check('the downloader stamps the window', dl.includes('windowLabel: data.window.label,') && dl.includes('windowDays: data.window.days,'));
check('the downloader is a client-side Blob, not a fetch', dl.includes("new Blob([csv], { type: 'text/csv; charset=utf-8' })") && dl.includes('URL.createObjectURL(blob)') && dl.includes('URL.revokeObjectURL(href)') && !dl.includes('fetch('));
check('the filename comes from the pure builder', dl.includes('deskReportSliceCsvFilename(kind, subject, data)'));
const rev = VIEW.split("downloadSliceCsv('reviewer'")[1]?.split('</button>')[0] ?? '';
check('the reviewer drawer carries its CSV button', rev.includes('data-testid="desk-report-reviewer-csv"') && rev.includes("aria-label={`File ${r.name}'s visits as CSV`}"));
const req = VIEW.split("downloadSliceCsv('request'")[1]?.split('</button>')[0] ?? '';
check('the request drawer carries its CSV button', req.includes('data-testid="desk-report-request-csv"') && req.includes("aria-label={`File ${r.employeeName}'s ${r.leaveTypeName} visits as CSV`}"));
check('the request button is wired to the downloader with the human subject', VIEW.includes("downloadSliceCsv('request', `${r.employeeName}'s ${r.leaveTypeName}`, visits)"));
check('the CSV buttons are action buttons, not walk doors', !rev.includes('data-desk-door') && !req.includes('data-desk-door') && (VIEW.match(/data-desk-door\n/g) || []).length === 6);
check('the buttons wear the emerald dress with dark variants', rev.includes('border-emerald-200 bg-white') && rev.includes('dark:border-emerald-500/30 dark:bg-slate-900/60 dark:text-emerald-300') && rev.includes('focus-visible:ring-emerald-400'));

console.log('== The paper names its scope ==');
const foot = VIEW.split('data-testid="desk-report-footnote"')[1]?.split('</p>')[0] ?? '';
check('the footnote names the scope via scopeLabel', foot.includes('({scopeLabel})'));
check('the shape-name parenthetical is gone', !foot.includes("'branch scope'") && !foot.includes("'org-wide scope'"));
check('the kbd hint stays print:hidden (the paper never learns about keyboards)', foot.includes('print:hidden'));

console.log('== Prior anchors ==');
check('the walk announcer survives', VIEW.includes('data-testid="desk-report-walk-announcer"'));
check('the scope announcer survives', VIEW.includes('data-testid="desk-report-scope-announcer"'));
check('the j/k walk still glides and announces', VIEW.includes("next.scrollIntoView({ block: 'nearest', behavior: 'smooth' })") && VIEW.includes('announce(`Door ${nextIdx + 1} of ${doors.length} — ${label}`)'));
check('the chips still speak the keyboard', VIEW.includes('tabIndex={days === d ? 0 : -1}') && (VIEW.match(/onKeyDown=\{chipNav\}/g) || []).length === 3);
check('the drawers keep their one-drawer rule', VIEW.includes('const clearDrawers = useCallback(') && VIEW.includes('jumpToReviewer') && VIEW.includes('jumpToRequest'));
check('the report\u2019s own CSV voice survives', VIEW.includes('data-testid="desk-report-csv"') && MOD.includes('export function deskReportToCsv('));

console.log(`\nv2.79.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
if (fail > 0) { failures.forEach((f) => console.error(`  FAIL: ${f}`)); process.exit(1); }
