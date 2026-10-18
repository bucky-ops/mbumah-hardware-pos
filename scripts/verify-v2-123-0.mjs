#!/usr/bin/env node
// v2.123.0 verification — "the sweep shows its hand".
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
check('version: package.json leads 2.123.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.123.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.123.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.123.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-123-0'], 'verify script entry missing');
});

check('whats-new: 2.123.0 leads the feed with the dry-run story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.123.0'");
  assert(head > -1, 'no 2.123.0 entry');
  assert(head < wn.indexOf("version: '2.122.0'"), '2.123.0 does not lead');
  assert(wn.includes('The sweep shows its hand'), 'title missing');
  assert(wn.includes('waiting behind the hold'), 'held-backlog vocabulary missing from bullets');
  assert(wn.includes('up to 500 rows per night'), 'pacing disclosure missing from bullets');
});

check('changelog: [2.123.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.123.0]');
  assert(head > -1, 'no [2.123.0] section');
  assert(head < cl.indexOf('## [2.122.0]'), '[2.123.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.122.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the service (the dry run + the single source of truth) ─────────────────
check('lib: the three where-builders exist and pin the sweep criteria', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  for (const fn of ['applicantSweepWhere', 'disciplinarySweepWhere', 'attendanceSweepWhere']) {
    assert(lib.includes(`export function ${fn}(`), `${fn} missing`);
  }
  assert(lib.includes("status: { in: ['REJECTED', 'WITHDRAWN'] }"), 'applicant statuses missing');
  assert(lib.includes("status: { in: ['RESOLVED', 'DISMISSED', 'EXPIRED'] }"), 'disciplinary statuses missing');
  assert(lib.includes('sourceDevice: { not: null }'), 'attendance device guard missing');
});

check('lib: the redaction marker is ONE shared constant riding every clause', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes("const RETENTION_REDACTED = 'REDACTED (retention)';"), 'shared constant missing');
  assert(lib.includes('fullName: { not: RETENTION_REDACTED }'), 'applicant clause not guarded');
  assert(lib.includes('description: { not: RETENTION_REDACTED }'), 'disciplinary clause not guarded');
  const inline = lib.match(/not: 'REDACTED \(retention\)'/g);
  assert(!inline, `inline redaction strings linger (${inline ? inline.length : 0}) — use the constant`);
});

check('lib: the executing sweep consumes the SAME builders the preview counts', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes('where: applicantSweepWhere(now, orgStoreIds)'), 'sweep applicant where not shared');
  assert(lib.includes('where: disciplinarySweepWhere(now, organizationId)'), 'sweep disciplinary where not shared');
  assert(lib.includes('where: attendanceSweepWhere(now, organizationId)'), 'sweep attendance where not shared');
  assert(lib.includes('db.applicant.count({ where: applicantSweepWhere(now, orgStoreIds) })'), 'preview applicant count not shared');
  assert(lib.includes('db.disciplinaryCase.count({ where: disciplinarySweepWhere(now, organizationId) })'), 'preview disciplinary count not shared');
  assert(lib.includes('db.attendanceRecord.count({ where: attendanceSweepWhere(now, organizationId) })'), 'preview attendance count not shared');
});

check('lib: the dry run counts and changes nothing; held scopes keep their backlog', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes('export async function previewRetentionSweep('), 'preview missing');
  assert(lib.includes('sweepable: number'), 'sweepable field missing');
  assert(lib.includes('export function describeSweepPreview('), 'humaniser missing');
  assert(lib.includes("'nothing to sweep'"), 'zero-state label missing');
  assert(lib.includes('waiting behind the hold'), 'held-backlog label missing');
  assert(lib.includes('sweepLabel: describeSweepPreview(sweepable, held)'), 'label not folded server-side');
  assert(lib.includes('sweepableTotal: views.filter((v) => !v.held).reduce('), 'total must sum over NON-held scopes');
});

// ── the route ───────────────────────────────────────────────────────────────
check('route: the dry run rides the guarded desk read', () => {
  const route = read('src/app/api/hr/privacy/retention/route.ts');
  assert(route.includes("hrGuard('hr.report.branch', VIEW_ROLES)"), 'guard missing');
  assert(route.includes("['HR_MANAGER', 'STORE_OWNER', 'BRANCH_MANAGER']"), 'view trio missing');
  assert(route.includes('listRetentionPolicies(session)'), 'desk fold missing');
  assert(route.includes('sweepableTotal: desk.sweepableTotal'), 'total not surfaced');
});

// ── the page ────────────────────────────────────────────────────────────────
check('page: a Next sweep column renders the server-computed label per scope', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('data-testid="hr-retention-preview-col"'), 'column testid missing');
  assert(page.includes('Next sweep'), 'column title missing');
  assert(page.includes('hr-retention-sweep-${p.scope}'), 'per-row testid missing');
  assert(page.includes('{p.sweepLabel}'), 'label not rendered');
  assert(page.includes("Dry run — counts rows matching the sweep's own criteria; nothing is changed."), 'dry-run disclosure missing');
});

check('page: the held backlog wears amber; tooltips disclose both truths', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes("p.held && p.sweepable > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"), 'amber ternary missing');
  assert(page.includes('A hold stands — these rows wait until a settings manager releases the scope.'), 'held tooltip missing');
  assert(page.includes('Dry-run count — what the next nightly run would anonymise; nothing is changed.'), 'preview tooltip missing');
});

check('page: the backlog strip answers with honest zero and pacing states', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('data-testid="hr-privacy-retention-sweep-count"'), 'strip testid missing');
  assert(page.includes('Counting the sweep backlog…'), 'loading state missing');
  assert(page.includes('would be anonymised on the next nightly run'), 'backlog sentence missing');
  assert(page.includes('the sweep takes up to 500 per night'), 'pacing disclosure missing');
  assert(page.includes('nothing to sweep tonight — every scope sits inside its window'), 'honest zero missing');
  assert(page.includes('sweepableTotal: number;'), 'DTO field missing');
});

check('page: still never imports the service module — labels ride the DTO', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(!page.includes("from '@/lib/hr/data-protection'"), 'page imports the db-backed module');
  assert(page.includes('p.windowLabel'), 'windowLabel render missing');
});

// ── tests + prior anchors ──────────────────────────────────────────────────
check('tests: the v2.123.0 suite exists and pins the contract', () => {
  const t = read('src/tests/retention-sweep-preview-v2123.test.ts');
  for (const s of [
    'previewRetentionSweep — the dry run changes nothing',
    'the where-builders — one source of truth for "in scope"',
    'sweepableTotal sums over NON-held scopes only',
    'a held scope still reports its backlog',
    "the page still never imports the service module",
  ]) {
    assert(t.includes(s), `pin missing: ${s}`);
  }
});

check('tests: the unread counter re-anchored for the 2.123.0-fed feed', () => {
  const t = read('src/tests/console-changelog.test.ts');
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(12)"), '2.110.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(13)"), '2.109.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(14)"), '2.108.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(45)"), '2.77.0 anchor missing');
});

check('prior anchors: the three posture cards stand beside the dry run', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('Consent records (Data Protection Act posture)'), 'consent card missing');
  assert(page.includes('Erasure requests (Data Protection Act posture)'), 'erasure card missing');
  assert(page.includes('Retention &amp; legal holds (Data Protection Act posture)'), 'retention card missing');
  assert(page.includes('data-testid="hr-privacy-retention-hold-count"'), 'hold strip missing');
});

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
