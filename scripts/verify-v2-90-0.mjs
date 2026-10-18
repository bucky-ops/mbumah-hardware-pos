#!/usr/bin/env node
// v2.90.0 verification — "the goals meet their cycles, and the portal
// reads the shape". Written fresh this round (never patch a prior round's
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
const SERVICE = read('src/lib/hr/goal-service.ts');
const VIEW = read('src/app/(selfservice)/employees/me/goals/goals-view.tsx');
const SELF = read('src/lib/hr/self-service.ts');
const SCHEMA = read('prisma/schema.prisma');

// ── 1. Version slots ────────────────────────────────────────────────────────
// atLeast semantics from birth (the v2-85 lesson: a === pin breaks on every
// later bump and forces a re-anchor round).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.90.0', () => {
  assert(atLeast(PKG.version, '2.90.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.90.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.90.0'), 'baseVersion');
});

// ── 2. What's-New 2.90.0 leads the feed ─────────────────────────────────────
check("What's-New 2.90.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.90.0'");
  assert(at > -1, '2.90.0 entry missing');
  assert(at < WN.indexOf("version: '2.89.0'"), '2.90.0 does not lead');
  assert(/goals meet their cycles/.test(WN), 'title missing');
  assert(/cycle picker/.test(WN), 'picker bullet missing');
  assert(/"My goals" heading/.test(WN), 'portal heading bullet missing');
  assert(/never a dangling id/.test(WN), 'dangling-id bullet missing');
});

// ── 3. Service: the cycleName fold ──────────────────────────────────────────
check('GoalDto grows cycleName; the fold is one deduped, deleted-aware in-query', () => {
  assert(/cycleName:\s*string \| null/.test(SERVICE), 'GoalDto.cycleName missing');
  assert(SERVICE.includes('async function cycleNamesFor'), 'cycleNamesFor missing');
  assert(/id:\s*\{\s*in:\s*ids\s*\}/.test(SERVICE), 'in-query drifted');
  assert(/deletedAt: null/.test(SERVICE), 'deletedAt guard drifted');
  assert(/select:\s*\{\s*id: true, name: true\s*\}/.test(SERVICE), 'select drifted');
  assert(/if \(ids\.length === 0\) return new Map\(\)/.test(SERVICE), 'zero-cost short-circuit missing');
});

check('every read path passes a cycle name (list / mine / create / update / recompute)', () => {
  const list = SERVICE.split('export async function listGoals')[1]?.split('export async function recomputeGoal')[0] ?? '';
  assert(list.includes('cycleNamesFor(goals.map((g) => g.cycleId))'), 'listGoals fold missing');
  const mine = SERVICE.split('export async function listMyGoals')[1] ?? '';
  assert(mine.includes('cycleNamesFor(goals.map((g) => g.cycleId))'), 'listMyGoals fold missing');
  // The E2E-found arity bug: the fold once passed the cycle name into the
  // employeeName seat (toDto(row, name)) and cycleName stayed null on the
  // portal. The seat order is pinned: (row, employeeName, cycleName).
  assert(/toDto\(\s*\{\s*\.\.\.goal,\s*employee: undefined,\s*currentValue: current,\s*status\s*\},\s*null,\s*cycleNames\.get\(goal\.cycleId \?\? ''\) \?\? null\s*\)/.test(mine), 'listMyGoals toDto seat order drifted (employeeName must stay null, cycleName third)');
  assert(/cycleName = cycle\.name;/.test(SERVICE), 'createGoal name capture missing');
  const calls = SERVICE.match(/cycleNamesFor\(\[goal\.cycleId\]\)/g) ?? [];
  assert(calls.length >= 2, `single-goal folds drifted (${calls.length})`);
});

check('NO schema migration — the Goal model keeps its bare cycleId column', () => {
  const goalModel = SCHEMA.split('model Goal ')[1]?.split('}')[0] ?? '';
  assert(goalModel.includes('cycleId      String?'), 'cycleId column drifted');
  assert(!/cycle\s+ReviewCycle\s+@relation/.test(goalModel), 'unexpected relation added');
  assert(!/model GoalRev|_GoalToReviewCycle/.test(SCHEMA), 'unexpected join table added');
});

// ── 4. Console: the dialog offers the cycle, the cards name it ──────────────
check('the New goal dialog carries an optional cycle picker', () => {
  assert(PAGE.includes('data-testid="goal-cycle-picker"'), 'picker testid missing');
  assert(PAGE.includes('aria-label="Goal review cycle"'), 'picker aria missing');
  assert(PAGE.includes('<SelectItem value="none">No cycle</SelectItem>'), 'none option missing');
  assert(/\.filter\(\(c\) => c\.status !== 'CLOSED'\)/.test(PAGE), 'closed-cycle filter missing');
});

check('the POST stays conditional and the dialog resets', () => {
  assert(/\.\.\.\(goalCycleId !== 'none' \? \{ cycleId: goalCycleId \} : \{\}\)/.test(PAGE), 'conditional cycleId missing');
  assert(/const \[goalCycleId, setGoalCycleId\] = useState\('none'\)/.test(PAGE), 'state default drifted');
  assert(PAGE.includes("setGoalCycleId('none');"), 'dialog reset missing');
});

check('linked goal cards wear the amber cycle chip', () => {
  assert(/\{g\.cycleName \? \(/.test(PAGE), 'conditional chip missing');
  assert(PAGE.includes('border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300'), 'amber family missing');
  assert(PAGE.includes('title="Linked review cycle"'), 'chip title missing');
});

// ── 5. Portal: My goals speaks the same shape ───────────────────────────────
check('the My goals heading is VISIBLE in empty and populated states', () => {
  assert(VIEW.includes('<h2 className="px-1 text-sm font-semibold">My goals</h2>'), 'empty-state heading missing');
  assert(VIEW.includes('<h2 className="text-sm font-semibold">My goals</h2>'), 'populated heading missing');
});

check('status chips with live counts, pressed-aware, family-dressed', () => {
  assert(/data-testid=\{`my-goal-filter-\$\{s\}`\}/.test(VIEW), 'chips missing');
  assert(/aria-pressed=\{active\}/.test(VIEW), 'chips not pressed-aware');
  assert(/const count = s === 'ALL' \? initialGoals\.length : goalStatusCounts\[s\] \?\? 0;/.test(VIEW), 'count rule drifted');
  assert(VIEW.includes("OPEN: 'bg-sky-100 text-sky-800 border-sky-300"), 'open family missing');
  assert(VIEW.includes("ACHIEVED: 'bg-emerald-100 text-emerald-800 border-emerald-300"), 'achieved family missing');
  assert(VIEW.includes("MISSED: 'bg-rose-100 text-rose-800 border-rose-300"), 'missed family missing');
  assert(VIEW.includes("CLOSED: 'bg-slate-100 text-slate-800 border-slate-300"), 'closed family missing');
});

check('the honest line, the filtered-empty state, and the way back', () => {
  assert(VIEW.includes('data-testid="my-goal-count"'), 'count line missing');
  assert(/Showing \{visibleGoals\.length\} of \{initialGoals\.length\} goals/.test(VIEW), 'count copy drifted');
  assert(VIEW.includes('No goals match the current filter.'), 'filtered empty missing');
  assert(VIEW.includes('data-testid="my-goal-filter-clear"'), 'clear button missing');
  assert(VIEW.includes('Show all goals'), 'way-back copy missing');
});

check('cards carry anchors; the cycle name rides the meta line; self maps it', () => {
  assert(/data-testid=\{`my-goal-card-\$\{g\.id\}`\}/.test(VIEW), 'card anchor missing');
  assert(/\{g\.cycleName \? \(/.test(VIEW), 'cycle conditional missing');
  assert(/<CalendarRange className="h-3 w-3" aria-hidden \/> \{g\.cycleName\}/.test(VIEW), 'cycle meta drifted');
  assert(/cycleName: g\.cycleName,/.test(SELF), 'self-service mapping missing');
});

// ── 6. The privacy floor and the prior shape hold ───────────────────────────
check('portal lists still never render ratings; the read half stays gated', () => {
  const goalsRegion = VIEW.split('{/* Goals */}')[1]?.split('{/* Reviews */}')[0] ?? '';
  assert(!goalsRegion.includes('overallRating'), 'goals region references a rating');
  assert(VIEW.includes('data-testid="my-review-panel"'), 'my-review panel drifted');
  assert(/data-testid=\{`my-review-read-\$\{r\.id\}`\}/.test(VIEW), 'review read toggle drifted');
});

check('v2.89.0 console shape intact (chips, recompute-all, filters, count line)', () => {
  assert(PAGE.includes('data-testid={`goal-filter-status-${s}`}'), 'goal chips drifted');
  assert(PAGE.includes('data-testid="goal-recompute-all"'), 'recompute-all drifted');
  assert(PAGE.includes('data-testid="goal-filter-count"'), 'count line drifted');
  assert(PAGE.includes('data-testid="goal-filters"'), 'filter row drifted');
});

check('v2.89.0 service shape intact (bulk recompute + single-recompute rules)', () => {
  assert(SERVICE.includes('export async function recomputeAllGoals'), 'bulk recompute drifted');
  assert(SERVICE.includes('bulk: true'), 'bulk audit marker drifted');
  assert(SERVICE.includes('POS_GOAL_READONLY'), 'computed-not-typed drifted');
});

check('v2.86.0 who’s-next surface intact (strip + waiting-since)', () => {
  const RUNS_PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
  const DIALOG = read('src/components/hr/payroll-run-dialog.tsx');
  assert(RUNS_PAGE.includes('payroll-run-waiting-since'), 'waiting-since cell drifted');
  assert(DIALOG.includes('Waiting on <span className="font-semibold">you</span>'), 'strip seats drifted');
});

check('desk-report family stays archived (v2.82 anchors)', () => {
  const DESK = read('src/lib/hr/desk-report.ts');
  assert(DESK.includes('deskReportRequestLedger'), 'desk ledger drifted');
});

console.log(`\nv2.90.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
