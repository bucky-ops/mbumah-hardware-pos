#!/usr/bin/env node
// v2.139.0 verification — "the table counts the attempts".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the trail's compact surface (count + last outcome, honest absence, tone
// vocabulary) and the batch door (the ONE per-employee service walked on
// the client, never a new bulk write path; the receipt never smooths).
// Comment-stripping before code searches (house lesson 49).

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

const TRAIL = 'src/lib/hr/payroll/gate-trail.ts';
const DESK_LIB = 'src/lib/hr/attendance-desk.ts';
const RUNS_ROUTE = 'src/app/api/payroll/runs/route.ts';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const TEST = 'src/tests/run-attempts-v2139.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.139.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.139.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.139.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.139.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-139-0'], 'verify script entry missing');
});

check('release: whats-new leads 2.139.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  assert(feed.includes("version: '2.139.0'"), 'whats-new 2.139.0 missing');
  assert(feed.includes('The table counts the attempts'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.139.0] The table counts the attempts'), 'CHANGELOG entry missing');
});

// ── the chip builder ───────────────────────────────────────────────────────
check('pure: the attempt chip speaks count + last outcome, honest absence', () => {
  const src = stripComments(read(TRAIL));
  assert(src.includes('export function buildGateAttemptChip'), 'chip builder missing');
  assert(src.includes("count === 1 ? 'attempt' : 'attempts'"), 'plural honesty missing');
  assert(src.includes("'UNKNOWN'"), 'unknown outcome missing');
  assert(!src.includes('@/lib/db'), 'imports the db');
  assert(!src.includes('fetch('), 'fetches');
  assert(!src.includes('new Date()'), 'reads the clock');
});

// ── the receipt builder ────────────────────────────────────────────────────
check('pure: the batch receipt never smooths (partial names failures, raced stays honest)', () => {
  const src = stripComments(read(DESK_LIB));
  assert(src.includes('export function buildBulkApproveSummary'), 'receipt builder missing');
  assert(src.includes('retry from their rows'), 'partial retry line missing');
  assert(src.includes('Nothing left to approve'), 'raced-batch honesty missing');
  assert(src.includes('No approvals landed'), 'total-failure honesty missing');
  assert(src.includes('tone: \'ok\' | \'partial\' | \'err\''), 'three tones missing');
});

// ── the runs list route ────────────────────────────────────────────────────
check('route: the trail surface rides additively, one query, read-only', () => {
  const src = stripComments(read(RUNS_ROUTE));
  assert(src.includes('_count: { select: { details: true, gateEvents: true } }'), 'count include missing');
  assert(src.includes("orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }]"), 'newest-clock order missing');
  assert(src.includes('take: 1'), 'last-row take missing');
  assert(src.includes('gateAttemptCount: r._count.gateEvents'), 'count field missing');
  assert(src.includes('gateLastOutcome: r.gateEvents[0]?.outcome ?? null'), 'outcome field missing');
  assert(!src.includes('payrollRunGateEvent.create'), 'a write path exists');
  assert(!src.includes('payrollRun.update'), 'a write path exists');
});

// ── the runs table chip ────────────────────────────────────────────────────
check('table: the chip rides BESIDE the frozen verdict in one wrapping row', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('data-testid="payroll-run-gate-attempts"'), 'chip testid missing');
  assert(src.includes('mt-0.5 flex flex-wrap items-center gap-1'), 'wrap container missing');
  assert(src.includes('buildGateAttemptChip({'), 'builder unused');
  assert(src.includes('<History className="h-2.5 w-2.5 shrink-0" aria-hidden />'), 'History icon missing');
  assert(src.includes("Every prepare attempt on record — the run dialog's Gate trail keeps the full story"), 'dialog-pointer title missing');
  assert(src.includes('gateAttemptCount?: number | null;'), 'DTO field missing');
  assert(src.includes('gateLastOutcome?: string | null;'), 'DTO field missing');
  assert(src.includes('border-border bg-muted/60 text-muted-foreground dark:bg-muted/40'), 'muted family missing');
});

// ── the desk batch ─────────────────────────────────────────────────────────
check('desk: the batch loops the ONE service (exact single-approve contract)', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('data-testid="hr-timesheet-approve-all"'), 'batch button missing');
  assert(src.includes("'/api/attendance/timesheets/approve'"), 'approve URL missing');
  assert(src.includes('body: JSON.stringify({ employeeId: row.employeeId, from: row.firstDay, to: row.lastDay })'), 'body shape mismatch');
  assert(!src.includes('approveMany'), 'a bulk path exists');
  assert(!src.includes('bulkApprove'), 'a bulk path exists');
});

check('desk: single-flight both directions, honest progress, refetch at the end', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('disabled={!payload || loading || payload.rows.length === 0 || approvingId !== null || bulkRunning}'), 'batch disable logic missing');
  assert(src.includes('setApprovingId(row.employeeId);'), 'batch does not ride approvingId');
  assert(src.includes('${bulkProgress.done}/${bulkProgress.total}'), 'progress label missing');
  assert(src.includes('await loadPending(scopeId);'), 'end-of-batch refetch missing');
});

check('desk: the receipt strip names failures, both notes clear on scope change', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('data-testid="hr-timesheet-bulk-note"'), 'receipt strip missing');
  assert(src.includes('data-testid="hr-timesheet-bulk-failure"'), 'failure lines missing');
  assert(src.includes("bulkNote.tone === 'partial'"), 'partial tone missing');
  assert(src.includes('dark:bg-rose-950/40 dark:text-rose-300'), 'rose dark twin missing');
  assert(src.includes('setBulkNote(null);'), 'receipt never cleared');
  assert(src.includes('setRowNote(null);'), 'row note never cleared');
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: the v2.139.0 suite exists and names the release contract', () => {
  const src = read(TEST);
  assert(src.includes('v2.139.0'), 'release named in suite missing');
  assert(src.includes('buildGateAttemptChip'), 'chip coverage missing');
  assert(src.includes('buildBulkApproveSummary'), 'receipt coverage missing');
  assert(src.includes('payroll-run-gate-attempts'), 'table chip coverage missing');
  assert(src.includes('hr-timesheet-approve-all'), 'desk batch coverage missing');
});

check('counters: console-changelog re-anchored for 2.139.0', () => {
  const src = stripComments(read('src/tests/console-changelog.test.ts'));
  assert(src.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(28)"), '2.110 anchor stale');
  assert(src.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(61)"), '2.77 anchor stale');
});

console.log(`\nverify-v2-139-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
