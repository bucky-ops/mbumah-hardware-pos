#!/usr/bin/env node
// v2.89.0 verification — "the goals speak the same shape".
// Written fresh this round (never patch a prior round's copy): every check
// reads the SOURCE OF RECORD, not memory.

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
const ROUTE = read('src/app/api/hr/goals/recompute-all/route.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
// atLeast semantics from birth (the v2-85 lesson: a === pin breaks on every
// later bump and forces a re-anchor round).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.89.0', () => {
  assert(atLeast(PKG.version, '2.89.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.89.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.89.0'), 'baseVersion');
});

// ── 2. What's-New 2.89.0 leads the feed ─────────────────────────────────────
check("What's-New 2.89.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.89.0'");
  assert(at > -1, '2.89.0 entry missing');
  assert(at < WN.indexOf("version: '2.88.0'"), '2.89.0 does not lead');
  assert(/goals speak the same shape/.test(WN), 'title missing');
  assert(/Recompute all POS goals/.test(WN), 'recompute-all bullet missing');
  assert(/Showing X of Y goals/.test(WN), 'count-line bullet missing');
  assert(/closed goals keep their status/i.test(WN), 'closed-rule bullet missing');
});

// ── 3. Service: recomputeAllGoals ───────────────────────────────────────────
check('service exports the bulk recompute with an honest summary', () => {
  assert(SERVICE.includes('export interface GoalRecomputeAllSummary'), 'summary interface missing');
  assert(SERVICE.includes('export async function recomputeAllGoals'), 'recomputeAllGoals missing');
  assert(/recomputed:\s*number/.test(SERVICE), 'recomputed slot missing');
  assert(/achieved:\s*number/.test(SERVICE), 'achieved slot missing');
  assert(/missed:\s*number/.test(SERVICE), 'missed slot missing');
  assert(/open:\s*number/.test(SERVICE), 'open slot missing');
  assert(/closed:\s*number/.test(SERVICE), 'closed slot missing');
});

check('the bulk recompute keeps the single-recompute rules exactly', () => {
  assert(/metricSource:\s*\{\s*in:\s*\['SALES_TOTAL',\s*'SALES_COUNT'\]\s*\}/.test(SERVICE), 'POS-only filter drifted');
  assert(/employee:\s*employeeScopeWhere\(session\)/.test(SERVICE), 'scope filter drifted');
  assert(SERVICE.split('recomputeAllGoals')[1].includes('if (goal.status !== \'CLOSED\')'), 'CLOSED rule drifted');
  assert(SERVICE.split('recomputeAllGoals')[1].includes('target.gt(0) && value.gte(target)'), 'achieved rule drifted');
  assert(SERVICE.split('recomputeAllGoals')[1].includes('goal.dueDate && goal.dueDate.getTime() < Date.now()'), 'missed rule drifted');
  assert(SERVICE.split('recomputeAllGoals')[1].includes('bulk: true'), 'bulk audit marker missing');
});

check('the computed-not-typed floor holds (v2.19.0 anchor)', () => {
  assert(SERVICE.includes('POS_GOAL_READONLY'), 'readonly rule drifted');
  assert(SERVICE.includes('computePosGoalValue'), 'POS computation drifted');
  assert(!/overallRating|strengths|improvements/.test(SERVICE), 'goal service grew sensitive fields');
});

// ── 4. Route: POST /api/hr/goals/recompute-all ──────────────────────────────
check('the bulk route is guarded and wired', () => {
  assert(ROUTE.includes("hrGuard('hr.performance.manage')"), 'guard drifted');
  assert(ROUTE.includes('recomputeAllGoals(session)'), 'service wiring drifted');
  assert(ROUTE.includes('toErrorResponse(error)'), 'error mapping drifted');
});

// ── 5. Console: the Goals tab speaks the same shape ─────────────────────────
check('employee + source picks join the goal filter row', () => {
  assert(PAGE.includes('data-testid="goal-filters"'), 'filter row missing');
  assert(PAGE.includes('data-testid="goal-filter-employee"'), 'employee select missing');
  assert(PAGE.includes('aria-label="Filter goals by employee"'), 'employee aria missing');
  assert(PAGE.includes('data-testid="goal-filter-source"'), 'source select missing');
  assert(PAGE.includes('aria-label="Filter goals by metric source"'), 'source aria missing');
  assert(PAGE.includes('<SelectItem value="ALL">All employees</SelectItem>'), 'employee ALL missing');
  assert(PAGE.includes('<SelectItem value="ALL">All sources</SelectItem>'), 'source ALL missing');
});

check('status chips carry live counts from the FULL goal list', () => {
  assert(/data-testid=\{`goal-filter-status-\$\{s\}`\}/.test(PAGE), 'chips missing');
  assert(/aria-pressed=\{active\}/.test(PAGE), 'chips not pressed-aware');
  assert(/goalStatusCounts\[s\] \?\? 0/.test(PAGE), 'chip counts drifted');
  assert(/const count = s === 'ALL' \? \(goals \?\? \[\]\)\.length : goalStatusCounts\[s\] \?\? 0;/.test(PAGE), 'count rule drifted');
});

check('active chips wear their badge families, light and dark', () => {
  assert(PAGE.includes("OPEN: 'bg-sky-100 text-sky-800 border-sky-300"), 'open family missing');
  assert(PAGE.includes("ACHIEVED: 'bg-emerald-100 text-emerald-800 border-emerald-300"), 'achieved family missing');
  assert(PAGE.includes("MISSED: 'bg-rose-100 text-rose-800 border-rose-300"), 'missed family missing');
  assert(PAGE.includes("CLOSED: 'bg-slate-100 text-slate-800 border-slate-300"), 'closed family missing');
});

check('filtering is real, and the picture stays honest', () => {
  assert(/const filteredGoals = useMemo\(/.test(PAGE), 'filtered subset missing');
  assert(/\(filterGoalEmployee === 'ALL' \|\| g\.employeeId === filterGoalEmployee\)/.test(PAGE), 'employee predicate missing');
  assert(/\(filterGoalSource === 'ALL' \|\| g\.metricSource === filterGoalSource\)/.test(PAGE), 'source predicate missing');
  assert(/\(filterGoalStatus === 'ALL' \|\| g\.status === filterGoalStatus\)/.test(PAGE), 'status predicate missing');
  assert(PAGE.includes('{filteredGoals.map((g) => ('), 'grid not filtered');
  assert(PAGE.includes('data-testid="goal-filter-count"'), 'count line missing');
  assert(/Showing \{filteredGoals\.length\} of \{\(goals \?\? \[\]\)\.length\} goals/.test(PAGE), 'count copy drifted');
  assert(PAGE.includes('data-testid="goal-filter-clear"'), 'clear button missing');
  assert(PAGE.includes('No goals match the current filters.'), 'filtered empty state missing');
  assert(PAGE.includes('No goals yet. Create the first one.'), 'empty-tab state drifted');
});

check('the recompute-all door opens only when a POS goal exists', () => {
  assert(PAGE.includes('data-testid="goal-recompute-all"'), 'button testid missing');
  assert(/\{posGoalCount > 0 \? \(/.test(PAGE), 'visibility gate drifted');
  assert(PAGE.includes('Recompute all POS goals'), 'button copy missing');
  assert(PAGE.includes("'/api/hr/goals/recompute-all'"), 'bulk endpoint missing');
  assert(PAGE.includes('`/api/hr/goals/${g.id}/recompute`'), 'per-card recompute drifted');
  assert(/title=\{`Recompute \$\{posGoalCount\} POS-sourced/.test(PAGE), 'honest count title missing');
});

check('cards carry anchors, family-tinted source badges, tabular numbers', () => {
  assert(/data-testid=\{`goal-card-\$\{g\.id\}`\}/.test(PAGE), 'card anchor missing');
  assert(PAGE.includes('SOURCE_CHIP[g.metricSource]'), 'source tint missing');
  assert(PAGE.includes("SALES_TOTAL: 'border-sky-300 text-sky-700"), 'sales tint missing');
  assert(PAGE.includes("CUSTOM: 'border-amber-300 text-amber-700"), 'custom tint missing');
  assert(PAGE.includes("MANUAL: 'border-slate-300 text-slate-600"), 'manual tint missing');
});

// ── 6. Prior anchors ────────────────────────────────────────────────────────
check('v2.88.0 meter + review filters stay intact', () => {
  assert(PAGE.includes('data-testid={`cycle-meter-${c.id}`}'), 'meter drifted');
  assert(PAGE.includes('data-testid={`review-filter-status-${s}`}'), 'review chips drifted');
  assert(PAGE.includes('data-testid="review-filter-count"'), 'review count line drifted');
});

check('v2.87.0 write/read loop intact (edit form + save gate)', () => {
  assert(PAGE.includes("'Write review' : 'Edit review'"), 'edit affordance drifted');
  assert(PAGE.includes('perf-save-draft'), 'save-draft testid drifted');
  assert(/disabled=\{busy \|\| editRating === null\}/.test(PAGE), 'rating gate drifted');
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

console.log(`\nv2.89.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
