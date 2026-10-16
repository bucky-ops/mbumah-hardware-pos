#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.42.0 verification
// Scope: governed leave attachments — the pure validation helper (MIME
// allowlist + 500 KB decoded cap on data URLs, http(s) links accepted),
// server enforcement on every leave path (HR POST, HR EDIT, portal
// requestMyLeave), the shared picker + kind-coded chip UI, display surfaces
// (detail dialog card, desk row marker, portal card chip), tests, whats-new,
// version lockstep.
// Run: node scripts/verify-v2-42-0.mjs

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

console.log('== Helper: leave-attachment.ts ==');
const H = read('src/lib/hr/leave-attachment.ts') ?? '';
check('module is pure (no imports)', !/\nimport /.test(H));
check('500 KB decoded cap exported', H.includes('MAX_LEAVE_ATTACHMENT_BYTES = 500 * 1024') && H.includes("MAX_LEAVE_ATTACHMENT_LABEL = '500 KB'"));
check('MIME allowlist: pdf/png/jpeg/webp only', H.includes("'application/pdf'") && H.includes("'image/png'") && H.includes("'image/jpeg'") && H.includes("'image/webp'"));
check('URL validator accepts null/empty/whitespace', H.includes('export function validateLeaveAttachmentUrl') && H.includes('if (!trimmed) return { ok: true };'));
check('URL validator keeps http(s) links working', H.includes('/^https?:\\/\\//i.test(trimmed)'));
check('data-URL parse with specific failure codes', H.includes("'EMPTY' | 'TOO_LARGE' | 'TYPE' | 'FORMAT'") && H.includes("invalid('TYPE'") && H.includes("invalid('TOO_LARGE'") && H.includes("invalid('FORMAT'"));
check('padding-aware base64 byte math', H.includes('export function base64PayloadBytes') && H.includes("endsWith('==')"));
check('client File gate mirrors server rules', H.includes('export function validateLeaveAttachmentFile') && H.includes('file.size > MAX_LEAVE_ATTACHMENT_BYTES'));
check('display metadata parser (kind/label/bytes)', H.includes("export type LeaveAttachmentKind = 'pdf' | 'image' | 'link';") && H.includes('export function parseLeaveAttachmentMeta') && H.includes('base64PayloadBytes(payload)'));

console.log('== Server enforcement: /api/leaves (POST + PUT EDIT) ==');
const ROUTE = read('src/app/api/leaves/route.ts') ?? '';
check('helper imported in the route', ROUTE.includes("import { validateLeaveAttachmentUrl } from '@/lib/hr/leave-attachment';"));
check('POST validates before requestLeave', ROUTE.includes('const attachmentCheck = validateLeaveAttachmentUrl(attachmentUrl);') && ROUTE.indexOf('attachmentCheck') < ROUTE.indexOf('requestLeave({'));
check('POST maps rejection to 400 with ATTACHMENT_ code', ROUTE.includes('code: `ATTACHMENT_${attachmentCheck.code}`'));
check('EDIT action validates the attachment too', (ROUTE.split("if (action === 'EDIT')")[1] ?? '').includes('validateLeaveAttachmentUrl(attachmentUrl)'));

console.log('== Server enforcement: portal self-service ==');
const SS = read('src/lib/hr/self-service.ts') ?? '';
check('requestMyLeave accepts attachmentUrl', SS.includes('attachmentUrl?: unknown;'));
check('portal path validates with the same helper', SS.includes("validateLeaveAttachmentUrl(rawAttachment || null)") && SS.includes("StageGError(`ATTACHMENT_${attachmentCheck.code}`"));
check('validated value reaches requestLeave', SS.includes('attachmentUrl: rawAttachment || null'));
check('listMyLeave serializes attachmentUrl for the portal', (SS.split('listMyLeave')[1] ?? '').includes('attachmentUrl: r.attachmentUrl ?? null'));

console.log('== Shared UI: picker + chip ==');
const UI = read('src/components/hr/leave-attachment-ui.tsx') ?? '';
check('component module exists and is a client component', UI.includes("'use client'"));
check('picker validates before reading the file', UI.indexOf('validateLeaveAttachmentFile(file)') < UI.indexOf('readFileAsDataUrl(file)'));
check('chip is a real link with download for files', UI.includes('target="_blank"') && UI.includes('download={isDownload ? meta.label : undefined}'));
check('kind-coded chip styles for all three kinds', UI.includes('pdf: {') && UI.includes('image: {') && UI.includes('link: {'));
check('dropzone card + Replace/Remove actions', UI.includes('Attach a supporting document') && UI.includes('Replace') && UI.includes('Remove'));
check('test hooks exposed', UI.includes('data-testid={testId}') && UI.includes('data-testid="leave-attachment-chip"') && UI.includes('`${testId}-picker`'));

console.log('== HR desk wiring (payroll-tab.tsx) ==');
const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('LeaveRequest DTO carries attachmentUrl', TAB.includes('/** v2.42.0: supporting document — data URL (governed cap) or http(s) link. */'));
check('on-behalf filing dialog has the picker', TAB.includes('<LeaveAttachmentPicker value={newAttachment} onChange={setNewAttachment} testId="onbehalf-attachment" />'));
check('filing payload includes the attachment', TAB.includes('...(newAttachment ? { attachmentUrl: newAttachment } : {})'));
check('correction window has the picker + participates in the no-op guard', TAB.includes('<LeaveAttachmentPicker value={editAttachment} onChange={setEditAttachment} testId="edit-attachment" />') && TAB.includes("(editAttachment ?? '') !== (editTarget.attachmentUrl ?? '')"));
check('edit payload always sends the attachment state', TAB.includes('attachmentUrl: editAttachment,'));
check('detail dialog renders the attachment card', TAB.includes('Supporting document') && TAB.includes('<LeaveAttachmentChip value={detail.attachmentUrl} />'));
check('desk rows show the paperclip marker', TAB.includes('A supporting document is attached') && TAB.includes('<Paperclip className="h-2.5 w-2.5" aria-hidden /> attachment'));

console.log('== Portal wiring (leave-view.tsx) ==');
const PORTAL = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('RequestDto carries attachmentUrl', PORTAL.includes('/** v2.42.0: supporting document — data URL (governed cap) or http(s) link. */'));
check('request dialog has the picker', PORTAL.includes('<LeaveAttachmentPicker value={attachment} onChange={setAttachment} testId="portal-attachment" />'));
check('portal payload includes the attachment', PORTAL.includes('...(attachment ? { attachmentUrl: attachment } : {})'));
check('dialog close clears the attachment', PORTAL.includes('setAttachment(null)'));
check('card renders the Attached document chip', PORTAL.includes('Attached document') && PORTAL.includes('<LeaveAttachmentChip value={r.attachmentUrl} />'));

console.log('== Governance untouched ==');
const SVC = read('src/lib/hr/leave-service.ts') ?? '';
check('requestLeave still owns balance guard + recompute', SVC.includes('INSUFFICIENT_LEAVE_BALANCE') && SVC.includes('recomputeBalances'));
check('editLeaveRequest still PENDING-only', SVC.includes('NOT_EDITABLE'));
const LEAVES = read('src/app/api/leaves/route.ts') ?? '';
check('v2.38.0 on-behalf authz intact', LEAVES.includes('You can only file leave requests for yourself.'));
check('v2.33.0 CANCEL authz intact', LEAVES.includes('You can only cancel your own leave requests.'));
const NOTIFY = read('src/lib/hr/leave-notify.ts') ?? '';
check('no new notification marker (feed filters untouched)', !NOTIFY.includes('LEAVE_ATTACHMENT'));

console.log('== Tests + docs + version ==');
const TEST = read('src/tests/leave-attachment.test.ts') ?? '';
check('validation contracts tested (accepted + rejected)', TEST.includes("describe('validateLeaveAttachmentUrl") && TEST.includes('rejects a data URL whose decoded size exceeds the 500 KB cap'));
check('display metadata + byte math tested', TEST.includes('parseLeaveAttachmentMeta') && TEST.includes('base64PayloadBytes'));
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new 2.42.0 entry present', WN.includes("version: '2.42.0'") && WN.includes('medical certificate'));
check('whats-new ordering (2.42.0 above 2.41.0)', WN.indexOf("version: '2.42.0'") < WN.indexOf("version: '2.41.0'"));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json 2.42.0 lockstep', PKG.version === '2.42.0' && PKG.mbumah?.releaseVersion === '2.42.0' && PKG.mbumah?.baseVersion === '2.42.0');

console.log('');
if (failures === 0) {
  console.log('ALL PASS: v2.42.0 leave-attachments verification complete.');
} else {
  console.log(`FAILURES: ${failures} check(s) failed.`);
  process.exit(1);
}
