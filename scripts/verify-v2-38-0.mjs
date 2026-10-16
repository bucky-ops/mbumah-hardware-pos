#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.38.0 verification
// Scope: on-behalf leave requests — schema marker columns + migration,
// leave_on_behalf notify marker + employee copy, requestLeave stamping +
// employee notification leg, POST /api/leaves authz gate + governed-path
// delegation, GET mapping, HR desk dialog + chips, portal chip, tests,
// version lockstep.
// Run: node scripts/verify-v2-38-0.mjs

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

console.log('== Schema + migration: entered-by marker ==');
const SCHEMA = read('prisma/schema.prisma') ?? '';
check('LeaveRequest.enteredById column', SCHEMA.includes('enteredById   String?'));
check('LeaveRequest.enteredByName column', SCHEMA.includes('enteredByName String?'));
const MIG = read('prisma/migrations/20261017120000_add_leave_entered_by/migration.sql') ?? '';
check('migration alters leave_requests with both columns', MIG.includes('ALTER TABLE "leave_requests" ADD COLUMN "enteredById" TEXT;') && MIG.includes('ALTER TABLE "leave_requests" ADD COLUMN "enteredByName" TEXT;'));

console.log('== Notify layer: marker + employee-facing copy ==');
const NOTIFY = read('src/lib/hr/leave-notify.ts') ?? '';
check('LEAVE_ON_BEHALF_METADATA_MARKER exported', NOTIFY.includes("export const LEAVE_ON_BEHALF_METADATA_MARKER = 'leave_on_behalf'"));
check('kind union extended', NOTIFY.includes("'leave_decision' | 'leave_request' | 'leave_cancel' | 'leave_on_behalf'"));
check('leaveOnBehalfCopy builder exists', NOTIFY.includes('export function leaveOnBehalfCopy('));
check('copy is explicit about who filed it', NOTIFY.includes('ENTERED BY HR') && NOTIFY.includes('Filed by'));
check('copy carries the withdraw hint', NOTIFY.includes('You can withdraw it from your self-service portal while it is still pending.'));
check('submission copy accepts enteredByLabel', NOTIFY.includes('enteredByLabel?: string | null'));
check('parser accepts leave_on_behalf + enteredByName', NOTIFY.includes("rec.kind === 'leave_on_behalf'") && NOTIFY.includes("if (typeof rec.enteredByName === 'string') out.enteredByName = rec.enteredByName;"));
check('submission footer documents on-behalf', NOTIFY.includes('on behalf of the employee'));

console.log('== Service: requestLeave stamping + employee leg ==');
const SVC = read('src/lib/hr/leave-service.ts') ?? '';
check('RequestLeaveInput carries the marker fields', SVC.includes('enteredById?: string | null;') && SVC.includes('enteredByName?: string | null;'));
check('create stores the marker', SVC.includes('enteredById: input.enteredById ?? null,') && SVC.includes('enteredByName: input.enteredByName ?? null,'));
check('create includes leaveType for the on-behalf copy', SVC.includes("include: { leaveType: { select: { name: true, code: true } } }"));
check('employee leg runs only for on-behalf filings', SVC.includes('if (input.enteredById) {'));
check('leg is skipped when the actor IS the linked user', SVC.includes('target.user?.id !== input.enteredById'));
check('bell row deep-links the portal leave page', SVC.includes("actionUrl: '/employees/me/leave'"));
check('bell metadata carries the marker + filer name', SVC.includes('kind: LEAVE_ON_BEHALF_METADATA_MARKER') && SVC.includes('enteredByName: input.enteredByName ?? undefined'));
check('employee email uses LEAVE_REQUEST type', SVC.includes("type: 'LEAVE_REQUEST'"));
check('approver fan-out receives enteredByLabel', SVC.includes('enteredByLabel: input.enteredByName ?? null'));
check('audit metadata records onBehalfOf', SVC.includes('onBehalfOf: input.enteredById ? input.enteredByName'));
check('both legs are best-effort (never fail the submission)', (SVC.match(/\/\/ On-behalf delivery is best-effort by design\./g) ?? []).length === 1);

console.log('== Route: POST /api/leaves gate + delegation ==');
const ROUTE = read('src/app/api/leaves/route.ts') ?? '';
check('authz gate message', ROUTE.includes("'You can only file leave requests for yourself.'"));
check('gate mirrors the v2.33.0 decision-capable list', ROUTE.includes("const isDecisionCapable = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'].includes(session.role)"));
check('self check uses the linked user', ROUTE.includes('const isSelf = employee.user?.id === session.userId;'));
check('gate runs before requestLeave', ROUTE.indexOf("'You can only file leave requests for yourself.'") < ROUTE.indexOf('await requestLeave({'));
check('creation delegated to the governed service path', ROUTE.includes('await requestLeave({') && !ROUTE.includes('db.leaveRequest.create'));
check('marker set only for true on-behalf filings', ROUTE.includes('const onBehalf = isDecisionCapable && !isSelf;') && ROUTE.includes('enteredById: onBehalf ? session.userId : null'));
check('filer name resolved from the user row', ROUTE.includes("db.user.findUnique({\n      where: { id: session.userId },"));
check('INSUFFICIENT_LEAVE_BALANCE mapped to the 400 contract', ROUTE.includes("message.startsWith('INSUFFICIENT_LEAVE_BALANCE')") && ROUTE.includes("code: 'INSUFFICIENT_BALANCE'"));
check('systemLog records the on-behalf entry', ROUTE.includes('onBehalfOf: onBehalf ? enteredByName : undefined'));
check('GET mapping exposes enteredByName', ROUTE.includes('enteredByName: r.enteredByName'));
check('employee lookup fail-closed on deleted employees', ROUTE.includes('deletedAt: null'));

console.log('== Self-service DTO: portal marker ==');
const SELF = read('src/lib/hr/self-service.ts') ?? '';
check('portal requests expose enteredByName', SELF.includes('enteredByName: r.enteredByName ?? null,'));

console.log('== HR desk UI: dialog + chips ==');
const TAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('New request button on the Leave desk', TAB.includes('onClick={openNewRequest}') && TAB.includes('New request'));
check('dialog files for an employee explicitly', TAB.includes('File a leave request for an employee'));
check('live working-days preview (weekends skipped)', TAB.includes('Working days (weekends skipped)') && TAB.includes('data-testid="onbehalf-days-preview"'));
check('balance preview reads the governed endpoint', TAB.includes('/api/leave/balances?employeeId='));
check('submit disabled on insufficient preview', TAB.includes('!previewInsufficient') && TAB.includes('the server will reject this submission'));
check('employee-notification note in the dialog', TAB.includes('The employee gets a portal notification and an email'));
check('row chip marks HR-entered requests', TAB.includes('HR · {l.enteredByName}'));
check('detail dialog explains the marker', TAB.includes('Entered by HR · {detail.enteredByName}'));
check('helper import for the day preview', TAB.includes('previewWorkingDays'));

console.log('== Portal UI: Filed-by chip ==');
const VIEW = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('RequestDto carries enteredByName', VIEW.includes('enteredByName?: string | null;'));
check('violet Filed-by chip on the card', VIEW.includes('Filed by HR · {r.enteredByName}'));
check('UserCheck icon imported', VIEW.includes("import { CalendarOff, CalendarPlus, Loader2, MessageSquareWarning, Palmtree, RefreshCw, UserCheck } from 'lucide-react';"));

console.log('== Notification feed: on-behalf surface + double-render fix ==');
const FEED = read('src/app/api/notifications/route.ts') ?? '';
check('leave section OR includes the on-behalf marker', FEED.includes('{ metadata: { contains: LEAVE_ON_BEHALF_METADATA_MARKER } }'));
check("leave_on_behalf branch typed 'leave_on_behalf'", FEED.includes("type: 'leave_on_behalf'"));
check('digest sweep NOT-filters all four leave markers', (FEED.match(/contains: LEAVE_(DECISION|REQUEST|CANCEL|ON_BEHALF)_METADATA_MARKER \}/g) ?? []).length >= 8);
const NC = read('src/components/notification-center.tsx') ?? '';
check('feed icon case for leave_on_behalf (UserCheck violet)', NC.includes("case 'leave_on_behalf':") && NC.includes('<UserCheck className="h-4 w-4 text-violet-600" />'));
check('violet rail + Entered by HR chip in the feed row', NC.includes("notification.type === 'leave_on_behalf' ? 'border-l-[3px] border-l-violet-400") && NC.includes('Entered by HR\n                            </span>'));
const API = read('src/lib/api.ts') ?? '';
check("NotificationItem union extended with 'leave_on_behalf'", API.includes("'leave_cancel' | 'leave_on_behalf';"));

console.log('== Helper: client-side working-day mirror ==');
const LT = read('src/lib/leave-tab.ts') ?? '';
check('previewWorkingDays exported', LT.includes('export function previewWorkingDays('));
check('half-day arithmetic mirrors the service (days - 0.5)', LT.includes('return Math.max(0, halfDay ? days - 0.5 : days);'));
check('invalid/inverted ranges yield 0', LT.includes('if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return 0;'));

console.log('== Tests ==');
check('leave-on-behalf test file exists', existsSync(join(ROOT, 'src/tests/leave-on-behalf.test.ts')));
const T = read('src/tests/leave-on-behalf.test.ts') ?? '';
check('marker stamping test', T.includes('stores enteredById/enteredByName on the created row'));
check('employee bell row test', T.includes('writes the employee bell row with the leave_on_behalf marker and portal deep link'));
check('no-linked-user fallback test', T.includes('skips the employee bell row when the target has no linked user but still emails the employee address'));
check('self-filed skip test', T.includes('skips the whole employee-facing leg for self-filed requests'));
check('HR balance-guard test', T.includes('enforces the balance guard for HR filers too (no overdraft on behalf)'));
check('route gate order test', T.includes('runs the ownership gate BEFORE the governed creation path'));
check('route delegation test', T.includes('delegates creation to requestLeave (no hand-rolled leaveRequest.create in the route)'));
check('copy escape test', T.includes('escapes the filer name in the HTML surface'));

console.log('== What\'s-New + version lockstep ==');
const PKG = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.38.0', PKG.version === '2.38.0', PKG.version ?? 'missing');
const WN = read('src/lib/whats-new.ts') ?? '';
check('What\'s-New 2.38.0 entry', WN.includes("'2.38.0'"));
check('What\'s-New bullet mentions on-behalf filing', WN.includes('on behalf') || WN.includes('Entered by HR'));
const VER = read('src/lib/version.ts') ?? '';
check('version.ts still delegates to package.json', VER.includes("import pkg from '../package.json'") || VER.includes("from '@/../package.json'") || VER.includes('package.json'));
const OPENAPI = read('openapi.json') ?? '';
if (OPENAPI) {
  try { check('openapi.json info.version mirrors 2.38.0', JSON.parse(OPENAPI).info.version === '2.38.0'); }
  catch { check('openapi.json parses', false); }
}

console.log('== Release-contract guard: provider committed for Vercel ==');
check('schema datasource committed as postgresql', SCHEMA.includes('provider = "postgresql"'));

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
