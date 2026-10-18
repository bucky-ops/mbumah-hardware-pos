#!/usr/bin/env node
// v2.116.0 verification — "The trail reads back".
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
check('version: package.json leads 2.116.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.116.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.116.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.116.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-116-0'], 'verify script entry missing');
});

check('whats-new: 2.116.0 leads the feed with the read-back story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.116.0'");
  assert(head > -1, 'no 2.116.0 entry');
  assert(head < wn.indexOf("version: '2.115.0'"), '2.116.0 does not lead');
  assert(wn.includes('The trail reads back'), 'title missing');
});

check('changelog: [2.116.0] section leads with Added/Changed', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.116.0]');
  assert(head > -1, 'no [2.116.0] section');
  assert(head < cl.indexOf('## [2.115.0]'), '[2.116.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.115.0]'));
  for (const h of ['### Added', '### Changed']) {
    assert(section.includes(h), `${h} missing`);
  }
  // the changelog itself is an artifact the auditors read: no stray CJK
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the trail read-back (the round's core) ─────────────────────────────────
check('service: the trail is read BEFORE the current view writes its event', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  const readBack = s.indexOf('db.auditLog.findMany');
  // lastIndexOf: the FIRST "VIEWED" occurrence is the list's groupBy where
  // clause (listCases sits earlier in the file) — the detail write is last.
  const write = s.lastIndexOf("action: 'DISCIPLINARY_RESTRICTED_VIEWED'");
  assert(readBack > -1, 'the read-back query is missing');
  assert(write > -1, 'the v2.115.0 write disappeared');
  assert(readBack < write, 'the trail must be read BEFORE the in-flight write');
  // the comment names the semantics
  assert(s.includes('never the in-flight'), 'the before-you semantics are undocumented');
});

check('service: the trail query admits exactly the two confidentiality actions', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  assert(s.includes('action: { in: [...RESTRICTED_TRAIL_ACTIONS] }'), 'the query must ride the pure constant');
  const ui = read('src/lib/hr/discipline-ui.ts');
  assert(ui.includes("'DISCIPLINARY_RESTRICTED_VIEWED'"), 'VIEWED missing from the constant');
  assert(ui.includes("'DISCIPLINARY_RESTRICTED_DENIED'"), 'DENIED missing from the constant');
});

check('service: the last viewer resolves to a name, never a raw id in the DTO', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  assert(s.includes('db.user.findUnique'), 'name resolution missing');
  assert(s.includes('lastViewedByName'), 'the name field is missing');
  assert(s.includes("select: { name: true }"), 'the select must be minimal (name only)');
});

check('service: the deny path and the allow-list are unchanged', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  assert(s.includes("action: 'DISCIPLINARY_RESTRICTED_DENIED'"), 'the DENIED trace disappeared');
  const denied = s.indexOf("action: 'DISCIPLINARY_RESTRICTED_DENIED'");
  const thrown = s.indexOf("'CONFIDENTIALITY_RESTRICTED'");
  assert(denied < thrown, 'the denial must be audited BEFORE the 403');
  assert(s.includes("['HR_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'].includes(session.role)"), 'allow-list changed');
  // the deny path never reads the trail back (no trail rides a 403)
  const denyBlock = s.slice(denied, thrown);
  assert(!denyBlock.includes('db.auditLog.findMany'), 'the deny path must not query the trail');
});

check('service: the list stamps restricted rows from ONE grouped count', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  assert(s.includes('db.auditLog.groupBy'), 'the grouped count is missing');
  assert(s.includes("action: 'DISCIPLINARY_RESTRICTED_VIEWED'"), 'the count must ask VIEWED only');
  assert(s.includes('counts.get(d.id) ?? 0'), 'a restricted row with no trail must read 0, honestly');
  assert(s.includes('restrictedViews'), 'the list DTO field is missing');
});

check('ui-lib: the fold is pure, order-independent, and null-honest', () => {
  const lib = read('src/lib/hr/discipline-ui.ts');
  assert(lib.includes('export function buildAccessTrail'), 'buildAccessTrail missing');
  assert(lib.includes('.sort('), 'input order must not matter');
  assert(lib.includes('RESTRICTED_TRAIL_ACTIONS'), 'the action constant moved');
  assert(lib.includes('if (trail.length === 0) return null;'), 'empty input must be honestly null');
});

check('page: the detail dialog reads the trail back and names the first view', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('data-testid="hr-discipline-access-trail"'), 'trail block missing');
  assert(page.includes('data-testid="hr-discipline-trail-first"'), 'first-view state missing');
  assert(page.includes('Last opened by'), 'the who line is missing');
  assert(page.includes('prior '), 'the count line is missing');
  assert(page.includes('denied '), 'the denied line is missing');
  assert(page.includes('This is the first logged view of this restricted record.'), 'the honest first-view copy is missing');
});

check('page: restricted list rows wear the trail chip with an honest zero', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('data-testid="hr-discipline-trail-chip"'), 'trail chip missing');
  assert(page.includes('c.restrictedViews ?? 0'), 'the zero must be honest');
  assert(page.includes('Prior restricted opens recorded in the audit trail'), 'the chip title is missing');
});

check('csv: the description-free contract survives — no trail columns invented', () => {
  const csv = read('src/lib/hr/discipline-list-csv.ts');
  assert(!csv.includes('restrictedViews'), 'the CSV must not grow a trail column');
  assert(!csv.includes('accessTrail'), 'the CSV must not grow a trail column');
  assert(!csv.includes("'description'"), 'a description column must never exist');
});

check('route guard: the discipline routes keep their key (no widening)', () => {
  const route = read('src/app/api/hr/discipline/[id]/route.ts');
  assert(route.includes("hrGuard('hr.discipline.manage')"), 'guard key changed');
});

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
