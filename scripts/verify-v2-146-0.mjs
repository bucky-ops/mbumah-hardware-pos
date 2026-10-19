#!/usr/bin/env node
// v2.146.0 verification — "the table wears the same dots".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the runs table's period outcome dots (the picker's own dot, ONE definition
// of "last" through the SAME listTimelinePeriods memo), the desk's split
// line (the two counts the lenses imply, garbage in neither bucket), and
// the weekday sibling's strengthened readability (deskDayLabel is the one
// readability judge). Comment-stripping before code searches (lesson 49).

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
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';
const DOC = 'docs/PAYROLL_LEDGER_ZERO_RUNS.md';
const TEST = 'src/tests/table-dots-v2146.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.146.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.146.0', `version=${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.146.0', `release=${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.146.0', `base=${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-146-0'], 'verify script entry missing');
});

check('release: whats-new LEADS 2.146.0; CHANGELOG carries the entry', () => {
  const feed = read('src/lib/whats-new.ts');
  const head = feed.indexOf("version: '2.146.0'");
  assert(head > -1, 'whats-new 2.146.0 missing');
  assert(feed.indexOf("version: '") === head, '2.146.0 must LEAD the feed (the dialog reads WHATS_NEW[0])');
  assert(feed.includes('The table wears the same dots'), 'headline missing');
  const changelog = read('CHANGELOG.md');
  assert(changelog.includes('## [2.146.0] The table wears the same dots'), 'CHANGELOG entry missing');
});

// ── the pure additions ─────────────────────────────────────────────────────
check('pure: deskDaySplit composes the two siblings — never a second parser', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export interface DeskDaySplit'), 'split interface missing');
  assert(
    src.includes('return { weekday: deskWeekdayDays(days).length, weekend: deskWeekendDays(days).length };'),
    'the split MUST compose deskWeekdayDays/deskWeekendDays — one definition of each kind',
  );
  assert(src.includes("if (!Array.isArray(days)) return { weekday: 0, weekend: 0 };"), 'non-array must read zero');
});

check('pure: deskSplitLabel — lone kind speaks alone; nothing readable speaks nothing', () => {
  const src = stripComments(read(PURE));
  assert(src.includes('export function deskSplitLabel'), 'label builder missing');
  assert(src.includes("return `${weekday} · ${weekend}`;"), 'the joined form missing');
  assert(src.includes('return weekday || weekend;'), 'the lone-kind form missing');
  assert(src.includes("if (!split) return '';"), 'garbage input must speak nothing');
});

check('pure: deskWeekdayDays rides deskDayLabel — a calendar-impossible day is honestly neither', () => {
  const src = stripComments(read(PURE));
  assert(
    src.includes('return days.filter((day) => deskDayLabel(day) !== null && !deskDayIsWeekend(day));'),
    'readability must ride deskDayLabel (the shape regex alone lets 2026-13-99 through)',
  );
});

// ── the desk wears the split ───────────────────────────────────────────────
check('desk: the split line under the count chip, always visible without lensing', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('deskDaySplit(row.days)'), 'page must compose the pure split');
  assert(src.includes('deskSplitLabel(split)'), 'page must speak the pure label');
  assert(src.includes('data-testid="hr-timesheet-split"'), 'split testid missing');
  assert(src.includes('data-testid="hr-timesheet-count-chip"'), 'count chip must stay');
  assert(src.includes('flex flex-col items-start gap-1'), 'the chip+split stack missing');
});

check('desk: the split dresses as the chips it counts; the words live in the aria-label', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('<Briefcase className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />'), 'weekday icon must wear amber');
  assert(src.includes('<Sun className="h-3 w-3 text-sky-600 dark:text-sky-400" aria-hidden />'), 'weekend icon must wear sky');
  assert(src.includes("aria-label={`${row.days.length} pending ${row.days.length === 1 ? 'day' : 'days'} — ${splitLabel}`}"), 'the spoken words missing');
  assert(src.includes('{splitLabel ? ('), 'an unreadable row must render NO split');
  assert(src.includes("{row.days.length} {row.days.length === 1 ? 'day' : 'days'}"), 'the total chip must keep speaking the row total');
});

// ── the runs table wears the same dots ─────────────────────────────────────
check('payroll: the dot lookup rides the SAME memo the picker reads', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('new Map(timelinePeriods.map((p) => [p.label, p.lastOutcome] as const))'), 'the one-lookup map missing');
  assert(src.includes('timelineOutcomeByPeriod.get(group.periodName) ?? null'), 'the group lookup missing');
});

check('payroll: the group header wears the picker-class dot (exact parity)', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('data-testid="payroll-period-gate-outcome"'), 'dot testid missing');
  assert(src.includes("'bg-emerald-500 dark:bg-emerald-400'"), 'PASSED tone missing');
  assert(src.includes("'bg-amber-500 dark:bg-amber-400'"), 'BLOCKED tone missing');
  assert(src.includes("'bg-muted-foreground/40'"), 'UNKNOWN tone missing');
  assert(src.includes('inline-block h-1.5 w-1.5 shrink-0 rounded-full'), 'the picker dot shape missing');
  assert(src.includes("title={`Last prepare attempt outcome in the gate trail: ${periodOutcome}`}"), 'the title word missing');
});

check('payroll: the dot is decoration; the aria-label carries the word; absence is honest', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('aria-hidden'), 'the dot must be aria-hidden');
  assert(
    src.includes("${periodOutcome ? ` — last gate attempt ${periodOutcome}` : ''}"),
    'the aria-label word missing',
  );
  assert(src.includes('{periodOutcome ? ('), 'no outcome must render no dot');
});

// ── docs + tests ───────────────────────────────────────────────────────────
check('docs: the ledger doc links the gate-contract catalogue (one carried line)', () => {
  const src = read(DOC);
  assert(src.includes('## Related contracts'), 'the section missing');
  assert(src.includes('[docs/hr/payroll-run-lifecycle.md](./hr/payroll-run-lifecycle.md)'), 'the link missing');
  assert(src.includes('"Gate surfaces and contracts"'), 'the section name missing');
});

check('tests: the v2.146 suite exists and pins the round', () => {
  const src = read(TEST);
  assert(src.includes('deskDaySplit'), 'split coverage missing');
  assert(src.includes('deskSplitLabel'), 'label coverage missing');
  assert(src.includes('payroll-period-gate-outcome'), 'dot coverage missing');
  assert(src.includes('hr-timesheet-split'), 'desk split coverage missing');
  assert(src.includes('2026-13-99'), 'the calendar-impossible day must be pinned');
});

check('tests: the counters were re-anchored for the new head', () => {
  const src = read('src/tests/console-changelog.test.ts');
  assert(src.includes("expect(whatsNewUnreadCount('2.110.0')).toBe(35);"), 'counter 2.110.0 must read 35');
  assert(src.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(68);"), 'counter 2.77.0 must read 68');
});

// ── the family still stands ────────────────────────────────────────────────
check('family: the picker dot (v2.144.0) and lens trio (v2.144/145) untouched', () => {
  const payroll = stripComments(read(PAYROLL));
  const desk = stripComments(read(DESK));
  assert(payroll.includes('data-testid="payroll-gate-timeline-period-outcome"'), 'the picker dot must survive');
  assert(payroll.includes('data-testid="payroll-gate-timeline-lens"'), 'the outcome trio must survive');
  assert(desk.includes('data-testid="hr-timesheet-lens"'), 'the desk trio must survive');
  assert(desk.includes("DESK_LENS_STORAGE_KEY") || desk.includes('readDeskLensPref'), 'the persisted lens read must survive');
});

console.log(`\nverify-v2-146-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
