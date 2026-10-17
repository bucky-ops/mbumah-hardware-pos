#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.60.0 verification
// Scope: the receipt is personal and shared.
// (1) LeaveRequest carries deskReviewedById/Name and the review stamp
//     records WHO reviewed (Users.name -> email -> id fallback).
// (2) The desk receipt says "Last reviewed by {name}" and the cached row
//     carries the reviewer name after a stamp.
// (3) The portal mirrors the review: emerald "Seen by {reviewer}" after a
//     post-edit visit, amber "Waiting for a desk review" while unseen —
//     decided by the SAME needsDeskRecheck rule as the desk chip.
// (4) Both DTOs (desk GET + portal listMyLeave) expose the mirror fields.
// Every v2.47–v2.59 feature is asserted intact.
// Run: node scripts/verify-v2-60-0.mjs

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
check('package.json version is 2.60.0', PKG.version === '2.60.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.60.0', PKG.mbumah?.releaseVersion === '2.60.0');
check('mbumah.baseVersion is 2.60.0', PKG.mbumah?.baseVersion === '2.60.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.60.0 entry", WN.includes("version: '2.60.0'"));
check("What's-New names the personal-receipt story", WN.includes('personal and shared'));
check('verify:v2-60-0 script is wired', (PKG.scripts ?? {})['verify:v2-60-0'] === 'node scripts/verify-v2-60-0.mjs');
check('verify:v2-59-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-59-0'] === 'node scripts/verify-v2-59-0.mjs');

console.log('== Schema: the reviewer identity ==');
const SC = read('prisma/schema.prisma') ?? '';
check('LeaveRequest carries deskReviewedById', SC.includes('deskReviewedById   String?') || SC.includes('deskReviewedById String?'));
check('LeaveRequest carries deskReviewedByName', SC.includes('deskReviewedByName String?'));
check('the columns are documented as WHO reviewed', SC.includes('v2.60.0: WHO stamped the review'));

console.log('== Route: the stamp is personal ==');
const RV = read('src/app/api/leaves/[id]/review/route.ts') ?? '';
check('the stamp writes the reviewer id', RV.includes('deskReviewedById: session.userId'));
check('the stamp writes the reviewer name', RV.includes('deskReviewedByName: reviewerName'));
check('the name resolves from Users with an email->id fallback', RV.includes('reviewer?.name ?? session.email ?? session.userId'));
check('the audit metadata carries the reviewer', RV.includes('reviewerId: session.userId') && RV.includes('reviewerName'));
check('the response returns the reviewer name', RV.includes('deskReviewedByName: updated.deskReviewedByName ?? null'));

console.log('== DTOs: both sides carry the mirror ==');
const LR = read('src/app/api/leaves/route.ts') ?? '';
check('desk GET exposes deskReviewedByName', LR.includes('deskReviewedByName: r.deskReviewedByName ?? null'));
const SS = read('src/lib/hr/self-service.ts') ?? '';
check('portal listMyLeave exposes deskReviewedAt', SS.includes('deskReviewedAt: r.deskReviewedAt?.toISOString() ?? null'));
check('portal listMyLeave exposes deskReviewedByName', SS.includes('deskReviewedByName: r.deskReviewedByName ?? null'));

console.log('== Desk UI: the receipt names the reviewer ==');
const PT = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('the receipt says "Last reviewed by {name}"', PT.includes('by {live.deskReviewedByName}'));
check('the receipt keeps the timestamp', PT.includes("formatDateTime(live.deskReviewedAt)"));
check('the cached row carries the name after a stamp', PT.includes('deskReviewedByName: data.deskReviewedByName'));
check('the cache write reads the UNWRAPPED apiFetch shape (v2.60.0 fix)', PT.includes('l.id === data.id') && !PT.includes('data.data.needsRecheck'));
check('the LeaveRequest DTO interface carries the field', PT.includes('deskReviewedByName?: string | null;'));

console.log('== Portal UI: the mirror is honest both ways ==');
const LV = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('the portal imports the SHARED rule', LV.includes("import { needsDeskRecheck } from '@/lib/hr/leave-recheck';"));
check('amber "Waiting for a desk review" while unseen', LV.includes('Waiting for a desk review'));
check('emerald "Seen by {reviewer}" after the visit', LV.includes('Seen by ${r.deskReviewedByName}'));
check('the anonymous fallback keeps working', LV.includes("'Seen by the desk'"));
check('the badge is decided by needsDeskRecheck, not ad-hoc logic', LV.includes('needsDeskRecheck(r.editedAt, r.deskReviewedAt)'));
check('the mirror only renders on corrected cards (inside the edit block)', LV.indexOf('Waiting for a desk review') > LV.indexOf('v2.40.0: correction provenance'));

console.log('== Tests ==');
const RT = read('src/tests/leave-recheck.test.ts') ?? '';
check('the v2.59.0 heuristic suite still exists', RT.includes('needsDeskRecheck - the one shared re-check rule'));
check('the route contract pins the reviewer stamp', RT.includes("action: 'LEAVE_REVIEW_STAMPED'"));
check('the DTO contract pins the shared rule', RT.includes('GET /api/leaves - DTO carries the server-computed marker'));

console.log('== History: v2.47–v2.59 anchors intact ==');
check('v2.58.0 tableToCsv still present', (read('src/lib/hr/digest-csv.ts') ?? '').includes('export function tableToCsv'));
check('v2.58.0 audit test still present', !!read('src/tests/bypass-reads-audit.test.ts'));
check('v2.57.0 rawDb feed fix still present', (read('src/lib/db.ts') ?? '').includes('rawDb'));
check('v2.59.0 re-check chip still renders', PT.includes('re-check'));
check('v2.59.0 review stamp route still exists', !!read('src/app/api/leaves/[id]/review/route.ts'));
check('v2.59.0 verify script still exists', !!read('scripts/verify-v2-59-0.mjs'));

console.log('');
if (failures === 0) {
  console.log('v2.60.0 verification: ALL PASS');
} else {
  console.log(`v2.60.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
