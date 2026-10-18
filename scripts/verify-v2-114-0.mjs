#!/usr/bin/env node
// v2.114.0 verification — "The assets half of the alert opens its door".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory.

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
check('version: package.json leads 2.114.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.114.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.114.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.114.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-114-0'], 'verify script entry missing');
});

check('whats-new: 2.114.0 leads the feed with the two-doors story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.114.0'");
  assert(head > -1, 'no 2.114.0 entry');
  assert(head < wn.indexOf("version: '2.113.0'"), '2.114.0 does not lead');
  assert(wn.includes('The assets half of the alert opens its door'), 'title missing');
});

check('changelog: [2.114.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.114.0]');
  assert(head > -1, 'no 2.114.0 section');
  assert(head < cl.indexOf('## [2.113.0]'), '2.114.0 does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.113.0]'));
  assert(section.includes('### Added'), 'Added');
  assert(section.includes('### Changed'), 'Changed');
  assert(section.includes('### Security'), 'Security');
});

// ── the service: windowed, org-scoped reads ────────────────────────────────
check('listAssets: overdue mirrors assetsOverdue exactly, wins over status', () => {
  const svc = read('src/lib/hr/asset-service.ts');
  assert(svc.includes('filters: { employeeId?: string; status?: string; storeId?: string; overdue?: boolean }'), 'new filter signature missing');
  assert(svc.includes("status: 'ASSIGNED', dueReturnOn: { lt: new Date() }"), 'overdue window missing');
  assert(svc.includes('? { status: \'ASSIGNED\', dueReturnOn: { lt: new Date() } }\n        : filters.status'), 'overdue must win over status');
  assert(svc.includes('await storeInOrganization(filters.storeId, session.organizationId)'), 'org verification missing');
  assert(svc.includes('employee: storeFilter ? { ...scope, storeId: storeFilter } : scope'), 'narrowed scope missing');
  assert(svc.includes("import { storeInOrganization } from './employee-service';"), 'storeInOrganization import missing');
});

check('the assets route parses storeId + overdue (guard key unchanged)', () => {
  const route = read('src/app/api/hr/assets/route.ts');
  assert(route.includes("url.searchParams.get('storeId') ?? undefined"), 'storeId param missing');
  assert(route.includes("overdue: url.searchParams.get('overdue') === '1'"), 'overdue param missing');
  assert(route.includes("hrGuard('hr.asset.manage')"), 'guard key changed');
});

// ── the door ───────────────────────────────────────────────────────────────
check('link builder: buildOverdueAssetsHref pure and encoded', () => {
  const links = read('src/lib/workspace/links.ts');
  assert(links.includes('export function buildOverdueAssetsHref'), 'builder missing');
  assert(links.includes("params.set('overdue', '1');"), 'overdue param');
  assert(links.includes("params.set('storeId', storeId || '');"), 'storeId param');
  assert(links.includes('return `/hr/assets?${params.toString()}`;'), 'href');
});

check('the panel: the assets half is a role-gated door with honest degrades', () => {
  const p = read('src/components/finance/people-payroll-by-branch.tsx');
  assert(p.includes('href={buildOverdueAssetsHref(row.storeId)}'), 'assets door href missing');
  assert(p.includes('data-testid="people-payroll-assets-door"'), 'assets door testid missing');
  assert(p.includes('ASSET_LIST_READ_ROLES.includes(role'), 'assets role gate missing (a door that 403s is a lie)');
  assert(p.includes('EMPLOYEE_LIST_READ_ROLES.includes(role'), 'docs role gate lost');
  assert(p.match(/assets > 0 && canOpenAssets/), 'zero halves must never render as links');
  assert(p.includes('Overdue asset assignments: ${assets} — see the Assets page'), 'text degrade lost');
  assert(p.includes('data-testid="people-payroll-expiry-door"'), 'docs door lost');
  assert(p.match(/<LatestRunCell run=\{row\.latestPayroll\} storeName=\{row\.storeName\} \/>/g)?.length === 2, 'table+card must both pass storeName');
  assert(p.includes('<ExpiryCell row={row} />'), 'mobile card must reuse ExpiryCell');
});

check('the client role list mirrors the route guard (shared truth in app-config)', () => {
  const cfg = read('src/lib/app-config.ts');
  assert(cfg.includes("export const ASSET_LIST_READ_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'HR_MANAGER'];"), 'client role list missing');
  // the accountant is deliberately absent — payroll + reports, not assets
  assert(!cfg.match(/ASSET_LIST_READ_ROLES = \[[^\]]*ACCOUNTANT/), 'accountant must not hold the assets door');
  const perms = read('src/lib/hr/permissions.ts');
  assert(perms.includes("'hr.asset.manage': ['HR_MANAGER', 'STORE_OWNER']"), 'server guard key drifted');
});

check('/hr/assets: the landing seeds lazily, mirrors, and stays honest', () => {
  const page = read('src/app/(shell)/hr/assets/page.tsx');
  assert(page.match(/useState\(\(\) => readParam\('storeId'\)\)/), 'storeId seed not a lazy initializer');
  assert(page.match(/useState\(\(\) => readParam\('overdue'\) === '1'\)/), 'overdue seed not a lazy initializer');
  assert(page.includes("params.set('overdue', '1')"), 'overdue not sent to the API');
  assert(page.includes('window.history.replaceState(null'), 'URL mirror missing');
  assert(page.includes('data-testid="hr-assets-overdue-toggle"'), 'toggle missing');
  assert(page.includes('from link'), '(from link) chip missing');
  assert(page.includes('data-testid="hr-assets-store-notice"'), 'store-scope notice missing');
  assert(page.includes('the server never widens scope on request alone'), 'honesty wording missing');
  assert(page.includes('data-testid="hr-assets-count"'), 'assignment count missing');
});

check('the new test file pins all three layers', () => {
  const t = read('src/tests/assets-door-v2114.test.ts');
  assert(t.includes("listAssets(ORG_SESSION, { overdue: true })"), 'service pins missing');
  assert(t.includes('buildOverdueAssetsHref'), 'builder pins missing');
  assert(t.includes("src('src/app/(shell)/hr/assets/page.tsx')"), 'page pin missing');
  assert(t.includes('ASSET_LIST_READ_ROLES'), 'role pins missing');
});

check('the v2.113.0 panel pin rides the renamed gate (honest re-anchor)', () => {
  const t = read('src/tests/panel-doors-v2113.test.ts');
  assert(t.includes('/if \\(docs > 0 && canOpenDocs\\) \\{/'), 're-anchor missing');
  assert(t.includes('v2.114.0 re-anchor'), 're-anchor comment missing');
});

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
