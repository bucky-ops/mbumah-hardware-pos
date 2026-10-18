#!/usr/bin/env node
// v2.118.0 verification — "The ledger files its copy".
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
check('version: package.json leads 2.118.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.118.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.118.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.118.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-118-0'], 'verify script entry missing');
});

check('whats-new: 2.118.0 leads the feed with the export story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.118.0'");
  assert(head > -1, 'no 2.118.0 entry');
  assert(head < wn.indexOf("version: '2.117.0'"), '2.118.0 does not lead');
  assert(wn.includes('The ledger files its copy'), 'title missing');
});

check('changelog: [2.118.0] section leads with Added/Changed/Security', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.118.0]');
  assert(head > -1, 'no [2.118.0] section');
  assert(head < cl.indexOf('## [2.117.0]'), '[2.118.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.117.0]'));
  for (const h of ['### Added', '### Changed', '### Security']) {
    assert(section.includes(h), `${h} missing`);
  }
  assert(!/[\u4e00-\u9fff]/.test(section), 'CJK characters leaked into the changelog');
});

// ── the export door (the round's core) ─────────────────────────────────────
check('serializer: pure, self-contained, RFC 4180, CRLF', () => {
  const lib = read('src/lib/hr/discipline-ledger-csv.ts');
  assert(lib.includes('export function buildAccessLedgerCsv'), 'buildAccessLedgerCsv missing');
  assert(lib.includes('export function escapeLedgerCsvCell'), 'escapeLedgerCsvCell missing');
  assert(lib.includes('export function ledgerEventLabel'), 'ledgerEventLabel missing');
  assert(lib.includes("denied ? 'DENIED' : 'OPEN'"), 'the event label must ride the boolean');
  assert(lib.includes("if (/[\",\\r\\n]/.test(s))"), 'quote-on-need changed');
  assert(lib.includes('replace(/"/g, \'""\')'), 'embedded quotes must double');
  assert(lib.includes("lines.join('\\r\\n') + '\\r\\n'"), 'CRLF terminator changed');
});

check('serializer: the column set is the content-free contract', () => {
  const lib = read('src/lib/hr/discipline-ledger-csv.ts');
  for (const h of ['when_iso', 'event', 'who', 'case_id', 'case_employee']) {
    assert(lib.includes(`'${h}',`), `header ${h} missing`);
  }
  // structural content-freedom: search the CODE, not the contract's own
  // comment (the comment names "description" to explain why there is none)
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!code.includes('description'), 'a description surface appeared in the serializer code');
  assert(!code.includes('resolutionNotes'), 'a resolutionNotes surface appeared in the serializer code');
  const row = lib.slice(lib.indexOf('export interface AccessLedgerCsvRow'), lib.indexOf('const CSV_HEADERS'));
  assert(!/description|resolutionNotes/i.test(row), 'AccessLedgerCsvRow must have no content fields');
});

check('page: the ledger toolbar wears the CSV door with honest manners', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('aria-label="Export access ledger as CSV"'), 'aria label missing');
  assert(page.includes('data-testid="hr-discipline-ledger-csv"'), 'testid missing');
  assert(page.includes("title=\"Only who, when, and which case are exported"), 'the honest title is missing');
  assert(page.includes('disabled={ledgerVisible.length === 0}'), 'the button must disable on an empty filtered set');
  assert(page.includes('a.download = `access-ledger-${new Date().toISOString().slice(0, 10)}.csv`;'), 'filename contract changed');
  // the export maps the FILTERED rows
  const fn = page.slice(page.indexOf('const exportLedgerCsv'), page.indexOf('return ('));
  assert(fn.includes('ledgerVisible.map'), 'the export must map ledgerVisible (the filtered rows)');
  assert(!/[^V]ledger\.map/.test(fn), 'the export must not map the unfiltered ledger');
  for (const field of ['timestamp: r.timestamp', 'denied: r.denied', 'userName: r.userName', 'caseId: r.caseId', 'employeeName: r.employeeName']) {
    assert(fn.includes(field), `the export must carry ${field}`);
  }
  assert(!fn.includes('description'), 'the export must never touch a description field');
});

check('page: the counts line names denials with its own honest span', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('data-testid="hr-discipline-ledger-denied-count"'), 'denied-count span missing');
  assert(page.includes('text-rose-600 dark:text-rose-400'), 'the rose tint is missing');
  assert(page.includes('Denied attempts in this window'), 'the denied tooltip is missing');
  assert(page.includes('clampLedgerWindow(ledgerDays)'), 'the counts line must keep showing the clamped window');
  // the v2.117 ledger card still stands
  assert(page.includes('data-testid="hr-discipline-ledger"'), 'the ledger card disappeared');
  assert(page.includes('data-testid="hr-discipline-ledger-counts"'), 'the counts testid disappeared');
});

check('desk: both CSV doors coexist (case list v2.115 + ledger v2.118)', () => {
  const page = read('src/app/(shell)/hr/discipline/page.tsx');
  assert(page.includes('aria-label="Export case list as CSV"'), 'the case-list CSV door disappeared');
  assert(page.includes('aria-label="Export access ledger as CSV"'), 'the ledger CSV door is missing');
  assert(page.includes("discipline-cases-${new Date().toISOString().slice(0, 10)}.csv"), 'the case-list filename changed');
  assert(page.includes("access-ledger-${new Date().toISOString().slice(0, 10)}.csv"), 'the ledger filename changed');
});

check('desk: the v2.115 list serializer is untouched by this round', () => {
  const listCsv = read('src/lib/hr/discipline-list-csv.ts');
  assert(listCsv.includes("'case_id',"), 'the list headers moved');
  assert(listCsv.includes("'expires_on',"), 'the list headers moved');
  assert(!listCsv.includes('access-ledger'), 'the list serializer must not know the ledger file');
});

check('tests: the v2.118 suite pins the export end to end', () => {
  const t = read('src/tests/discipline-v2118.test.ts');
  assert(t.includes('buildAccessLedgerCsv'), 'the suite must pin the serializer');
  assert(t.includes("toBe('when_iso,event,who,case_id,case_employee')"), 'the header row must be pinned exactly');
  assert(t.includes("'Owner, \"Mbumah\"'") && t.includes('"Nduta, Grace"'), 'the RFC 4180 escaping must be pinned');
  assert(t.includes('ledgerVisible.map'), 'the filtered-mapping contract must be pinned');
  assert(t.includes("aria-label=\"Export access ledger as CSV\""), 'the button contract must be pinned');
});

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
