#!/usr/bin/env node
// v2.130.0 verification — "the timeline files its copy".
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
check('version: package.json leads 2.130.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.130.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.130.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.130.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-130-0'], 'verify script entry missing');
});

check('whats-new: 2.130.0 leads the feed with the export story', () => {
  const wn = read('src/lib/whats-new.ts');
  const head = wn.indexOf("version: '2.130.0'");
  assert(head > -1, 'no 2.130.0 entry');
  assert(head < wn.indexOf("version: '2.129.0'"), '2.130.0 does not lead');
  assert(wn.includes('The timeline files its copy'), 'title missing');
  assert(wn.includes('Export CSV door'), 'the door missing from bullets');
  assert(wn.includes('error strip'), 'failure-speech missing from bullets');
});

check('changelog: [2.130.0] section leads with both beats', () => {
  const cl = read('CHANGELOG.md');
  const head = cl.indexOf('## [2.130.0]');
  assert(head > -1, 'no [2.130.0] section');
  assert(head < cl.indexOf('## [2.129.0]'), '[2.130.0] does not lead');
  const section = cl.slice(head, cl.indexOf('## [2.129.0]'));
  assert(section.includes('buildConsentTimelineCsv'), 'serializer missing');
  assert(section.includes('Loading-forever'), 'the fix missing');
  assert(section.includes('### Fixed'), 'Fixed section missing');
});

// ── the serializer: the third export-honesty beat ──────────────────────────
check('serializer: pure module, RFC 4180, exact header, content-free row type', () => {
  const s = read('src/lib/hr/consent-timeline-csv.ts');
  assert(s.includes('export function buildConsentTimelineCsv'), 'builder missing');
  assert(s.includes('export function escapeConsentCsvCell'), 'escaper missing');
  assert(s.includes('export function consentTimelineStateLabel'), 'state label missing');
  assert(s.includes('export function consentTimelineCsvFilename'), 'filename missing');
  // the exact header, pinned
  assert(
    s.includes("  'cycle',\n  'state',\n  'granted_at',\n  'withdrawn_at',\n  'stood_days',\n  'purpose',\n  'policy_version',\n  'employee_code',\n  'employee_name',"),
    'exact header missing',
  );
  // the confidentiality contract: no content field in the row interface
  const iface = s.slice(s.indexOf('export interface ConsentTimelineCsvRow'), s.indexOf('// Pinned by tests'));
  for (const forbidden of ['note', 'description', 'resolution', 'salary', 'amount', 'content']) {
    assert(!iface.toLowerCase().includes(forbidden), `row type carries a forbidden field: ${forbidden}`);
  }
  // CRLF + trailing ending + garbage-timestamp honesty
  assert(s.includes("join('\\r\\n') + '\\r\\n'"), 'CRLF discipline missing');
  assert(s.includes('Number.isNaN(d.getTime())'), 'garbage-timestamp guard missing');
  // standing leaves the cells empty — the state column derives, never free text
  assert(s.includes("return withdrawnAt ? 'WITHDRAWN' : 'STANDING';"), 'state derivation missing');
});

// ── the drawer door: the export rides the ledger's own identity ────────────
check('page: the CSV door wears the export-honesty manners', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('data-testid="hr-privacy-consent-history-csv"'), 'door testid missing');
  assert(s.includes('aria-label={`Export consent timeline CSV — ${historyPayload.employee.name}`}'), 'aria missing');
  assert(s.includes("Only who, when, and what purpose are exported — the ledger's own columns, never more."), 'honesty tooltip missing');
  assert(s.includes('{historyPayload.events.length > 0 ? ('), 'empty-ledger gate missing');
  assert(s.includes('buildConsentTimelineCsv(rows)'), 'serializer wiring missing');
  assert(s.includes('consentTimelineCsvFilename(historyPayload.employee.code)'), 'filename wiring missing');
  assert(s.includes('employeeCode: historyPayload.employee.code'), 'identity wiring missing');
  assert(s.includes("{ type: 'text/csv;charset=utf-8' }"), 'blob mime missing');
});

// ── the fix: the Privacy tab speaks its failures ────────────────────────────
check('page: three per-card error strips with retries and dark twins', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  for (const tid of ['hr-privacy-consent-error', 'hr-privacy-erasure-error', 'hr-privacy-retention-error']) {
    assert(s.includes(`data-testid="${tid}"`), `missing strip: ${tid}`);
  }
  assert(s.match(/the desk stays dark rather than guess\./g)?.length === 3, 'the honest sentence must ride all three strips');
  assert(s.match(/border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950\/40/g)?.length === 3, 'rose twins ×3');
  for (const retry of ['Retry loading consent records', 'Retry loading erasure requests', 'Retry loading the retention desk']) {
    assert(s.includes(`aria-label="${retry}"`), `missing retry aria: ${retry}`);
  }
});

check('page: loaders mark failure on catch, clear on success; skeletons stay distinct', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  for (const setter of ['setConsentFailed', 'setErasureFailed', 'setRetentionFailed']) {
    const uses = s.split(setter).length - 1;
    assert(uses === 3, `${setter}: declare + catch-true + success-false expected, found ${uses}`);
  }
  assert(s.match(/<Skeleton className="h-28 w-full" \/>/g)?.length === 3, 'skeletons must remain the not-yet-answered state');
  for (const gate of ['consentFailed ? (', 'erasureFailed ? (', 'retentionFailed ? (']) {
    assert(s.includes(gate), `missing failure gate: ${gate}`);
  }
});

// ── continuity ──────────────────────────────────────────────────────────────
check('continuity: the v2.129.0 timeline door + v2.128.0 marker stay intact', () => {
  const s = read('src/app/(shell)/hr/reports/page.tsx');
  assert(s.includes('data-testid="hr-privacy-consent-history-open"'), 'v2.129 door missing');
  assert(s.includes('data-testid="hr-privacy-consent-history-timeline"'), 'v2.129 timeline missing');
  assert(s.includes('data-testid="hr-privacy-consent-regrant"'), 'v2.128 marker missing');
});

check('tests: consent-timeline-csv-v2130.test.ts pins 18 assertions of honesty', () => {
  const s = read('src/tests/consent-timeline-csv-v2130.test.ts');
  const count = (s.match(/\bit\(/g) || []).length;
  assert(count === 18, `expected 18 its, found ${count}`);
  assert(s.includes('never "Invalid Date" on file'), 'garbage-timestamp pin missing');
  assert(s.includes('an export can never become a back door'), 'contract pin missing');
});

console.log(`\nverify-v2-130-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
