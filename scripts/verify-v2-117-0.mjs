#!/usr/bin/env node
// v2.117.0 verification — "The ledger reads the room".
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
check('version: package.json leads 2.117.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.117.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.117.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.117.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-117-0'], 'verify script entry missing');
});

check('whats-new: 2.117.0 leads the feed with the ledger story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.117.0'");
  assert(head > -1, 'no 2.117.0 entry');
  assert(head < wn.indexOf("version: '2.116.0'"), '2.117.0 does not lead');
  assert(wn.includes('The ledger reads the room'), 'title missing');
});

check('changelog: [2.117.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.117.0]');
  assert(head > -1, 'no [2.117.0] section');
  assert(head < cl.indexOf('## [2.116.0]'), '[2.117.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.116.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the ledger (the round's core) ──────────────────────────────────────────
check('service: the ledger answers the SAME employee scope as the list', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  const fn = s.slice(s.indexOf('export async function listRestrictedAccess'), s.indexOf('async function loadCase'));
  assert(fn.includes('employeeScopeWhere(session)'), 'the ledger must ride the list scope');
  assert(fn.includes('deletedAt: null'), 'deleted cases must not answer');
  // zero visible cases short-circuits before the audit query
  const early = fn.indexOf('if (cases.length === 0) return [];');
  const audit = fn.indexOf('db.auditLog.findMany');
  assert(early > -1 && audit > -1 && early < audit, 'the empty-scope short-circuit must precede the audit query');
});

check('service: the window is clamped and the payload capped', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  const fn = s.slice(s.indexOf('export async function listRestrictedAccess'), s.indexOf('async function loadCase'));
  assert(fn.includes('clampLedgerWindow(opts.days)'), 'the window must ride the clamp');
  assert(fn.includes('take: ACCESS_LEDGER_LIMIT'), 'the row cap is missing');
  const lib = read('src/lib/hr/discipline-ui.ts');
  assert(lib.includes('ACCESS_LEDGER_MAX_DAYS = 90'), 'the hard cap moved without a decision');
  assert(lib.includes('return Math.min(Math.floor(n), ACCESS_LEDGER_MAX_DAYS)'), 'the clamp arithmetic changed');
  assert(lib.includes('if (!Number.isFinite(n) || n <= 0) return ACCESS_LEDGER_WINDOW_DAYS;'), 'the default fallback changed');
});

check('ui-lib: the fold joins names honestly and filters unrelated actions', () => {
  const lib = read('src/lib/hr/discipline-ui.ts');
  assert(lib.includes('export function foldAccessLedger'), 'foldAccessLedger missing');
  assert(lib.includes("denied: e.action === 'DISCIPLINARY_RESTRICTED_DENIED'"), 'the denied flag moved');
  assert(lib.includes('export function relativeTimeLabel'), 'relativeTimeLabel missing');
  assert(lib.includes('if (diff <= 0) return \'just now\';'), 'future timestamps must clamp to just now');
  assert(lib.includes('Math.round((startOfNow - startOfThen) / DAY_MS)'), 'the day arithmetic must stay calendar-day');
});

check('route: the ledger keeps the discipline guard key (no widening)', () => {
  const route = read('src/app/api/hr/discipline/restricted-access/route.ts');
  assert(route.includes("hrGuard('hr.discipline.manage')"), 'guard key changed');
  assert(route.includes('listRestrictedAccess'), 'the service is not wired');
  assert(route.includes("searchParams.get('days')"), 'the window param is not wired');
});

check('page: the desk wears the ledger card with honest manners', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  for (const tid of [
    'hr-discipline-ledger',
    'hr-discipline-ledger-counts',
    'hr-discipline-ledger-open-chip',
    'hr-discipline-ledger-denied-chip',
  ]) {
    assert(page.includes(`data-testid="${tid}"`), `${tid} missing`);
  }
  assert(page.includes('aria-label="Ledger window"'), 'window selector missing');
  assert(page.includes('aria-label="Filter ledger by action"'), 'action filter missing');
  assert(page.includes('No restricted access recorded in this window.'), 'true-empty state missing');
  assert(page.includes('No events match the current filter.'), 'filtered-empty state missing');
  assert(page.includes('Open case from ledger'), 'the deep link is missing');
  assert(page.includes('an unknown user'), 'the honest name fallback is missing');
  // the v2.116.0 trail block still stands beside it
  assert(page.includes('data-testid="hr-discipline-access-trail"'), 'the trail block disappeared');
});

check('page: the ledger reads the clamped window in its counts line', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('clampLedgerWindow(ledgerDays)'), 'the counts line must show the CLAMPED window, not the raw param');
  assert(page.includes('restricted-access?days='), 'the ledger fetch is missing');
});

check('service: the ledger payload is content-free (no description path exists)', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  const fn = s.slice(s.indexOf('export async function listRestrictedAccess'), s.indexOf('async function loadCase'));
  assert(!fn.includes('description'), 'the ledger query must never touch the description');
  assert(fn.includes('select: { entityId: true, action: true, userId: true, timestamp: true }'), 'the audit select must stay minimal');
  const lib = read('src/lib/hr/discipline-ui.ts');
  const row = lib.slice(lib.indexOf('export interface LedgerRow'), lib.indexOf('export function foldAccessLedger'));
  assert(!/description|resolutionNotes/i.test(row), 'LedgerRow must have no content fields');
});

check('both read-backs coexist: single-case trail + cross-case ledger', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  assert(s.includes('buildAccessTrail'), 'the v2.116.0 trail read-back disappeared');
  assert(s.includes('foldAccessLedger'), 'the v2.117.0 ledger read-back is missing');
  // the deny path still never reads the trail back
  const denied = s.indexOf("action: 'DISCIPLINARY_RESTRICTED_DENIED'");
  const thrown = s.indexOf("'CONFIDENTIALITY_RESTRICTED'");
  assert(denied > -1 && thrown > -1 && denied < thrown, 'the deny-path contract changed');
  const denyBlock = s.slice(denied, thrown);
  assert(!denyBlock.includes('db.auditLog.findMany'), 'the deny path must not query the trail');
});

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
