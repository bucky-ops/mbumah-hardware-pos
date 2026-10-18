#!/usr/bin/env node
// v2.92.0 verification — "the goals can leave, and the custom metric
// has a name". Written fresh this round (never patch a prior round's
// copy): every check reads the SOURCE OF RECORD, not memory.

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
const VIEW = read('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
const SERVICE = read('src/lib/hr/goal-service.ts');
const ROUTE = read('src/app/api/hr/goals/[id]/route.ts');
const SELF = read('src/lib/hr/self-service.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.92.0', () => {
  assert(atLeast(PKG.version, '2.92.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.92.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.92.0'), 'baseVersion');
});

// ── 2. What's-New 2.92.0 leads the feed ─────────────────────────────────────
check("What's-New 2.92.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.92.0'");
  assert(at > -1, '2.92.0 entry missing');
  assert(at < WN.indexOf("version: '2.91.0'"), '2.92.0 does not lead');
  assert(/The goals can leave/.test(WN), 'title missing');
  assert(/never a hard one/.test(WN), 'soft-delete bullet missing');
  assert(/Custom metrics go end-to-end/.test(WN), 'custom bullet missing');
  assert(/sign-in panel/.test(WN), 'sign-in door bullet missing');
});

// ── 3. The soft delete ──────────────────────────────────────────────────────
check('deleteGoal is a scope-aware soft delete with a GOAL_DELETED audit', () => {
  const body = SERVICE.split('export async function deleteGoal')[1]?.split('\n}')[0] ?? '';
  assert(body.includes('loadGoal(goalId, session)'), 'loadGoal missing');
  assert(body.includes('deletedAt: new Date()'), 'soft delete missing');
  assert(body.includes("action: 'GOAL_DELETED'"), 'audit missing');
  assert(body.includes('title: goal.title'), 'audit metadata thin');
  assert(!/\.delete\(/.test(body), 'HARD DELETE DETECTED');
});

check('the DELETE route is manage-guarded; no anonymous removal', () => {
  assert(/export const DELETE = hrGuard\('hr\.performance\.manage'\)/.test(ROUTE), 'guard missing');
  assert(ROUTE.includes('deleteGoal(id, session)'), 'route call missing');
});

check('the console deletes only through a confirm that names the goal', () => {
  assert(/data-testid=\{`goal-delete-\$\{g\.id\}`\}/.test(PAGE), 'card delete missing');
  assert(PAGE.includes('data-testid="goal-delete-dialog"'), 'confirm dialog missing');
  assert(PAGE.includes('this is a removal from the lists, never a hard delete'), 'honest copy missing');
  assert(PAGE.includes('data-testid="goal-delete-summary"'), 'summary missing');
  assert(PAGE.includes('Keep goal'), 'cancel copy missing');
  assert(/apiSend\(`\/api\/hr\/goals\/\$\{deleteTarget\.id\}`, 'DELETE'\)/.test(PAGE), 'DELETE verb missing');
  assert((PAGE.match(/\{canManage \? \(\n\s*<div className="flex w-full gap-2">/g) ?? []).length === 1, 'edit+delete not one manage block');
});

// ── 4. CUSTOM end-to-end ────────────────────────────────────────────────────
check('CUSTOM requires a named metric; the label rides toDto on the row', () => {
  const custom = SERVICE.split("if (metricSource === 'CUSTOM')")[1] ?? '';
  assert(custom.includes('CUSTOM_METRIC_LABEL_REQUIRED'), 'label guard missing');
  assert(/length < 2/.test(custom) && /length > 120/.test(custom), 'bounds missing');
  const toDto = SERVICE.split('function toDto(')[1]?.split('\n}')[0] ?? '';
  assert(toDto.includes('parseMetricConfig(goal.metricConfig)'), 'label not derived on the row');
  assert(/metricLabel: string \| null/.test(SERVICE), 'DTO field missing');
});

check('the dialog offers Custom and refuses an anonymous custom goal', () => {
  assert(PAGE.includes('<SelectItem value="CUSTOM">Custom metric</SelectItem>'), 'option missing');
  assert(PAGE.includes('data-testid="goal-custom-label"'), 'label input missing');
  assert(/goalSource === 'CUSTOM' && goalCustomLabel\.trim\(\)\.length < 2/.test(PAGE), 'create not gated on label');
  assert(/\.\.\.\(goalSource === 'CUSTOM' \? \{ metricConfig: \{ label: goalCustomLabel \} \} : \{\}\)/.test(PAGE), 'payload missing');
  assert(PAGE.includes("setGoalCustomLabel('')"), 'label does not reset');
});

check('the label shows on the console card and the portal (per-path rule)', () => {
  assert(/g\.metricSource === 'CUSTOM' && g\.metricLabel \? <span className="ml-1 opacity-80">· \{g\.metricLabel\}<\/span> : null/.test(PAGE), 'card label missing');
  const mapper = SELF.split('export async function listMyGoalProgress')[1]?.split('export async function listMyPerformanceReviews')[0] ?? '';
  assert(mapper.includes('metricLabel: g.metricLabel'), 'portal whitelist drops metricLabel');
  assert(/Custom metric · \{g\.metricLabel\}/.test(VIEW), 'portal meta line missing');
  assert(/`Custom · \$\{g\.metricLabel\}`/.test(VIEW), 'portal details missing');
});

// ── 5. The honest sign-in door ──────────────────────────────────────────────
check('a signed-out visitor gets the sign-in panel, never fake empty states', () => {
  assert(PAGE.includes('data-testid="perf-auth"'), 'auth panel missing');
  assert(PAGE.includes('data-testid="perf-auth-signin"'), 'sign-in link missing');
  assert(PAGE.includes('Sign in to view this workspace'), 'headline missing');
  assert(/status === 401/.test(PAGE), '401 branch missing');
  assert(/setAuthRequired\(true\)/.test(PAGE), 'state write missing');
  assert(/authRequired \? \(/.test(PAGE), 'panel does not gate the tabs');
  assert(/viewerRole === null && !authRequired && !cycles && !reviews && !goals \? \(/.test(PAGE), 'skeleton gate drifted');
});

// ── 6. Privacy floor + prior anchors ────────────────────────────────────────
check('privacy floor holds — no ratings or narratives in the goal family', () => {
  const goalSlice = PAGE.split('TabsContent value="goals"')[1]?.split('</Tabs>')[0] ?? '';
  assert(goalSlice.length > 0, 'goals slice failed');
  assert(!/overallRating|strengths|improvements/i.test(goalSlice), 'rating leaked into goals tab');
  const goalsHalf = VIEW.split('{/* Goals */}')[1]?.split('{/* Reviews */}')[0] ?? '';
  assert(goalsHalf.length > 0, 'portal goals slice failed');
  assert(!/overallRating|strengths|improvements/i.test(goalsHalf), 'rating leaked into portal goals');
});

check('prior anchors hold — v2.91 door + edit, v2.90 picker, v2.89 chips, v2.86 strip', () => {
  assert(PAGE.includes('data-testid="perf-lock"'), 'v2.91 lock drifted');
  assert(PAGE.includes('data-testid="goal-edit-dialog"'), 'v2.91 edit drifted');
  assert(PAGE.includes('data-testid="goal-cycle-picker"'), 'v2.90 picker drifted');
  assert(/data-testid=\{`goal-filter-status-\$\{s\}`\}/.test(PAGE), 'v2.89 chips drifted');
  assert(PAGE.includes('data-testid="perf-review-edit"'), 'v2.87 write drifted');
  const RUNS_PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(RUNS_PAGE.includes('payroll-run-waiting-since'), 'v2.86 strip drifted');
});

console.log(`\nv2.92.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
