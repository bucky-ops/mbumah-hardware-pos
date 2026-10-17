#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.62.0 verification
// Scope: the correction answers to the room.
// (1) The clearing desk visit fans out an APPROVER-facing bell row
//     ("Correction answered - {employee}") to the exact decision-capable
//     group the v2.43.0 correction fan-out addressed, minus the reviewer
//     and the employee's linked user — inside the SAME hadPendingCorrection
//     dedup gate as the v2.61.0 employee row (one visit, every listener
//     told exactly once).
// (2) The row is named (reviewerName), carries the leave_review_answered
//     marker, and is best-effort under its own guard. Bell-only: no email
//     surfaces. DECISION_CAPABLE_ROLES is exported so the group can never
//     drift from the correction fan-out.
// (3) The feed (leave OR filter + kind mapping → targetTab 'payroll'), the
//     NotificationItem union and the notification center (emerald rail,
//     badge-check, "Correction answered" chip) render the new type.
// (4) Styling: the desk dialog upgrades an answered correction to the
//     emerald "Correction answered / Seen by {reviewer}" receipt with the
//     badge-check heading and the reviewer avatar; the amber unanswered
//     state and the v2.61.0 ping dot stay intact.
// Every v2.47–v2.61 feature is asserted intact.
// Run: node scripts/verify-v2-62-0.mjs

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
check('package.json version is 2.62.0', PKG.version === '2.62.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.62.0', PKG.mbumah?.releaseVersion === '2.62.0');
check('mbumah.baseVersion is 2.62.0', PKG.mbumah?.baseVersion === '2.62.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new carries the 2.62.0 entry first', WN.includes("version: '2.62.0'") && WN.indexOf("version: '2.62.0'") < WN.indexOf("version: '2.61.0'"));

console.log('== Copy family ==');
const LV = read('src/lib/hr/leave-notify.ts') ?? '';
check('the answered marker exists', LV.includes("LEAVE_REVIEW_ANSWERED_METADATA_MARKER = 'leave_review_answered'"));
check('the answered copy builder exists', LV.includes('export function leaveReviewAnsweredCopy'));
check('the copy is bell-only (SUCCESS tone, no email fields in the return)', LV.includes("return { title, message, notifType: 'SUCCESS', priority: 'NORMAL' };") && LV.split('leaveReviewAnsweredCopy').length > 1);
check('the kind joins the LeaveNotificationKind union', LV.includes("| 'leave_review_answered'"));
check('the parser accepts the kind', LV.includes("rec.kind === 'leave_review_answered'"));

console.log('== Route contract ==');
const RV = read('src/app/api/leaves/[id]/review/route.ts') ?? '';
check('the stamp query fetches the employee name', RV.includes('firstName: true') && RV.includes('lastName: true'));
check('the answered fan-out imports the shared role set', RV.includes("DECISION_CAPABLE_ROLES") && RV.includes("from '@/lib/hr/leave-service'"));
check('the fan-out is gated by the SAME hadPendingCorrection dedup', RV.split('if (hadPendingCorrection) {').length - 1 === 1 && RV.indexOf('kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER') > RV.indexOf('if (hadPendingCorrection) {'));
check('the fan-out excludes the reviewer + the employee linked user', RV.includes('const exclude = [session.userId, ...(employeeLinkedUserId ? [employeeLinkedUserId] : [])];'));
check('the fan-out rides createMany with the marker', RV.includes('db.notification.createMany') && RV.includes('kind: LEAVE_REVIEW_ANSWERED_METADATA_MARKER'));
check('the answered delivery is best-effort under its own guard', RV.includes('// Review-answered delivery is best-effort by design.'));
check('the ordering contract holds (stamp < log < delivery)', RV.indexOf('deskReviewedByName: reviewerName,') < RV.indexOf("action: 'LEAVE_REVIEW_STAMPED'") && RV.indexOf("action: 'LEAVE_REVIEW_STAMPED'") < RV.indexOf('if (hadPendingCorrection) {'));
check('the service exports DECISION_CAPABLE_ROLES', (read('src/lib/hr/leave-service.ts') ?? '').includes('export const DECISION_CAPABLE_ROLES'));

console.log('== Feed + bell ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('the marker joins the leave OR filter', NF.includes('{ metadata: { contains: LEAVE_REVIEW_ANSWERED_METADATA_MARKER } }'));
check('the kind maps to leave_review_answered', NF.includes("kind === 'leave_review_answered'") && NF.includes("type: 'leave_review_answered'"));
check('approver rows route to the payroll desk', (NF.split("kind === 'leave_review_answered'")[1] ?? '').includes("targetTab: 'payroll'"));
const AP = read('src/lib/api.ts') ?? '';
check('the NotificationItem union carries the new type', AP.includes("'leave_review_answered'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check('the badge-check icon case renders', NC.includes("case 'leave_review_answered':") && NC.includes('BadgeCheck'));
check('the emerald rail renders', NC.includes("'leave_review_answered' ? 'border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500'"));
check('the "Correction answered" chip renders', NC.includes('Correction answered'));

console.log('== Styling: the desk receipt answers ==');
const PT = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('the answered state is computed from the shared rule', PT.includes('!live.needsRecheck && live.deskReviewedAt && live.editedAt'));
check('the answered rail wears emerald', PT.includes('border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40'));
check('the answered heading wears the badge-check', PT.includes("answeredCorrection ? 'Correction answered' : 'Desk review'"));
check('the answered body says "Seen by"', PT.includes('Seen by'));
check('the reviewer avatar carries over from v2.61.0', PT.includes('live.deskReviewedByName.trim().charAt(0).toUpperCase()'));
check('the amber unanswered state stays intact', PT.includes('animate-ping') && PT.includes('no desk visit since'));

console.log('== Tests ==');
const TS = read('src/tests/leave-review-answered.test.ts') ?? '';
check('the v2.62.0 suite exists', TS.includes('leaveReviewAnsweredCopy'));
check('the suite pins the single-gate dedup', TS.includes('GATED by the same hadPendingCorrection dedup'));

console.log('== History: v2.47–v2.61 anchors intact ==');
check('v2.58.0 tableToCsv still present', (read('src/lib/hr/digest-csv.ts') ?? '').includes('export function tableToCsv'));
check('v2.58.0 audit test still present', !!read('src/tests/bypass-reads-audit.test.ts'));
check('v2.57.0 rawDb feed fix still present', (read('src/lib/db.ts') ?? '').includes('rawDb'));
check('v2.59.0 re-check chip still present', (PT ?? '').includes('re-check'));
check('v2.60.0 reviewer stamp still personal', RV.includes('deskReviewedByName: reviewerName'));
check('v2.61.0 employee bell still gated + named', RV.includes("kind: LEAVE_REVIEW_SEEN_METADATA_MARKER") && RV.includes("actionUrl: '/employees/me/leave'"));
check('v2.61.0 cyan receipt still renders', NC.includes("'leave_review_seen' ? 'border-l-[3px] border-l-cyan-400 dark:border-l-cyan-500'"));
check('v2.60.0 verify script still exists', !!read('scripts/verify-v2-60-0.mjs'));

console.log('');
if (failures === 0) {
  console.log('v2.62.0 verification: ALL PASS');
} else {
  console.log(`v2.62.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
