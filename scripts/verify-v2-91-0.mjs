#!/usr/bin/env node
// v2.91.0 verification — "the HR door is honest, and the goals take
// edits". Written fresh this round (never patch a prior round's copy):
// every check reads the SOURCE OF RECORD, not memory.

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
const PERMS = read('src/lib/hr/permissions.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
// atLeast semantics from birth (the v2-85 lesson: a === pin breaks on every
// later bump and forces a re-anchor round).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.91.0', () => {
  assert(atLeast(PKG.version, '2.91.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.91.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.91.0'), 'baseVersion');
});

// ── 2. What's-New 2.91.0 leads the feed ─────────────────────────────────────
check("What's-New 2.91.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.91.0'");
  assert(at > -1, '2.91.0 entry missing');
  assert(at < WN.indexOf("version: '2.90.0'"), '2.91.0 does not lead');
  assert(/The HR door is honest/.test(WN), 'title missing');
  assert(/goals take edits/.test(WN), 'edit bullet missing');
  assert(/lock panel naming the role/.test(WN), 'lock bullet missing');
  assert(/Details panel/.test(WN), 'portal details bullet missing');
});

// ── 3. The honest HR door ───────────────────────────────────────────────────
check('the client gate reuses the server permission map over the /me role', () => {
  assert(PAGE.includes("import { hasHrPermission } from '@/lib/hr/permissions';"), 'map import missing');
  assert(/hasHrPermission\(viewerRole, 'hr\.performance\.review'\)/.test(PAGE), 'review key gate missing');
  assert(/hasHrPermission\(viewerRole, 'hr\.performance\.manage'\)/.test(PAGE), 'manage key gate missing');
  assert(/apiGet<\{ role\?: string \}>\('\/api\/auth\/me'\)/.test(PAGE), '/me fetch missing');
  // server side of the same truth
  assert(ROUTE.includes("hrGuard('hr.performance.manage')"), 'PATCH route guard drifted');
  assert(PERMS.includes("'hr.performance.review': ['BRANCH_MANAGER', 'HR_MANAGER', 'STORE_OWNER']"), 'review roles drifted');
});

check('no review permission → the lock panel, never interactive tabs', () => {
  assert(PAGE.includes('data-testid="perf-lock"'), 'lock panel missing');
  assert(PAGE.includes('data-testid="perf-lock-role"'), 'role chip missing');
  assert(PAGE.includes('HR performance is locked for your role'), 'lock headline missing');
  assert(PAGE.includes('href="/employees/me"'), 'portal way-home missing');
  assert(/viewerRole !== null && !canReview \? \(/.test(PAGE), 'lock ternary drifted');
});

check('write affordances hide without hr.performance.manage', () => {
  assert(/\{canManage \? \(\n\s*<div className="flex justify-end">/.test(PAGE), 'New cycle not gated');
  assert(/\{canManage \? \(\n\s*<Button size="sm" onClick=\{\(\) => setGoalOpen\(true\)\}>/.test(PAGE), 'New goal not gated');
  assert(/\{canManage && posGoalCount > 0 \? \(/.test(PAGE), 'recompute-all not gated');
});

// ── 4. The goals take edits ─────────────────────────────────────────────────
check('updateGoal remains the audited writer; the PATCH route feeds it', () => {
  const body = SERVICE.split('export async function updateGoal')[1] ?? '';
  assert(body.includes("action: 'GOAL_UPDATED'"), 'audit drifted');
  assert(body.includes('POS_GOAL_READONLY'), 'POS readonly guard drifted');
  assert(/status !== 'OPEN' && status !== 'CLOSED'/.test(body), 'status guard drifted');
  assert(ROUTE.includes('updateGoal(id, body, session)'), 'route call drifted');
});

check('every goal card offers Edit (manage-gated); the dialog PATCHes', () => {
  assert(/data-testid=\{`goal-edit-\$\{g\.id\}`\}/.test(PAGE), 'card edit button missing');
  assert(PAGE.includes('data-testid="goal-edit-dialog"'), 'edit dialog missing');
  assert(PAGE.includes('data-testid="goal-edit-save"'), 'save button missing');
  assert(/apiSend\(`\/api\/hr\/goals\/\$\{editGoal\.id\}`, 'PATCH'/.test(PAGE), 'PATCH call missing');
  assert(PAGE.includes('title: editGoalTitle'), 'title field missing');
  assert(PAGE.includes('targetValue: editGoalTarget'), 'target field missing');
  assert(PAGE.includes('status: editGoalStatus'), 'status field missing');
  assert(/dueDate: editGoalDue \? new Date\(editGoalDue\)\.toISOString\(\) : ''/.test(PAGE), 'due clear missing');
});

check('the edit dialog never rewrites load-bearing facts', () => {
  const payload = PAGE.split('apiSend(`/api/hr/goals/${editGoal.id}`')[1]?.split('setEditGoal(null)')[0] ?? '';
  assert(payload.length > 0, 'payload slice failed');
  // no sent KEY named employeeId / metricSource (the conditional spread
  // legitimately READS editGoal.metricSource to decide currentValue —
  // it never WRITES a metricSource key).
  assert(!/employeeId\s*:/.test(payload), 'payload must not carry employeeId');
  assert(!/(^|[^.])metricSource\s*:/.test(payload), 'payload must not carry metricSource');
  assert(PAGE.includes('data-testid="goal-edit-meta"'), 'read-only meta strip missing');
});

check('POS-sourced values stay computed — recompute is the only writer', () => {
  assert(PAGE.includes('data-testid="goal-edit-pos-note"'), 'POS note missing');
  assert(PAGE.includes('Computed from POS sales — use recompute, never a typed value.'), 'note copy drifted');
  assert(
    /\.\.\.\(editGoal\.metricSource === 'MANUAL' \|\| editGoal\.metricSource === 'CUSTOM' \? \{ currentValue: editGoalCurrent \} : \{\}\)/.test(PAGE),
    'conditional currentValue missing',
  );
});

check('the status switch parks or reopens; achieved/missed stay computed', () => {
  assert(/data-testid=\{`goal-edit-status-\$\{s\.toLowerCase\(\)\}`\}/.test(PAGE), 'status switch template missing');
  assert(/\(\['OPEN', 'CLOSED'\] as const\)\.map/.test(PAGE), 'switch options missing');
  assert(PAGE.includes('ACHIEVED and MISSED are computed from progress — you can only park or reopen a goal.'), 'hint drifted');
  assert(/active \? GOAL_CHIP_ACTIVE\[s\]/.test(PAGE), 'chip families not reused');
});

// ── 5. The portal details unfold ────────────────────────────────────────────
check('portal cards unfold a Details panel in place', () => {
  assert(/data-testid=\{`my-goal-details-\$\{g\.id\}`\}/.test(VIEW), 'details toggle missing');
  assert(/data-testid=\{`my-goal-panel-\$\{g\.id\}`\}/.test(VIEW), 'details panel missing');
  assert(/aria-expanded=\{isOpen\}/.test(VIEW), 'aria-expanded missing');
  assert(/const \[openGoalId, setOpenGoalId\] = useState<string \| null>\(null\)/.test(VIEW), 'one-at-a-time state missing');
  assert(VIEW.includes('Last updated'), 'last-updated cell missing');
  assert(/g\.updatedAt \? formatDate\(g\.updatedAt\) : '—'/.test(VIEW), 'updatedAt render missing');
  assert(/updatedAt\?: string;/.test(VIEW), 'DTO field missing');
  assert(VIEW.includes('This goal reads POS sales directly — the number moves when sales move, never by hand.'), 'POS note drifted');
  // the per-path rule: the portal whitelist must fold updatedAt through
  const SELF = read('src/lib/hr/self-service.ts');
  const mapper = SELF.split('export async function listMyGoalProgress')[1]?.split('export async function listMyPerformanceReviews')[0] ?? '';
  assert(mapper.includes('updatedAt: g.updatedAt'), 'listMyGoalProgress drops updatedAt');
});

// ── 6. Privacy floor + prior anchors ────────────────────────────────────────
check('privacy floor holds — no ratings or narratives in the goal family', () => {
  const goalSlice = PAGE.split('TabsContent value="goals"')[1]?.split('</Tabs>')[0] ?? '';
  assert(goalSlice.length > 0, 'goals slice failed');
  assert(!/overallRating|strengths|improvements/i.test(goalSlice), 'rating leaked into goals tab');
  // portal: scope to the goals section only (the reviews read-half
  // legitimately carries overallRating — it always has, since v2.87, and
  // its ReviewDetail interface sits above the Reviews marker).
  const goalsHalf = VIEW.split('{/* Goals */}')[1]?.split('{/* Reviews */}')[0] ?? '';
  assert(goalsHalf.length > 0, 'goals slice failed');
  assert(!/overallRating|strengths|improvements/i.test(goalsHalf), 'rating leaked into portal goals');
});

check('prior anchors hold — v2.90 picker, v2.89 chips, v2.87 write, v2.86 strip', () => {
  assert(PAGE.includes('data-testid="goal-cycle-picker"'), 'v2.90 picker drifted');
  assert(/data-testid=\{`goal-filter-status-\$\{s\}`\}/.test(PAGE), 'v2.89 chips drifted');
  assert(PAGE.includes('data-testid="perf-review-edit"'), 'v2.87 write drifted');
  const RUNS_PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
  assert(RUNS_PAGE.includes('payroll-run-waiting-since'), 'v2.86 strip drifted');
});

console.log(`\nv2.91.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
