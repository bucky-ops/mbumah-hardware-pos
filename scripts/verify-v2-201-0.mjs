#!/usr/bin/env node
// v2.201.0 verification — "the debt book and the movers speak".
// Written fresh this round (never patch a prior round's copy): every
// check reads the SOURCE OF RECORD, not memory.

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

const PKG = JSON.parse(read('package.json'));
const WN = read('src/lib/whats-new.ts');
const DOORS = read('src/components/dashboard/branch-doors.tsx');
const TAB = read('src/app/(shell)/tabs/dashboard-tab.tsx');
const ROUTE = read('src/app/api/dashboard/route.ts');
const KPI_DOORS = read('src/components/dashboard/kpi-doors.tsx');
const CHANGELOG = read('CHANGELOG.md');
const A11Y = read('docs/a11y/contrast-math.md');
const WORKSPACE = read('docs/multi-store-workspaces.md');
const TEST = read('src/tests/branch-quiet-doors-v2201.test.ts');
const CONTRAST = read('scripts/contrast-math-branch-doors-v2201.mjs');

// ── the version ──
check('the version rides at 2.201.0 in all three slots', () => {
  assert(PKG.version === '2.201.1', `version ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.201.1', 'releaseVersion');
  assert(PKG.mbumah.baseVersion === '2.201.1', 'baseVersion');
  assert(PKG.scripts['verify:v2-201-0'] === 'node scripts/verify-v2-201-0.mjs', 'verify script wired');
});

// ── the doors' file ──
check('the debt book door exists with its honest anatomy', () => {
  assert(DOORS.includes('export function DebtBookModal'), 'the modal');
  assert(DOORS.includes('data-testid="branch-debt-count"'), 'count');
  assert(DOORS.includes('data-testid="branch-debt-bar"'), 'bar');
  assert(DOORS.includes('branch-debt-bucket-${b.key}'), 'bucket cells');
  assert(DOORS.includes('data-testid="branch-debt-row"'), 'named rows');
  assert(DOORS.includes('data-testid="branch-debt-window"'), 'window note');
  assert(DOORS.includes('data-testid="branch-debt-clear"'), 'clear line');
  assert(DOORS.includes('data-testid="branch-debt-hot"'), 'high-risk line');
  assert(DOORS.includes('data-testid="branch-debt-banner"'), 'banner');
});

check("the movers door exists with the window + the category mix", () => {
  assert(DOORS.includes('export function MoversModal'), 'the modal');
  assert(DOORS.includes('data-testid="branch-movers-count"'), 'count');
  assert(DOORS.includes('data-testid="branch-movers-top"'), 'loudest voice');
  assert(DOORS.includes('data-testid="branch-movers-cat-row"'), 'category mix');
  assert(DOORS.includes('data-testid="branch-movers-window"'), 'window note');
  assert(DOORS.includes('data-testid="branch-movers-clear"'), 'clear line');
});

check('the honesty laws hold at source', () => {
  assert(DOORS.includes('if (total <= 0) return null;'), 'the zero-total share rule');
  assert(DOORS.includes('cats.length > 0 && catTotal > 0'), 'the mix silence');
  assert(DOORS.includes("owes more than twice their"), 'the wire risk voice');
  assert(!DOORS.includes('2 *') && !DOORS.includes('* 2'), 'no client re-derivation of the 2x rule');
  assert(!DOORS.includes('href='), 'the no-anchors law');
  assert(DOORS.includes('dark:border-slate-700 dark:bg-slate-900'), 'the dark-panel law');
});

check('the doors compose the wire, never fork it', () => {
  assert(ROUTE.includes('debtCrisis: insights.debtCrisis'), 'the crisis on the wire');
  assert(ROUTE.includes('topSellingCategories: topSellingCategoriesResult'), 'the categories on the wire');
  assert(!DOORS.includes("from '@/lib/db'"), 'no db import');
  assert(TAB.includes('topSellingCategories?: Array<{'), 'the tab structural subset');
  assert(!TAB.includes('interface BranchDebtWire'), 'no forked type');
});

// ── the wiring ──
check('the two cards are doors in the family vocabulary', () => {
  assert(TAB.includes('data-testid="branch-debt-card"'), 'the debt handle');
  assert(TAB.includes('aria-label="Debt aging summary - open details"'), 'the debt voice');
  assert(TAB.includes('data-testid="branch-movers-card"'), 'the movers handle');
  assert(TAB.includes('aria-label="Top selling products - open details"'), 'the movers voice');
  assert(TAB.includes('w-1 bg-rose-600'), 'the rose edge');
  assert(TAB.includes('w-1 bg-violet-600'), 'the violet edge');
  assert(TAB.includes('<DebtBookModal'), 'the debt modal mount');
  assert(TAB.includes('<MoversModal'), 'the movers modal mount');
});

// ── the sweep ──
check('the -600 straggler family is GONE from the branch dashboard', () => {
  assert(!TAB.includes('text-red-600'), 'no red-600 text');
  assert(!TAB.includes('text-rose-600'), 'no rose-600 text');
  assert(TAB.includes('bg-red-700 px-1.5 text-[10px] font-bold text-white'), 'the badge fix');
  assert(TAB.includes("DEBT: 'bg-rose-100 text-rose-700'"), 'the DEBT chip fix');
  assert(TAB.includes("GIFT_CARD: 'bg-slate-100 text-slate-600'"), 'the GIFT chip fix');
  assert(TAB.includes("circle: 'bg-red-100 text-red-700'"), 'the critical chip fix');
  assert(TAB.includes("'bg-red-50 text-red-700'"), 'the banner/trend fix');
  assert(!DOORS.includes('text-rose-600'), 'the doors speak the aligned voice');
});

check('the v2.200.0 carried nit is fixed', () => {
  assert(KPI_DOORS.includes("${maxCount === 1 ? 'receipt' : 'receipts'}"), 'the pluralization fix');
});

check("the round's contrast script carries the ghosts in reverse", () => {
  assert(CONTRAST.includes("checkBug('  ghost: white on red-500 (the badge draft)'"), 'badge ghost');
  assert(CONTRAST.includes("checkBug('  ghost: rose-600 on rose-100 (the DEBT chip draft)'"), 'chip ghost');
  assert(CONTRAST.includes('RECORDED HONESTLY as ALIGNMENT, not violation'), 'the alignment record');
});

// ── the release surfaces ──
check("the workspace doc's door register carries the new doors", () => {
  assert(WORKSPACE.includes('v2.201.0'), 'register row');
  assert(WORKSPACE.includes('debt book'), 'ledger name');
  assert(WORKSPACE.includes("The day's movers"), 'movers name');
});

check('the a11y doc records the sweep', () => {
  assert(A11Y.includes('2.201.'), 'the section');
  assert(A11Y.includes('3.82:1'), 'the badge find');
  assert(A11Y.includes('red-700'), 'the fixes');
});

check('the changelog keeps the round above its predecessor', () => {
  const i201 = CHANGELOG.indexOf('## [2.201.0] The debt book and the movers speak');
  assert(i201 > -1, 'the section exists');
  assert(i201 < CHANGELOG.indexOf('## [2.200.0] The branch row speaks'), 'the order');
});

check("the round's test file exists and pins the round", () => {
  assert(TEST.includes('the debt book and the movers'), 'headline');
  assert(TEST.includes('data-testid="branch-debt-card"'), 'card pin');
  assert(TEST.includes("'2.201.1'"), 'version pin context');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
