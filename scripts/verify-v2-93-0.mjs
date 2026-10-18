#!/usr/bin/env node
// v2.93.0 verification — "the bench remembers: deleted goals come home".
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
const PAGE = read('src/app/(shell)/hr/performance/page.tsx');
const SERVICE = read('src/lib/hr/goal-service.ts');
const DELETED_ROUTE = read('src/app/api/hr/goals/deleted/route.ts');
const RESTORE_ROUTE = read('src/app/api/hr/goals/[id]/restore/route.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.93.0', () => {
  assert(atLeast(PKG.version, '2.93.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.93.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.93.0'), 'baseVersion');
});

// ── 2. What's-New 2.93.0 leads the feed ─────────────────────────────────────
check("What's-New 2.93.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.93.0'");
  assert(at > -1, '2.93.0 entry missing');
  assert(at < WN.indexOf("version: '2.92.0'"), '2.93.0 does not lead');
  assert(/The bench remembers/.test(WN), 'title missing');
  assert(/Recently deleted/.test(WN), 'bench bullet missing');
  assert(/same target, same progress, same status/.test(WN), 'restore bullet missing');
  assert(/manage-gated like the delete/.test(WN), 'gate bullet missing');
});

// ── 3. The service: restore is an honest undo ───────────────────────────────
check('restoreGoal clears deletedAt, refuses live goals, audits GOAL_RESTORED', () => {
  const body = SERVICE.split('export async function restoreGoal')[1]?.split('\n}')[0] ?? '';
  assert(body.includes('loadGoalIncludingDeleted(goalId, session)'), 'deleted-aware loader missing');
  assert(body.includes('GOAL_NOT_DELETED'), 'GOAL_NOT_DELETED missing');
  assert(body.includes('deletedAt: null'), 'deletedAt clear missing');
  assert(body.includes("action: 'GOAL_RESTORED'"), 'audit missing');
  assert(body.includes('title: goal.title'), 'audit title missing');
  assert(!/\.delete\(/.test(body), 'hard delete in restore');
});

check('the restore loader reads past the soft delete but stays scope-aware; loadGoal untouched', () => {
  const loader = SERVICE.split('async function loadGoalIncludingDeleted')[1]?.split('\n}')[0] ?? '';
  assert(!loader.includes('deletedAt: null'), 'loader must not filter live rows');
  assert(loader.includes('employeeInScope(goal.employee, session)'), 'scope check missing');
  const loadGoal = SERVICE.split('async function loadGoal(')[1]?.split('\n}')[0] ?? '';
  assert(loadGoal.includes('deletedAt: null'), 'loadGoal contract drifted');
});

check('the bench lists soft-deleted goals, newest first, stamped honestly', () => {
  const body = SERVICE.split('export async function listDeletedGoals')[1]?.split('\n}')[0] ?? '';
  assert(body.includes('deletedAt: { not: null }'), 'filter missing');
  assert(body.includes("orderBy: { deletedAt: 'desc' }"), 'order missing');
  assert(body.includes('employeeScopeWhere(session)'), 'scope missing');
  assert(body.includes('take: 50'), 'take missing');
  assert(body.includes('deletedAt: g.deletedAt.toISOString()'), 'stamp missing');
  assert(!/deletedAt!|\bas Date\b/.test(body), 'dishonest narrowing present');
});

// ── 4. The routes: manage-gated, as-narrow ──────────────────────────────────
check('GET /api/hr/goals/deleted is manage-guarded and serves the bench', () => {
  assert(/export const GET = hrGuard\('hr\.performance\.manage'\)/.test(DELETED_ROUTE), 'guard missing');
  assert(DELETED_ROUTE.includes('listDeletedGoals(session)'), 'service call missing');
});

check('POST /api/hr/goals/[id]/restore is manage-guarded with the as-narrow pattern', () => {
  assert(/export const POST = hrGuard\('hr\.performance\.manage'\)/.test(RESTORE_ROUTE), 'guard missing');
  assert(RESTORE_ROUTE.includes('restoreGoal(id, session)'), 'service call missing');
  assert(RESTORE_ROUTE.includes('(context as HrRouteContext).params'), 'as-narrow missing');
  assert(!/context!/.test(RESTORE_ROUTE), 'non-null assertion present');
});

// ── 5. The console: the bench door ──────────────────────────────────────────
check('the Goals tab grows a manage-gated Recently deleted door with a live count', () => {
  assert(/data-testid="goal-deleted-open"/.test(PAGE), 'door missing');
  assert(/data-testid="goal-deleted-count"/.test(PAGE), 'count missing');
  assert(PAGE.includes('openDeletedBench'), 'fresh fetch missing');
  assert(/apiGet<DeletedGoalDto\[\]>\('\/api\/hr\/goals\/deleted'\)\.catch\(\(\) => \[\] as DeletedGoalDto\[\]\)/.test(PAGE), 'load-ride-along missing');
});

check('the bench dialog speaks the delete\u2019s honesty; rows carry restore in emerald', () => {
  assert(/data-testid="goal-deleted-dialog"/.test(PAGE), 'dialog missing');
  assert(PAGE.includes('nothing is ever\n              hard-deleted'), 'honesty copy missing');
  assert(PAGE.includes('same target, same progress, same status'), 'restore-promise copy missing');
  assert(/data-testid=\{`goal-restore-\$\{g\.id\}`\}/.test(PAGE), 'restore button missing');
  assert(/aria-label=\{`Restore goal \$\{g\.title\}`\}/.test(PAGE), 'restore aria missing');
  assert(/apiSend\(`\/api\/hr\/goals\/\$\{g\.id\}\/restore`, 'POST'\)/.test(PAGE), 'restore verb missing');
  assert(/data-testid="goal-deleted-empty"/.test(PAGE) && PAGE.includes('The bench is clear.'), 'empty state missing');
  assert(/border-emerald-300 text-emerald-700/.test(PAGE), 'emerald family missing');
  assert(/data-testid=\{`goal-deleted-row-\$\{g\.id\}`\}/.test(PAGE), 'row testid missing');
  assert(PAGE.includes('deleted {formatDate(g.deletedAt)}'), 'when-it-left stamp missing');
});

// ── 6. Privacy floor + prior anchors ────────────────────────────────────────
check('privacy floor holds — no ratings or narratives in the goal family (bench included)', () => {
  const goalSlice = PAGE.split('TabsContent value="goals"')[1]?.split('</Tabs>')[0] ?? '';
  assert(!/overallRating|strengths|improvements/i.test(goalSlice), 'ratings leaked into goals tab');
  const benchSlice = PAGE.split('data-testid="goal-deleted-dialog"')[1]?.split('</Dialog>')[0] ?? '';
  assert(!/overallRating|strengths|improvements/i.test(benchSlice), 'ratings leaked into bench');
});

check('prior anchors hold — v2.92 delete + custom, v2.91 door + edit, v2.90 picker, v2.89 chips', () => {
  assert(/data-testid="goal-delete-dialog"/.test(PAGE), 'v2.92 delete dialog');
  assert(/data-testid="goal-custom-label"/.test(PAGE), 'v2.92 custom label');
  assert(/data-testid="perf-auth"/.test(PAGE), 'v2.92 auth door');
  assert(/data-testid="goal-edit-dialog"/.test(PAGE), 'v2.91 edit dialog');
  assert(/data-testid="goal-cycle-picker"/.test(PAGE), 'v2.90 cycle picker');
  assert(/data-testid=\{`goal-filter-status-\$\{s\}`\}/.test(PAGE), 'v2.89 chips');
});

console.log(`\nv2.93.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
