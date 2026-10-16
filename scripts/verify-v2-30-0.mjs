#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.30.0 verification
// QA-caught crash from v2.29.1: opening Payroll → Leave (or Attendance) with
// any data crashed the whole tab — the sub-tabs read nested `employee` /
// `leaveType` objects that the flat GET /api/leaves and GET /api/attendance
// DTOs never returned. A second latent bug: approve/reject sent lowercase
// action values while PUT /api/leaves requires UPPERCASE. This release fixes
// both, adds the reject-reason dialog, request details dialog, and the
// balances panel (envelope payloads the old apiFetch dropped).
// Run: npm run verify:v2-30-0

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

const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';

console.log('== Flat DTO contract (the v2.29.x crash) ==');
check('tab never reads a nested l/r.employee object', !/\b[lr]\.employee\./.test(TAB));
check('tab never reads a nested l/r.leaveType object', !/\b[lr]\.leaveType\./.test(TAB));
check('tab never reads the old l.days field', !/\b[lr]\.days\b/.test(TAB));
check('tab renders the flat leaves fields', ['l.employeeName', 'l.employeeJobTitle', 'l.leaveTypeName', 'l.leaveTypeCode', 'l.workingDays'].every((f) => TAB.includes(f)));
check('tab renders the flat attendance fields', ['r.employeeName', 'r.employeeJobTitle'].every((f) => TAB.includes(f)));
check('attendance sub-tab surfaces overtime + late minutes', TAB.includes('r.overtimeHours') && TAB.includes('r.lateMinutes'));

console.log('== Actions + envelope ==');
check("mutation sends UPPERCASE 'APPROVE'", TAB.includes("action: 'APPROVE'"));
check("mutation sends UPPERCASE 'REJECT' with rejectionReason", /action:\s*'REJECT'[^)]*rejectionReason/s.test(TAB) || TAB.includes("rejectionReason: rejectReason.trim()"));
check('no lowercase approve/reject action literals remain', !/action:\s*'(approve|reject)'/.test(TAB));
check('apiFetchEnvelope helper exists and is used for the leaves query', TAB.includes('function apiFetchEnvelope') && TAB.includes('apiFetchEnvelope<{ success: boolean; data: LeaveRequest[]; balances?: LeaveBalance[] }>'));
check('balances side-payload is read', /leavesEnvelope\?\.balances/.test(TAB));

console.log('== Manager approval UX ==');
check('reject dialog collects a required reason', TAB.includes('id="reject-reason"') && TAB.includes('rejectionReason: rejectReason.trim()'));
check('request details dialog exists with decision actions', TAB.includes('View details') && TAB.includes('Leave request'));
check('LeaveBalance interface matches the API balance rows', TAB.includes('interface LeaveBalance') && TAB.includes('availableDays') && TAB.includes('pendingDays'));

console.log('== Pure presentation module ==');
const LT = read('src/lib/leave-tab.ts') ?? '';
check('src/lib/leave-tab.ts exists, directive-free (both-graph importable)', LT.length > 0 && !/^\s*['"]use client['"]/m.test(LT) && !/^\s*import\s+['"]server-only['"]/m.test(LT));
check('exports balanceTone / balanceUtilization / initialsOf / leaveTypeStyle', ['export function balanceTone', 'export function balanceUtilization', 'export function initialsOf', 'export function leaveTypeStyle'].every((s) => LT.includes(s)));
check('tab imports the helpers from the pure module', TAB.includes("from '@/lib/leave-tab'"));

console.log('== Regression guard ==');
const GUARD = read('src/tests/lib/payroll-tab-contracts.test.ts') ?? '';
check('contract test forbids nested reads + lowercase actions', GUARD.includes('l.employee') && GUARD.includes("action:\\s*'(approve|reject)'"));
check('contract test covers the presentation helpers', GUARD.includes('balanceTone') && GUARD.includes('initialsOf') && GUARD.includes('balanceUtilization'));

console.log('== Balance transition integrity (the Decimal-trap fix) ==');
check('pure Decimal-safe transition delta exists', TAB.includes('leaveStatusTransitionDelta') || (read('src/lib/payroll-helpers.ts') ?? '').includes('export function leaveStatusTransitionDelta'));
const HELPERS = read('src/lib/payroll-helpers.ts') ?? '';
check('transition delta coerces Number() at the boundary (Decimal trap closed)', /const days = Math\.max\(0, Number\(workingDays\) \|\| 0\)/.test(HELPERS));
check('helper writes via numeric deltas (no raw Decimal + Decimal)', !/round2\(balance\.usedDays \+ days\)/.test(HELPERS) && !/round2\(balance\.pendingDays - days\)/.test(HELPERS));
check('PUT /api/leaves heals aggregates via recomputeBalances after decisions', (read('src/app/api/leaves/route.ts') ?? '').includes('recomputeBalances('));
check('transition delta unit test covers the Decimal valueOf trap', (read('src/tests/lib/leave-balance-transition.test.ts') ?? '').includes('DecimalStub'));

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.30.0', pkg.version === '2.30.0', pkg.version);
check('mbumah.releaseVersion bumped in lockstep (2.30.0)', pkg.mbumah?.releaseVersion === '2.30.0' && pkg.mbumah?.baseVersion === '2.30.0');
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has a [2.30.0] entry', changelog.includes('[2.30.0]'));
check("whats-new has a 2.30.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.30.0'"));
check('verify script registered in package.json', (pkg.scripts ?? {})['verify:v2-30-0'] === 'node scripts/verify-v2-30-0.mjs');

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll v2.30.0 checks PASS');
