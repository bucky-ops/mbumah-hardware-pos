#!/usr/bin/env node
// v2.94.0 verification — "the cycle opens up: calibration takes notes".
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
check('version slots are at least 2.94.0', () => {
  assert(atLeast(PKG.version, '2.94.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.94.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.94.0'), 'baseVersion');
});

// ── 2. What's-New 2.94.0 leads the feed ─────────────────────────────────────
check("What's-New 2.94.0 leads the feed with its bullets", () => {
  const at = WN.indexOf("version: '2.94.0'");
  assert(at > -1, '2.94.0 entry missing');
  assert(at < WN.indexOf("version: '2.93.0'"), '2.94.0 does not lead');
  assert(/The cycle opens up/.test(WN), 'title missing');
  const entry = WN.slice(at, WN.indexOf("version: '2.93.0'"));
  assert((entry.match(/'/g) ?? []).length > 8, 'bullets missing');
  assert(entry.includes('calibration takes notes'), 'subtitle missing');
});

// ── 3. Service: the shared meter ────────────────────────────────────────────
check('statusCountsFor is ONE shared query — table and drawer cannot drift', () => {
  assert(SERVICE.includes('async function statusCountsFor(cycleIds: string[])'), 'helper missing');
  const listBody = SERVICE.split('export async function listCycles')[1]?.split('\n}')[0] ?? '';
  assert(listBody.includes('statusCountsFor(cycles.map((c) => c.id))'), 'listCycles does not use it');
  const detailBody = SERVICE.split('export async function getCycleDetail')[1]?.split('\n}')[0] ?? '';
  assert(detailBody.includes('statusCountsFor([cycle.id])'), 'getCycleDetail does not use it');
});

// ── 4. Service: the detail reads scoped, honest, rating-free ────────────────
check('getCycleDetail — scoped load, safe 404, list-shaped reviews, honest flag', () => {
  const loader = SERVICE.split('async function loadScopedCycle')[1]?.split('\n}')[0] ?? '';
  assert(loader.includes('deletedAt: null'), 'loader reads deleted rows');
  assert(loader.includes('organizationId: session.organizationId'), 'loader ignores org scope');
  assert(loader.includes('CYCLE_NOT_FOUND') && /404/.test(loader), 'safe 404 missing');
  const body = SERVICE.split('export async function getCycleDetail')[1]?.split('\n}')[0] ?? '';
  assert(body.includes('listReviews(session, { cycleId: cycle.id })'), 'reviews not list-shaped');
  assert(body.includes('canEditNotes: canManage && cycle.status !=='), 'canEditNotes missing');
  const dto = SERVICE.split('export interface CycleDetailDto extends CycleDto')[1]?.split('\n}')[0] ?? '';
  assert(!dto.includes('overallRating') && !dto.includes('strengths'), 'ratings joined the DTO');
});

// ── 5. Service: notes take ink, then freeze ─────────────────────────────────
check('updateCycleCalibration — trim, 4000 cap, clear-to-null, CYCLE_FROZEN, audited fields-only', () => {
  const body = SERVICE.split('export async function updateCycleCalibration')[1]?.split('\n}')[0] ?? '';
  assert(SERVICE.includes('export const CALIBRATION_NOTES_MAX = 4000'), 'ceiling constant missing');
  assert(body.includes('raw.trim()'), 'no trim');
  assert(body.includes('TEXT_TOO_LONG'), 'length guard missing');
  assert(body.includes('calibrationNotes: notes.length > 0 ? notes : null'), 'empty does not clear');
  assert(body.includes("cycle.status === 'CLOSED'") && body.includes('CYCLE_FROZEN') && /409/.test(body), 'frozen guard missing');
  assert(body.includes("action: 'PERFORMANCE_CYCLE_CALIBRATION_NOTES'"), 'audit missing');
  assert(body.includes("metadata: { fields: ['calibrationNotes'] }"), 'field-name-only metadata missing');
  assert(body.includes("typeof raw !== 'string'") && body.includes('NOTHING_TO_UPDATE'), 'type guard missing');
});

// ── 6. Route: GET read-gated, PATCH manage-gated with the new action ────────
check('route — GET hr.performance.review, PATCH manage + CALIBRATION_NOTES, as-narrow', () => {
  assert(ROUTE.includes("hrGuard('hr.performance.review')") && ROUTE.includes('getCycleDetail(id, session)'), 'GET missing/guarded wrong');
  assert(ROUTE.includes("hrGuard('hr.performance.manage')"), 'PATCH guard missing');
  assert(ROUTE.includes("action === 'CALIBRATION_NOTES'"), 'notes action missing');
  assert(ROUTE.includes('updateCycleCalibration(id, body, session)'), 'notes handler missing');
  assert(ROUTE.includes('transitionCycle(id, action, session)'), 'transition handler missing');
  assert(ROUTE.includes('action must be ACTIVATE, CLOSE or CALIBRATION_NOTES.'), 'unknown-action copy missing');
  assert(ROUTE.includes('(context as HrRouteContext).params'), 'as-narrow missing');
  assert(!ROUTE.includes('context!'), 'context! still present');
});

// ── 7. Console: the door + the drawer ───────────────────────────────────────
check('console — cycle name is the door; drawer loads honestly (skeleton, no fake empty)', () => {
  assert(/data-testid=\{`cycle-open-\$\{c\.id\}`\}/.test(PAGE), 'name-door missing');
  assert(PAGE.includes('openCycleDetail(c.id)'), 'door not wired');
  assert(PAGE.includes("useState<CycleDetailDto | 'loading' | null>(null)"), 'loading state missing');
  assert(PAGE.includes("setCycleDetail('loading')"), 'loading not set on open');
  assert(PAGE.includes('data-testid="cycle-detail-loading"'), 'skeleton missing');
  assert(PAGE.includes('data-testid="cycle-detail-dialog"'), 'dialog missing');
});

check('drawer — meter, reviews, cross-links that hand over cleanly', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(drawer.includes('data-testid="cycle-detail-meter-text"'), 'meter text missing');
  assert(drawer.includes('data-testid="cycle-detail-reviews"'), 'reviews list missing');
  assert(/data-testid=\{`cycle-detail-review-row-\$\{r\.id\}`\}/.test(drawer), 'review rows missing');
  assert(drawer.includes('data-testid="cycle-detail-no-reviews"'), 'honest no-reviews missing');
  const open = PAGE.split('const openCycleReview')[1]?.split('\n  });')[0] ?? '';
  assert(open.includes('setCycleDetail(null)'), 'single-drawer rule broken');
  assert(drawer.includes('data-testid="cycle-detail-view-reviews"') && drawer.includes('viewCycleReviews(cycleDetail.id)'), 'v2.88 walk not reused');
});

check('drawer — notes take ink inline with an honest counter and freeze copy', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  for (const tid of ['cycle-detail-notes', 'cycle-detail-notes-edit', 'cycle-detail-notes-input', 'cycle-detail-notes-save', 'cycle-detail-notes-cancel', 'cycle-detail-notes-counter', 'cycle-detail-notes-empty', 'cycle-detail-notes-body', 'cycle-detail-frozen', 'cycle-detail-close']) {
    assert(drawer.includes(`data-testid="${tid}"`), `${tid} missing`);
  }
  assert(drawer.includes('maxLength={CALIBRATION_NOTES_MAX}'), 'textarea ceiling missing');
  assert(drawer.includes('{notesDraft.length} / {CALIBRATION_NOTES_MAX}'), 'counter missing');
  assert(drawer.includes('no longer take ink'), 'frozen copy missing');
  assert(PAGE.includes('saveCycleNotes') && PAGE.includes("action: 'CALIBRATION_NOTES'"), 'save not wired to the new action');
});

// ── 8. Privacy floor + prior anchors ────────────────────────────────────────
check('privacy floor — the drawer never renders ratings or narratives', () => {
  const drawer = PAGE.split('the cycle detail drawer')[1]?.split('Review detail dialog')[0] ?? '';
  assert(!drawer.includes('overallRating'), 'rating leaked');
  assert(!drawer.includes('editStrengths') && !drawer.includes('editImprovements'), 'narratives leaked');
});

check('prior anchors hold — v2.93 bench, v2.92 delete + custom + auth, v2.91 edit, v2.88 meter', () => {
  assert(PAGE.includes('data-testid="goal-deleted-open"'), 'v2.93 bench door');
  assert(PAGE.includes('data-testid="goal-delete-dialog"'), 'v2.92 delete dialog');
  assert(PAGE.includes('data-testid="goal-custom-label"'), 'v2.92 custom label');
  assert(PAGE.includes('data-testid="perf-auth"'), 'v2.92 auth door');
  assert(PAGE.includes('data-testid="goal-edit-dialog"'), 'v2.91 edit dialog');
  assert(/data-testid=\{`cycle-meter-\$\{c\.id\}`\}/.test(PAGE), 'v2.88 meter');
  assert(/data-testid=\{`cycle-view-reviews-\$\{c\.id\}`\}/.test(PAGE), 'v2.88 view-reviews walk');
});

console.log(`\nv2.94.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
