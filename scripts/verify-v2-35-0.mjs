#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.35.0 verification
// Scope: leave entitlement utilisation & liability report (service + API route
// + "Leave balances" tab) with spec-compliant row shape, DATA_EXPORT audit,
// and version lockstep.
// Run: npm run verify:v2-35-0

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
  return existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null;
}

console.log('== Leave utilisation report service ==');
const REP = read('src/lib/hr/reports.ts') ?? '';
check('leaveUtilisationReport exists', REP.includes('export async function leaveUtilisationReport'));
check('scoped: fail-closed via resolveReportScope', (() => {
  const start = REP.indexOf('export async function leaveUtilisationReport');
  const body = start >= 0 ? REP.slice(start, start + 400) : '';
  return body.includes('const scope = resolveReportScope(session)') && body.indexOf('const scope = resolveReportScope(session)') < body.indexOf('if (!scope)');
})());
check('ACTIVE + non-deleted employees only', /employeeWhere = \{ status: 'ACTIVE', deletedAt: null, \.\.\.scopeWhere/.test(REP));
check('spec shape: employeeCode + job title, no names', /employeeCode: b\.employee\.employeeCode/.test(REP) && /jobTitle: b\.employee\.jobTitle/.test(REP));
check('noise filter drops zero-signal rows', /allocated \+ carried > 0 \|\| used > 0 \|\| pending > 0/.test(REP));
check('available = allocated + carried - used - pending', /allocated \+ carried - used - pending/.test(REP));
check('flag classification (OVERDRAWN/EXHAUSTED/LOW/OPEN)', /if \(available < 0\) return 'OVERDRAWN'/.test(REP) && /if \(available === 0\) return 'EXHAUSTED'/.test(REP) && /committedPct >= 80\) return 'LOW'/.test(REP));
check('rollups: totals + byType + byStore', REP.includes('byTypeMap') && REP.includes('byStoreMap') && REP.includes('totals.committedPct'));
check('distinct leave years surfaced', /distinct: \['leaveYear'\]/.test(REP));

console.log('== CSV export + DATA_EXPORT audit ==');
check('leaveUtilisationToCSV with TOTAL row', REP.includes('export function leaveUtilisationToCSV') && REP.includes("'TOTAL'"));
check('audit helper exists + fire-and-tolerate', REP.includes('export async function auditLeaveUtilisationExport') && REP.includes("action: 'LEAVE_UTILISATION_EXPORTED'") && REP.includes('.catch(() => undefined)'));
check('audit uses DATA_EXPORT resource type', /LEAVE_UTILISATION_EXPORTED[\s\S]{0,200}HrEntityType\.DATA_EXPORT/.test(REP));

console.log('== API route ==');
const ROUTE = read('src/app/api/hr/reports/leave-utilisation/route.ts') ?? '';
check('route exists + hrGuard guarded', ROUTE.includes("hrGuard('hr.report.branch'") && ROUTE.includes("REPORT_ROLES = ['HR_MANAGER', 'STORE_OWNER', 'ACCOUNTANT', 'BRANCH_MANAGER']"));
check('storeId drill-down validated (fail-closed)', ROUTE.includes('validateReportStore(session, scope,'));
check('year clamped to a sane range', /Math\.min\(2100, Math\.max\(2000, parsed\)\)/.test(ROUTE));
check('format=csv -> audited CSV response', ROUTE.includes("format') === 'csv'") && ROUTE.includes('auditLeaveUtilisationExport(session, year') && ROUTE.includes('text/csv; charset=utf-8'));
check('JSON payload wraps { success, data }', ROUTE.includes('Response.json({ success: true, data })'));

console.log('== Reports page: Leave balances tab ==');
const PAGE = read('src/app/(shell)/hr/reports/page.tsx') ?? '';
check('tab registered + deep-linkable', PAGE.includes("'absence', 'leave', 'turnover'"));
check('tab trigger with icon', PAGE.includes('value="leave"') && PAGE.includes('Leave balances'));
check('year picker drives an independent load', PAGE.includes('leaveYear') && PAGE.includes('/api/hr/reports/leave-utilisation?'));
check('storeId drill-down respected', /leave-utilisation\?\$\{qs\}/.test(PAGE) && PAGE.includes('storeId=${encodeURIComponent(storeId)}'));
check('stat cards: liability/committed/over-drawn/pending/tracked', PAGE.includes('Liability days') && PAGE.includes('Over-drawn') && PAGE.includes('Tracked rows'));
check('per-type committed bars', PAGE.includes('Entitlement by leave type') && PAGE.includes('utilRailTone(t.committedPct)'));
check('per-employee table with flag chips + rail', PAGE.includes('Per-employee balances') && PAGE.includes('utilFlagTone(r.flag)') && PAGE.includes('utilRailTone(r.committedPct)'));
check('negative available highlighted', PAGE.includes("r.available < 0 ? 'text-rose-600"));
check('client CSV export mirrors server columns', PAGE.includes('leave-utilisation-${leaveUtil.year}.csv') && PAGE.includes("'Committed %', 'Flag'"));
check('column visibility + print toolbar present', /TableToolbar/.test(PAGE) && PAGE.includes('max-h-[520px] overflow-auto'));
check('empty-state copy for a year with no balances', PAGE.includes('No entitlement balances recorded for'));

console.log('== Tests registered ==');
const T = read('src/tests/lib/leave-utilisation-report.test.ts') ?? '';
check('scoping tests', T.includes('maps roles to scopes') && T.includes('cannot narrow to another store'));
check('math/flag tests', T.includes('computes available/committed') && T.includes('classifies EXHAUSTED and LOW flags'));
check('CSV contract test', T.includes('emits RFC-4180 rows with a TOTAL line'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.35.0', pkg.version === '2.35.0', pkg.version);
check('mbumah.releaseVersion is 2.35.0', rel.releaseVersion === '2.35.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.35.0', rel.baseVersion === '2.35.0', rel.baseVersion);
check("What's-New has a 2.35.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.35.0'"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
