#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.40.0 verification
// Scope: governed edit window for PENDING leave requests — service
// (editLeaveRequest: recompute + balance guard with self headroom + dual
// recompute + before/after audit + employee notification), leaveEditedCopy
// (indigo CORRECTED surface), PUT /api/leaves action EDIT (role gate, error
// mapping, systemLog), GET serializer provenance fields, HR desk correction
// dialog (preview + delta + no-op guard), portal "Corrected by HR" chip,
// feed 'leave_edited' surface, schema + migration, tests, whats-new, version
// lockstep.
// Run: node scripts/verify-v2-40-0.mjs

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

console.log('== Service: editLeaveRequest ==');
const SVC = read('src/lib/hr/leave-service.ts') ?? '';
check('PENDING-only gate (NOT_EDITABLE)', SVC.includes('NOT_EDITABLE') && SVC.includes("request.status !== 'PENDING'"));
check('working days recomputed with the filing arithmetic', SVC.includes('countWorkingDays(input.startDate, input.endDate, input.halfDay === true)'));
check('balance guard mirrors requestLeave (INSUFFICIENT_LEAVE_BALANCE)', SVC.includes('INSUFFICIENT_LEAVE_BALANCE: corrected range needs'));
check('self pending days count as headroom on same type/year', SVC.includes('const ownPending = sameTypeAndYear ? Number(request.workingDays) : 0;'));
check('no headroom on a type change', SVC.includes('const sameTypeAndYear = newTypeId === request.leaveTypeId && oldYear === newYear;'));
check('provenance stamp editedAt/editedByName/editNote', SVC.includes('editedAt: new Date()') && SVC.includes('editedByName: input.editedByName ?? null') && SVC.includes('editNote: input.editNote?.trim()'));
check('no status transition (PENDING preserved)', /editLeaveRequest[\s\S]{0,4000}status: 'PENDING'[\s\S]{0,4000}leaveRequest\.update/.test(SVC) === false && !/data: \{[\s\S]{0,600}status:/.test(SVC.split('export async function editLeaveRequest')[1]?.split('export async function decideLeaveRequest')[0] ?? ''));
check('returnDate follows the corrected endDate', SVC.includes('returnDate: new Date(input.endDate.getTime() + 24 * 3600 * 1000)'));
check('dual recompute via deduped (type, year) set', SVC.includes('const recomputes = new Set<string>()') && SVC.includes('await recomputeBalances(request.employeeId, typeId, Number(year))'));
check('before/after audit metadata', SVC.includes('before: {') && SVC.includes('after: {') && SVC.includes("reason: 'Leave request corrected in place (edit window).'"));
check('employee bell row with LEAVE_EDITED marker + portal link', SVC.includes('kind: LEAVE_EDITED_METADATA_MARKER') && SVC.includes("actionUrl: '/employees/me/leave'"));
check('LEAVE_EDIT email via central service', SVC.includes("type: 'LEAVE_EDIT'"));
check('actor === linked user stays silent', SVC.includes('request.employee.user.id !== input.actorId'));
check('notification wrapped fail-soft', SVC.split('export async function editLeaveRequest')[1]?.includes('// Edit delivery is best-effort by design'));

console.log('== Copy: leaveEditedCopy (indigo surface) ==');
const NOTIFY = read('src/lib/hr/leave-notify.ts') ?? '';
check('LEAVE_EDITED marker + kind union', NOTIFY.includes("export const LEAVE_EDITED_METADATA_MARKER = 'leave_edited'") && NOTIFY.includes("| 'leave_edited';"));
check('parser accepts leave_edited', NOTIFY.includes("rec.kind === 'leave_edited'") && NOTIFY.includes('out.editedByName = rec.editedByName'));
check('copy carries was → now in message', NOTIFY.includes('previously ${oldDays} (${oldRange})'));
check('type-change prefix names the old type', NOTIFY.includes('const typeChanged = !!previousLeaveTypeName && previousLeaveTypeName !== leaveTypeName;'));
check('CORRECTED badge + indigo accents', NOTIFY.includes('>CORRECTED<') && NOTIFY.includes("const accent = '#4338ca';"));
check('pending-status reassurance', NOTIFY.includes('keeps its pending status'));
check('editor footer', NOTIFY.includes('Corrected by ${escapeHtml(editedByLabel)} (HR).'));

console.log('== Route: PUT /api/leaves action EDIT ==');
const ROUTE = read('src/app/api/leaves/route.ts') ?? '';
check('action list includes EDIT', ROUTE.includes("'APPROVE', 'REJECT', 'CANCEL', 'EDIT'"));
check('EDIT behind the decision-capable role gate', ROUTE.includes("action === 'APPROVE' || action === 'REJECT' || action === 'EDIT'") && ROUTE.includes("requireRole('SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT')(session)"));
check('EDIT branch returns before the status switch', ROUTE.indexOf("if (action === 'EDIT') {") > 0 && ROUTE.indexOf("const oldStatus = leaveRequest.status;") > ROUTE.indexOf("if (action === 'EDIT') {"));
check('date validation for the corrected range', ROUTE.includes('startDate and endDate are required for an edit.'));
check('optional type change validated', ROUTE.includes('Leave type not found.') && ROUTE.includes("leaveTypeId !== leaveRequest.leaveTypeId"));
check('editor label fallback to actor record', ROUTE.includes('editorLabel = actor?.name?.trim() || actor?.email || session.email'));
check('NOT_EDITABLE → 400 mapping', ROUTE.includes("message.startsWith('NOT_EDITABLE')"));
check('INSUFFICIENT_BALANCE → 400 mapping', ROUTE.includes("message.startsWith('INSUFFICIENT_LEAVE_BALANCE')"));
check('systemLog LEAVE_REQUEST_EDITED with old/new days', ROUTE.includes("action: 'LEAVE_REQUEST_EDITED'") && ROUTE.includes('oldWorkingDays') && ROUTE.includes('newWorkingDays'));
check('GET serializer exposes provenance', ROUTE.includes('editedAt: r.editedAt?.toISOString() ?? null') && ROUTE.includes('editedByName: r.editedByName') && ROUTE.includes('editNote: r.editNote'));

console.log('== HR desk: correction dialog ==');
const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('amber Pencil action on PENDING rows', TAB.includes('title="Correct request — fix dates, type or reason without cancelling"'));
check('prefill from the stored row', TAB.includes('setEditStart(l.startDate.slice(0, 10));'));
check('no-op guard (something must change)', TAB.includes('const editChanged =') && TAB.includes('editNote.trim().length > 0'));
check('self headroom mirrored client-side', TAB.includes('const editSelfHeadroom ='));
check('live days preview test hook', TAB.includes('data-testid="edit-days-preview"'));
check('insufficient preview blocks save', TAB.includes('the server will reject this correction.'));
check('before → after strip', TAB.includes('<span className="text-muted-foreground">Was</span>') && TAB.includes('Now (preview)'));
check('amber save CTA', TAB.includes('className="bg-amber-600 hover:bg-amber-700 text-white"'));
check('PUT sends action EDIT', TAB.includes("action: 'EDIT'"));
check('desk row "corrected" marker', TAB.includes('/> corrected'));
check('detail dialog provenance card', TAB.includes('Corrected by HR · {detail.editedByName}'));
check('mutation invalidates leaves + preview', TAB.includes("qc.invalidateQueries({ queryKey: ['payroll-leaves', storeId] });") && TAB.includes("qc.invalidateQueries({ queryKey: ['payroll-leave-balance-preview'] });"));

console.log('== Portal + feed surfaces ==');
const VIEW = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('portal card "Corrected by HR" chip', VIEW.includes('Corrected by HR · {r.editedByName}') && VIEW.includes('PenLine'));
check('portal note line', VIEW.includes('Note: {r.editNote}'));
const SS = read('src/lib/hr/self-service.ts') ?? '';
check('self-service serializer exposes provenance', SS.includes('editedAt: r.editedAt?.toISOString() ?? null') && SS.includes('editedByName: r.editedByName ?? null'));
const CENTER = read('src/components/notification-center.tsx') ?? '';
check('feed surface: icon case + indigo rail + chip', CENTER.includes("case 'leave_edited'") && CENTER.includes('border-l-indigo-400') && CENTER.includes('Corrected by HR'));
const FEED = read('src/app/api/notifications/route.ts') ?? '';
check('feed route maps leave_edited rows', FEED.includes("type: 'leave_edited'") && FEED.includes("kind === 'leave_edited'"));
check('feed marker filters own leave_edited (QA regression guard)', (FEED.match(/contains: LEAVE_EDITED_METADATA_MARKER/g) || []).length === 2 && FEED.includes('LEAVE_EDITED_METADATA_MARKER,'));
const API = read('src/lib/api.ts') ?? '';
check('api.ts feed type union extended', API.includes("| 'leave_on_behalf' | 'leave_edited';"));

console.log('== Schema + migration ==');
const SCHEMA = read('prisma/schema.prisma') ?? '';
check('LeaveRequest provenance columns', SCHEMA.includes('editedAt   DateTime?') && SCHEMA.includes('editedByName String?') && SCHEMA.includes('editNote   String?'));
check('committed provider stays postgresql', SCHEMA.split('datasource db')[1]?.includes('provider = "postgresql"'));
const MIG = read('prisma/migrations/20261017140000_add_leave_edited_by/migration.sql') ?? '';
check('migration adds the three columns', MIG.includes('ADD COLUMN "editedAt"') && MIG.includes('ADD COLUMN "editedByName"') && MIG.includes('ADD COLUMN "editNote"'));

console.log('== Tests + docs + version ==');
const TEST = read('src/tests/leave-edit.test.ts') ?? '';
check('test file covers service + copy + static contracts', TEST.includes('describe(\'editLeaveRequest - balance guard\'') && TEST.includes('describe(\'leaveEditedCopy - copy contracts\'') && TEST.includes('v2.40.0 static contracts'));
const WN = read('src/lib/whats-new.ts') ?? '';
check('whats-new 2.40.0 entry present', WN.includes("version: '2.40.0'") && WN.includes('Correct pending leave requests in place'));
check('whats-new keeps 2.39.0 below', WN.indexOf("version: '2.40.0'") < WN.indexOf("version: '2.39.0'"));
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json 2.40.0 lockstep', PKG.version === '2.40.0' && PKG.mbumah?.releaseVersion === '2.40.0' && PKG.mbumah?.baseVersion === '2.40.0');

console.log('');
if (failures === 0) {
  console.log('ALL PASS: v2.40.0 edit-window verification complete.');
} else {
  console.log(`FAILURES: ${failures} check(s) failed.`);
  process.exit(1);
}
