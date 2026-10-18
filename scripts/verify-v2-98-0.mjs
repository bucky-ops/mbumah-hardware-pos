#!/usr/bin/env node
// v2.98.0 verification — "payroll runs read as periods".
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
const LIB = read('src/lib/hr/payroll/run-groups.ts');
const PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
const TEST = read('src/tests/payroll-run-groups.test.ts');
const RUN_HISTORY = read('src/lib/hr/payroll/run-history.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.98.0', () => {
  assert(atLeast(PKG.version, '2.98.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.98.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.98.0'), 'baseVersion');
});

check('whats-new leads with 2.98.0 and tells the periods story', () => {
  const i98 = WN.indexOf("version: '2.98.0'");
  const i97 = WN.indexOf("version: '2.97.0'");
  assert(i98 >= 0, 'no 2.98.0 entry');
  assert(i97 > i98, '2.97.0 must follow 2.98.0 (newest first)');
  assert(WN.indexOf("title: 'Payroll runs read as periods'") > 0, 'missing periods headline');
  for (const phrase of [
    'settled net',
    'Honest money',
    'Periods fold',
    'never sneaks into the settled number',
  ]) {
    assert(WN.slice(i98, i97).includes(phrase), `2.98.0 bullets miss "${phrase}"`);
  }
});

// ── 2. The pure builder ─────────────────────────────────────────────────────
check('run-groups.ts exists, PURE (no db / network / env), contract documented', () => {
  assert(LIB.includes('groupRunsByPeriod'), 'missing export groupRunsByPeriod');
  assert(LIB.includes('PayrollPeriodGroup'), 'missing type PayrollPeriodGroup');
  assert(LIB.includes('RunGroupSource'), 'missing type RunGroupSource');
  assert(!/from ['"]@\/lib\/db['"]/.test(LIB), 'lib must not import the db');
  assert(!/process\.env/.test(LIB), 'lib must not read env');
  assert(!/fetch\(/.test(LIB), 'lib must not fetch');
  assert(LIB.includes('HONESTY CONTRACT'), 'honesty contract undocumented');
  assert(LIB.includes('PURE module'), 'purity undocumented');
});

check('settled predicate is exactly POSTED + LOCKED — nothing else joins the money', () => {
  const setBlock = LIB.split('SETTLED_RUN_STATUSES = [')[1].split('] as const')[0];
  assert(setBlock.includes('POSTED') && setBlock.includes('LOCKED'), 'settled set wrong');
  for (const never of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED', 'VOIDED']) {
    assert(!setBlock.includes(never), `${never} must never be settled`);
  }
});

check('VOIDED counts toward runCount and nothing else (closed door)', () => {
  const voidBranch = LIB.split("run.status === 'VOIDED'")[1]?.split('}')[0] ?? '';
  assert(voidBranch.includes('voidedCount++'), 'VOIDED branch must bump voidedCount');
  for (const never of ['settledNet', 'employeeCount', 'attentionCount', 'inMotionCount']) {
    assert(!voidBranch.includes(never), `VOIDED branch must not touch ${never}`);
  }
});

check('periods order by LATEST run, runs stay stable inside the period', () => {
  assert(LIB.includes("sort((a, b) =>"), 'missing period sort');
  assert(LIB.includes('latestRunAt'), 'missing latestRunAt');
  assert(LIB.includes('db - da'), 'must sort descending by latest run');
});

check('payslips are counted the honest way — settled runs only', () => {
  const settledBranch = LIB.split('if (settled(run.status))')[1]?.split('} else if')[0] ?? '';
  assert(settledBranch.includes('settledPayslips += run.employeeCount'), 'settled payslips must ride the settled branch');
  assert(settledBranch.includes('settledNet += Number(run.totalNet)'), 'settled net must ride the settled branch');
});

// ── 3. The page rides the builder ───────────────────────────────────────────
check('payroll page imports the builder and reads as periods', () => {
  assert(PAGE.includes("from '@/lib/hr/payroll/run-groups'"), 'page does not import run-groups');
  assert(PAGE.includes('groupRunsByPeriod(runs ?? [])'), 'page must fold the flat list');
  assert(PAGE.includes('Runs by period'), 'card title must say Runs by period');
  assert(PAGE.includes('settled net counts posted and locked runs\n                    only'), 'description must carry the honesty floor');
  assert(!PAGE.includes('>All runs<'), 'the old All-runs flat title must be gone');
  assert(!PAGE.includes('<TableHead>Period</TableHead>'), 'the per-row Period column must be gone (the group header owns the name)');
});

check('page carries the four period testids + aria affordances', () => {
  for (const tid of [
    'payroll-period-group',
    'payroll-period-toggle',
    'payroll-period-rollup',
    'payroll-period-net',
    'payroll-periods-toggle-all',
  ]) {
    assert(PAGE.includes(`data-testid="${tid}"`), `missing data-testid ${tid}`);
  }
  assert(PAGE.includes('aria-expanded={open}'), 'toggle must be aria-expanded');
  assert(PAGE.includes('Collapse all'), 'expand/collapse-all affordance missing');
});

check('the four rollup chips exist and settled/waiting/attention/voided each have a color', () => {
  for (const [label, tint] of [
    ['settled', 'emerald'],
    ['waiting', 'amber'],
    ['need attention', 'rose'],
    ['voided', 'zinc'],
  ]) {
    assert(PAGE.includes(`label: \`\${group.`), 'chips must be count-driven');
    assert(PAGE.includes(tint), `missing ${tint} tint for ${label}`);
  }
  assert(PAGE.includes('${group.settledCount} settled'), 'settled chip');
  assert(PAGE.includes('${group.inMotionCount} waiting'), 'waiting chip');
  assert(PAGE.includes('${group.attentionCount} need attention'), 'attention chip');
  assert(PAGE.includes('${group.voidedCount} voided'), 'voided chip');
});

check('prior payroll anchors survive: digest CSV, waiting-since, corrections, dialog', () => {
  assert(PAGE.includes('downloadRunDigestCsv'), 'digest export lost');
  assert(PAGE.includes('payroll-run-waiting-since'), 'v2.86.0 waiting-since anchor lost');
  assert(PAGE.includes('<PayrollCorrectionsPanel'), 'corrections tab lost');
  assert(PAGE.includes('<PayrollRunDialog'), 'run dialog lost');
  assert(PAGE.includes("['APPROVED', 'POSTED', 'LOCKED'].includes(run.status)"), 'digest gating lost');
});

// ── 4. The tests pin the contract ───────────────────────────────────────────
check('payroll-run-groups.test.ts executes the seeded October shape + honesty edges', () => {
  assert(TEST.includes('folds the seeded October 2026 console into ONE period'), 'seeded-shape case missing');
  assert(TEST.includes("expect(group!.settledNet).toBe(160000)"), 'settled-net honesty pin missing');
  assert(TEST.includes('expect(group!.settledPayslips).toBe(12)'), 'settled-payslips pin missing');
  assert(TEST.includes("run({ id: 'void', status: 'VOIDED' })"), 'voided edge missing');
  assert(TEST.includes("'SOMETHING_NEW'"), 'unknown-status edge missing');
  assert(TEST.includes('toBeCloseTo(1750.75, 2)'), 'numeric-sum pin missing');
  assert(TEST.includes("orderBy") === false && TEST.includes('LATEST run'), 'period-order case missing');
});

check('console-changelog re-anchored for the 2.98.0-fed feed', () => {
  const CC = read('src/tests/console-changelog.test.ts');
  assert(CC.includes("expect(whatsNewUnreadCount('2.96.0')).toBe(1);"), '2.96.0 flag count');
  assert(CC.includes("expect(whatsNewUnreadCount('2.95.0')).toBe(2);"), '2.95.0 flag count');
  assert(CC.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(20);"), '2.77.0 flag count');
  assert(CC.includes('v2.98.0-fed feed'), 're-anchor comment missing');
});

check('prior releases still told in the feed (2.97.0 / 2.96.0 anchors)', () => {
  assert(WN.includes('Every performance list files itself'), '2.97.0 story lost');
  assert(WN.includes('The performance page files itself'), '2.96.0 story lost');
  assert(RUN_HISTORY.includes('HONESTY CONTRACT'), 'run-history contract touched?');
});

// ── 5. Verify-script hygiene (drift-proof) ─────────────────────────────────
check('verify is deterministic: reads sources of record, not memory', () => {
  assert(read('scripts/verify-v2-98-0.mjs').includes('SOURCE OF RECORD'), 'hgiene comment missing');
});

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
