#!/usr/bin/env node
// verify-v2-82-0.mjs — release gate for "the report files everything".
//
// Contracts locked:
//   1. Version slots: package.json 2.82.0 (3 slots) + verify script
//      registered; What's-New 2.82.0 leads the feed.
//   2. Pure module: the 'all' slice family (voice map — three filings, one
//      wording), deskReportLedgerToCsv (the whole ledger through the SAME
//      slice builder, subject 'All visits'), deskReportLedgerCsvFilename
//      (kind names the file, no subject slug), and the SHARED stamp helper
//      that keeps all three filings' names in one voice (the prior
//      filename outputs stay byte-identical).
//   3. The view: the toolbar's "File all N visits" door — a client-side
//      Blob of data.ledger (no fetch), disabled until the read lands,
//      honest count label + aria, the emerald family at toolbar scale with
//      full dark variants, and an ACTION not a walk door (the walk stays
//      6); the footnote says what the filing is.
//   4. Prior anchors: walk, announcers, one-drawer rule, drawer CSVs,
//      report CSV, deep links + linkchips, 6 doors.

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
check('package.json version is >= 2.82.0', atLeast(PKG.version, '2.82.0'), PKG.version ?? 'missing');
check('mbumah.releaseVersion is >= 2.82.0', atLeast(PKG.mbumah?.releaseVersion, '2.82.0'));
check('mbumah.baseVersion is >= 2.82.0', atLeast(PKG.mbumah?.baseVersion, '2.82.0'));
check('verify:v2-82-0 script registered', PKG.scripts?.['verify:v2-82-0'] === 'node scripts/verify-v2-82-0.mjs');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.82.0 entry first', WN.includes("version: '2.82.0'") && WN.indexOf("version: '2.82.0'") < WN.indexOf("version: '2.81.0'"));
check('whats-new leads with the files-everything story', WN.includes('The report files everything') && WN.includes('File all N visits') && WN.includes('mbumah-desk-all-'));
check('whats-new feed has grown to 82+ entries', (WN.match(/version: '[^']+'/g) || []).length >= 82);

console.log('== Pure module: the whole ledger, filed ==');
const MOD = read('src/lib/hr/desk-report.ts') ?? '';
check("the slice kind grows the 'all' family", MOD.includes("export type DeskReportSliceKind = 'reviewer' | 'request' | 'all';"));
check('one voice map for the three filings', MOD.includes('const DESK_REPORT_SLICE_VOICE: Record<DeskReportSliceKind, string> = {') && MOD.includes("all: 'Desk report — all visits',") && MOD.includes("reviewer: 'Desk report — reviewer visits',") && MOD.includes("request: 'Desk report — request visits',"));
check('the slice builder rides the voice map (no inline ternary left)', MOD.includes("row(['Report', DESK_REPORT_SLICE_VOICE[kind]]);"));
check('deskReportLedgerToCsv is exported and rides the same builder', MOD.includes('export function deskReportLedgerToCsv(') && /export function deskReportLedgerToCsv\([\s\S]*?deskReportSliceToCsv\('all', 'All visits', entries, meta\)/.test(MOD));
check('deskReportLedgerCsvFilename is exported, the kind names the file', MOD.includes('export function deskReportLedgerCsvFilename(') && MOD.includes('return `mbumah-desk-all-${deskReportFileStamp(report)}.csv`;'));
check('ONE shared stamp helper for every filing', MOD.includes('function deskReportFileStamp(report: DeskReportPayload): string {') && (MOD.match(/deskReportFileStamp\(report\)/g) || []).length === 3);
check('the report filename output is byte-identical (v2.70 contract)', MOD.includes('return `mbumah-desk-report-${deskReportFileStamp(report)}.csv`;'));
check('the slice filename output shape is unchanged (v2.79 contract)', MOD.includes('return `mbumah-desk-${kind}-${slug}-${deskReportFileStamp(report)}.csv`;'));
check('the stamp keeps EAT wall dates + the scope slug', MOD.includes('const start = deskReportDayKey(new Date(report.window.start));') && MOD.includes("new Date(new Date(report.window.end).getTime() - DAY_MS)") && MOD.includes(": 'all-branches';"));
check('the module header tells the v2.82.0 story', MOD.includes('v2.82.0 — the report files everything'));

console.log('== The view: the File-all door ==');
const VIEW = read('src/components/org/desk-report-view.tsx') ?? '';
check('the view imports the whole-ledger builders and the FileStack icon', VIEW.includes('deskReportLedgerToCsv,') && VIEW.includes('deskReportLedgerCsvFilename,') && VIEW.includes('FileStack, FileText,'));
const dlBody = VIEW.split('const downloadLedgerCsv = useCallback(')[1]?.split('[data],')[0] ?? '';
check('the downloader files the WHOLE ledger through the same builder', dlBody.includes('if (!data) return;') && dlBody.includes('deskReportLedgerToCsv(data.ledger, {') && dlBody.includes('windowLabel: data.window.label,') && dlBody.includes('windowDays: data.window.days,'));
check("the downloader is a client-side Blob — no fetch, no round-trip", dlBody.includes("new Blob([csv], { type: 'text/csv; charset=utf-8' })") && dlBody.includes('URL.createObjectURL(blob)') && dlBody.includes('URL.revokeObjectURL(href)') && !dlBody.includes('fetch('));
check('the filename rides the shared stamp', dlBody.includes('deskReportLedgerCsvFilename(data)'));
check('the wiring sits with the button (onClick + disabled until the read lands)', VIEW.includes('onClick={downloadLedgerCsv}') && VIEW.includes('disabled={!data}'));
const btn = VIEW.split('data-testid="desk-report-file-all"')[1]?.split('</button>')[0] ?? '';
check('the toolbar door carries the honest title, aria and count label', btn.includes('title="File every visit in this window as CSV — the whole ledger, newest first (RFC-4180, formula-injection guarded)"') && btn.includes("data ? `File all ${data.ledger.length} visits as CSV` : 'File all visits as CSV'") && btn.includes("data ? `File all ${num(data.ledger.length)} visits` : 'File all visits'"));
check('the button wears the emerald family at toolbar scale', btn.includes('border-emerald-300 bg-emerald-50/70') && btn.includes('hover:border-emerald-400 hover:bg-emerald-100') && btn.includes('focus-visible:ring-emerald-400') && btn.includes('disabled:opacity-60'));
check('the button dresses for the dark', btn.includes('dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300') && btn.includes('dark:hover:bg-emerald-500/20'));
check('the whole-ledger filing is an ACTION, not a walk door', !btn.includes('data-desk-door') && (VIEW.match(/data-desk-door\n/g) || []).length === 6);
check('the footnote says what the filing is', (VIEW.split('data-testid="desk-report-footnote"')[1] ?? '').split('</p>')[0].includes('files the whole ledger — every visit the report read, newest first'));
check('the view header tells the v2.82.0 story', VIEW.includes('v2.82.0: the report files everything') && VIEW.includes("the 'all' family"));

console.log('== Prior anchors ==');
check('the walk announcer survives', VIEW.includes('data-testid="desk-report-walk-announcer"'));
check('the scope announcer survives', VIEW.includes('data-testid="desk-report-scope-announcer"'));
check('the drawers keep their one-drawer rule', VIEW.includes('const clearDrawers = useCallback(') && VIEW.includes('jumpToReviewer') && VIEW.includes('jumpToRequest'));
check('the drawer CSVs survive (filing family intact)', VIEW.includes('data-testid="desk-report-reviewer-csv"') && VIEW.includes('data-testid="desk-report-request-csv"'));
check("the report's own CSV voice survives beside the new door", VIEW.includes('data-testid="desk-report-csv"') && MOD.includes('export function deskReportToCsv('));
check('the deep-link family survives (parser, composer, resolver)', MOD.includes('export function deskReportDrawerParam(') && MOD.includes('export function deskReportReportHref(') && MOD.includes('export function deskReportArrival(') && MOD.includes('export function deskReportResolveDeepLink('));
check('the from-the-link chips survive', VIEW.includes('data-testid="desk-report-reviewer-linkchip"') && VIEW.includes('data-testid="desk-report-request-linkchip"'));
check('the footnote still says an open drawer rides the address bar', (VIEW.split('data-testid="desk-report-footnote"')[1] ?? '').split('</p>')[0].includes('An open drawer rides the address bar — copy the URL and the same file opens for whoever follows.'));
check('the desk panel door still hands the branch over', (read('src/components/org/panels.tsx') ?? '').includes("href={deskReportDrawerHref('reviewer', reviewer, { branch: branch ?? null })}"));

console.log(`\nv2.82.0 verification: ${fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
if (fail > 0) { failures.forEach((f) => console.error(`  FAIL: ${f}`)); process.exit(1); }
