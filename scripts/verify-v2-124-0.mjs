#!/usr/bin/env node
// v2.124.0 verification — "the broom answers the desk".
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
check('version: package.json leads 2.124.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.124.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.124.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.124.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-124-0'], 'verify script entry missing');
});

check('whats-new: 2.124.0 leads the feed with the door story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.124.0'");
  assert(head > -1, 'no 2.124.0 entry');
  assert(head < wn.indexOf("version: '2.123.0'"), '2.124.0 does not lead');
  assert(wn.includes('The broom answers the desk'), 'title missing');
  assert(wn.includes('Sweep now'), 'door vocabulary missing from bullets');
  assert(wn.includes('asks twice'), 'two-step disclosure missing from bullets');
});

check('changelog: [2.124.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.124.0]');
  assert(head > -1, 'no [2.124.0] section');
  assert(head < cl.indexOf('## [2.123.0]'), '[2.124.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.123.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the route (the manual run) ─────────────────────────────────────────────
check('route: the manual run rides the nightly function with actor attribution', () => {
  const route = read('src/app/api/hr/privacy/retention-sweep/route.ts');
  assert(route.includes("hrGuard('hr.report.branch')"), 'read guard missing');
  assert(route.includes("code: 'DECISION_FORBIDDEN'"), 'decision gate missing');
  assert(route.includes('Only settings managers can run the retention sweep early.'), 'refusal message missing');
  assert(route.includes('canDecideErasure(session.role)'), 'canDecide key missing');
  assert(route.includes('runHrRetentionSweep(session.organizationId, session.userId)'), 'must call the nightly fn with actor');
  assert(route.includes('sweptAt: new Date().toISOString()'), 'sweptAt missing');
  assert(route.includes('toErrorResponse(error)'), 'error boundary missing');
});

check('service: the executing truth stays the nightly function itself', () => {
  const lib = read('src/lib/hr/data-protection.ts');
  assert(lib.includes('export async function runHrRetentionSweep('), 'sweep fn missing');
  assert(lib.includes("action: 'RETENTION_APPLICANTS_ANONYMISED'"), 'applicant audit missing');
  assert(lib.includes("action: 'RETENTION_DISCIPLINARY_ANONYMISED'"), 'disciplinary audit missing');
  assert(lib.includes("action: 'RETENTION_ATTENDANCE_ANONYMISED'"), 'attendance audit missing');
  assert(lib.includes('where: applicantSweepWhere(now, orgStoreIds)'), 'shared builders must stay');
});

// ── the pure humaniser ─────────────────────────────────────────────────────
check('pure: describeSweepOutcome is client-safe and degrades honestly', () => {
  const pure = read('src/lib/hr/sweep-outcome.ts');
  assert(!pure.includes('@/lib/db'), 'pure module must not import the db client');
  assert(pure.includes('export function describeSweepOutcome('), 'humaniser missing');
  assert(pure.includes('Sweep ran — nothing to anonymise; every scope sits inside its window.'), 'zero truth missing');
  assert(pure.includes('Held scopes were skipped'), 'held-skip disclosure missing');
  assert(pure.includes('nothing readable'), 'garbage truth missing');
  assert(pure.includes('cannot read'), 'shape truth missing');
});

// ── the page (the door) ────────────────────────────────────────────────────
check('page: Sweep now… renders only for deciders and arms the rose confirm', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('data-testid="hr-retention-sweep-now"'), 'button testid missing');
  assert(page.includes('Sweep now…'), 'button label missing');
  assert(page.includes('data-testid="hr-retention-sweep-arm"'), 'arm testid missing');
  assert(page.includes('Confirm sweep'), 'confirm missing');
  assert(page.includes('would be anonymised immediately.'), 'backlog quote missing');
  assert(page.includes('retention !== null && retention.canDecide'), 'decider gate missing');
});

check('page: the honest zero has its own arm-row truth; arms cross-disarm', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('Nothing is in scope — held scopes are skipped, in-window rows are untouched.'), 'zero truth missing');
  assert(page.includes('setSweepArm(true); setReleaseArm(null); setRetentionNote(null)'), 'sweep arm must disarm release');
  assert(page.includes('setReleaseArm(p.scope); setSweepArm(false); setRetentionNote(null)'), 'release arm must disarm sweep');
});

check('page: the run posts to the new route, reports in the card, refetches the desk', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes("'/api/hr/privacy/retention-sweep'"), 'route URL missing');
  assert(page.includes('describeSweepOutcome(res.results)'), 'outcome render missing');
  assert(page.includes("from '@/lib/hr/sweep-outcome'"), 'pure humaniser import missing');
  assert(page.includes('await loadRetention()'), 'desk refetch missing');
  assert(!page.includes("from '@/lib/hr/data-protection'"), 'page must never import the db-backed module');
});

// ── tests + prior anchors ──────────────────────────────────────────────────
check('tests: the v2.124.0 suite exists and pins the contract', () => {
  const t = read('src/tests/retention-sweep-now-v2124.test.ts');
  for (const s of [
    'the pure humaniser',
    'the manual run rides the cron',
    'the door on the desk',
    'never a fake success',
    'the page still never imports the db-backed service module',
  ]) {
    assert(t.includes(s), `pin missing: ${s}`);
  }
});

check('tests: the unread counter re-anchored for the 2.124.0-fed feed', () => {
  const t = read('src/tests/console-changelog.test.ts');
  assert(t.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(13)"), '2.110.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.109.0')).toBe(14)"), '2.109.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.108.0')).toBe(15)"), '2.108.0 anchor missing');
  assert(t.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(46)"), '2.77.0 anchor missing');
});

check('prior anchors: the dry run, the holds, and the three cards all stay', () => {
  const page = read('src/app/(shell)/hr/reports/page.tsx');
  assert(page.includes('data-testid="hr-retention-preview-col"'), 'dry-run column missing');
  assert(page.includes('data-testid="hr-privacy-retention-sweep-count"'), 'backlog strip missing');
  assert(page.includes('nothing to sweep tonight — every scope sits inside its window'), 'honest zero missing');
  assert(page.includes('Retention &amp; legal holds (Data Protection Act posture)'), 'retention card missing');
  assert(page.includes('data-testid="hr-privacy-retention-hold-count"'), 'hold strip missing');
});

// ── verdict ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
