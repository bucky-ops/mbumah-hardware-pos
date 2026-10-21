#!/usr/bin/env node
// v2.203.0 verification — "the week speaks".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');
const DOORS = read('src/components/dashboard/branch-doors.tsx');
const TAB = read('src/app/(shell)/tabs/dashboard-tab.tsx');
const CHANGELOG = read('CHANGELOG.md');
const A11Y = read('docs/a11y/contrast-math.md');
const TEST = read('src/tests/branch-week-door-v2203.test.ts');
const PROBE = read('scripts/probe-week-doors-v2203.mjs');
const CONTRAST = read('scripts/contrast-math-week-doors-v2203.mjs');

// ── the version ──
check('the version rides at 2.203.0 in all three slots', () => {
  assert(PKG.version === '2.203.0', `version ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.203.0', 'releaseVersion');
  assert(PKG.mbumah.baseVersion === '2.203.0', 'baseVersion');
  assert(PKG.scripts['verify:v2-203-0'] === 'node scripts/verify-v2-203-0.mjs', 'verify script wired');
});

// ── the week door ──
check('the week wire is a structural subset with coercion-ready money', () => {
  assert(DOORS.includes('export interface BranchWeekWire'), 'the wire');
  for (const f of ['date: string;', 'label: string;', 'revenue: number | string;', 'isToday: boolean;']) {
    assert(DOORS.includes(f), `field ${f.trim()}`);
  }
  assert(DOORS.includes('forecast?: number | string;'), 'forecast on the wire');
  assert(DOORS.includes('forecastMethod?: string | null;'), 'method on the wire');
  assert(DOORS.includes('todayIsOutlier?: boolean;'), 'outlier flag on the wire');
});

check('the modal carries the honest anatomy', () => {
  assert(DOORS.includes('export function WeekLedgerModal'), 'the modal');
  assert(DOORS.includes('branch-week-total'), 'the total handle');
  assert(DOORS.includes('branch-week-meta'), 'the meta line');
  assert(DOORS.includes('branch-week-loudest'), 'the loudest line');
  assert(DOORS.includes('branch-week-row'), 'the day row');
  assert(DOORS.includes('branch-week-share'), 'the share voice');
  assert(DOORS.includes('branch-week-today-chip'), 'the today chip');
  assert(DOORS.includes('branch-week-zero'), 'the zero-day voice');
  assert(DOORS.includes('branch-week-forecast'), 'the forecast block');
  assert(DOORS.includes('branch-week-delta'), "today's progress");
  assert(DOORS.includes('branch-week-outlier'), 'the outlier voice');
  assert(DOORS.includes('branch-week-window'), 'the window note');
  assert(DOORS.includes('branch-week-empty'), 'the empty step-aside');
});

check('the honesty laws hold at source', () => {
  assert(DOORS.includes('if (total <= 0) return null;'), 'the zero-total share rule (the one share writer)');
  assert(DOORS.includes('a week is a timeline, not a ranking'), 'the calendar-order law (no reorder)');
  assert(DOORS.includes('.filter((d): d is NonNullable<typeof d> => !!d && d.date != null)'), 'the predicate-filter law');
  assert(!DOORS.includes('href='), 'the no-anchors law');
  assert(DOORS.includes('dark:border-slate-700 dark:bg-slate-900'), 'the dark-panel law');
  assert(DOORS.includes('no sales'), 'zero days speak, never dropped');
});

check("today's progress is honest: only when both figures are real", () => {
  assert(DOORS.includes('todayShare = today && forecast > 0 ? shareOf(today.revenue, forecast) : null'), 'the share-of-a-zero-forecast rule');
  assert(DOORS.includes('Today so far '), 'the progress read (never an UP/DOWN verdict)');
});

// ── the wiring ──
check('the trend card is a door with the family face', () => {
  assert(TAB.includes('data-testid="branch-week-card"'), 'the card handle');
  assert(TAB.includes('aria-label="Sales trend - open details"'), 'the open-details voice');
  assert(TAB.includes('onKeyDown={(e: React.KeyboardEvent) => { if (e.key === \'Enter\' || e.key === \' \') { e.preventDefault(); setWeekOpen(true); } }}'), 'the keyboard law');
  assert(TAB.includes('<span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-emerald-600" />'), 'the emerald edge bar');
  assert(TAB.includes('<WeekLedgerModal'), 'the modal mount');
  assert(TAB.includes('trend={data?.revenueTrend7d ?? null}'), 'the wire fed straight from the answer');
  assert(TAB.indexOf('const [weekOpen, setWeekOpen] = useState(false);') < TAB.indexOf('const trend: RevenueTrend7d'), 'the hook-order law');
});

check('the dot is honest: lit only when the week has data', () => {
  assert(TAB.includes("{hasData ? <span aria-hidden=\"true\" className=\"absolute right-3 top-3 h-2 w-2 rounded-full bg-emerald-600 anim-pulse-dot\" /> : null}"), 'the live dot gate');
  assert(TAB.includes("hasData ? 'ring-1 ring-slate-300 dark:ring-slate-600' : ''"), 'the quiet-ring gate');
});

// ── the style ──
check('the forecast line rides amber-600 and the ghost is pinned in reverse', () => {
  assert(TAB.includes('stroke="#d97706"'), 'the chart line re-voice');
  assert(TAB.includes('border-dashed border-amber-600'), 'the legend swatch re-voice');
  // the ghost is scoped to the trend card's own body — the tab's OTHER
  // #f59e0b voices (the M-Pesa donut segment, the health bar) are
  // pre-existing surfaces with their figures spoken beside them, out of
  // this round's scope, recorded honestly.
  const card = TAB.slice(TAB.indexOf('function SalesTrendForecastCard'), TAB.indexOf('function DebtAgingCard'));
  assert(!card.includes('#f59e0b'), 'the amber-500 voice is gone from the trend card');
  assert(!card.includes('border-amber-500'), 'the amber-500 swatch is gone from the trend card');
  assert(PROBE.includes('GHOST amber-500 forecast line pinned BELOW the bar (in reverse)'), 'the ghost pin in the probe');
  assert(CONTRAST.includes('GHOST amber-500 forecast line pinned BELOW the bar (reverse)'), 'the ghost pin in the math');
});

check('the day labels grew to 10px and today wears the chip', () => {
  assert(TAB.includes('flex justify-between px-0.5 text-[10px] text-slate-500'), 'the 10px row');
  assert(TAB.includes("rounded-full bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"), 'the today chip voice');
  assert(!TAB.includes('text-[9px] text-slate-500'), 'the 9px row is gone from the card');
});

check('the voice lint still bans the double-currency class', () => {
  const out = execSync('node scripts/voice-lint.mjs', { encoding: 'utf8' });
  assert(out.includes('clean'), `lint output: ${out.slice(0, 120)}`);
});

// ── the release surfaces ──
check('the whats-new feed heads the release (ORDER pattern)', () => {
  assert(WN.includes("version: '2.203.0'"), 'the entry');
  assert(WN.indexOf("version: '2.203.0'") < WN.indexOf("version: '2.202.1'"), 'the order');
});

check('the a11y doc records the round', () => {
  assert(A11Y.includes('v2.203.0'), 'the section');
  assert(A11Y.includes('16/16'), 'the probe record');
  assert(A11Y.includes('18/18'), 'the math record');
});

check('the changelog keeps the round above its predecessor', () => {
  const i203 = CHANGELOG.indexOf('## [2.203.0]');
  assert(i203 > -1, 'the section exists');
  assert(i203 < CHANGELOG.indexOf('## [2.202.1]'), 'the order');
});

check("the round's test file exists and pins the round", () => {
  assert(TEST.includes('the week'), 'headline');
  assert(TEST.includes('branch-week-card'), 'card pin');
  assert(TEST.includes("'2.203.0'"), 'version pin context');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
