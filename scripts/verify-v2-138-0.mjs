#!/usr/bin/env node
// v2.138.0 verification — "the verdict keeps its every attempt".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the append-only contract: one row per attempt, BOTH paths, the SAME clock
// as the snapshot, never updated — and the honest absences (no trail renders
// nothing; a pre-v2.138.0 prepared run gets one dashed note). Comment-
// stripping before code searches (house lesson 49).

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
const SERVICE = 'src/lib/hr/payroll/run-service.ts';
const ROUTE = 'src/app/api/payroll/runs/[id]/route.ts';
const DIALOG = 'src/components/hr/payroll-run-dialog.tsx';
const DESK_LIB = 'src/lib/hr/attendance-desk.ts';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const TEST = 'src/tests/gate-trail-v2138.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.138.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.138.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.138.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.138.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-138-0'], 'verify script entry missing');
});

check('release: whats-new leads 2.138.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  assert(feed.includes("version: '2.138.0'"), 'whats-new 2.138.0 missing');
  assert(feed.includes('The verdict keeps its every attempt'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.138.0] The verdict keeps its every attempt'), 'CHANGELOG entry missing');
});

// ── the schema ─────────────────────────────────────────────────────────────
check('schema: PayrollRunGateEvent exists, append-only by shape, indexed', () => {
  const src = read('prisma/schema.prisma');
  assert(src.includes('model PayrollRunGateEvent'), 'model missing');
  assert(src.includes('@@map("payroll_run_gate_events")'), 'map missing');
  assert(src.includes('@@index([runId, checkedAt])'), 'index missing');
  assert(src.includes('gateEvents  PayrollRunGateEvent[]'), 'run relation missing');
});

// ── the pure builder ───────────────────────────────────────────────────────
check('pure: gate-trail.ts stays pure and speaks the summary (not the wrapper)', () => {
  const src = stripComments(read(TRAIL));
  assert(!src.includes('@/lib/db'), 'imports the db');
  assert(!src.includes('fetch('), 'fetches');
  assert(!src.includes('new Date()'), 'reads the clock');
  assert(src.includes('buildGateVerdictText(verdict.summary)'), 'text speaks the wrong shape');
  assert(src.includes('gateVerdictTone(verdict.summary)'), 'tone speaks the wrong shape');
  assert(src.includes("'Verdict unreadable'"), 'honest degradation missing');
});

// ── the append points ──────────────────────────────────────────────────────
check('service: BLOCKED appends with the shared blockedAt clock', () => {
  const src = stripComments(read(SERVICE));
  assert(src.includes('const blockedAt = new Date();'), 'shared clock missing');
  assert(src.includes("outcome: 'BLOCKED'"), 'blocked append missing');
  const clockIdx = src.indexOf('gateCheckedAt: blockedAt');
  const appendIdx = src.indexOf("outcome: 'BLOCKED'");
  assert(clockIdx > -1 && clockIdx < appendIdx, 'snapshot must precede the trail append');
  assert(src.includes('actorId: ctx.actorId'), 'actor missing');
});

check('service: PASSED appends inside the tx with the shared passedAt clock', () => {
  const src = stripComments(read(SERVICE));
  assert(src.includes('const passedAt = new Date();'), 'shared clock missing');
  assert(src.includes("outcome: 'PASSED'"), 'pass append missing');
  assert(src.includes('gateCheckedAt: passedAt'), 'snapshot clock mismatch');
  const txIdx = src.indexOf('await db.$transaction(async (tx) => {', src.indexOf('withImmutabilityBypass'));
  const appendIdx = src.indexOf("outcome: 'PASSED'");
  assert(appendIdx > txIdx, 'pass append must sit inside the transaction');
});

check('service: append-only — no code updates or deletes a trail row', () => {
  const src = stripComments(read(SERVICE));
  assert(!src.includes('payrollRunGateEvent.update'), 'an update path exists');
  assert(!src.includes('payrollRunGateEvent.delete'), 'a delete path exists');
});

// ── the detail route ───────────────────────────────────────────────────────
check('route: additive gateTrail, oldest-first, capped, best-effort', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes("orderBy: { checkedAt: 'asc' }"), 'order missing');
  assert(src.includes('take: 50'), 'cap missing');
  assert(src.includes('gateTrail = [];'), 'best-effort empty missing');
  assert(src.includes('history, gateTrail'), 'payload missing');
  assert(src.includes('buildGateTrail('), 'pure builder unused');
});

// ── the dialog ─────────────────────────────────────────────────────────────
check('dialog: trail block, moved chip, outcome icons, honest absence', () => {
  const src = stripComments(read(DIALOG));
  for (const pin of [
    'data-testid="payroll-run-gate-trail"',
    'data-testid="payroll-run-gate-trail-count"',
    'payroll-run-gate-trail-moved-${i}',
    'data-testid="payroll-run-gate-trail-absent"',
    'border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300',
    'ShieldAlert',
    'run?.preparedAt ?',
    'gateTrail?: GateTrailRow[]',
  ]) {
    assert(src.includes(pin), `missing ${pin}`);
  }
});

// ── the weekend tint ───────────────────────────────────────────────────────
check('desk: weekend tint via UTC, parallel arrays, sky dark twins', () => {
  const lib = stripComments(read(DESK_LIB));
  assert(lib.includes('export function deskDayIsWeekend'), 'weekend fn missing');
  assert(lib.includes('shownDays: string[]'), 'parallel array missing');
  const page = stripComments(read(DESK));
  assert(page.includes('deskDayIsWeekend(day)'), 'page does not tint');
  assert(page.includes('dark:bg-sky-950/50 dark:text-sky-300'), 'sky dark twin missing');
  assert(page.includes('— weekend day'), 'honest title missing');
});

// ── tests + counters ───────────────────────────────────────────────────────
check('tests: the v2.138.0 suite exists and names the release contract', () => {
  const src = read(TEST);
  assert(src.includes('v2.138.0'), 'release named in suite missing');
  assert(src.includes('every attempt speaks'), 'append-only contract missing from suite');
  assert(src.includes('buildGateTrail'), 'builder coverage missing');
  assert(src.includes('payroll-run-gate-trail'), 'dialog coverage missing');
});

check('counters: console-changelog re-anchored for 2.138.0', () => {
  const src = stripComments(read('src/tests/console-changelog.test.ts'));
  assert(src.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(27)"), '2.110 anchor stale');
  assert(src.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(60)"), '2.77 anchor stale');
});

console.log(`\nverify-v2-138-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
