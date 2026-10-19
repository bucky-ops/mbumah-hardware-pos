#!/usr/bin/env node
// v2.145.0 verification — "the desk lens learns weekdays".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the three-way day-kind lens (garbage survives only under All), the legacy
// '1' → 'weekends' migration (an old browser's choice never resets), the
// joined segmented trio on the desk, and the post-hydration persisted read
// preserved. Comment-stripping before code searches (house lesson 49).

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

const PURE = 'src/lib/hr/attendance-desk.ts';
const PAGE = 'src/app/(shell)/hr/timesheets/page.tsx';
const DOC = 'docs/hr/payroll-run-lifecycle.md';
const TEST = 'src/tests/desk-lens-v2145.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.145.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.145.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.145.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.145.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-145-0'], 'verify script entry missing');
});

check('release: whats-new LEADS 2.145.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  const head = feed.indexOf("version: '2.145.0'");
  assert(head > -1, 'whats-new 2.145.0 missing');
  assert(feed.indexOf("version: '") === head, '2.145.0 must LEAD the feed (the dialog reads WHATS_NEW[0])');
  assert(feed.includes('The desk lens learns weekdays'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.145.0] The desk lens learns weekdays'), 'CHANGELOG entry missing');
});

// ── the pure additions ─────────────────────────────────────────────────────
check('pure: deskWeekdayDays — the weekend lens\u2019s honest sibling', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function deskWeekdayDays'), 'weekday sibling missing');
  assert(src.includes('return !deskDayIsWeekend(day);'), 'must be the exact negation — no second weekend parser');
  assert(src.includes('if (!Array.isArray(days)) return [];'), 'non-array guard missing');
  assert(src.includes('export function deskWeekendDays'), 'the weekend sibling must remain');
});

check('pure: DeskLensPref three-value era with the legacy-1 migration', () => {
  const src = stripComments(read(PURE));
  assert(src.includes("export type DeskLensPref = 'all' | 'weekends' | 'weekdays'"), 'pref type missing');
  assert(src.includes("if (raw === 'weekdays') return 'weekdays';"), 'weekdays read missing');
  assert(src.includes("if (raw === 'weekends' || raw === '1') return 'weekends';"), 'legacy-1 migration missing');
  assert(src.includes('return \'all\';'), 'all fallback missing');
  assert(src.includes("if (pref === 'weekends' || pref === 'weekdays') store.setItem(DESK_LENS_STORAGE_KEY, pref);"), 'word write missing');
  assert(src.includes('else store.removeItem(DESK_LENS_STORAGE_KEY);'), 'all-removes-key missing');
});

check('pure: the storage KEY is UNCHANGED — the old choice stays reachable', () => {
  const src = read(PURE);
  assert(src.includes("DESK_LENS_STORAGE_KEY = 'mbumah.hr.timesheets.lens.weekendsOnly'"), 'key name changed — the legacy migration depends on it');
});

check('pure: the module stays PURE — no db, no network, no window, no clock', () => {
  const code = stripComments(read(PURE));
  assert(!/@prisma\/client|node-fetch|axios|fetch\(|window\.|new Date\(\)/.test(code), 'purity violation');
});

// ── the desk contract ──────────────────────────────────────────────────────
check('desk: the joined segmented trio with three aria-pressed members', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes('data-testid="hr-timesheet-lens"'), 'group container missing');
  assert(src.includes('role="group"'), 'role=group missing');
  for (const m of ['lens-all', 'lens-weekends', 'lens-weekdays']) {
    assert(src.includes(`hr-timesheet-${m}`), `member ${m} missing`);
  }
  assert(src.includes("aria-pressed={lens === 'all'}"), 'all aria-pressed missing');
  assert(src.includes("aria-pressed={lens === 'weekends'}"), 'weekends aria-pressed missing');
  assert(src.includes("aria-pressed={lens === 'weekdays'}"), 'weekdays aria-pressed missing');
  assert(src.includes("useState<DeskLensPref>('all')"), 'lens state missing');
});

check('desk: each member dresses as the chips it keeps — neutral / sky / amber', () => {
  const src = read(PAGE);
  assert(src.includes('bg-muted text-foreground hover:bg-muted hover:text-foreground'), 'ALL active family missing');
  assert(src.includes('border border-sky-300 bg-sky-50 text-sky-800'), 'WEEKENDS sky family missing');
  assert(src.includes('dark:bg-sky-950/50 dark:text-sky-300'), 'WEEKENDS dark twins missing');
  assert(src.includes('border border-amber-300 bg-amber-50 text-amber-800'), 'WEEKDAYS amber family missing');
  assert(src.includes('dark:bg-amber-950/50 dark:text-amber-300'), 'WEEKDAYS dark twins missing');
  assert(src.includes('All days'), 'ALL label missing');
  assert(src.includes('Weekends only'), 'WEEKENDS label missing');
  assert(src.includes('Weekdays only'), 'WEEKDAYS label missing');
});

check('desk: the strip composes through the three-way ternary; the boolean is GONE', () => {
  const src = stripComments(read(PAGE));
  assert(src.includes("lens === 'weekends'"), 'weekends branch missing');
  assert(src.includes('? deskWeekendDays(row.days)'), 'weekend filter call missing');
  assert(src.includes('? deskWeekdayDays(row.days)'), 'weekday filter call missing');
  assert(!/weekendsOnly|toggleWeekendsOnly/.test(src), 'the v2.140 boolean must be GONE from the page');
});

check('desk: the lens marker carries the word; both honest empties speak', () => {
  const src = read(PAGE);
  assert(src.includes("data-lens={lens !== 'all' ? lens : undefined}"), 'lens marker missing');
  assert(src.includes("lens === 'weekends' ? 'no weekend days' : 'no weekday days'"), 'empty voices missing');
  assert(src.includes('hr-timesheet-strip-empty'), 'strip-empty testid missing');
});

check('desk: the persisted read stays POST-hydration; writes go through setLensPref', () => {
  const src = read(PAGE);
  assert(src.includes('Promise.resolve().then(() => setLens(readDeskLensPref(window.localStorage)))'), 'post-hydration read lost (lesson 56)');
  assert(src.includes('const setLensPref = useCallback'), 'write-through callback missing');
  const uses = src.match(/setLensPref\('/g) ?? [];
  assert(uses.length === 3, `all three members must write through setLensPref, got ${uses.length}`);
});

check('desk: the count chip keeps speaking the row TOTAL — a view, not a rewrite', () => {
  const src = read(PAGE);
  assert(src.includes("{row.days.length} {row.days.length === 1 ? 'day' : 'days'}"), 'count chip moved off the total');
});

// ── tests + docs ───────────────────────────────────────────────────────────
check('tests: desk-lens-v2145 carries the round contract', () => {
  const src = read(TEST);
  assert(src.includes('deskWeekdayDays'), 'sibling tests missing');
  assert(src.includes("readDeskLensPref(store)).toBe('weekends')"), 'legacy migration test missing');
  assert(src.includes('hr-timesheet-lens-weekdays'), 'trio card pin missing');
});

check('tests: prior rounds re-anchored — no stale boolean pins remain in the suite', () => {
  for (const f of ['src/tests/desk-lens-v2140.test.ts', 'src/tests/gate-timeline-v2141.test.ts']) {
    // The storage-key literal CONTAINS the word 'weekendsOnly' by design
    // (legacy compat) — strip it before hunting for stale state pins.
    const src = read(f).replace("'mbumah.hr.timesheets.lens.weekendsOnly'", "'");
    assert(!/weekendsOnly|toggleWeekendsOnly/.test(src), `${f} still pins the boolean era`);
  }
  const counters = read('src/tests/console-changelog.test.ts');
  assert(counters.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(34)"), 'counter 2.110.0 not re-anchored to 34');
  assert(counters.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(67)"), 'counter 2.77.0 not re-anchored to 67');
});

check('docs: the run-lifecycle contract names the day-kind lens + the migration rule', () => {
  const doc = read(DOC);
  assert(doc.includes('**Day-kind lens (v2.145.0).**'), 'day-kind lens contract missing from the doc');
  assert(doc.includes("legacy boolean `'1'` still reads `'weekends'`"), 'legacy migration rule missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
