#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.36.0 verification
// Scope: leave balance governance — drill-down service + routes, governed
// adjustment (validation, tenths-exact math, notes, audit, notify/email),
// reports-page drill-down dialog + clickable rows, tests, version lockstep.
// Run: node scripts/verify-v2-36-0.mjs

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

console.log('== Leave balance governance service ==');
const GOV = read('src/lib/hr/leave-balance-governance.ts') ?? '';
check('adjustLeaveBalance exported', GOV.includes('export async function adjustLeaveBalance'));
check('leaveBalanceDrillDown exported', GOV.includes('export async function leaveBalanceDrillDown'));
check('ADJUST_ROLES mirror hr.leave.balance.manage', /ADJUST_ROLES = \['HR_MANAGER', 'STORE_OWNER'\]/.test(GOV));
check('drill-down fail-closed via resolveReportScope', (() => {
  const start = GOV.indexOf('export async function leaveBalanceDrillDown');
  const body = start >= 0 ? GOV.slice(start, start + 600) : '';
  return body.includes('const scope = resolveReportScope(session)') && body.indexOf('if (!scope) return null;') > -1;
})());
check('adjust fail-closed scope via scopeWhere', /employeeLeaveBalance\.findFirst\(\{\s*where: \{ id: input\.balanceId, employee: scopeWhere\(session, scope\) \}/.test(GOV.replace(/\n\s*/g, ' ')));
check('non-zero delta enforced', GOV.includes('Adjustment must be a non-zero number of days.'));
check('0.5-day step enforced', GOV.includes('Adjustments must be in steps of 0.5 days.'));
check('±365 cap enforced', GOV.includes('Adjustments are capped at ±365 days.'));
check('reason mandatory (8+ chars)', /reason\.length < 8/.test(GOV));
check('allocated floor: never below zero', GOV.includes('Adjustment would drive allocated days below zero'));
check('tenths-exact math helper', GOV.includes('addTenths'));
check('governance notes appended', GOV.includes('[balance adjust]'));
check('hash-chained audit via hrAudit LEAVE_BALANCE_ADJUSTED', GOV.includes("action: 'LEAVE_BALANCE_ADJUSTED'"));
check('employee bell row with deep link', GOV.includes("actionUrl: '/employees/me/leave'"));
check('email via sendEmail LEAVE_BALANCE_ADJUSTED (fail-tolerant)', GOV.includes("type: 'LEAVE_BALANCE_ADJUSTED'") && /\.catch\(\(\) => undefined\)/.test(GOV));
check('history window: requests starting inside the year', /startDate: \{ gte: yearStart, lt: yearEnd \}/.test(GOV.replace(/\n\s*/g, ' ')));

console.log('== Drill-down + adjust API routes ==');
const DD = read('src/app/api/hr/reports/leave-utilisation/drill-down/route.ts') ?? '';
const ADJ = read('src/app/api/hr/leave-balances/adjust/route.ts') ?? '';
check('drill-down route guarded by hrGuard hr.report.branch', DD.includes("hrGuard('hr.report.branch'") && DD.includes('REPORT_ROLES'));
check('drill-down validates params + clamps year', DD.includes('employeeCode') && DD.includes('Math.min(2100, Math.max(2000'));
check('drill-down 404 without existence leak', DD.includes("'Balance not found.'") && DD.includes("status: 404"));
check('adjust route guarded by hrGuard hr.leave.balance.manage', ADJ.includes("hrGuard('hr.leave.balance.manage'"));
check('adjust route maps VALIDATION/NOT_FOUND/FORBIDDEN', ADJ.includes("'VALIDATION' ? 400") && ADJ.includes("'NOT_FOUND' ? 404") && ADJ.includes(': 403'));
check('adjust route requires balanceId', ADJ.includes('balanceId is required.'));
check('outcome carries honest delivery facts (notified bell/email)', GOV.includes('notified: { bell: boolean; email: boolean }') && GOV.includes('notified: { bell: bellSent, email: emailSent }'));
check('delivery legs capture results instead of swallowing', GOV.includes('.then(() => true)') && GOV.includes('.catch(() => false)'));

console.log('== Reports page: clickable rows + drill-down dialog ==');
const PAGE = read('src/app/(shell)/hr/reports/page.tsx') ?? '';
check('rows are clickable with drill fetch', PAGE.includes('onClick={() => void openDrill(r.employeeCode, r.typeCode)}'));
check('OVERDRAWN rows tinted rose', PAGE.includes("r.flag === 'OVERDRAWN'") && PAGE.includes('bg-rose-500/[0.05]'));
check('row hover affordance + chevrons', PAGE.includes('cursor-pointer transition-colors') && (PAGE.match(/ChevronRight className="h-3 w-3/g) ?? []).length >= 2);
check('drill dialog with balance chips', PAGE.includes('function BalanceChip') && PAGE.includes('<BalanceChip'));
check('governance notes block rendered', PAGE.includes('Governance notes'));
check('history list with status chips', PAGE.includes('leaveStatusTone') && PAGE.includes('Requests starting in'));
check('adjust form: delta input + reason textarea + preview', PAGE.includes('adjust-delta') && PAGE.includes('adjust-reason') && PAGE.includes('Preview: allocated'));
check('apply button role-gated copy', PAGE.includes('Apply adjustment') && PAGE.includes('restricted to HR managers and store owners'));
check('submit posts to /api/hr/leave-balances/adjust', PAGE.includes("'/api/hr/leave-balances/adjust', 'POST'"));
check('non-adjusters see restricted copy', PAGE.includes('drill.data.canAdjust ?'));
check('delivery chips rendered after apply', PAGE.includes('In-app notification sent') && PAGE.includes('Email sent') && PAGE.includes('No portal account — in-app notice skipped') && PAGE.includes('Email not delivered'));

console.log('== Tests ==');
const T = read('src/tests/hr/leave-balance-governance.test.ts') ?? '';
check('scoping fail-closed tests', T.includes('returns null for a scopeless session') && T.includes('fails closed on a balanceId outside the caller scope'));
check('validation rails test', T.includes('enforces the validation rails'));
check('success path: math + notes + notify + email', T.includes('writes tenths-exact allocation') && T.includes('LEAVE_BALANCE_ADJUSTED'));
check('honest delivery facts tests', T.includes('reports honest delivery') && T.includes('notified: { bell: false, email: true }'));
check('flag rails parity test', T.includes('classifies OVERDRAWN / EXHAUSTED / LOW / OPEN like the report'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.36.0', pkg.version === '2.36.0', pkg.version);
check('mbumah.releaseVersion is 2.36.0', rel.releaseVersion === '2.36.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.36.0', rel.baseVersion === '2.36.0', rel.baseVersion);
check("What's-New has a 2.36.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.36.0'"));
check('scopeWhere exported from reports.ts', (read('src/lib/hr/reports.ts') ?? '').includes('export function scopeWhere'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
