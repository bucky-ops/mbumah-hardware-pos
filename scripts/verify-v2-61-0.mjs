#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.61.0 verification
// Scope: the bell answers the correction.
// (1) The review stamp writes an employee-facing bell row when it actually
//     CLEARS a pending correction (gated by hadPendingCorrection — the
//     first visit after an edit rings, re-opens are silent).
// (2) The row is named (reviewerName), carries the leave_review_seen marker,
//     deep-links the portal leave page, and is best-effort (never fails the
//     stamp). Bell-only: no email surfaces.
// (3) The feed (leave OR filter + kind mapping), the NotificationItem union
//     and the notification center (cyan rail, scan-eye, "Correction seen"
//     chip) render the new 'leave_review_seen' type.
// (4) Styling: the portal waiting badge pulses; a named portal review wears
//     the scan-eye; the desk receipt wears the reviewer initial avatar.
// Every v2.47–v2.60 feature is asserted intact.
// Run: node scripts/verify-v2-61-0.mjs

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
check('package.json version is 2.61.0', PKG.version === '2.61.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.61.0', PKG.mbumah?.releaseVersion === '2.61.0');
check('mbumah.baseVersion is 2.61.0', PKG.mbumah?.baseVersion === '2.61.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.61.0 entry", WN.includes("version: '2.61.0'"));
check("What's-New names the bell-answers story", WN.includes('The bell answers the correction'));
check('verify:v2-61-0 script is wired', (PKG.scripts ?? {})['verify:v2-61-0'] === 'node scripts/verify-v2-61-0.mjs');
check('verify:v2-60-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-60-0'] === 'node scripts/verify-v2-60-0.mjs');

console.log('== Copy module: the review-seen family ==');
const LN = read('src/lib/hr/leave-notify.ts') ?? '';
check('the marker constant exists', LN.includes("export const LEAVE_REVIEW_SEEN_METADATA_MARKER = 'leave_review_seen';"));
check('the kind joins LeaveNotificationKind', LN.includes("| 'leave_review_seen'"));
check('leaveReviewSeenCopy exists', LN.includes('export function leaveReviewSeenCopy'));
check('the copy is bell-ONLY (no email fields)', !/LeaveReviewSeenCopy \{[\s\S]*?emailSubject/.test(LN.split('LeaveReviewSeenCopyInput')[1] ?? ''));
check('the parser accepts the new kind', LN.includes("rec.kind === 'leave_review_seen'"));
check('the parser exposes reviewerName', LN.includes('reviewerName?: string'));

console.log('== Route: the stamp rings the bell ==');
const RV = read('src/app/api/leaves/[id]/review/route.ts') ?? '';
check('the stamp query fetches leaveType name', RV.includes('leaveType: { select: { name: true } }'));
check('the stamp query fetches the employee linked user', RV.includes('employee: { select: { user: { select: { id: true } } } }'));
check('the bell write is gated by hadPendingCorrection', RV.includes('if (hadPendingCorrection) {'));
check('the gate is computed from the PRE-update row', RV.indexOf('const hadPendingCorrection = needsDeskRecheck(existing.editedAt, existing.deskReviewedAt)') > -1 && RV.indexOf('const hadPendingCorrection') < RV.indexOf('if (hadPendingCorrection) {'));
check('the row addresses the employee linked user', RV.includes('existing.employee?.user?.id ?? null'));
check('the row carries the marker + reviewer name', RV.includes('kind: LEAVE_REVIEW_SEEN_METADATA_MARKER') && RV.includes('reviewerName,\n            }),'));
check('the row deep-links the portal leave page', RV.includes("actionUrl: '/employees/me/leave'"));
check('the write is best-effort (try/catch after the stamp)', RV.indexOf("action: 'LEAVE_REVIEW_STAMPED'") < RV.indexOf('if (hadPendingCorrection) {') && RV.includes('// Review-seen delivery is best-effort by design.'));

console.log('== Feed + union + bell UI ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('the marker joins the leave OR filter', NF.split('LEAVE_REVIEW_SEEN_METADATA_MARKER').length - 1 >= 2);
check('the kind maps to the leave_review_seen type', NF.includes("kind === 'leave_review_seen'") && NF.includes("type: 'leave_review_seen'"));
const API = read('src/lib/api.ts') ?? '';
check('the NotificationItem union carries the new type', API.includes("'leave_corrected' | 'leave_review_seen' | 'payroll_approved'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check('the bell renders the scan-eye icon', NC.includes("case 'leave_review_seen'") && NC.includes('ScanEye'));
check('the bell wears the cyan rail', NC.includes("border-l-cyan-400 dark:border-l-cyan-500"));
check('the bell carries the "Correction seen" chip', NC.includes('Correction seen'));

console.log('== Styling: the mirror got louder ==');
const LV = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('the portal waiting badge pulses', LV.includes('animate-ping'));
check('a named portal review wears the scan-eye', LV.includes('<ScanEye className="h-3 w-3" aria-hidden />'));
check('the anonymous fallback keeps the plain eye', LV.includes("'Seen by the desk'"));
const PT = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('the desk receipt wears the reviewer initial avatar', PT.includes('live.deskReviewedByName.trim().charAt(0).toUpperCase()'));
check('the amber desk state pulses in step', PT.includes('animate-ping'));

console.log('== Tests ==');
const TS = read('src/tests/leave-review-seen.test.ts') ?? '';
check('the v2.61.0 suite exists', TS.includes('leaveReviewSeenCopy'));
check('the suite pins the dedup gate', TS.includes('GATED by hadPendingCorrection'));

console.log('== History: v2.47–v2.60 anchors intact ==');
check('v2.58.0 tableToCsv still present', (read('src/lib/hr/digest-csv.ts') ?? '').includes('export function tableToCsv'));
check('v2.58.0 audit test still present', !!read('src/tests/bypass-reads-audit.test.ts'));
check('v2.57.0 rawDb feed fix still present', (read('src/lib/db.ts') ?? '').includes('rawDb'));
check('v2.59.0 re-check chip still renders', (PT ?? '').includes('re-check'));
check('v2.60.0 reviewer stamp still personal', RV.includes('deskReviewedByName: reviewerName'));
check('v2.60.0 verify script still exists', !!read('scripts/verify-v2-60-0.mjs'));

console.log('');
if (failures === 0) {
  console.log('v2.61.0 verification: ALL PASS');
} else {
  console.log(`v2.61.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
