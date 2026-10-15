#!/usr/bin/env node
// MBUMAH HARDWARE POS - Stage G (v2.19.0) verification
// Static + structural checks for Phase 4.7: performance, goals, assets,
// discipline, and the employee self-service portal. Run: npm run verify:stage-g

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

console.log('== Stage G route surface ==');
const routes = [
  'src/app/api/hr/performance/cycles/route.ts',
  'src/app/api/hr/performance/cycles/[id]/route.ts',
  'src/app/api/hr/performance/reviews/route.ts',
  'src/app/api/hr/performance/reviews/[id]/route.ts',
  'src/app/api/hr/performance/people/route.ts',
  'src/app/api/hr/performance/authorizers/route.ts',
  'src/app/api/hr/goals/route.ts',
  'src/app/api/hr/goals/[id]/route.ts',
  'src/app/api/hr/goals/[id]/recompute/route.ts',
  'src/app/api/hr/assets/route.ts',
  'src/app/api/hr/assets/[id]/route.ts',
  'src/app/api/hr/discipline/route.ts',
  'src/app/api/hr/discipline/[id]/route.ts',
  'src/app/api/self-service/me/route.ts',
  'src/app/api/self-service/me/payslips/route.ts',
  'src/app/api/self-service/me/payslips/[id]/route.ts',
  'src/app/api/self-service/me/attendance/route.ts',
  'src/app/api/self-service/me/leave/route.ts',
  'src/app/api/self-service/me/documents/route.ts',
  'src/app/api/self-service/me/goals/route.ts',
  'src/app/api/self-service/me/reviews/route.ts',
  'src/app/api/self-service/me/reviews/[id]/acknowledge/route.ts',
];
for (const route of routes) {
  check(`route ${route}`, existsSync(join(ROOT, route)));
}

console.log('== Guard composition ==');
const hrGuardRoutes = routes.filter((r) => r.startsWith('src/app/api/hr/'));
for (const route of hrGuardRoutes) {
  const src = read(route);
  check(`${route} composes hrGuard`, src !== null && src.includes('hrGuard('));
}
const selfRoutes = routes.filter((r) => r.includes('/self-service/'));
for (const route of selfRoutes) {
  const src = read(route);
  check(`${route} composes selfServiceGuard`, src !== null && src.includes('selfServiceGuard('));
}

console.log('== Sensitive-data rules ==');
const perfService = read('src/lib/hr/performance-service.ts') ?? '';
check(
  'review lists exclude overallRating (list payload DTO has no rating field)',
  !/ReviewListItemDto\s*=\s*{[^}]*overallRating/s.test(perfService),
);
const disciplineService = read('src/lib/hr/discipline-service.ts') ?? '';
check(
  'case list DTO excludes description',
  !/CaseListItemDto\s*=\s*{[^}]*description/s.test(disciplineService),
);
check('RESTRICTED confidentiality gate present', disciplineService.includes('CONFIDENTIALITY_RESTRICTED'));
check('warning expiry sweep present', disciplineService.includes('sweepExpiredCases'));

console.log('== Asset recovery authorization ==');
const assetService = read('src/lib/hr/asset-service.ts') ?? '';
check('recovery authorization gate present', assetService.includes('RECOVERY_NOT_AUTHORIZED'));
check('self-authorization blocked', assetService.includes('RECOVERY_SELF_AUTHORIZATION'));
check('authorizer role validated via hasHrPermission', assetService.includes("hasHrPermission(authorizer.role, 'hr.asset.manage')"));

console.log('== Goals computed from POS (never typed) ==');
const goalService = read('src/lib/hr/goal-service.ts') ?? '';
check('SALES_TOTAL / SALES_COUNT computation present', goalService.includes('SALES_TOTAL') && goalService.includes('SALES_COUNT'));
check('POS values reject typed writes', goalService.includes('POS_GOAL_READONLY'));
check('Decimal aggregation over SalesTransaction', goalService.includes('salesTransaction.aggregate') && goalService.includes('Prisma.Decimal'));
check('no Math.* on money paths', !/Math\.(round|floor|ceil)\([^)]*(?:targetValue|currentValue|totalAmount)/.test(goalService));

console.log('== Self-service cross-employee denial ==');
for (const route of selfRoutes) {
  const src = read(route) ?? '';
  const acceptsEmployeeIdParam = /searchParams\.get\(['"]employeeId/.test(src);
  check(`${route} ignores client employeeId`, !acceptsEmployeeIdParam);
}
const selfService = read('src/lib/hr/self-service.ts') ?? '';
check('employee link resolution present', selfService.includes('resolveSelfEmployee'));
check('NO_EMPLOYEE_PROFILE gate present', selfService.includes('NO_EMPLOYEE_PROFILE'));
check('statutory ids masked in self payslips', selfService.includes('[REDACTED]'));

console.log('== RBAC ==');
const permissions = read('src/lib/hr/permissions.ts') ?? '';
check('hr.documents.read.own key exists (additive)', permissions.includes("'hr.documents.read.own'"));
check('performance keys exist', permissions.includes("'hr.performance.manage'") && permissions.includes("'hr.performance.review'"));
check('asset + discipline keys exist', permissions.includes("'hr.asset.manage'") && permissions.includes("'hr.discipline.manage'"));

console.log('== UI surface ==');
const uiPages = [
  'src/app/hr/performance/page.tsx',
  'src/app/hr/assets/page.tsx',
  'src/app/hr/discipline/page.tsx',
  'src/app/employees/me/layout.tsx',
  'src/app/employees/me/page.tsx',
  'src/app/employees/me/payslips/page.tsx',
  'src/app/employees/me/attendance/page.tsx',
  'src/app/employees/me/leave/page.tsx',
  'src/app/employees/me/goals/page.tsx',
  'src/app/employees/me/documents/page.tsx',
];
for (const page of uiPages) {
  check(`page ${page}`, existsSync(join(ROOT, page)));
}
const hrLayout = read('src/app/hr/layout.tsx') ?? '';
check('HR nav links the new consoles', hrLayout.includes('/hr/performance') && hrLayout.includes('/hr/assets') && hrLayout.includes('/hr/discipline'));
const payslipsPage = read('src/app/employees/me/payslips/page.tsx') ?? '';
check('payslip offline cache present', payslipsPage.includes('localStorage'));
const meLayout = read('src/app/employees/me/layout.tsx') ?? '';
check('mobile-first bottom tab nav', meLayout.includes('md:hidden'));

console.log('== Tests + docs ==');
const tests = [
  'src/tests/lib/stage-g-performance.test.ts',
  'src/tests/lib/stage-g-goals.test.ts',
  'src/tests/lib/stage-g-assets-discipline.test.ts',
  'src/tests/lib/stage-g-self-service.test.ts',
];
for (const t of tests) check(`test ${t}`, existsSync(join(ROOT, t)));
for (const doc of ['docs/hr/performance.md', 'docs/hr/assets-and-discipline.md', 'docs/hr/self-service.md']) {
  check(`doc ${doc}`, existsSync(join(ROOT, doc)));
}

const pkg = JSON.parse(read('package.json'));
check('verify:stage-g npm script wired', Boolean(pkg.scripts?.['verify:stage-g']));
check('package version is 2.19.0', pkg.version === '2.19.0', pkg.version);
check(
  'mbumah.releaseVersion is 2.19.0',
  pkg.mbumah?.releaseVersion === '2.19.0',
  String(pkg.mbumah?.releaseVersion),
);

console.log('');
if (failures > 0) {
  console.error(`Stage G verification FAILED: ${failures} check(s).`);
  process.exit(1);
}
console.log('Stage G verification PASSED.');
