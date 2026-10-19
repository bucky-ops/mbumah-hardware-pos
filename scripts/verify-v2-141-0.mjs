#!/usr/bin/env node
// v2.141.0 verification — "the gate tells its story across runs".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the store-level gate timeline (movement computed CHRONOLOGICALLY across
// runs, the bounded window spoken, best-effort degrade confined to the
// card) and the desk lens keeping its preference (guarded reads degrade to
// OFF, turn-off removes the key). Comment-stripping before code searches
// (house lesson 49).

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
const ROUTE = 'src/app/api/payroll/gate-timeline/route.ts';
const PAGE = 'src/app/(shell)/hr/payroll/page.tsx';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const DOC = 'docs/hr/payroll-run-lifecycle.md';
const TEST = 'src/tests/gate-timeline-v2141.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.141.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.141.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.141.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.141.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-141-0'], 'verify script entry missing');
});

check('release: whats-new LEADS 2.141.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  const head = feed.indexOf("version: '2.141.0'");
  assert(head > -1, 'whats-new 2.141.0 missing');
  const first = feed.indexOf("version: '");
  assert(first === head, '2.141.0 must LEAD the feed (the dialog reads WHATS_NEW[0] as latest)');
  assert(feed.includes('The gate tells its story across runs'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.141.0] The gate tells its story across runs'), 'CHANGELOG entry missing');
});

// ── the pure builder ───────────────────────────────────────────────────────
check('pure: buildGateTimeline computes movement chronologically, drops junk, degrades garbage', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function buildGateTimeline'), 'builder missing');
  assert(src.includes('export function summarizeGateTimeline'), 'summary missing');
  assert(src.includes("if (typeof event.runId !== 'string' || !event.runId) continue;"), 'junk runId must drop');
  assert(src.includes("previousText !== null && previousText !== text"), 'chronological movement missing');
  assert(src.includes("'Verdict unreadable'"), 'garbage verdict must degrade, never guess');
  assert(src.includes("from './gate-verdict'"), 'must speak the v2.135.0 verdict words');
});

check('pure: the module stays PURE — no db, no network, no clock', () => {
  const src = stripComments(read(PURE));
  assert(!/@prisma\/client|node-fetch|axios|fetch\(|new Date\(\)|window\./.test(src), 'purity leak in gate-timeline');
});

// ── the route ──────────────────────────────────────────────────────────────
check('route: the gate read-right quartet, store-scoped, read-only', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes("hrGuard('hr.payroll.read.all'"), 'guard missing');
  for (const role of ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT']) {
    assert(src.includes(`'${role}'`), `role missing: ${role}`);
  }
  assert(src.includes('const storeId = session.storeId'), 'store scoping missing');
  assert(!/\.create\(|\.update\(|\.delete\(/.test(src), 'read-only violated');
});

check('route: newest-window read reversed to chronological; window honesty rides the payload', () => {
  const src = stripComments(read(ROUTE));
  assert(src.includes('TIMELINE_WINDOW = 120'), 'window constant missing');
  assert(src.includes("orderBy: [{ checkedAt: 'desc' }, { createdAt: 'desc' }]"), 'newest-clock ordering missing');
  assert(src.includes('[...events].reverse()'), 'chronological reversal missing');
  assert(src.includes('[...rows].reverse()'), 'payload must render newest-first');
  assert(src.includes('totalEvents'), 'totalEvents honesty missing');
  assert(src.includes("u.name?.trim() || u.email || 'Unknown user'"), 'actor fallback ladder missing');
});

// ── the card ───────────────────────────────────────────────────────────────
check('card: the Gate activity card carries its own loader and every honest state', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('payroll-gate-timeline'), 'card testid missing');
  assert(src.includes('payroll-gate-timeline-summary'), 'summary chip missing');
  assert(src.includes('payroll-gate-timeline-row-'), 'rows missing');
  assert(src.includes('payroll-gate-timeline-moved-'), 'moved pill missing');
  assert(src.includes('payroll-gate-timeline-empty'), 'honest empty missing');
  assert(src.includes('payroll-gate-timeline-error'), 'error state missing');
  assert(src.includes('payroll-gate-timeline-retry'), 'retry missing');
  assert(src.includes('payroll-gate-timeline-loading'), 'skeleton missing');
  assert(src.includes('payroll-gate-timeline-toggle'), 'show-all toggle missing');
  assert(src.includes('payroll-gate-timeline-window'), 'window honesty line missing');
  assert(src.includes('const loadTimeline = useCallback'), 'own loader missing');
  assert(src.includes("fetch('/api/payroll/gate-timeline', { credentials: 'include' })"), 'card fetch missing');
  assert(src.includes('void loadTimeline();'), 'dialog onChanged must re-read the timeline');
});

check('card: best-effort by design — a timeline failure never touches the page error', () => {
  const src = stripComments(read(PAGE));
  const idx = src.indexOf('const loadTimeline = useCallback');
  const block = src.slice(idx, idx + 1400);
  assert(block.includes('setTimelineError'), 'card error state missing');
  assert(!block.includes('setError('), 'the timeline loader must never set the PAGE error');
});

// ── the lens persistence ───────────────────────────────────────────────────
check('desk: the lens keeps its preference, read AFTER hydration (not a lazy init)', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('readDeskLensPref('), 'guarded read missing');
  assert(src.includes('writeDeskLensPref(window.localStorage, next)'), 'guarded write missing');
  assert(
    src.includes('Promise.resolve().then(() => setWeekendsOnly(readDeskLensPref(window.localStorage)))'),
    'the persisted read must ride the microtask-deferred effect (stale hydration attributes are never patched)',
  );
  assert(!/useState<boolean>\(\(\) =>/.test(src), 'lazy initializer would poison hydration');
  assert(src.includes('toggleWeekendsOnly'), 'persisted flip handler missing');
});

check('desk-pure: lens turn-off removes the key; a throwing storage reads OFF, never crashes', () => {
  const src = stripComments(read('src/lib/hr/attendance-desk.ts'));
  assert(src.includes("store.setItem(DESK_LENS_STORAGE_KEY, '1')"), 'on-write missing');
  assert(src.includes('store.removeItem(DESK_LENS_STORAGE_KEY)'), 'turn-off must REMOVE the key');
  const readFn = src.slice(src.indexOf('export function readDeskLensPref'), src.indexOf('export function writeDeskLensPref'));
  assert(readFn.includes('try {') && readFn.includes('} catch {'), 'read must guard storage throws');
  const writeFn = src.slice(src.indexOf('export function writeDeskLensPref'));
  assert(writeFn.includes('try {') && writeFn.includes('} catch {'), 'write must guard storage throws');
});

// ── the docs contract ──────────────────────────────────────────────────────
check('docs: the lifecycle doc names the store timeline and the lens persistence', () => {
  const src = read(DOC);
  assert(src.includes('### Gate surfaces and contracts (v2.135.0 → v2.141.0)'), 'section header stale');
  assert(src.includes('**Store gate timeline (v2.141.0).**'), 'store timeline surface missing');
  assert(src.includes('CHRONOLOGICALLY'), 'cross-run movement promise missing');
  assert(src.includes('Since v2.141.0\n  the preference persists per browser'), 'lens persistence missing');
  assert(src.includes('**Weekends-only lens (v2.140.0/v2.141.0).**'), 'lens surface re-anchored missing');
});

// ── the suite ──────────────────────────────────────────────────────────────
check('tests: the v2.141.0 suite exists and pins this release; counters re-anchored', () => {
  const src = read(TEST);
  assert(src.includes('v2.141.0'), 'suite must name the release');
  assert(src.includes('buildGateTimeline'), 'builder pin missing');
  assert(src.includes('summarizeGateTimeline'), 'summary pin missing');
  assert(src.includes('DESK_LENS_STORAGE_KEY'), 'lens key pin missing');
  const cc = read('src/tests/console-changelog.test.ts');
  assert(cc.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(30)"), '2.110.0 anchor stale');
  assert(cc.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(63)"), '2.77.0 anchor stale');
});

console.log(`\nverify-v2-141-0: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
