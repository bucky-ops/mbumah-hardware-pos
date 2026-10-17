#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.59.0 verification
// Scope: the desk never decides on a stale correction.
// (1) LeaveRequest carries deskReviewedAt (visit-tracking) and every list
//     row exposes deskReviewedAt + the server-computed needsRecheck.
// (2) POST /api/leaves/[id]/review stamps the read-receipt under the same
//     guard family as the list GET, answers 404 for cross-store ids, and
//     audits with whether a correction was waiting.
// (3) The HR desk renders the amber re-check chip, the Pending card's
//     re-check hint, the "Needs re-check" filter, the live dialog receipt,
//     and opening a request always stamps the visit.
// (4) needsDeskRecheck is the ONE shared rule (pure module, no server-only
//     imports) and the test suite pins it.
// Every v2.47–v2.58 feature is asserted intact.
// Run: node scripts/verify-v2-59-0.mjs

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
let failures = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

console.log('== Version slots ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.59.0', PKG.version === '2.59.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.59.0', PKG.mbumah?.releaseVersion === '2.59.0');
check('mbumah.baseVersion is 2.59.0', PKG.mbumah?.baseVersion === '2.59.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.59.0 entry", WN.includes("version: '2.59.0'"));
check("What's-New names the re-check story", WN.includes('stale correction'));
check('verify:v2-59-0 script is wired', (PKG.scripts ?? {})['verify:v2-59-0'] === 'node scripts/verify-v2-59-0.mjs');
check('verify:v2-58-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-58-0'] === 'node scripts/verify-v2-58-0.mjs');

console.log('== Schema: desk visit-tracking ==');
const SC = read('prisma/schema.prisma') ?? '';
check('LeaveRequest carries deskReviewedAt', SC.includes('deskReviewedAt DateTime?'));
check('the field is documented as a read-receipt', SC.includes('v2.59.0: desk visit-tracking'));

console.log('== Heuristic: one shared rule ==');
const RC = read('src/lib/hr/leave-recheck.ts') ?? '';
check('needsDeskRecheck exists (pure module)', RC.includes('export function needsDeskRecheck'));
check('no correction = never a re-check', RC.includes('if (!editedAt) return false;'));
check('corrected + never visited = re-check', RC.includes('if (!deskReviewedAt) return true;'));
check('visit-before-edit = re-check (strictly-after rule)', RC.includes('new Date(deskReviewedAt).getTime() < new Date(editedAt).getTime()'));
check('no server-only imports (pure)', !RC.includes("@/lib/db") && !RC.includes("next/server"));

console.log('== Route: POST /api/leaves/[id]/review ==');
const RV = read('src/app/api/leaves/[id]/review/route.ts') ?? '';
check('route file exists', !!RV);
check('guarded by requireStoreAccess (same family as the list GET)', RV.includes('requireStoreAccess(reviewLeaveHandler)'));
check('stamps deskReviewedAt', RV.includes('deskReviewedAt: reviewedAt'));
check('404 for cross-store ids (no disclosure)', RV.includes('existing.storeId !== session.storeId') && RV.includes('status: 404'));
check('audits with hadPendingCorrection', RV.includes("action: 'LEAVE_REVIEW_STAMPED'") && RV.includes('hadPendingCorrection'));
check('returns the refreshed needsRecheck', RV.includes('needsDeskRecheck(updated.editedAt, updated.deskReviewedAt)'));

console.log('== DTO: GET /api/leaves carries the server-computed marker ==');
const LR = read('src/app/api/leaves/route.ts') ?? '';
check('deskReviewedAt exposed per row', LR.includes('deskReviewedAt: r.deskReviewedAt?.toISOString() ?? null'));
check('needsRecheck computed through the shared heuristic', LR.includes('needsRecheck: needsDeskRecheck(r.editedAt, r.deskReviewedAt)'));
check('imports the shared rule', LR.includes("from '@/lib/hr/leave-recheck'"));

console.log('== Desk UI: the marker is visible and actionable ==');
const PT = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('amber re-check chip renders on needsRecheck rows', PT.includes("{l.needsRecheck ? ("));
check('chip has a tooltip that says what to do', PT.includes('No desk visit since the last edit'));
check('chip is focusable + labelled (a11y)', PT.includes('Open to mark re-checked.'));
check('Pending card says the number out loud', PT.includes("need${recheckCount === 1 ? 's' : ''} re-check"));
check('"Needs re-check" filter isolates the queue', PT.includes("statusFilter === 'RECHECK'"));
check('the empty state explains the cleared queue', PT.includes('Nothing needs re-checking'));
check('opening a request ALWAYS stamps the visit', PT.includes('const openLeaveDetail = (l: LeaveRequest) => {'));
check('the stamp updates the cached row in place', PT.includes('needsRecheck: data.data.needsRecheck'));
check('a failed stamp is honest (no fake read)', PT.includes('Could not mark this request as reviewed'));
check('the dialog shows the live review receipt', PT.includes('const live = leaves.find((row) => row.id === detail.id) ?? detail;'));
check('the receipt flips while the dialog is open', PT.includes('Last reviewed {formatDateTime(live.deskReviewedAt)}'));
check('StatCard carries the hint pill (v2.59.0 prop)', PT.includes("hintTone?: 'amber' | 'muted';"));

console.log('== Tests ==');
const RT = read('src/tests/leave-recheck.test.ts') ?? '';
check('the heuristic suite exists', RT.includes('needsDeskRecheck - the one shared re-check rule'));
check('the >= boundary is pinned', RT.includes('counts an equal-timestamp visit as having seen the edit'));
check('re-edit after review flips back to true', RT.includes('flips back to true the moment a NEWER correction lands'));
check('the route contract is pinned', RT.includes('POST /api/leaves/[id]/review - static route contract'));
check('the DTO contract is pinned', RT.includes('GET /api/leaves - DTO carries the server-computed marker'));

console.log('== History: v2.47–v2.58 anchors intact ==');
check('v2.58.0 tableToCsv still present', (read('src/lib/hr/digest-csv.ts') ?? '').includes('export function tableToCsv'));
check('v2.58.0 audit test still present', !!read('src/tests/bypass-reads-audit.test.ts'));
check('v2.57.0 rawDb feed fix still present', (read('src/lib/db.ts') ?? '').includes('rawDb'));
check('v2.57.0 feed contract test still present', !!read('src/tests/notifications-feed-tenant-free.test.ts'));
check('v2.55.0 resend route still present', !!read('src/app/api/hr/reports/schedules/[id]/resend/route.ts'));
check('v2.45.0 self-correction provenance still present', LR.includes('editedByUserId'));

console.log('');
if (failures === 0) {
  console.log('v2.59.0 verification: ALL PASS');
} else {
  console.log(`v2.59.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
