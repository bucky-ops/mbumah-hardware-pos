#!/usr/bin/env node
// v2.95.0 verification — "the drawer takes the wheel: lifecycle rides inside".
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
const SERVICE = read('src/lib/hr/performance-service.ts');
const ROUTE = read('src/app/api/hr/performance/cycles/[id]/route.ts');

// ── 1. Version slots ────────────────────────────────────────────────────────
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.95.0', () => {
  assert(atLeast(PKG.version, '2.95.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.95.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.95.0'), 'baseVersion');
});

// ── 2. What's-New 2.95.0 leads the feed ─────────────────────────────────────
check("What's-New 2.95.0 leads the feed with its bullets", () => {
  const at = WN.indexOf("version: '2.95.0'");
  assert(at > -1, '2.95.0 entry missing');
  assert(at < WN.indexOf("version: '2.94.0'"), '2.95.0 does not lead');
  assert(/The drawer takes the wheel/.test(WN), 'title missing');
  const entry = WN.slice(at, WN.indexOf("version: '2.94.0'"));
  assert((entry.match(/'/g) ?? []).length > 8, 'bullets missing');
  assert(entry.includes('lifecycle rides inside'), 'subtitle missing');
});

// ── 3. Service: the lifecycle facts ride with the detail ────────────────────
check('detail DTO carries canManageLifecycle + lifecycleBlock — rating-free still', () => {
  const dto = SERVICE.split('export interface CycleDetailDto extends CycleDto')[1]?.split('\n}')[0] ?? '';
  assert(dto.includes('canManageLifecycle: boolean'), 'canManageLifecycle missing');
  assert(dto.includes('lifecycleBlock: string | null'), 'lifecycleBlock missing');
  assert(!dto.includes('overallRating') && !dto.includes('strengths'), 'ratings joined the DTO');
});

check('lifecycleBlock derives from the guard\u2019s own count — never the scoped list length', () => {
  const body = SERVICE.split('export async function getCycleDetail')[1]?.split('\n}')[0] ?? '';
  assert(body.includes("db.performanceReview.count({ where: { cycleId: cycle.id, deletedAt: null } })"), 'guard count missing');
  assert(body.includes("canManage && cycle.status === 'DRAFT' && guardCount === 0"), 'block arithmetic missing');
  assert(body.includes('Add at least one review before activating'), 'explanation copy missing');
  assert(body.includes('canManageLifecycle: canManage'), 'flag not wired');
});

check('transition map still owns legality — EMPTY_CYCLE / ILLEGAL_TRANSITION untouched', () => {
  const map = SERVICE.split('const CYCLE_TRANSITIONS')[1]?.split('};')[0] ?? '';
  assert(map.includes("DRAFT: ['ACTIVE']"), 'DRAFT transition missing');
  assert(map.includes("ACTIVE: ['CLOSED']"), 'ACTIVE transition missing');
  assert(map.includes('CLOSED: []'), 'CLOSED not terminal');
  const body = SERVICE.split('export async function transitionCycle')[1]?.split('\n}')[0] ?? '';
  assert(body.includes('EMPTY_CYCLE') && body.includes('ILLEGAL_TRANSITION') && /409/.test(body), 'guards missing');
});

// ── 4. Route: unchanged contract, honest header ─────────────────────────────
check('route — GET review / PATCH manage, CALIBRATION_NOTES beside ACTIVATE/CLOSE, as-narrow', () => {
  assert(ROUTE.includes("hrGuard('hr.performance.review')") && ROUTE.includes('getCycleDetail(id, session)'), 'GET missing/guarded wrong');
  assert(ROUTE.includes("hrGuard('hr.performance.manage')"), 'PATCH guard missing');
  assert(ROUTE.includes('transitionCycle(id, action, session)'), 'transition handler missing');
  assert(ROUTE.includes('(context as HrRouteContext).params'), 'as-narrow missing');
  assert(!ROUTE.includes('context!'), 'context! still present');
});

// ── 5. Console: the strip rides inside the drawer ───────────────────────────
check('strip — manage-gated lifecycle panel beside the meter', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(drawer.includes('data-testid="cycle-detail-lifecycle"'), 'strip missing');
  assert(drawer.includes('cycleDetail.canManageLifecycle ?'), 'strip not manage-gated');
  assert(drawer.includes('data-testid="cycle-detail-activate"') && drawer.includes("runCycleLifecycle('ACTIVATE')"), 'activate not wired');
  assert(drawer.includes('data-testid="cycle-detail-close-arm"'), 'close-arm missing');
  assert(drawer.includes('data-testid="cycle-detail-close-confirm"') && drawer.includes("runCycleLifecycle('CLOSE')"), 'close-confirm not wired');
  assert(drawer.includes('data-testid="cycle-detail-close-cancel"'), 'close-cancel missing');
  assert(drawer.includes('data-testid="cycle-detail-history"'), 'closed-history missing');
  // The table obeys the same rule — no buttons that only answer 403.
  const actions = PAGE.split('<TableCell className="space-x-2 text-right">')[1]?.split('</TableCell>')[0] ?? '';
  assert(actions.includes('canManage ?'), 'table lifecycle not manage-gated');
  assert(PAGE.includes('cycle-row-actions-muted-'), 'reviewer dash missing');
});

check('guard explained inline — Activate rests while lifecycleBlock stands', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(drawer.includes('disabled={busy || cycleDetail.lifecycleBlock !== null}'), 'activate not blocked');
  assert(drawer.includes('data-testid="cycle-detail-lifecycle-block"'), 'block reason missing');
  assert(drawer.includes('data-testid="cycle-detail-lifecycle-hint"'), 'unblocked hint missing');
});

check('close asks twice — the armed panel states exactly what closing ends', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(drawer.includes('data-testid="cycle-detail-close-confirm-row"'), 'confirm row missing');
  assert(drawer.includes('cannot reopen'), 'one-way copy missing');
  assert(drawer.includes('setCloseArmed(false)'), 'no disarm path');
});

check('lifecycle runner — drawer-local errors, self-refetch, table refresh', () => {
  const runner = PAGE.split('const runCycleLifecycle')[1]?.split('\n  };')[0] ?? '';
  assert(runner.includes(`apiSend(\`/api/hr/performance/cycles/\${cycleDetail.id}\`, 'PATCH', { action })`), 'PATCH not wired');
  assert(runner.includes(`apiGet<CycleDetailDto>(\`/api/hr/performance/cycles/\${cycleDetail.id}\`)`), 'no self-refetch');
  assert(runner.includes('setCycleDetail(d)'), 'drawer not updated');
  assert(runner.includes('await load()'), 'table not refreshed');
  assert(runner.includes('setCycleActionError'), 'drawer-local error missing');
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(drawer.includes('data-testid="cycle-detail-action-error"'), 'error line missing');
  // Arm + error memory reset with the drawer.
  const open = PAGE.split('const openCycleDetail')[1]?.split('\n  };')[0] ?? '';
  const close = PAGE.split('const closeCycleDetail')[1]?.split('\n  };')[0] ?? '';
  assert(open.includes('setCloseArmed(false)') && open.includes("setCycleActionError('')"), 'open does not reset');
  assert(close.includes('setCloseArmed(false)') && close.includes("setCycleActionError('')"), 'close does not reset');
});

// ── 6. Privacy floor + prior anchors ────────────────────────────────────────
check('privacy floor — the drawer never renders ratings or narratives', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(!drawer.includes('overallRating'), 'rating leaked');
  assert(!drawer.includes('editStrengths') && !drawer.includes('editImprovements'), 'narratives leaked');
});

check('prior anchors hold — v2.94 drawer, v2.93 bench, v2.92 delete + auth, v2.88 meter + table lifecycle', () => {
  assert(PAGE.includes('data-testid="cycle-detail-notes-edit"'), 'v2.94 notes edit');
  assert(PAGE.includes('data-testid="cycle-detail-view-reviews"'), 'v2.94 walk');
  assert(PAGE.includes('data-testid="goal-deleted-open"'), 'v2.93 bench door');
  assert(PAGE.includes('data-testid="goal-delete-dialog"'), 'v2.92 delete dialog');
  assert(PAGE.includes('data-testid="perf-auth"'), 'v2.92 auth door');
  assert(/data-testid=\{`cycle-meter-\$\{c\.id\}`\}/.test(PAGE), 'v2.88 meter');
  assert(PAGE.includes("apiSend(`/api/hr/performance/cycles/${c.id}`, 'PATCH', { action: 'ACTIVATE' })"), 'table activate anchor');
  assert(PAGE.includes("apiSend(`/api/hr/performance/cycles/${c.id}`, 'PATCH', { action: 'CLOSE' })"), 'table close anchor');
});

console.log(`\nv2.95.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
