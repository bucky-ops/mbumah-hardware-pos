#!/usr/bin/env node
// v2.137.0 verification — "the picker sees the gate".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the honesty chain: the preview speaks the gate's own where (parity), a
// failed preview says "unavailable" instead of guessing, chips speak only
// when something would block, and the desk export can never carry pay data
// because the row TYPE has no field for it. Comment-stripping before code
// searches (house lesson 49).

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
/** Strip line comments so a quoted example in prose never satisfies a code pin. */
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '');

const CSV = 'src/lib/hr/timesheet-desk-csv.ts';
const PREVIEW = 'src/lib/hr/payroll/gate-preview.ts';
const ROUTE = 'src/app/api/payroll/periods/route.ts';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const TEST = 'src/tests/timesheet-desk-v2137.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.137.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.137.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.137.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.137.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-137-0'], 'verify script entry missing');
});

check('release: whats-new leads 2.137.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  assert(feed.includes("version: '2.137.0'"), 'whats-new 2.137.0 missing');
  assert(feed.includes('The picker sees the gate'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.137.0] The picker sees the gate'), 'CHANGELOG entry missing');
});

// ── the pure layers stay pure ──────────────────────────────────────────────
check('pure: both v2.137.0 modules stay pure (no db, no network, no clock)', () => {
  for (const [name, path] of [['csv', CSV], ['preview', PREVIEW]]) {
    const src = stripComments(read(path));
    assert(!src.includes('@/lib/db'), `${name} imports the db`);
    assert(!src.includes('fetch('), `${name} fetches`);
    assert(!src.includes('new Date()'), `${name} reads the clock`);
  }
});

check('csv: the honesty pin — the column set IS the row type', () => {
  const src = stripComments(read(CSV));
  assert(src.includes("'employee_code',"), 'header pin drift');
  assert(src.includes("'pending_dates',"), 'dates column missing');
  assert(!/gross|net|amount|rate|pay_amount/i.test(src.split('CSV_HEADERS')[1]?.split(']')[0] ?? ''), 'a pay column proposed itself');
  assert(src.includes("join('\\r\\n')"), 'CRLF discipline missing');
});

check('preview: chips speak only when blocking, in prepare loop order', () => {
  const src = stripComments(read(PREVIEW));
  const consentIdx = src.indexOf('missingConsent > 0');
  const timesheetIdx = src.indexOf('unapprovedDays > 0');
  assert(consentIdx > -1 && timesheetIdx > consentIdx, 'chip order is not prepare order (consent first)');
  assert(src.includes("unavailable — the run gate still checks on prepare."), 'honest unavailable line missing');
});

// ── the periods route (additive preview) ───────────────────────────────────
check('periods route: gate parity where + one-count consent', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes('checkIn: { not: null }'), 'checkIn pin missing');
  assert(src.includes('timesheetApprovedByUserId: null'), 'unapproved pin missing');
  assert(src.includes("employee: { storeId, deletedAt: null, status: 'ACTIVE' }"), 'employee parity missing');
  assert(src.includes('consentRecords: { none: { withdrawnAt: null } }'), 'consent count missing');
});

check('periods route: bucketed in memory, null-degrade, additive field', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes('bucketPendingDays'), 'pure bucketing unused');
  assert(src.includes('gatePreview ? gatePreview[i] : null'), 'additive null-safe mapping missing');
  assert(src.includes('gatePreview = null;'), 'degrade path missing');
});

// ── the picker ─────────────────────────────────────────────────────────────
check('picker: chips in items, preview line, amber door (only when days pending)', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('gatePreviewChips(p.gatePreview)'), 'item chips missing');
  assert(src.includes('data-testid="payroll-picker-gate-chip"'), 'chip testid missing');
  assert(src.includes('gatePreviewLine(selected?.gatePreview)'), 'preview line missing');
  assert(src.includes('data-testid="payroll-picker-timesheet-door"'), 'door missing');
  assert(src.includes('const door = (selected?.gatePreview?.unapprovedDays ?? 0) > 0;'), 'door gate missing');
  assert(src.includes('rel="noopener noreferrer"'), 'door rel missing');
});

check('picker: both chip families + door carry dark twins and focus rings', () => {
  const src = stripComments(read(PAYROLL));
  for (const pin of [
    'dark:bg-rose-950/50 dark:text-rose-300',
    'dark:bg-amber-950/50 dark:text-amber-300',
    'dark:hover:ring-amber-800',
    'focus-visible:ring-2 focus-visible:ring-amber-400',
  ]) {
    assert(src.includes(pin), `missing ${pin}`);
  }
});

// ── the desk export door ───────────────────────────────────────────────────
check('desk export: rows as shown, disabled when empty, never pay data', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('buildTimesheetDeskCsv'), 'serializer unused');
  assert(src.includes('pendingDates: row.days'), 'rows-as-shown mapping missing');
  assert(src.includes('timesheet-pending-'), 'filename family missing');
  assert(src.includes('disabled={!payload || loading || payload.rows.length === 0}'), 'empty-disable missing');
  assert(src.includes('never pay data'), 'honest aria missing');
  assert(src.includes('data-testid="hr-timesheet-csv"'), 'testid missing');
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: the v2.137.0 suite exists and names the release contract', () => {
  const src = read(TEST);
  assert(src.includes('v2.137.0'), 'release named in suite missing');
  assert(src.includes('the picker sees the gate'), 'headline missing from suite');
  assert(src.includes('buildTimesheetDeskCsv'), 'csv coverage missing');
  assert(src.includes('gatePreviewChips'), 'preview coverage missing');
});

check('counters: console-changelog re-anchored for 2.137.0', () => {
  const src = stripComments(read('src/tests/console-changelog.test.ts'));
  assert(src.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(26)"), '2.110 anchor stale');
  assert(src.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(59)"), '2.77 anchor stale');
});

console.log(`\nverify-v2-137-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
