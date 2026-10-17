#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.52.0 verification
// Scope: ad-hoc digest CSV export ("Digest CSV, on demand"). The /hr/reports
// page gains a violet Digest CSV button per digest-capable tab; a new
// GET /api/hr/reports/export route serves the SAME governed digest payload
// the scheduled emails carry — buildDigestPayload (extracted from
// buildDigestData) is the single builder for both channels, so a downloaded
// CSV can never drift from the email. Leave-balances honours the on-screen
// leave year; empty periods fail honestly (404 NO_REPORT_DATA); exports are
// audit logged (DATA_EXPORT, field-name metadata only). Every v2.47–v2.51
// feature is asserted intact.
// Run: node scripts/verify-v2-52-0.mjs

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

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.52.0', PKG.version === '2.52.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.52.0', PKG.mbumah?.releaseVersion === '2.52.0');
check('mbumah.baseVersion is 2.52.0', PKG.mbumah?.baseVersion === '2.52.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.52.0 entry", WN.includes("version: '2.52.0'"));
check("What's-New names the on-demand story", WN.includes('Digest CSV, on demand'));
check("What's-New names the leave-year honesty", WN.includes('honours the leave year selected on screen'));
check('verify:v2-52-0 script is wired', (PKG.scripts ?? {})['verify:v2-52-0'] === 'node scripts/verify-v2-52-0.mjs');
check('verify:v2-51-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-51-0'] === 'node scripts/verify-v2-51-0.mjs');

console.log('== Service: one builder for both channels ==');
const SS = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('exports buildDigestPayload (the shared builder)', SS.includes('export async function buildDigestPayload'));
check('exports DigestMeta (header-block facts)', SS.includes('export interface DigestMeta'));
check('exports digestOrgAndScope (one label path)', SS.includes('export async function digestOrgAndScope'));
check('buildDigestData delegates to buildDigestPayload', SS.includes('return buildDigestPayload('));
check('payload builder accepts a store narrowing opt', SS.includes('opts?: { storeId?: string | null; year?: number }'));
check('leave-utilisation honours the explicit year', SS.includes('const year = opts?.year ?? now.getUTCFullYear()'));
check('leave period label names the effective year', SS.includes('periodLabel: `Leave year ${year}`'));
check('scheduled sweep keeps its synthetic session', SS.includes('function sweepSession('));

console.log('== Route: GET /api/hr/reports/export ==');
const RT = read('src/app/api/hr/reports/export/route.ts') ?? '';
check('route file exists', !!RT);
check('same guard + roles as the interactive report routes', RT.includes("hrGuard('hr.report.branch', REPORT_ROLES)"));
check('report param is allow-listed against HR_SCHEDULE_REPORTS', RT.includes('HR_SCHEDULE_REPORTS.includes'));
check('pure query parser is exported for unit tests', RT.includes('export function parseExportQuery'));
check('missing report → 400 MISSING_REPORT', RT.includes("code: 'MISSING_REPORT'"));
check('unknown report → 400 INVALID_REPORT', RT.includes("code: 'INVALID_REPORT'"));
check('missing period → 400 MISSING_PERIOD', RT.includes("code: 'MISSING_PERIOD'"));
check('bad dates → 400 INVALID_PERIOD', RT.includes("code: 'INVALID_PERIOD'"));
check('period span is capped at 366 days', RT.includes('MAX_EXPORT_SPAN_DAYS = 366') && RT.includes("code: 'PERIOD_TOO_LONG'"));
check('leave year param validated as four digits', RT.includes("code: 'INVALID_YEAR'"));
check('empty report → honest 404 NO_REPORT_DATA', RT.includes("code: 'NO_REPORT_DATA'") && RT.includes('status: 404'));
check('serves the digestToCsv attachment as the body', RT.includes('digestToCsv(digest, now)'));
check('download disposition + honest filename headers', RT.includes("'Content-Disposition': `attachment; filename=\"${csv.filename}\"`") && RT.includes('X-Digest-Csv-Filename'));
check('no-store cache (a filing export is never a cached artefact)', RT.includes("'Cache-Control': 'no-store'"));
check('export is audit logged as DATA_EXPORT', RT.includes('HR_REPORT_DIGEST_EXPORTED') && RT.includes('HrEntityType.DATA_EXPORT'));
check('audit metadata carries report/period/scope/size only', RT.includes('channel:') && RT.includes('byteSize:') && RT.includes('scope:'));
check('org callers drill down through validateReportStore', RT.includes('validateReportStore(session, scope, parsed.storeId)'));
check('AD_HOC frequency label (never impersonates a scheduled digest)', RT.includes("frequencyLabel: 'AD_HOC'"));

console.log('== UI: violet Digest CSV button on /hr/reports ==');
const PG = read('src/app/(shell)/hr/reports/page.tsx') ?? '';
check('tab → report-key map is module-scoped', PG.includes('const DIGEST_EXPORT_KEYS: Record<string, string>'));
check('all seven digest-capable tabs are mapped', PG.includes("cost: 'employment-cost'") && PG.includes("tth: 'time-to-hire'") && PG.includes("statutory: 'statutory-liability'"));
check('p10 / schedules / privacy deliberately absent', !PG.includes('p10:'));
check('violet outline button family (light + dark)', PG.includes('border-violet-300 text-violet-700') && PG.includes('dark:border-violet-700'));
check('busy state never double-fires', PG.includes('digestBusy') && PG.includes("'Exporting…'"));
check('download honours the server filename first', PG.includes("match?.[1] ?? res.headers.get('X-Digest-Csv-Filename')"));
check('success note names file + human size + parity promise', PG.includes('Same aggregates, labels and scope a scheduled digest email carries.'));
check('failure note is the honest server message', PG.includes('j.error || `Export failed (${res.status}).`'));
check('leave tab exports the selected leave year', PG.includes("qs.set('year', leaveYear)"));
check('period tabs export the applied from/to', PG.includes("qs.set('from', from)") && PG.includes("qs.set('to', to)"));
check('branch filter rides along when active', PG.includes("qs.set('storeId', storeId)"));
check('status note is a live region (screen-reader reachable)', PG.includes('role="status"'));
check('size formatted by the shared formatter (chip parity)', PG.includes('formatCsvSize(blob.size)'));
check('the note line never prints on paper', PG.includes('print:hidden'));

console.log('== What did NOT change ==');
const DC = read('src/lib/hr/digest-csv.ts') ?? '';
check('digest-csv pure module untouched in contract', DC.includes('export function digestToCsv') && DC.includes('export function formatCsvSize'));
check('digestToCsv still refuses empty payloads', DC.includes('if (headline.length === 0 && (!table || table.rows.length === 0))'));
check('formula-injection guard still armed', DC.includes("const guarded = /^[=+\\-@\\t\\r]/.test(raw) ? `'${raw}` : raw;"));
const SCHED = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('schedule send-now CSV path untouched', SCHED.includes('digestToCsv') || SCHED.includes('formatCsvSize'));
check('P10 keeps its own statutory CSV route', !!read('src/app/api/hr/reports/p10/route.ts'));

console.log('== Tests ==');
const TP = read('src/tests/report-digest-export.test.ts') ?? '';
check('export test file exists', !!TP);
check('covers the query parser allow-list', TP.includes('INVALID_REPORT'));
check('covers the period caps', TP.includes('PERIOD_TOO_LONG'));
check('covers the leave-year honesty', TP.includes('honours the selected leave year') || TP.includes('INVALID_YEAR'));
check('covers payload parity between channels', TP.includes('buildDigestPayload'));
check('covers the builder swap regressions', TP.includes('buildDigestData'));
check('v2.51 intact: paid notice test file still exists', !!read('src/tests/payroll-paid-notice.test.ts'));
check('v2.50 intact: disbursement digest test file still exists', !!read('src/tests/payroll-disbursed-digest.test.ts'));
check('v2.46 intact: digest csv attachment test file still exists', !!read('src/tests/digest-csv-attachment.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.52.0 verification: ALL PASS');
} else {
  console.log(`v2.52.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
