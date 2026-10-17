#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.45.0 verification
// Scope: portal self-correction — the employee side of the v2.40.0 governed
// edit window. editedByUserId schema column + migration, the EDIT owner
// authz split in PUT /api/leaves (decision-capable OR request owner),
// deterministic provenance in both DTOs, the portal Correct action +
// correction dialog (live day count, balance rail, no-op guard, note), the
// desk self-corrected chip nuance, and the password-changed security notice
// (PASSWORD_CHANGED type + best-effort send after the rotation tx).
// Run: node scripts/verify-v2-45-0.mjs

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

console.log('== Schema & migration ==');
const SCHEMA = read('prisma/schema.prisma') ?? '';
check('LeaveRequest.editedByUserId column', SCHEMA.includes('editedByUserId String?'));
const MIG = read('prisma/migrations/20261018000000_add_leave_request_edited_by_user_id/migration.sql') ?? '';
check('migration adds the column', MIG.includes('ALTER TABLE "LeaveRequest" ADD COLUMN "editedByUserId" TEXT'));

console.log('== Service: provenance stamp + window unchanged ==');
const SVC = read('src/lib/hr/leave-service.ts') ?? '';
check('editLeaveRequest stamps editedByUserId', SVC.includes('editedByUserId: input.actorId'));
check('PENDING-only guard intact', SVC.includes("if (request.status !== 'PENDING')"));

console.log('== API: PUT /api/leaves EDIT owner authz ==');
const ROUTE = read('src/app/api/leaves/route.ts') ?? '';
check('EDIT removed from the requireRole gate', (ROUTE.split("if (action === 'APPROVE' || action === 'REJECT')")[1] ?? '').slice(0, 400).includes('requireRole') && !(ROUTE.split("if (action === 'APPROVE' || action === 'REJECT')")[0] ?? '').includes("action === 'EDIT') {\n    const roleError"));
const gateHead = (ROUTE.split("if (action === 'APPROVE' || action === 'REJECT')")[1] ?? '').split('const leaveRequest')[0];
check('gate covers approve/reject only', gateHead.includes("requireRole('SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')"));
check('EDIT authz block exists (decision-capable OR owner → else 403)', (ROUTE.split("if (action === 'EDIT')")[1] ?? '').includes("leaveRequest.employee.user?.id === session.userId") && (ROUTE.split("if (action === 'EDIT')")[1] ?? '').includes('status: 403'));
check('owner refusal message', ROUTE.includes('You can only correct your own leave requests.'));
check('GET DTO exposes editedByUserId', ROUTE.includes('editedByUserId: r.editedByUserId ?? null'));
check('GET DTO exposes employeeUserId', ROUTE.includes('employeeUserId: r.employee.user?.id ?? null'));
check('GET include joins the linked user', ROUTE.includes('user: { select: { id: true } }'));

console.log('== Portal: Correct action + dialog + chip ==');
const VIEW = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('LeaveView takes selfUserId', VIEW.includes('selfUserId: string'));
check('PENDING cards render the Correct action', VIEW.includes('aria-hidden /> Correct'));
check('dialog PUTs action EDIT', (VIEW.split('const correct = async')[1] ?? '').includes("action: 'EDIT'"));
check('dialog carries editNote to the server', (VIEW.split('const correct = async')[1] ?? '').includes('editNote'));
check('no-op guard gates Save', VIEW.includes('disabled={busy || !editFormReady}'));
check('live day count via previewWorkingDays', VIEW.includes('previewWorkingDays('));
check('balance rail warns on insufficiency', VIEW.includes('the server will reject this correction'));
check('deterministic "Corrected by you" chip', VIEW.includes('r.editedByUserId === selfUserId') && VIEW.includes('Corrected by you'));
check('HR chip fallback intact', VIEW.includes('Corrected by HR · {r.editedByName}'));
const PAGE = read('src/app/(selfservice)/employees/me/leave/page.tsx') ?? '';
check('page passes guard.session.userId', PAGE.includes('selfUserId={guard.session.userId}'));

console.log('== listMyLeave DTO ==');
const SS = read('src/lib/hr/self-service.ts') ?? '';
check('portal payload exposes editedByUserId', SS.includes('editedByUserId: r.editedByUserId ?? null'));

console.log('== HR desk: self-corrected nuance ==');
const PAYROLL = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('row chip flips to self-corrected', PAYROLL.includes("'self-corrected' : 'corrected'"));
check('tooltip relabels a self-correction', PAYROLL.includes("'Self-corrected by ' : 'Corrected by '"));
check('detail dialog relabels a self-correction', PAYROLL.includes("? 'Self-corrected' : 'Corrected by HR'"));
check('desk DTO interface carries the pair', PAYROLL.includes('editedByUserId?: string | null;') && PAYROLL.includes('employeeUserId?: string | null;'));

console.log('== Password-changed security notice ==');
const PW = read('src/app/api/profile/password/route.ts') ?? '';
check('sends the notice best-effort', PW.includes('await sendEmail({') && PW.includes('.catch(() => undefined)'));
check('PASSWORD_CHANGED type tag', PW.includes('NotificationType.PASSWORD_CHANGED'));
check('notice fires after the rotation tx', PW.indexOf('await db.$transaction') < PW.indexOf('await sendEmail({'));
check('metadata carries sessionsRevoked', PW.includes('metadata: { sessionsRevoked, currentSessionKept: true, changedAtIso }'));
const TPL = read('src/lib/email-templates.ts') ?? '';
check('passwordChangedTemplate exists', TPL.includes('export function passwordChangedTemplate'));
check('template has the was-not-you escalation', TPL.includes("Wasn't you?") || TPL.includes('Wasn&#x27;t you?'));
check('template names the signed-out devices', TPL.includes('sessionsRevoked === 1'));
const ESVC = read('src/lib/email-service.ts') ?? '';
check('NotificationType.PASSWORD_CHANGED registered', ESVC.includes("PASSWORD_CHANGED: 'PASSWORD_CHANGED'"));

console.log('== Tests, whats-new, version lockstep ==');
const T = read('src/tests/leave-self-correct.test.ts') ?? '';
check('self-correction test file exists', T !== null && T.length > 0);
check('tests cover the owner authz split', T.includes('You can only correct your own leave requests.'));
check('tests cover the provenance stamp', T.includes('editedByUserId'));
check('tests cover the security notice', T.includes('PASSWORD_CHANGED'));
check('whats-new has the 2.45.0 entry', (read('src/lib/whats-new.ts') ?? '').includes("version: '2.45.0'"));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json is 2.45.0', PKG.version === '2.45.0');
check('mbumah.releaseVersion lockstep', PKG.mbumah?.releaseVersion === '2.45.0');
check('verify:v2-45-0 registered', typeof PKG.scripts?.['verify:v2-45-0'] === 'string');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
