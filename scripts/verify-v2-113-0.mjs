#!/usr/bin/env node
// v2.113.0 verification — "The dead columns open their doors; the HR roster
// finally exists". Written fresh this round (never patch a prior round's copy
// — house lesson 25): every check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`[PASS] ${name}`);
  } catch (e) {
    fail++;
    console.log(`[FAIL] ${name}\n       ${e.message}`);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json stays at-or-above 2.113.0 (all three slots)', () => {
  // v2.114.0 chore re-anchor (the PR #235/#238 precedent): floor holds (never
  // backward), slots must AGREE with each other (no half-bumped trees).
  const pkg = JSON.parse(read('package.json'));
  const atLeast = (v, floor) => {
    const p = v.split('.').map(Number);
    const f = floor.split('.').map(Number);
    return p[0] > f[0] || (p[0] === f[0] && (p[1] > f[1] || (p[1] === f[1] && p[2] >= f[2])));
  };
  assert(atLeast(pkg.version, '2.113.0'), `version=${pkg.version}`);
  assert(atLeast(pkg.mbumah.releaseVersion, '2.113.0'), `release=${pkg.mbumah.releaseVersion}`);
  assert(atLeast(pkg.mbumah.baseVersion, '2.113.0'), `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.version === pkg.mbumah.releaseVersion && pkg.mbumah.releaseVersion === pkg.mbumah.baseVersion, 'slots disagree');
});

check('whats-new: 2.113.0 leads the feed with the doors story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.113.0'");
  assert(head > -1, 'no 2.113.0 entry');
  assert(head < wn.indexOf("version: '2.112.0'"), '2.113.0 does not lead');
  assert(wn.includes('The dead columns open their doors; the HR roster finally exists'), 'title missing');
});

check('changelog: [2.113.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.113.0]');
  assert(head > -1, 'no 2.113.0 section');
  assert(head < cl.indexOf('## [2.112.0]'), '2.113.0 does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.112.0]'));
  assert(section.includes('### Added'), 'Added');
  assert(section.includes('### Changed'), 'Changed');
  assert(section.includes('### Security'), 'Security');
});

// ── the bug fix: /hr/employees exists ──────────────────────────────────────
check('the /hr/employees list page EXISTS (the 404 is dead)', () => {
  const page = read('src/app/(shell)/hr/employees/page.tsx');
  assert(page.includes('data-testid="hr-employees-page"'), 'page marker missing');
  assert(page.includes("readParam('expiring')"), 'expiring seed missing');
  assert(page.includes("readParam('storeId')"), 'storeId seed missing');
  assert(page.includes('hr-employees-expiring-toggle'), 'expiring toggle missing');
  assert(page.includes('storeMismatch'), 'store-scope honesty missing');
  assert(page.includes("href={`" + "/hr/employees/${r.id}`}"), 'row doors missing');
  assert(page.includes('apiGet<EmployeeRow[]>'), 'list fetch missing');
  // lazy initializers, never setState-in-effect for seeds
  assert(page.match(/useState\(\(\) => readParam\('storeId'\)\)/), 'storeId seed not a lazy initializer');
});

check('the employees list API: role-keyed read + expiring + org-owned storeId', () => {
  const route = read('src/app/api/hr/employees/route.ts');
  assert(route.includes('parseExpiringDays(url.searchParams.get(\'expiring\'))'), 'expiring param not parsed');
  assert(route.includes('resolveReportScope(session) === \'ORG\''), 'org-scope gate missing');
  assert(route.includes('storeInOrganization(requested, session.organizationId)'), 'org verification missing');
  assert(route.includes('status: 403'), 'fail-closed 403 missing');
  // v2.113.0 QA fix: the read key resolves BY ROLE (owner = read.all; the
  // old pinned own_branch key 403'd every owner)
  assert(route.includes('READ_KEY_BY_ROLE'), 'role-keyed read missing');
  assert(route.includes("STORE_OWNER: 'hr.employee.read.all'"), 'owner key missing');
  assert(route.includes("BRANCH_MANAGER: 'hr.employee.read.own_branch'"), 'branch manager key missing');
  assert(route.includes('recordPermissionDenied'), 'deny log missing');
  const cfg = read('src/lib/app-config.ts');
  assert(cfg.includes("EMPLOYEE_LIST_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER', 'BRANCH_MANAGER']"), 'client role list missing');
});

check('the service filter: window [now, now+N], grouped counts, PII holds', () => {
  const svc = read('src/lib/hr/employee-service.ts');
  assert(svc.includes('export function parseExpiringDays'), 'parseExpiringDays missing');
  assert(svc.includes('Math.min(365, Math.max(1, Math.floor(n)))'), 'clamp missing');
  assert(svc.includes('expiryDate: { gte: now, lte: horizon }'), 'window missing');
  assert(svc.includes('deletedAt: null,'), 'soft-delete respect missing');
  assert(svc.includes('expiringDocuments: hit.count, nearestExpiry: toIso(hit.nearest)'), 'annotations missing');
  assert(svc.includes('export async function storeInOrganization'), 'storeInOrganization missing');
});

// ── the doors ──────────────────────────────────────────────────────────────
check('link builders: expiring employees + run deep link, pure and encoded', () => {
  const links = read('src/lib/workspace/links.ts');
  assert(links.includes('export function buildExpiringEmployeesHref'), 'expiry builder missing');
  assert(links.includes('export function buildRunDeepLinkHref'), 'run builder missing');
  assert(links.includes("params.set('expiring', String(days > 0 ? Math.floor(days) : 90))"), 'expiring param');
  assert(links.includes("return `/hr/employees?${params.toString()}`;"), 'expiring href');
  assert(links.includes("return `/hr/payroll?${params.toString()}`;"), 'run href');
});

check('the server joins run.id into hrPerStore.latestPayroll (additive)', () => {
  const reports = read('src/lib/hr/reports.ts');
  assert(
    reports.includes('select: { id: true, status: true, createdAt: true, payrollPeriod: { select: { name: true } } }'),
    'run id not selected',
  );
  assert(reports.includes('runId: latestRun.id,'), 'runId not in payload');
  const primitives = read('src/components/org/primitives.tsx');
  assert(
    primitives.includes('latestPayroll: { runId: string; periodName: string; status: string; createdAt: string } | null;'),
    'type not widened',
  );
});

check('the panel: latest-run cell is a door with a degrade path', () => {
  const p = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(p.includes('if (run.runId) {'), 'no id gate');
  assert(p.includes('href={buildRunDeepLinkHref(run.runId)}'), 'run door href missing');
  assert(p.includes('data-testid="people-payroll-run-door"'), 'run door testid missing');
  assert(p.includes("aria-label={`Open the payroll run detail for ${run.periodName} — ${storeName}`}"), 'run door aria missing');
  assert(p.includes('focus-visible:ring-2 focus-visible:ring-orange-400'), 'focus path missing');
  // degrade paths survive
  assert(p.includes('no runs yet'), 'no-run text lost');
  assert(p.includes('PAYROLL_RUN_NOT_AVAILABLE'), 'no-run title lost');
});

check('the panel: expiry cell is a role-gated door for documents, text for assets', () => {
  const p = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(p.includes('href={buildExpiringEmployeesHref(row.storeId)}'), 'expiry door href missing');
  assert(p.includes('data-testid="people-payroll-expiry-door"'), 'expiry door testid missing');
  assert(p.includes('EMPLOYEE_LIST_READ_ROLES.includes(role'), 'role gate missing (a door that 403s is a lie)');
  // v2.114.0 chore re-anchor: the gate renamed canOpenExpiry -> canOpenDocs
  // when the assets half grew its own parallel door (canOpenAssets)
  assert(p.match(/if \(docs > 0 && canOpenDocs\) \{/), 'door not gated on docs + role');
  assert(p.includes('Overdue asset assignments: ${assets} — see the Assets page'), 'assets honesty lost');
  // both surfaces share the cells
  assert(p.match(/<LatestRunCell run=\{row\.latestPayroll\} storeName=\{row\.storeName\} \/>/g)?.length === 2, 'table+card must both pass storeName');
  assert(p.includes('<ExpiryCell row={row} />'), 'mobile card must reuse ExpiryCell');
});

check('/hr/payroll consumes ?run= as a lazy seed and strips it once', () => {
  const page = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(page.match(/useState<string \| null>\(\(\) => \{[\s\S]*?get\('run'\)/), 'run seed not a lazy initializer');
  assert(page.includes("sp.delete('run')"), 'strip missing');
  assert(page.includes('window.history.replaceState(null'), 'replaceState missing');
});

check('the new test file pins all three layers', () => {
  const t = read('src/tests/panel-doors-v2113.test.ts');
  assert(t.includes('parseExpiringDays'), 'parser pins missing');
  assert(t.includes('expiringWithinDays: 90'), 'filter pins missing');
  assert(t.includes('buildExpiringEmployeesHref'), 'builder pins missing');
  assert(t.includes("src('src/app/(shell)/hr/employees/page.tsx')"), 'page pin missing');
});

check('the v2.109.0 panel pins ride the new cell signature (honest re-anchor)', () => {
  const t = read('src/tests/nav-console-v2109.test.ts');
  assert(
    t.includes('<LatestRunCell run={row.latestPayroll} storeName={row.storeName} />'),
    're-anchor missing',
  );
});

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
