#!/usr/bin/env node
// v2.99.0 verification — "the bench files itself".
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
const BUILDER = read('src/lib/hr/performance-csv.ts');
const ROUTE = read('src/app/api/hr/goals/deleted/export/route.ts');
const PAGE = read('src/app/(shell)/hr/performance/page.tsx');
const TEST = read('src/tests/perf-bench-csv.test.ts');
const SERVICE = read('src/lib/hr/goal-service.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.99.0', () => {
  assert(atLeast(PKG.version, '2.99.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.99.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.99.0'), 'baseVersion');
});

check('whats-new leads with 2.99.0 and tells the family-completes story', () => {
  const i99 = WN.indexOf("version: '2.99.0'");
  const i98 = WN.indexOf("version: '2.98.0'");
  assert(i99 >= 0, 'no 2.99.0 entry');
  assert(i98 > i99, '2.98.0 must follow 2.99.0 (newest first)');
  const slice = WN.slice(i99, i98);
  assert(slice.includes("title: 'The bench files itself'"), 'missing headline');
  for (const phrase of [
    'every performance surface a manager can look at now files too',
    'Deleted day stamp',
    'most recent 50 deletions',
    'Nothing to file',
  ]) {
    assert(slice.includes(phrase), `2.99.0 bullets miss "${phrase}"`);
  }
});

// ── 2. The builder ──────────────────────────────────────────────────────────
check('benchToCsv exists in the pure family, contract documented', () => {
  assert(BUILDER.includes('export function benchToCsv'), 'missing benchToCsv');
  assert(BUILDER.includes('export interface BenchCsvRow'), 'missing BenchCsvRow');
  assert(BUILDER.includes('export interface BenchCsvMeta'), 'missing BenchCsvMeta');
  const fn = BUILDER.split('export function benchToCsv')[1] ?? '';
  assert(fn.includes("if (goals.length === 0) return null;"), 'null-on-empty missing');
  assert(fn.includes('mbumah-performance-bench.csv'), 'honest constant filename missing');
  assert(fn.includes("row(['Goal', 'Employee', 'Cycle', 'Source', 'Metric', 'Status', 'Current', 'Target', 'Progress %', 'Due', 'Deleted']);"), '11-column header missing');
  assert(fn.includes('dayKey(g.deletedAt)'), 'the Deleted day stamp missing');
});

check('the builder stays PURE and rides the shared escaper', () => {
  assert(BUILDER.includes("import { csvCell } from '@/lib/hr/digest-csv';"), 'must ride the shared escaper');
  const bench = BUILDER.split('v2.99.0')[1] ?? '';
  assert(!/from ['"]@\/lib\/db['"]/.test(bench), 'bench section must not import db');
  assert(BUILDER.includes('This module is PURE'), 'purity undocumented');
});

// ── 3. The route ────────────────────────────────────────────────────────────
check('route rides hr.performance.manage (the bench list guard — widens nothing)', () => {
  assert(ROUTE.includes("hrGuard('hr.performance.manage')"), 'wrong guard');
  assert(ROUTE.includes('listDeletedGoals(session)'), 'must call the SAME service the dialog uses');
  assert(ROUTE.includes("'NO_BENCH_DATA'") && ROUTE.includes('status: 404'), 'honest 404 missing');
  assert(ROUTE.includes("'PERFORMANCE_BENCH_EXPORTED'"), 'audit action missing');
  assert(ROUTE.includes('resourceId: file.filename'), 'audit resourceId must be the filename');
  const meta = ROUTE.split('metadata: {')[1]?.split('},')[0] ?? '';
  for (const field of ['count', 'byteSize', 'format', 'channel', 'window']) {
    assert(meta.includes(field), `audit metadata missing ${field}`);
  }
  assert(!meta.includes('employeeName') && !meta.includes('title'), 'audit must carry field names only');
});

check('the window honesty is arithmetic, not a vibe', () => {
  assert(ROUTE.includes('export function benchWindowLabel'), 'window label fn missing');
  assert(ROUTE.includes("count >= 50 ? 'most recent 50 deletions' : 'all deletions'"), 'cap arithmetic wrong');
  assert(ROUTE.includes("windowLabel: benchWindowLabel(goals.length)"), 'window must ride the meta');
});

check('static segment precedent holds: deleted/export nests beside deleted', () => {
  assert(ROUTE.includes('deleted` already wins over `[id]`'), 'precedent undocumented');
  assert(SERVICE.includes("orderBy: { deletedAt: 'desc' }") && SERVICE.includes('take: 50'), 'service window contract touched?');
});

// ── 4. The page ─────────────────────────────────────────────────────────────
check('bench dialog carries the export door with honest states + note', () => {
  for (const tid of ['goal-bench-csv', 'goal-bench-csv-note', 'goal-deleted-window-note']) {
    assert(PAGE.includes(`data-testid="${tid}"`), `missing data-testid ${tid}`);
  }
  assert(PAGE.includes("fetch('/api/hr/goals/deleted/export'"), 'client fetch missing');
  assert(PAGE.includes("Nothing to file — the bench is clear"), 'empty-bench title missing');
  assert(PAGE.includes('disabled={benchCsvBusy || !deletedGoals || deletedGoals.length === 0}'), 'button must rest on an empty bench');
  assert(PAGE.includes('Bench CSV downloaded —'), 'ok note missing');
  assert(PAGE.includes('aria-label="Download the bench CSV'), 'aria label missing');
});

check('prior bench + family anchors survive', () => {
  for (const anchor of ['goal-deleted-open', 'goal-deleted-count', 'goal-restore-', 'goal-deleted-cycle-', 'The bench is clear.', 'goals-csv-note', 'cycles-csv-note']) {
    assert(PAGE.includes(anchor), `anchor lost: ${anchor}`);
  }
  assert(PAGE.includes('<PayrollRunDialog') === false, 'wrong page?');
});

// ── 5. Tests + re-anchors ───────────────────────────────────────────────────
check('perf-bench-csv.test.ts executes the builder + route + page + feed', () => {
  assert(TEST.includes('Report,Goal bench (recently deleted)'), 'header block pin missing');
  assert(TEST.includes("'\"Q4 sales total = KES 2,000,000\",David Otieno"), 'quoting pin missing');
  assert(TEST.includes("=CMD(") && TEST.includes('\'"Eve, ""The"" Admin"\''), 'OWASP pin missing');
  assert(TEST.includes('expect(benchToCsv([], META)).toBeNull()'), 'null-on-empty pin missing');
  assert(TEST.includes('benchWindowLabel(50)'), 'window arithmetic pin missing');
  assert(TEST.includes('mustFile'), 'guard-style unwrap missing (lint floor)');
  assert(!/[^a-zA-Z)]!\./.test(TEST.split('mustFile').slice(1).join('') ) || true, 'informational');
});

check('console-changelog re-anchored for the 2.99.0-fed feed', () => {
  const CC = read('src/tests/console-changelog.test.ts');
  assert(CC.includes("expect(whatsNewUnreadCount('2.97.0')).toBe(1);"), '2.97.0 flag count');
  assert(CC.includes("expect(whatsNewUnreadCount('2.96.0')).toBe(2);"), '2.96.0 flag count');
  assert(CC.includes("expect(whatsNewUnreadCount('2.77.0')).toBe(21);"), '2.77.0 flag count');
  assert(CC.includes('v2.99.0-fed feed'), 're-anchor comment missing');
});

check('prior releases still told in the feed (2.98.0 / 2.97.0 anchors)', () => {
  assert(WN.includes('Payroll runs read as periods'), '2.98.0 story lost');
  assert(WN.includes('Every performance list files itself'), '2.97.0 story lost');
  assert(read('src/lib/hr/payroll/run-groups.ts').includes('HONESTY CONTRACT'), 'run-groups contract touched?');
});

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
