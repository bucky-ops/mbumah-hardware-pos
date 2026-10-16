#!/usr/bin/env node
// MBUMAH HARDWARE POS - Stage H (v2.20.0) verification
// Static + structural checks for Phase 4.8: HR reports, P10 from stored
// lines, org-console HR tiles, retention + legal hold, erasure requests.
// Run: npm run verify:stage-h

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

console.log('== Report routes ==');
const reports = ['headcount', 'employment-cost', 'absence', 'turnover', 'time-to-hire', 'statutory-liability', 'p10', 'summary'];
for (const r of reports) {
  const p = `src/app/api/hr/reports/${r}/route.ts`;
  const src = read(p);
  check(`route ${p}`, src !== null);
  check(`  ${r} composes hrGuard`, src !== null && src.includes('hrGuard('));
  check(`  ${r} allows BRANCH_MANAGER (branch scope)`, src !== null && src.includes('BRANCH_MANAGER'));
}

console.log('== P10 reproduces from stored lines (never recomputed) ==');
const reportsService = read('src/lib/hr/reports.ts') ?? '';
check('P10 reads PayrollDetail columns', reportsService.includes('payrollDetail.findMany'));
check('P10 restricted to POSTED/LOCKED runs', reportsService.includes("['POSTED', 'LOCKED']"));
check('P10 has no engine import (nothing recomputed)', !reportsService.includes('payroll/engine'));
check('P10 CSV export follows repo conventions', reportsService.includes("from '@/lib/report-utils'"));
check('P10 export audit logged', reportsService.includes('P10_EXPORTED') && reportsService.includes('DATA_EXPORT'));

console.log('== Aggregate-only payloads (no raw ids / no names) ==');
check('reports carry no fullName (explicit select exclusion allowed)', !/fullName:\s*true/.test(reportsService) && !/fullName(?!\s*:)/.test(reportsService));
check('turnover rows use employeeCode only', reportsService.includes('employeeCode') && !reportsService.includes('nationalId'));
check('scope resolver fail-closed', reportsService.includes('resolveReportScope'));

console.log('== Org console HR tiles (5) ==');
const orgSummary = read('src/app/api/org/summary/route.ts') ?? '';
check('org summary exposes hr block', orgSummary.includes('hrSummaryForOrgConsole'));
check('tiles gated by HR module + report permission', orgSummary.includes('isHrModuleEnabled') && orgSummary.includes('hasHrPermission'));
const orgConsole = read('src/components/workspace/org-console.tsx') ?? '';
for (const tile of ['Active headcount', 'Employment cost (month)', 'Absence rate (month)', 'Payroll', 'Expiry alerts']) {
  check(`tile "${tile}" present`, orgConsole.includes(tile));
}

console.log('== /hr/reports page: dense table contract ==');
const page = read('src/app/hr/reports/page.tsx') ?? '';
check('sticky headers', page.includes('sticky top-0'));
check('column visibility control', page.includes('Column visibility') && page.includes('Checkbox'));
check('CSV export', page.includes('downloadCSV'));
check('print-to-PDF', page.includes('window.print'));
check('no horizontal scroll (vertical scroll containers)', page.includes('max-h-96 overflow-y-auto'));
check('no raw employee ids rendered', !/TableCell[^>]*>\{r\.id\}/.test(page));

console.log('== Retention + legal hold ==');
const dp = read('src/lib/hr/data-protection.ts') ?? '';
check('HR retention policies defined per record type', dp.includes('HR_RETENTION_POLICIES'));
check('legal hold blocks archival', dp.includes('getLegalHolds') && dp.includes('legalHold:'));
check('anonymise-in-place (no hard delete)', dp.includes('REDACTED (retention)'));
const cron = read('src/app/api/cron/retention/route.ts') ?? '';
check('retention cron runs the HR sweep', cron.includes('runHrRetentionSweep'));

console.log('== Erasure requests ==');
check('model exists in schema', (read('prisma/schema.prisma') ?? '').includes('model ErasureRequest'));
for (const r of [
  'src/app/api/hr/privacy/erasure-requests/route.ts',
  'src/app/api/hr/privacy/erasure-requests/[id]/execute/route.ts',
  'src/app/api/hr/privacy/erasure-requests/[id]/reject/route.ts',
]) {
  check(`route ${r}`, existsSync(join(ROOT, r)));
}
check('decision + legal basis recorded', dp.includes('legalBasis') && dp.includes('decision'));
check('statutory retention note present', dp.includes('STATUTORY_RETENTION_NOTE') || dp.includes('statutory retention'));
check('decisions reserved to settings managers', dp.includes('canDecideErasure'));

console.log('== Tests + docs + version ==');
for (const t of ['src/tests/lib/stage-h-reports.test.ts', 'src/tests/lib/stage-h-data-protection.test.ts']) {
  check(`test ${t}`, existsSync(join(ROOT, t)));
}
for (const d of ['docs/hr/reporting.md', 'docs/hr/data-protection.md', 'docs/hr/documents-and-retention.md']) {
  check(`doc ${d}`, existsSync(join(ROOT, d)));
}
check('reports linked from /hr nav', (read('src/app/hr/layout.tsx') ?? '').includes('/hr/reports'));

const pkg = JSON.parse(read('package.json'));
check('verify:stage-h npm script wired', Boolean(pkg.scripts?.['verify:stage-h']));
// Forward-compatible version floor (same helper as verify-stage-g.mjs) so
// later feature releases keep this gate green.
function semverAtLeast(version, minimum) {
  const [a, b, c] = String(version).split('.').map((n) => Number(n) || 0);
  const [x, y, z] = minimum.split('.').map((n) => Number(n) || 0);
  return a > x || (a === x && (b > y || (b === y && c >= z)));
}
check('package version >= 2.20.0 (Stage H baseline)', semverAtLeast(pkg.version, '2.20.0'), pkg.version);
check('mbumah.releaseVersion >= 2.20.0 (Stage H baseline)', semverAtLeast(String(pkg.mbumah?.releaseVersion), '2.20.0'), String(pkg.mbumah?.releaseVersion));

console.log('');
if (failures > 0) {
  console.error(`Stage H verification FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log('Stage H verification PASSED.');
