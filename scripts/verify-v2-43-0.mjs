#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.43.0 verification
// Scope: approver-side correction awareness — the leave_corrected marker +
// amber approver-facing copy, the fan-out from the edit path (actor +
// employee excluded), feed wiring in BOTH filter lists (the v2.38.0
// double-render bug class stays dead), notification-center surface,
// attachment marker text upgrade + inline image previews, tests, whats-new,
// version lockstep.
// Run: node scripts/verify-v2-43-0.mjs

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

console.log('== Copy module: leave-notify.ts ==');
const N = read('src/lib/hr/leave-notify.ts') ?? '';
check('leave_corrected marker exported', N.includes("export const LEAVE_CORRECTED_METADATA_MARKER = 'leave_corrected';"));
check('kind union extended', N.includes("  | 'leave_edited'\n  | 'leave_corrected';"));
check('parser accepts the new kind', N.includes("rec.kind === 'leave_edited' ||\n      rec.kind === 'leave_corrected'"));
check('approver-facing copy builder exported', N.includes('export function leaveCorrectedCopy'));
check('copy is amber-accented and decision-aware', N.includes("const accent = '#b45309';") && N.includes('still awaits a decision'));
check('copy carries the before → after contract', N.includes("previousWorkingDays") && N.includes('(was ${escapeHtml(oldRange)})'));

console.log('== Service: fan-out from the edit path ==');
const SVC = read('src/lib/hr/leave-service.ts') ?? '';
check('notifyLeaveRequestCorrected exported', SVC.includes('export async function notifyLeaveRequestCorrected'));
check('fan-out mirrors the submission recipient query', (SVC.split('notifyLeaveRequestCorrected')[1] ?? '').includes("'SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'"));
check('actor + employee linked user excluded', (SVC.split('export async function notifyLeaveRequestCorrected')[1] ?? '').includes('notIn'));
check('edit path calls the fan-out AFTER the employee notification', SVC.indexOf('leaveEditedCopy({') > -1 && SVC.indexOf('notifyLeaveRequestCorrected({') > SVC.indexOf('leaveEditedCopy({'));
check('fan-out is best-effort (own try/catch)', (SVC.split('notifyLeaveRequestCorrected({')[1] ?? '').includes('// Approver delivery is best-effort by design.'));
check('grouped email rides on LEAVE_EDIT type', (SVC.split('export async function notifyLeaveRequestCorrected')[1] ?? '').includes("type: 'LEAVE_EDIT'"));
check('v2.40.0 employee-side notification intact', SVC.includes('kind: LEAVE_EDITED_METADATA_MARKER'));
check('v2.33.0 cancel router intact', SVC.includes('notifyLeaveRequestCancelled'));

console.log('== Feed wiring: /api/notifications (BOTH filter lists) ==');
const R = read('src/app/api/notifications/route.ts') ?? '';
check('marker imported', R.includes('LEAVE_CORRECTED_METADATA_MARKER'));
check('section-8 digest NOT list excludes the marker', R.slice(R.indexOf('NOT: {'), R.indexOf('9. v2.31.0')).includes('LEAVE_CORRECTED_METADATA_MARKER'));
check('section-9 leave OR list includes the marker', (R.split('9. v2.31.0 + v2.32.0: leave notifications')[1] ?? '').includes('LEAVE_CORRECTED_METADATA_MARKER'));
check('feed type union extended', R.includes("| 'leave_edited' | 'leave_corrected';"));
check('section-9 branch maps the kind', R.includes("} else if (kind === 'leave_corrected') {"));
check('branch deep-links the Payroll Leave desk', (R.split("kind === 'leave_corrected'")[1] ?? '').includes("targetTab: 'payroll'"));

console.log('== Client surface ==');
const API = read('src/lib/api.ts') ?? '';
check('NotificationItem union extended', API.includes("| 'leave_edited' | 'leave_corrected';"));
const C = read('src/components/notification-center.tsx') ?? '';
check('icon case present (amber file-pen)', C.includes("case 'leave_corrected':") && C.includes('FilePenLine'));
check('amber left rail on feed rows', C.includes("notification.type === 'leave_corrected' ? 'border-l-[3px] border-l-amber-400"));
check('re-review chip present', C.includes('Corrected - re-review'));

console.log('== Attachment styling details (v2.43.0) ==');
const A = read('src/lib/hr/leave-attachment.ts') ?? '';
check('describeLeaveAttachmentMarker exported (pure)', A.includes('export function describeLeaveAttachmentMarker'));
const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('desk rows use the descriptive marker', TAB.includes('{describeLeaveAttachmentMarker(l.attachmentUrl)}'));
check('marker kind-coded to the chip language', TAB.includes("meta?.kind === 'image'") && TAB.includes("meta?.kind === 'link'"));
check('detail dialog previews image attachments inline', TAB.includes('alt="Supporting document preview"') && TAB.includes("detail.attachmentUrl.startsWith('data:image/')"));
const P = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('portal cards preview image attachments inline', P.includes('alt="Attached document preview"') && P.includes("r.attachmentUrl.startsWith('data:image/')"));

console.log('== Governance untouched ==');
const DBT = read('src/lib/db.ts') ?? '';
check('employeeLeaveBalance NOT tenant-scoped (v2.43.0 QA fix: no storeId column)', !DBT.split('const STORE_SCOPED_MODELS = new Set<string>([')[1]?.split(']);')[0]?.replace(/\/\/.*$/gm, '').includes('employeeLeaveBalance'));
check('exclusion documented inline', DBT.includes('employeeLeaveBalance is ALSO intentionally NOT here'));
const LEAVES = read('src/app/api/leaves/route.ts') ?? '';
check('v2.38.0 on-behalf authz intact', LEAVES.includes('You can only file leave requests for yourself.'));
check('v2.33.0 CANCEL authz intact', LEAVES.includes('You can only cancel your own leave requests.'));
check('v2.40.0 EDIT stays decision-capable-only', (LEAVES.split("if (action === 'APPROVE' || action === 'REJECT' || action === 'EDIT')")[1] ?? '').includes('requireRole'));
check('attachment validation still on the EDIT branch', (LEAVES.split("if (action === 'EDIT')")[1] ?? '').includes('validateLeaveAttachmentUrl(attachmentUrl)'));

console.log('== Tests + docs + version ==');
const T = read('src/tests/leave-corrected-routing.test.ts') ?? '';
check('copy + parser + fan-out + wiring tested', T.includes('leaveCorrectedCopy') && T.includes('notifyLeaveRequestCorrected') && T.includes('describeLeaveAttachmentMarker'));
check('feed-filter regression guard tested', T.includes('BOTH feed filter lists'));
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new 2.43.0 entry present', WN.includes("version: '2.43.0'") && WN.includes('re-review'));
check('whats-new ordering (2.43.0 above 2.42.0)', WN.indexOf("version: '2.43.0'") < WN.indexOf("version: '2.42.0'"));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json 2.43.0 lockstep', PKG.version === '2.43.0' && PKG.mbumah?.releaseVersion === '2.43.0' && PKG.mbumah?.baseVersion === '2.43.0');

console.log('');
if (failures === 0) {
  console.log('ALL PASS: v2.43.0 approver-correction-awareness verification complete.');
} else {
  console.log(`FAILURES: ${failures} check(s) failed.`);
  process.exit(1);
}
