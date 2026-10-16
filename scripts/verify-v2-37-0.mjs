#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.37.0 verification
// Scope: leave-utilisation scheduled digest — report-key registration (service
// + UI dropdown), year-keyed digest build (Leave year label, totals headline,
// byType table, aggregate-only), sweep/send-now paths, tests, lockfile parity
// guard, version lockstep.
// Run: node scripts/verify-v2-37-0.mjs

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

console.log('== Service: leave-utilisation schedule registration ==');
const SVC = read('src/lib/hr/report-schedule-service.ts') ?? '';
check("HR_SCHEDULE_REPORTS includes 'leave-utilisation'", SVC.includes("  'leave-utilisation',"));
check('REPORT_LABELS maps Leave balances', SVC.includes("'leave-utilisation': 'Leave balances'"));
check('REPORT_KEY_TO_TAB deep-links to the leave tab', SVC.includes("'leave-utilisation': 'leave'"));
check('leaveUtilisationReport imported from ./reports', SVC.includes('  leaveUtilisationReport,'));
check('digest case is YEAR-keyed (current UTC year)', SVC.includes('leaveUtilisationReport(session, now.getUTCFullYear()'));
check('digest period label says Leave year', SVC.includes('periodLabel: `Leave year ${r.year}`'));
check('headline carries the balance-sheet stats', SVC.includes("'Liability days'") && SVC.includes("'Over-drawn'") && SVC.includes("'Exhausted / low'"));
check('byType table carried with committed %', SVC.includes("'Committed %'") && SVC.includes('r.byType.map'));

console.log('== UI: Schedules tab report dropdown ==');
const TAB = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check("dropdown option for leave-utilisation", TAB.includes("{ value: 'leave-utilisation', label: 'Leave balances (leave-year keyed)' }"));
check('dialog documents the year-keyed exception', TAB.includes('keyed to the current calendar leave year'));

console.log('== Lockfile parity guard (carried-over chore) ==');
check('drift checker exists', existsSync(join(ROOT, 'scripts/check-lockfile-drift.mjs')));
const CI = read('.github/workflows/ci-cd.yml') ?? '';
check('CI security job runs the parity check', CI.includes('check-lockfile-drift.mjs'));

console.log('== Tests ==');
const T = read('src/tests/lib/hr-report-schedules.test.ts') ?? '';
check('leaveUtilisationReport in the reports mock', T.includes('leaveUtilisationReport: vi.fn()'));
check('year-keyed digest test', T.includes('builds a leave-year digest: year label, totals headline, byType table'));
check('aggregate-only leak test', T.includes('stays aggregate-only (no employee rows leak)'));
check('fail-closed null test', T.includes('returns null when the report returns null'));
check('sweep-to-SENT test with year subject', T.includes('Leave balances digest — MBUMAH Hardware (Leave year 2026)'));
check('schedule key accepted test', T.includes('schedules accept the leave-utilisation report key'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.37.0', pkg.version === '2.37.0', pkg.version);
check('mbumah.releaseVersion is 2.37.0', rel.releaseVersion === '2.37.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.37.0', rel.baseVersion === '2.37.0', rel.baseVersion);
check("What's-New has a 2.37.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.37.0'"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
