#!/usr/bin/env node
// v2.140.0 verification — "the desk finds its weekends".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the weekends-only lens (a view preference that never becomes a data
// change; the overflow stays honest about what the lens shows) and the
// attempt chip riding the dialog's frozen-verdict strip (built from the
// trail the dialog already holds — no new fetch). Comment-stripping before
// code searches (house lesson 49).

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

const DESK_LIB = 'src/lib/hr/attendance-desk.ts';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const DIALOG = 'src/components/hr/payroll-run-dialog.tsx';
const DOC = 'docs/hr/payroll-run-lifecycle.md';
const TEST = 'src/tests/desk-lens-v2140.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.140.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.140.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.140.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.140.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-140-0'], 'verify script entry missing');
});

check('release: whats-new leads 2.140.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  assert(feed.includes("version: '2.140.0'"), 'whats-new 2.140.0 missing');
  assert(feed.includes('The desk finds its weekends'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.140.0] The desk finds its weekends'), 'CHANGELOG entry missing');
});

// ── the lens's pure half ───────────────────────────────────────────────────
check('pure: deskWeekendDays filters through deskDayIsWeekend only', () => {
  const src = stripComments(read(DESK_LIB));
  assert(src.includes('export function deskWeekendDays'), 'lens builder missing');
  assert(src.includes('days.filter((day) => deskDayIsWeekend(day))'), 'must filter through deskDayIsWeekend');
  assert(src.includes('if (!Array.isArray(days)) return [];'), 'non-array degradation missing');
  // The strip builder never learns about weekends — composition stays in the page.
  assert(!src.includes('export function deskDayStrip(weekend'), 'strip builder must not grow a lens param');
});

// ── the desk lens UI ───────────────────────────────────────────────────────
check('desk: the toggle speaks aria-pressed and wears the sky family when on', () => {
  const src = stripComments(read(DESK));
  assert(src.includes("aria-pressed={weekendsOnly}"), 'aria-pressed missing');
  assert(src.includes('hr-timesheet-weekends-only'), 'toggle testid missing');
  assert(src.includes('border-sky-300 bg-sky-50 text-sky-800'), 'on-state sky family missing');
  assert(src.includes('dark:bg-sky-950/50'), 'sky dark twin missing');
  assert(src.includes('Weekends only'), 'toggle label missing');
});

check('desk: the lens composes BEFORE the strip builder; strip wears data-lens', () => {
  const src = stripComments(read(DESK));
  assert(
    src.includes('deskDayStrip(weekendsOnly ? deskWeekendDays(row.days) : row.days)'),
    'composition order missing',
  );
  assert(src.includes("data-lens={weekendsOnly ? 'weekends' : undefined}"), 'strip lens marker missing');
});

check('desk: honest empty — a row with no weekend days says so; count chip untouched', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('hr-timesheet-strip-empty'), 'empty-lens note missing');
  assert(src.includes('no weekend days'), 'empty-lens copy missing');
  // The count chip still speaks the row's TOTAL (row.days.length), lens or not.
  assert(src.includes('{row.days.length} {row.days.length === 1 ? \'day\' : \'days\'}'), 'count chip must keep the total');
});

check('desk: a view preference — disabled only while loading, never scope-cleared', () => {
  const src = stripComments(read(DESK));
  const idx = src.indexOf('hr-timesheet-weekends-only');
  const head = src.slice(Math.max(0, idx - 800), idx);
  assert(head.includes('disabled={loading}'), 'toggle must disable only on loading');
  assert(src.includes('setWeekendsOnly((v) => !v)'), 'flip handler missing');
  // Scope change clears notes, never the lens.
  const scopeIdx = src.indexOf('setRowNote(null);\n              setBulkNote(null);');
  assert(scopeIdx > -1, 'scope-change note clearing moved');
  const scopeBlock = src.slice(scopeIdx, scopeIdx + 200);
  assert(!scopeBlock.includes('setWeekendsOnly'), 'lens must survive a scope change');
});

// ── the dialog chip ────────────────────────────────────────────────────────
check('dialog: the verdict strip wears the attempt chip, built from the held trail', () => {
  const src = stripComments(read(DIALOG));
  assert(src.includes('buildGateAttemptChip'), 'chip builder not imported/used');
  assert(src.includes('attemptCount: gateTrail.length'), 'chip must count the held trail');
  assert(src.includes('gateTrail[gateTrail.length - 1]?.outcome'), 'chip must read the newest outcome');
  const stripIdx = src.indexOf('payroll-run-gate-verdict-strip');
  const chipIdx = src.indexOf('payroll-run-gate-attempts-dialog');
  assert(stripIdx > -1 && chipIdx > stripIdx, 'chip must ride the verdict strip');
  assert(src.includes("title=\"Every prepare attempt on record"), 'trail-pointer title missing');
  assert(/History/.test(src), 'History icon missing');
});

// ── the docs contract ──────────────────────────────────────────────────────
check('docs: the lifecycle doc names all six gate surfaces and their promises', () => {
  const src = read(DOC);
  assert(src.includes('### Gate surfaces and contracts'), 'contract section missing');
  for (const surface of [
    '**Frozen verdict (v2.135.0).**',
    '**Gate trail (v2.138.0).**',
    '**Attempt chip (v2.139.0/v2.140.0).**',
    '**Timesheet desk (v2.136.0).**',
    '**Batch receipt (v2.139.0).**',
    '**Weekends-only lens (v2.140.0).**',
  ]) {
    assert(src.includes(surface), `surface missing: ${surface}`);
  }
  assert(src.includes('Append-only: no update or delete path exists'), 'append-only promise missing');
  assert(src.includes('never a new bulk write path'), 'no-bulk-path promise missing');
});

// ── the suite ──────────────────────────────────────────────────────────────
check('tests: the v2.140.0 suite exists and pins this release', () => {
  const src = read(TEST);
  assert(src.includes('v2.140.0'), 'suite must name the release');
  assert(src.includes('deskWeekendDays'), 'lens builder pin missing');
  assert(src.includes('buildGateAttemptChip'), 'chip pin missing');
  assert(src.includes('payroll-run-gate-attempts-dialog'), 'dialog chip pin missing');
});

check('tests: console-changelog counters re-anchored for 2.140.0', () => {
  const src = read('src/tests/console-changelog.test.ts');
  assert(src.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(29)"), '2.110.0 anchor stale');
  assert(src.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(62)"), '2.77.0 anchor stale');
  assert(src.includes('2.140.0 "the desk finds its weekends" joining the feed'), 're-anchor comment missing');
});

check('purity: the desk lib stays free of db/network/clock imports', () => {
  const src = stripComments(read(DESK_LIB));
  assert(!/@prisma\/client|node-fetch|axios|fetch\(|new Date\(\)/.test(src), 'purity leak in attendance-desk');
});

console.log(`\nverify-v2-140-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
