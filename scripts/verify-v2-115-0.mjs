#!/usr/bin/env node
// v2.115.0 verification — "The restricted read leaves a trace".
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
check('version: package.json leads 2.115.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.115.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.115.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.115.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-115-0'], 'verify script entry missing');
});

check('whats-new: 2.115.0 leads the feed with the traceability story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.115.0'");
  assert(head > -1, 'no 2.115.0 entry');
  assert(head < wn.indexOf("version: '2.114.0'"), '2.115.0 does not lead');
  assert(wn.includes('The restricted read leaves a trace'), 'title missing');
});

check('changelog: [2.115.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.115.0]');
  assert(head > -1, 'no [2.115.0] section');
  assert(head < cl.indexOf('## [2.114.0]'), '[2.115.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.114.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  // the changelog itself is an artifact the auditors read: no stray CJK
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the audit trail (the round's core) ─────────────────────────────────────
check('service: granted restricted reads write DISCIPLINARY_RESTRICTED_VIEWED', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  const m = s.match(/action: 'DISCIPLINARY_RESTRICTED_VIEWED',[\s\S]*?\}\);/);
  assert(m, 'VIEWED action missing');
  // metadata carries the flag, never case content
  assert(m[0].includes("confidentiality: 'RESTRICTED'"), 'metadata flag missing');
  assert(!m[0].includes('description'), 'metadata must not carry the description');
});

check('service: denied attempts write DISCIPLINARY_RESTRICTED_DENIED before the 403', () => {
  const s = read('src/lib/hr/discipline-service.ts');
  const m = s.match(/action: 'DISCIPLINARY_RESTRICTED_DENIED',[\s\S]*?\}\);/);
  assert(m, 'DENIED action missing');
  assert(m[0].includes("confidentiality: 'RESTRICTED'"), 'metadata flag missing');
  assert(!m[0].includes('description'), 'metadata must not carry the description');
  const denied = s.indexOf("action: 'DISCIPLINARY_RESTRICTED_DENIED'");
  const thrown = s.indexOf("'CONFIDENTIALITY_RESTRICTED'");
  assert(thrown > -1, 'the 403 disappeared');
  assert(denied < thrown, 'the audit must be written BEFORE the throw (a throw skips trailing writes)');
  // the allow-list itself is unchanged
  assert(s.includes("['HR_MANAGER', 'STORE_OWNER', 'SUPER_ADMIN'].includes(session.role)"), 'allow-list changed');
});

check('route guard: the discipline routes keep their key (no widening)', () => {
  const route = read('src/app/api/hr/discipline/[id]/route.ts');
  assert(route.includes("hrGuard('hr.discipline.manage')"), 'guard key changed');
});

// ── the CSV door (description-free by construction) ────────────────────────
check('csv: columns are exactly the list payload — no description column', () => {
  const csv = read('src/lib/hr/discipline-list-csv.ts');
  const headers = ['case_id', 'employee', 'type', 'severity', 'status', 'confidentiality', 'issued_on', 'expires_on'];
  for (const h of headers) assert(csv.includes(`'${h}'`), `column ${h} missing`);
  assert(!csv.includes("'description'"), 'a description column must never exist');
  assert(!csv.includes('resolutionNotes'), 'resolution notes must never export');
  assert(csv.includes("lines.join('\\r\\n')"), 'RFC 4180 CRLF endings missing');
});

check('page: the CSV door exports the filtered list and says so', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes("aria-label=\"Export case list as CSV\""), 'csv button aria missing');
  assert(page.includes('discipline-cases-'), 'filename missing');
  assert(page.includes('buildDisciplineListCsv('), 'serializer not wired');
  assert(page.includes('visible.map((c) => ({'), 'exports the FILTERED list');
  assert(page.includes('Descriptions are never exported'), 'title honesty missing');
});

// ── the desk maturity (search, type filter, chips, counts) ─────────────────
check('page: search + type filter narrow the loaded list client-side', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('aria-label="Search cases by employee"'), 'search aria missing');
  assert(page.includes('aria-label="Filter by type"'), 'type filter aria missing');
  assert(page.includes("typeFilter !== 'ALL'"), 'type filter not applied');
  assert(page.includes("No cases match the current filters."), 'filtered-empty state missing');
  assert(page.includes('No disciplinary cases recorded.'), 'true-zero state lost');
});

check('page: the counts line, the restricted chip, and the countdown chip exist', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('data-testid="hr-discipline-counts"'), 'counts line missing');
  assert(page.includes('data-testid="hr-discipline-restricted-chip"'), 'restricted chip missing');
  assert(page.includes('data-testid="hr-discipline-expires-soon"'), 'countdown chip missing');
  // the boundary arithmetic lives in the pure, unit-tested home
  assert(page.includes("from '@/lib/hr/discipline-ui'"), 'countdown helper must ride the pure lib');
});

check('ui-lib: the 14-day window is pure, guarded, and OPEN-only', () => {
  const lib = read('src/lib/hr/discipline-ui.ts');
  assert(lib.includes('EXPIRES_SOON_DAYS = 14'), 'the 14-day window moved without a decision');
  assert(lib.includes('days < 0 || days > EXPIRES_SOON_DAYS'), 'past-due guard missing');
  assert(lib.includes("status !== 'OPEN'"), 'non-OPEN countdown possible');
  assert(lib.includes("'expires today'"), 'the same-day label missing');
});

check('page: the detail dialog tells the truth about logging', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('data-testid="hr-discipline-audit-note"'), 'audit note missing');
  assert(page.includes('Viewing this restricted record is logged to the audit trail.'), 'note text missing');
});

// ── the tests exist and pin the contract ───────────────────────────────────
check('tests: discipline-v2115.test.ts pins the service, csv, and page contracts', () => {
  const t = read('src/tests/discipline-v2115.test.ts');
  assert(t.includes('DISCIPLINARY_RESTRICTED_VIEWED'), 'VIEWED pin missing');
  assert(t.includes('DISCIPLINARY_RESTRICTED_DENIED'), 'DENIED pin missing');
  assert(t.includes('buildDisciplineListCsv'), 'csv pins missing');
  assert(t.includes('expiresSoonLabel'), 'countdown pins missing');
  assert(t.includes("src('src/app/(shell)/hr/discipline/page.tsx')"), 'page pin missing');
});

check('tests: the unread counter rode the new feed head (re-anchored)', () => {
  const t = read('src/tests/console-changelog.test.ts');
  assert(t.includes("whatsNewUnreadCount('2.110.0')).toBe(4)"), 'counter not re-anchored for 2.115.0');
  assert(t.includes('2.115.0'), 're-anchor comment missing');
});

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
