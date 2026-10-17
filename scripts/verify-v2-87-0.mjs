#!/usr/bin/env node
// v2.87.0 verification — "the review gets written, and its subject reads it".
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
const SERVICE = read('src/lib/hr/performance-service.ts');
const SS_ROUTE = read('src/app/api/self-service/me/reviews/[id]/route.ts');
const ACK_ROUTE = read('src/app/api/self-service/me/reviews/[id]/acknowledge/route.ts');
const GOALS_VIEW = read('src/app/(selfservice)/employees/me/goals/goals-view.tsx');

// ── 1. Version slots ────────────────────────────────────────────────────────
// atLeast semantics from birth (the v2-85 lesson: a === pin breaks on every
// later bump and forces a re-anchor round).
const atLeast = (actual, floor) => {
  const a = String(actual ?? '').split('.').map(Number);
  const f = String(floor).split('.').map(Number);
  return a.length === 3 && f.length === 3 && (a[0] > f[0] || (a[0] === f[0] && (a[1] > f[1] || (a[1] === f[1] && a[2] >= f[2]))));
};
check('version slots are at least 2.87.0', () => {
  assert(atLeast(PKG.version, '2.87.0'), `version=${PKG.version}`);
  assert(atLeast(PKG.mbumah.releaseVersion, '2.87.0'), 'releaseVersion');
  assert(atLeast(PKG.mbumah.baseVersion, '2.87.0'), 'baseVersion');
});

// ── 2. What's-New 2.87.0 leads the feed ─────────────────────────────────────
check("What's-New 2.87.0 leads the feed", () => {
  const at = WN.indexOf("version: '2.87.0'");
  assert(at > -1, '2.87.0 entry missing');
  assert(at < WN.indexOf("version: '2.86.0'"), '2.87.0 does not lead');
  assert(/gets written/.test(WN), 'title missing');
  assert(/dead end/.test(WN), 'dead-end bullet missing');
  assert(/Read review/.test(WN), 'read-review bullet missing');
  assert(/blind acknowledgements/i.test(WN), 'blind-acknowledgement bullet missing');
});

// ── 3. Service: canEdit joins the detail DTO additively ─────────────────────
check('service exposes canEdit with the writable-state + reviewer-or-HR rule', () => {
  assert(SERVICE.includes('canEdit: boolean;'), 'canEdit missing from ReviewDetailDto');
  assert(/canEdit:\s*\n?\s*\(canManage \|\| review\.reviewerUserId === session\.userId\)/.test(SERVICE), 'canEdit rule missing');
  assert(/review\.status === 'DRAFT' \|\| review\.status === 'SUBMITTED'/.test(SERVICE), 'writable states missing');
  // the old rules stay intact
  assert(/canSubmit:\s*\n?\s*\(canManage \|\| review\.reviewerUserId === session\.userId\) &&\s*\n?\s*review\.status === 'DRAFT' &&\s*\n?\s*review\.overallRating !== null/.test(SERVICE), 'canSubmit rule drifted');
});

// ── 4. HR dialog: the write half ────────────────────────────────────────────
check('HR dialog carries the edit form: Write/Edit review, stars, capped narratives', () => {
  assert(PAGE.includes("'Write review' : 'Edit review'"), 'edit affordance label missing');
  assert(PAGE.includes('data-testid={`perf-rating-option-${n}`}'), 'rating options missing');
  assert(PAGE.includes('role="radiogroup"'), 'radiogroup missing');
  assert(PAGE.includes('perf-strengths-input') && PAGE.includes('perf-improvements-input'), 'narrative inputs missing');
  assert(PAGE.includes('maxLength={NARRATIVE_MAX}') && PAGE.includes('NARRATIVE_MAX = 4000'), 'narrative cap missing');
  assert(PAGE.includes('RATING_MAX = 5'), 'rating max missing');
});

check("Save draft PATCHes UPDATE and demands a rating before it lights up", () => {
  assert(PAGE.includes("action: 'UPDATE'"), 'UPDATE action missing');
  assert(PAGE.includes('overallRating: editRating'), 'rating payload missing');
  assert(/disabled=\{busy \|\| editRating === null\}/.test(PAGE), 'save button not rating-gated');
  assert(PAGE.includes('perf-save-draft') && PAGE.includes('perf-cancel-edit'), 'save/cancel testids missing');
});

check('action row widens to include edit; submit + calibrate keep their gates', () => {
  assert(PAGE.includes('detail.canEdit || detail.canSubmit || detail.canCalibrate'), 'gate not widened');
  assert(PAGE.includes("action: 'SUBMIT'") && PAGE.includes('Submit for acknowledgement'), 'submit drifted');
  assert(PAGE.includes("action: 'CALIBRATE'"), 'calibrate drifted');
});

// ── 5. Self-service: the read half ──────────────────────────────────────────
check('subject-scoped GET route exists with the isSelf boundary', () => {
  assert(SS_ROUTE.includes("GET = selfServiceGuard('hr.performance.read.own')"), 'guard missing');
  assert(SS_ROUTE.includes('getReviewDetail'), 'service delegation missing');
  assert(SS_ROUTE.includes('if (!data.isSelf)') && SS_ROUTE.includes('NOT_THE_SUBJECT'), 'isSelf boundary missing');
  assert(/403/.test(SS_ROUTE), '403 missing');
});

check('acknowledge POST route untouched', () => {
  assert(ACK_ROUTE.includes("action: 'ACKNOWLEDGE'"), 'acknowledge action drifted');
});

check('My reviews rows expand to read the review before acknowledging', () => {
  assert(GOALS_VIEW.includes('Read review'), 'read toggle missing');
  assert(GOALS_VIEW.includes('data-testid={`my-review-read-${r.id}`}'), 'toggle testid missing');
  assert(GOALS_VIEW.includes('data-testid="my-review-panel"'), 'panel missing');
  assert(GOALS_VIEW.includes('apiGet<ReviewDetail>(`/api/self-service/me/reviews/${id}`)'), 'detail fetch missing');
  assert(GOALS_VIEW.includes('if (!reviewDetails[id])'), 'fetch-once cache missing');
  assert(GOALS_VIEW.includes("apiSend(`/api/self-service/me/reviews/${id}/acknowledge`, 'POST')"), 'acknowledge drifted');
  // the SSR list DTO stays rating-free (sensitive-data rule)
  const dto = GOALS_VIEW.split('export interface ReviewDto {')[1].split('}')[0];
  assert(!/overallRating|strengths|improvements/.test(dto), 'ReviewDto grew sensitive fields');
});

// ── 6. Prior anchors ────────────────────────────────────────────────────────
check('v2.86.0 who’s-next surface intact (strip + waiting-since)', () => {
  const RUNS_PAGE = read('src/app/(shell)/hr/payroll/page.tsx');
  const DIALOG = read('src/components/hr/payroll-run-dialog.tsx');
  assert(RUNS_PAGE.includes('payroll-run-waiting-since'), 'waiting-since cell drifted');
  assert(DIALOG.includes('Waiting on <span className="font-semibold">you</span>'), 'strip seats drifted');
  assert(DIALOG.includes('handed over by'), 'handover phrase drifted');
});

check('v2.85.0 handover step intact in run history', () => {
  const BUILDER = read('src/lib/hr/payroll/run-history.ts');
  assert(/submitted/i.test(BUILDER), 'submitted step drifted');
  assert(BUILDER.includes("'Submitted for approval'"), 'handover label drifted');
});

check('desk-report family stays archived (v2.82 anchors)', () => {
  const DESK = read('src/lib/hr/desk-report.ts');
  assert(DESK.includes('deskReportRequestLedger'), 'desk ledger drifted');
});

console.log(`\nv2.87.0 verification: ${pass > 0 && fail === 0 ? 'ALL PASS' : 'FAILURES'} (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
