#!/usr/bin/env node
// v2.147.0 verification — "the gate passes the keyboard".
// Written fresh this round (never patch a prior round's copy — house lesson
// 25): every check reads the SOURCE OF RECORD, not memory. The emphasis is
// the EMS spec acceptance sweep: "No horizontal scroll on supported
// viewports" (the header wraps, the desk toolbar wraps, the desk table
// scrolls inside its own wrapper) and "Accessibility passes" (the scope
// trigger is named on the trigger itself, the split line is a <p> whose
// role accepts author naming). Comment-stripping before code searches
// (lesson 49); assert lines avoid nested-backtick single-quote traps
// (lesson 61 amendment — double-quoted strings throughout).

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

const LAYOUT = 'src/app/(shell)/hr/layout.tsx';
const DESK = 'src/app/(shell)/hr/timesheets/page.tsx';
const PAYROLL = 'src/app/(shell)/hr/payroll/page.tsx';
const CHANGELOG = 'CHANGELOG.md';
const FEED = 'src/lib/whats-new.ts';
const TEST = 'src/tests/a11y-sweep-v2147.test.ts';

// ── version + release discipline ───────────────────────────────────────────
check('version: package.json leads 2.147.0 (all three slots)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.version === '2.147.0', `version is ${pkg.version}`);
  assert(pkg.mbumah.releaseVersion === '2.147.0', `releaseVersion is ${pkg.mbumah.releaseVersion}`);
  assert(pkg.mbumah.baseVersion === '2.147.0', `baseVersion is ${pkg.mbumah.baseVersion}`);
  assert(pkg.scripts['verify:v2-147-0'], 'verify:v2-147-0 script missing');
});

check('release surfaces: changelog leads 2.147.0 and the feed leads 2.147.0', () => {
  const cl = read(CHANGELOG);
  assert(cl.indexOf('## [2.147.0] The gate passes the keyboard') !== -1, 'changelog section missing');
  const feed = read(FEED);
  assert(feed.indexOf("version: '2.147.0'") !== -1, 'feed entry missing');
  assert(feed.indexOf("version: '2.147.0'") < feed.indexOf("version: '2.146.0'"), 'feed order wrong');
  assert(feed.includes('The gate passes the keyboard'), 'feed title missing');
});

// ── acceptance line 1: no horizontal scroll on supported viewports ─────────
check('header: the row wraps (min-h replaces h-14) — the nav may drop to its own line', () => {
  const src = stripComments(read(LAYOUT));
  assert(src.includes('flex min-h-14 max-w-7xl flex-wrap items-center'), 'container lacks min-h-14 flex-wrap');
  assert(!src.includes('flex h-14 max-w-7xl'), 'fixed h-14 still present');
});

check('header: the nav wraps right-aligned — no hidden overflow for the ten links', () => {
  const src = stripComments(read(LAYOUT));
  assert(src.includes('ml-auto flex flex-wrap items-center justify-end gap-1'), 'nav lacks flex-wrap justify-end');
});

check('header: phone-compact link dress code with the desktop size pinned from sm:', () => {
  const src = stripComments(read(LAYOUT));
  assert(src.includes('whitespace-nowrap rounded-md px-2.5 py-1 text-[13px]'), 'mobile-compact classes missing');
  assert(src.includes('sm:px-3 sm:py-1.5 sm:text-sm'), 'sm: desktop dress code missing');
});

check('desk toolbar: the controls row wraps', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('<div className="flex flex-wrap items-center gap-2">'), 'toolbar lacks flex-wrap');
});

check('desk table: the shadcn scroll wrapper holds the desk table', () => {
  const src = stripComments(read(DESK));
  assert(src.includes('<div className="relative w-full overflow-x-auto">'), 'wrapper missing');
  const wrapperIdx = src.indexOf('<div className="relative w-full overflow-x-auto">');
  const tableIdx = src.indexOf('<Table data-testid="hr-timesheet-desk">');
  assert(wrapperIdx !== -1 && tableIdx !== -1 && tableIdx > wrapperIdx, 'table not inside wrapper');
});

check('payroll: the runs table keeps its own overflow wrapper (regression pin)', () => {
  const src = stripComments(read(PAYROLL));
  assert(src.includes('<div className="overflow-x-auto">'), 'runs table wrapper missing');
});

// ── acceptance line 2: accessibility passes ────────────────────────────────
check('desk: the scope trigger is named ON the trigger (Radix forwards it)', () => {
  const src = stripComments(read(DESK));
  const triggerIdx = src.indexOf('data-testid="hr-timesheet-scope-picker"');
  assert(triggerIdx !== -1, 'scope picker trigger missing');
  const openTagStart = src.lastIndexOf('<SelectTrigger', triggerIdx);
  const openTagEnd = src.indexOf('>', triggerIdx);
  const openTag = src.slice(openTagStart, openTagEnd);
  assert(
    openTag.includes('aria-label="Scope the timesheet desk to a payroll period"'),
    'trigger open tag lacks the aria-label'
  );
});

check('desk: the dead root-level aria-label is gone from the Select root', () => {
  const src = stripComments(read(DESK));
  const rootStart = src.indexOf('<Select');
  const rootEnd = src.indexOf('>', rootStart);
  const rootOpen = src.slice(rootStart, rootEnd);
  assert(!rootOpen.includes('aria-label'), 'Select root still carries an aria-label');
});

check('desk: the split line is a <p role="note"> (explicit role accepts author naming)', () => {
  const src = stripComments(read(DESK));
  const splitIdx = src.indexOf('data-testid="hr-timesheet-split"');
  assert(splitIdx !== -1, 'split element missing');
  const openTagStart = src.lastIndexOf('<p', splitIdx);
  assert(openTagStart !== -1, 'split is not opened by <p');
  const openTag = src.slice(openTagStart, splitIdx);
  assert(openTag.includes('role="note"'), 'split p lacks the explicit note role');
  assert(openTag.includes('m-0 inline-flex'), 'split p lacks m-0 inline-flex dress code');
  assert(!openTag.includes('<span'), 'unexpected span inside the p open tag');
  // And the old span opener is gone from the split entirely.
  const spanOpenIdx = src.lastIndexOf('<span', splitIdx);
  const between = src.slice(spanOpenIdx, splitIdx);
  assert(!between.includes('hr-timesheet-split'), 'a span still opens the split element');
});

check('desk: the split keeps its full-word aria-label and honesty title', () => {
  const src = stripComments(read(DESK));
  const splitIdx = src.indexOf('data-testid="hr-timesheet-split"');
  const window = src.slice(splitIdx, splitIdx + 400);
  assert(window.includes('aria-label='), 'split aria-label missing');
  assert(window.includes('title='), 'split honesty title missing');
});

// ── tests + docs self-reference ────────────────────────────────────────────
check('tests: a11y-sweep-v2147.test.ts exists and pins the same contracts', () => {
  const src = read(TEST);
  assert(src.includes('flex min-h-14 max-w-7xl flex-wrap'), 'test misses the container pin');
  assert(src.includes('Scope the timesheet desk to a payroll period'), 'test misses the trigger label pin');
  assert(src.includes('data-testid="hr-timesheet-split"'), 'test misses the split pin');
});

check('changelog: both acceptance lines are named verbatim in the 2.147.0 section', () => {
  const cl = read(CHANGELOG);
  const section = cl.slice(cl.indexOf('## [2.147.0]'), cl.indexOf('## [2.146.0]'));
  assert(section.includes('No horizontal scroll on supported viewports'), 'scroll line missing');
  assert(section.includes('Accessibility passes'), 'a11y line missing');
  assert(section.includes('### Fixed'), 'Fixed section missing');
  assert(section.includes('### Verified'), 'Verified section missing');
});

console.log(`\nverify-v2-147-0: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
