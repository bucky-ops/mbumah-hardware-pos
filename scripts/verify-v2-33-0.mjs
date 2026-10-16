#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.33.0 verification
// Scope: leave CANCEL notifications (the last silent lifecycle transition,
// bidirectional: manager-cancel → employee, employee self-cancel → approvers)
// + B2C retry discipline (exponential backoff + attempt ceiling, pure gate
// shared by the retry service and the run summary) + the violet Cancelled
// surface across notification center and email log.
// Run: npm run verify:v2-33-0

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

console.log('== Leave CANCEL notifications (bidirectional) ==');
const LN = read('src/lib/hr/leave-notify.ts') ?? '';
check('cancel marker constant is stable', LN.includes("LEAVE_CANCEL_METADATA_MARKER = 'leave_cancel'"));
check('kind union includes leave_cancel', /'leave_decision' \| 'leave_request' \| 'leave_cancel'/.test(LN));
check('cancel copy builder exists (pure module)', LN.includes('export function leaveCancelledCopy'));
check('cancel copy adapts to who cancelled', LN.includes('cancelledByManager'));
check('parser accepts the cancel kind + flag', LN.includes("rec.kind === 'leave_cancel'") && LN.includes('rec.cancelledByManager'));

const LS = read('src/lib/hr/leave-service.ts') ?? '';
check('bidirectional cancel notifier exists', LS.includes('export async function notifyLeaveRequestCancelled'));
check('manager-cancel routes to the employee linked user', LS.includes("actionUrl: '/employees/me/leave'"));
check('self-cancel fans out to the approvals group', LS.includes('Employee self-cancelled: fan out'));
check('decision-capable roles shared between both directions', LS.includes('DECISION_CAPABLE_ROLES'));
check('cancel email tagged LEAVE_CANCEL', (LS.match(/type: 'LEAVE_CANCEL'/g) ?? []).length >= 2);

const LEAVES = read('src/app/api/leaves/route.ts') ?? '';
check('PUT /api/leaves wires the cancel notifier', LEAVES.includes('notifyLeaveRequestCancelled'));
check('cancel wiring is CANCEL-scoped (not approve/reject)', LEAVES.includes("if (newStatus === 'CANCELLED')"));
check('cancel delivery is best-effort', /if \(newStatus === 'CANCELLED'\) \{\s*\n\s*try \{/.test(LEAVES));
check('CANCEL is ownership-gated (authz fix)', LEAVES.includes('const isRequestOwner = leaveRequest.employee.user?.id === session.userId') && LEAVES.includes('You can only cancel your own leave requests.'));
check('ownership gate runs before the status transition', LEAVES.indexOf("action === 'CANCEL'") < LEAVES.indexOf('newStatus = '));

console.log('== Cancel UI surfaces (HR desk + portal withdrawal) ==');
const PTAB = read('src/app/(shell)/tabs/payroll-tab.tsx') ?? '';
check('mutation accepts the CANCEL action', PTAB.includes("'APPROVE' | 'REJECT' | 'CANCEL'"));
check('HR desk has the violet row Cancel button', PTAB.includes('Cancel leave for ${l.employeeName}') && PTAB.includes('Cancel approved leave for'));
check('HR desk has the cancel-confirm dialog', PTAB.includes('Cancel leave request') && PTAB.includes('Keep request'));
check('details dialog offers Cancel request', PTAB.includes('Cancel request'));
const PORTAL = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('portal sends CANCEL to PUT /api/leaves', PORTAL.includes("action: 'CANCEL', leaveRequestId: withdrawTarget.id"));
check('portal renders the Withdraw button on pending requests', PORTAL.includes('Withdraw</Button>') || (PORTAL.includes('aria-hidden /> Withdraw')));
check('portal has the withdraw-confirm dialog', PORTAL.includes('Withdraw leave request') && PORTAL.includes('slot is free again'));

console.log('== Notification feed + center (violet Cancelled surface) ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('feed query pulls the cancel marker', NF.includes('LEAVE_CANCEL_METADATA_MARKER'));
check('feed maps the leave_cancel kind', NF.includes("kind === 'leave_cancel'"));
check('feed extends leaveStatus with CANCELLED', NF.includes("'APPROVED' | 'REJECTED' | 'CANCELLED'"));
check('feed routes cancel targetTab by direction', NF.includes('cancelledByManager === true'));

const API = read('src/lib/api.ts') ?? '';
check('NotificationItem type union includes leave_cancel', API.includes("'leave_decision' | 'leave_request' | 'leave_cancel'"));
check('NotificationItem leaveStatus includes CANCELLED', API.includes("'APPROVED' | 'REJECTED' | 'CANCELLED'"));

const NC = read('src/components/notification-center.tsx') ?? '';
check("center renders a CalendarOff icon for cancels", NC.includes('case \'leave_cancel\'') && NC.includes('CalendarOff'));
check('center adds the violet status rail', NC.includes("notification.type === 'leave_cancel' ? 'border-l-[3px] border-l-violet-400"));
check('center shows Cancelled / Withdrawn chips', NC.includes("'Withdrawn' : 'Cancelled'"));

console.log('== Email log (LEAVE_CANCEL filter) ==');
const LOGS = read('src/app/api/notifications/logs/route.ts') ?? '';
check('logs API whitelists LEAVE_CANCEL', LOGS.includes("'LEAVE_CANCEL'"));
const EV = read('src/components/admin/email-delivery-log-section.tsx') ?? '';
check('email-log viewer whitelists LEAVE_CANCEL', EV.includes("'LEAVE_CANCEL'"));
check('email-log viewer chips LEAVE_CANCEL violet', EV.includes("LEAVE_CANCEL: 'bg-violet-100"));
const ES = read('src/lib/email-service.ts') ?? '';
check('email-service tags LEAVE_CANCEL', ES.includes("LEAVE_CANCEL: 'LEAVE_CANCEL'"));

console.log('== B2C retry discipline (backoff + ceiling) ==');
const DS = read('src/lib/hr/payroll/disbursement-service.ts') ?? '';
check('pure backoff function exported', DS.includes('export function b2cRetryBackoffMs'));
check('pure retry gate exported', DS.includes('export function evaluateB2CRetryGate'));
check('backoff constants documented (2m base / 30m cap / 5 attempts)', DS.includes('B2C_RETRY_BASE_BACKOFF_MS') && DS.includes('B2C_RETRY_BACKOFF_CAP_MS') && DS.includes('B2C_MAX_RETRY_ATTEMPTS'));
check('retry service applies the gate before initiating', DS.includes('const gate = evaluateB2CRetryGate(failedAttempts'));
check('gate skips report distinct reasons', DS.includes('Max retry attempts (') && DS.includes('Backoff active - retry available in'));
check('summary counts blocked retries', DS.includes('backoffSkipped') && DS.includes('maxAttemptSkipped'));
check('run summary exposes per-payslip gate state', DS.includes('retryBlocked?: boolean') && DS.includes('maxAttemptsReached?: boolean'));

const RD = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('run dialog counts only gate-allowed payslips in Retry failed', RD.includes("st?.lastStatus === 'FAILED' && !st.retryBlocked"));
check('run dialog renders the backoff countdown chip', RD.includes('retry in {wait}'));
check('run dialog renders the manual-review chip', RD.includes('manual review'));
check('run dialog shows the waiting count beside the button', RD.includes('waiting</span>'));

check('retry gate unit tests exist', (read('src/tests/b2c-retry-gate.test.ts') ?? '').includes('evaluateB2CRetryGate'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.33.0', pkg.version === '2.33.0', pkg.version);
check('mbumah.releaseVersion is 2.33.0', rel.releaseVersion === '2.33.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.33.0', rel.baseVersion === '2.33.0', rel.baseVersion);
check("What's-New has a 2.33.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.33.0'"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
