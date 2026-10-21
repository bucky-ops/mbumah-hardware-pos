#!/usr/bin/env node
// v2.202.0 verification — "the org's quiet row".
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
const DOORS = read('src/components/org/desk-doors.tsx');
const CONSOLE = read('src/components/workspace/org-console.tsx');
const CHANGELOG = read('CHANGELOG.md');
const A11Y = read('docs/a11y/contrast-math.md');
const TEST = read('src/tests/desk-doors-v2202.test.ts');
const CONTRAST = read('scripts/contrast-math-desk-doors-v2202.mjs');

// ── the version ──
check('the version rides at 2.202.0 in all three slots', () => {
  assert(PKG.version === '2.202.0', `version ${PKG.version}`);
  assert(PKG.mbumah.releaseVersion === '2.202.0', 'releaseVersion');
  assert(PKG.mbumah.baseVersion === '2.202.0', 'baseVersion');
  assert(PKG.scripts['verify:v2-202-0'] === 'node scripts/verify-v2-202-0.mjs', 'verify script wired');
});

// ── the doors' file ──
check('the registry speaks all six metrics in the face hues', () => {
  for (const id of ['revenue', 'transactions', 'lowStock', 'overdueRentals', 'debt', 'pendingMpesa']) {
    assert(DOORS.includes(`${id}: {`), `metric ${id}`);
  }
  for (const h of ['orange', 'blue', 'amber', 'rose', 'red', 'indigo']) {
    assert(DOORS.includes(`hue: '${h}'`), `hue ${h}`);
  }
});

check('the branch-slice modal carries the honest anatomy', () => {
  assert(DOORS.includes('export function BranchSliceModal'), 'the modal');
  assert(DOORS.includes('org-desk-total-${metric.id}'), 'the total handle');
  assert(DOORS.includes('org-desk-row-${metric.id}'), 'the row handle');
  assert(DOORS.includes('org-desk-share-${metric.id}'), 'the share handle');
  assert(DOORS.includes('org-desk-quiet-${metric.id}'), 'the quiet voice');
  assert(DOORS.includes('org-desk-window'), 'the window note');
  assert(DOORS.includes('org-desk-clear-${metric.id}'), 'the clear line');
  assert(DOORS.includes('org-desk-empty'), 'the empty step-aside');
});

check('the honesty laws hold at source', () => {
  assert(DOORS.includes('if (total <= 0) return null;'), 'the zero-total share rule');
  assert(DOORS.includes('At zero: '), 'the quiet branches speak their 0');
  assert(DOORS.includes('.sort((a, b) => b.value - a.value)'), 'the loudest-first sort');
  assert(!DOORS.includes('href='), 'the no-anchors law');
  assert(DOORS.includes('dark:border-slate-700 dark:bg-slate-900'), 'the dark-panel law');
  assert(!DOORS.includes("from '@/lib/db'"), 'no db import');
});

// ── the wiring ──
check('the six cards are doors with the family faces', () => {
  for (const id of ['revenue', 'transactions', 'lowStock', 'overdueRentals', 'debt', 'pendingMpesa']) {
    assert(CONSOLE.includes(`org-desk-card-${id}`), `card handle ${id}`);
    assert(CONSOLE.includes(`setDeskDoor('${id}')`), `door state ${id}`);
  }
  assert(CONSOLE.includes('doorHot: summary ? ORG_DESK_METRICS[id].total(summary) > 0 : false'), 'the honest hot ring');
  assert(CONSOLE.includes('aria-label={`${label} - open details`}'), 'the open-details voice');
  assert((CONSOLE.match(/<BranchSliceModal/g) || []).length === 1, 'one modal mount');
});

check('the HR tiles keep their hrefs (they were never quiet)', () => {
  assert(CONSOLE.includes('href="/hr/reports?tab=headcount"'), 'headcount');
  assert(CONSOLE.includes('href="/hr/payroll"'), 'payroll');
});

// ── the style ──
check('the alignment is honest: the overdue cell rides red-700', () => {
  assert(CONSOLE.includes('text-red-700 font-medium'), 'the re-voice');
  assert(!CONSOLE.includes('text-red-600'), 'no -600 text voice rides');
  assert(CONTRAST.includes('RECORDED HONESTLY as ALIGNMENT, not violation'), 'the record');
});

check('the voice lint bans the double-currency class', () => {
  const out = execSync('node scripts/voice-lint.mjs', { encoding: 'utf8' });
  assert(out.includes('clean'), `lint output: ${out.slice(0, 120)}`);
});

// ── the release surfaces ──
check('the whats-new feed heads the release', () => {
  assert(WN.includes("version: '2.202.0'"), 'the entry');
  assert(WN.indexOf("version: '2.202.0'") < WN.indexOf("version: '2.201.1'"), 'the order');
});

check('the a11y doc records the round', () => {
  assert(A11Y.includes('2.202.0'), 'the section');
  assert(A11Y.includes('36/36'), 'the probe record');
});

check('the changelog keeps the round above its predecessor', () => {
  const i202 = CHANGELOG.indexOf('## [2.202.0]');
  assert(i202 > -1, 'the section exists');
  assert(i202 < CHANGELOG.indexOf('## [2.201.1]'), 'the order');
});

check("the round's test file exists and pins the round", () => {
  assert(TEST.includes('the org'), 'headline');
  assert(TEST.includes('org-desk-card-revenue'), 'card pin');
  assert(TEST.includes("'2.202.0'"), 'version pin context');
});

console.log(`\n${pass}/${pass + fail} checks pass`);
process.exit(fail > 0 ? 1 : 0);
