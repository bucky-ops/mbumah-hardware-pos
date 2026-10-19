#!/usr/bin/env node
// v2.142.0 verification — "the activity answers back".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the blocked-only lens (a view preference that composes BEFORE the bound;
// the summary chip keeps speaking ALL attempts) and the gate-activity CSV
// export (the RFC 4180 family's newest member: the whole window, never the
// viewport; counts and verdicts, never pay data). Comment-stripping before
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

const PURE = 'src/lib/hr/payroll/gate-timeline.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';
const DOC = 'docs/hr/payroll-run-lifecycle.md';
const TEST = 'src/tests/gate-activity-v2142.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.142.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.142.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.142.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.142.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-142-0'], 'verify script entry missing');
});

check('release: whats-new LEADS 2.142.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  const head = feed.indexOf("version: '2.142.0'");
  assert(head > -1, 'whats-new 2.142.0 missing');
  assert(feed.indexOf("version: '") === head, '2.142.0 must LEAD the feed (the dialog reads WHATS_NEW[0])');
  assert(feed.includes('The activity answers back'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.142.0] The activity answers back'), 'CHANGELOG entry missing');
});

// ── the pure additions ─────────────────────────────────────────────────────
check('pure: buildGateTimelineCsv pins the honest column set and never re-sorts', () => {
  const src = stripComments(read(PURE));
  const headers = src.match(/const GATE_CSV_HEADERS = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  const cols = [...headers.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert(cols.join(',') === 'attempted_at,period,run_status,outcome,verdict,actor', `header pin stale: ${cols.join(',')}`);
  assert(src.includes('export function buildGateTimelineCsv'), 'serializer missing');
  assert(src.includes('export function escapeGateCsvCell'), 'escape missing');
  assert(src.includes('export function filterGateTimeline'), 'lens missing');
  // No employee codes, no pay fields in the headers array.
  assert(!/employee|code|pay|salary|net|gross|amount/i.test(headers), 'the export must never carry pay data or identifiers');
});

check('pure: the module stays PURE — no db, no network, no clock, no window', () => {
  const src = stripComments(read(PURE));
  assert(!/@prisma\/client|node-fetch|axios|fetch\(|new Date\(\)|window\./.test(src), 'purity leak in gate-timeline');
});

// ── the card lens ──────────────────────────────────────────────────────────
check('card: the blocked-only lens speaks aria-pressed, rose when on, dark twins', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('aria-pressed={timelineBlockedOnly}'), 'aria-pressed missing');
  assert(src.includes('payroll-gate-timeline-blocked-only'), 'lens testid missing');
  assert(src.includes('border-rose-300 bg-rose-50 text-rose-800'), 'rose on-state missing');
  assert(src.includes('dark:bg-rose-950/50 dark:text-rose-300'), 'rose dark twin missing');
});

check('card: the lens composes BEFORE the bound; the summary chip keeps ALL attempts', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('filterGateTimeline(timeline?.rows ?? [], timelineBlockedOnly)'), 'lens composition missing');
  assert(src.includes('(timelineShowAll ? timelineFiltered : timelineFiltered.slice(0, 8)).map('), 'bound must follow the lens');
  assert(src.includes('timelineFiltered.length > 8'), 'show-all bound must speak the lens count');
  assert(!src.includes('timelineShowAll ? timeline.rows : timeline.rows.slice(0, 8)'), 'stale unfiltered bound still present');
  assert(src.includes('timeline.summary.attempts}'), 'summary chip must keep the route-built ALL count');
});

check('card: the lens-empty note is honest and distinct from the global empty', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('payroll-gate-timeline-lens-empty'), 'lens-empty missing');
  assert(src.includes('No blocked attempts in the window'), 'lens-empty copy missing');
  assert(src.includes('payroll-gate-timeline-empty'), 'global empty must stay');
});

// ── the export door ────────────────────────────────────────────────────────
check('export: whole window (never the viewport), lens applied, disabled when empty', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('payroll-gate-timeline-export'), 'export testid missing');
  assert(src.includes('const exportGateTimelineCsv = useCallback'), 'export handler missing');
  assert(src.includes('filterGateTimeline(timeline.rows, timelineBlockedOnly)'), 'export must follow the lens');
  // The handler maps timeline.rows through the lens — never a slice(0, 8).
  const handler = src.slice(src.indexOf('const exportGateTimelineCsv'), src.indexOf('const stats = useMemo'));
  assert(!handler.includes('slice(0, 8)'), 'the export must never carry the viewport bound');
  assert(handler.includes('gate-activity-'), 'filename prefix missing');
  assert(src.includes('disabled={timeline === null || timelineFiltered.length === 0}'), 'disabled-when-empty missing');
  assert(src.includes('not just the rows on screen'), 'window-not-viewport honesty title missing');
  assert(src.includes('never pay data'), 'no-pay-data title missing');
});

// ── the picker chip ────────────────────────────────────────────────────────
check('picker: the last-run attempts chip rides the runs in memory, honest absence', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('runs.find((r) => r.payrollPeriodId === periodId)'), 'memory lookup missing');
  assert(src.includes('attemptCount: lastRun?.gateAttemptCount ?? null'), 'count wiring missing');
  assert(src.includes('lastOutcome: lastRun?.gateLastOutcome ?? null'), 'outcome wiring missing');
  assert(src.includes('payroll-picker-attempts-chip'), 'chip testid missing');
  assert(src.includes('{attempts ? ('), 'honest absence missing');
  assert(src.includes('runs={runs ?? []}'), 'runs prop missing');
});

// ── the docs contract ──────────────────────────────────────────────────────
check('docs: the timeline contract names the lens and the export door', () => {
  const src = read(DOC);
  assert(src.includes('### Gate surfaces and contracts (v2.135.0 → v2.142.0)'), 'section header stale');
  assert(src.includes('"Blocked\n  only"'), 'lens surface missing');
  assert(src.includes('buildGateTimelineCsv'), 'export surface missing');
  assert(src.includes('never the 8-row\n  viewport'), 'window-not-viewport promise missing');
  assert(src.includes('never employee codes or pay data'), 'no-identifier promise missing');
});

// ── the suite ──────────────────────────────────────────────────────────────
check('tests: the v2.142.0 suite exists and pins this release; counters re-anchored', () => {
  const src = read(TEST);
  assert(src.includes('v2.142.0'), 'suite must name the release');
  assert(src.includes('buildGateTimelineCsv'), 'serializer pin missing');
  assert(src.includes('filterGateTimeline'), 'lens pin missing');
  assert(src.includes('payroll-picker-attempts-chip'), 'picker chip pin missing');
  const cc = read('src/tests/console-changelog.test.ts');
  assert(cc.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(31)"), '2.110.0 anchor stale');
  assert(cc.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(64)"), '2.77.0 anchor stale');
  assert(cc.includes('2.142.0 "the activity answers back" joining the feed'), 're-anchor comment missing');
});

console.log(`\nverify-v2-142-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
