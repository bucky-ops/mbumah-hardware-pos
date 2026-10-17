#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.49.0 verification
// Scope: the employee-facing "your payslip is issued" notices — the last
// silent hop of the payroll lifecycle closed: the pure personalized copy
// (teal surface family, own-numbers-only privacy contract), the
// portal-link-gated fan-out inside postPayrollRun (personal bell rows +
// per-employee emails, best-effort, replay never re-notifies), the post
// route surfacing employeeNotices, the run-dialog teal second line, the
// notification feed carrying payslip_issued rows (both filter lists +
// portal deep link), NotificationType.PAYSLIP_ISSUED, the portal home
// notice strip, and the What's-New entry — with every v2.48.0 feature
// asserted intact.
// Run: node scripts/verify-v2-49-0.mjs

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
check('package.json version is 2.49.0', PKG.version === '2.49.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.49.0', PKG.mbumah?.releaseVersion === '2.49.0');
check('mbumah.baseVersion is 2.49.0', PKG.mbumah?.baseVersion === '2.49.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.49.0 entry", WN.includes("version: '2.49.0'"));
check("What's-New mentions the personal payslip notice", WN.includes('Payslip issued') || WN.includes('payslip'));
check("What's-New mentions the portal notice strip", WN.includes('teal notice strip') || WN.includes('self-service home'));
check('verify:v2-49-0 script is wired', (PKG.scripts ?? {})['verify:v2-49-0'] === 'node scripts/verify-v2-49-0.mjs');
check('verify:v2-48-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-48-0'] === 'node scripts/verify-v2-48-0.mjs');

console.log('== Pure module: src/lib/hr/payroll/run-digest.ts ==');
const RD = read('src/lib/hr/payroll/run-digest.ts') ?? '';
check('exports the payslip_issued marker', RD.includes("PAYSLIP_ISSUED_METADATA_MARKER = 'payslip_issued'"));
check('exports the PayslipIssuedMeta contract', RD.includes('interface PayslipIssuedMeta'));
check('exports the personal copy builder', RD.includes('export function payslipIssuedCopy'));
check('personal copy uses the teal surface family (#0f766e)', RD.includes('#0f766e'));
check('personal copy tolerates a missing payslip number', RD.includes('being finalised'));
check('PAID status is celebrated in the copy', RD.includes("meta.paymentStatus === 'PAID'"));
check('personal privacy contract in the email footer', RD.includes('only your own payslip summary'));
check('personal copy states the deep-link destination', RD.includes('My Workspace → Payslips'));
// v2.48.0 features still intact:
check('v2.48 intact: posted marker + posted copy builder', RD.includes("PAYROLL_POSTED_METADATA_MARKER = 'payroll_posted'") && RD.includes('export function payrollRunPostedCopy'));
check('v2.48 intact: posted CSV variant + -posted suffix', RD.includes("variant: 'approval' | 'posted' = 'approval'") && RD.includes("'-posted'"));
check('v2.47 intact: approval copy + approval marker', RD.includes("PAYROLL_APPROVED_METADATA_MARKER = 'payroll_approved'") && RD.includes('export function payrollRunApprovalCopy'));

console.log('== Service fan-out: src/lib/hr/payroll/run-service.ts ==');
const RS = read('src/lib/hr/payroll/run-service.ts') ?? '';
check('exports the PayslipIssuedFanoutResult contract', RS.includes('interface PayslipIssuedFanoutResult'));
check('fan-out runs inside postPayrollRun', RS.includes('notifyEmployeesPayslipsIssued({'));
check('fail-soft: posting never fails on the fan-out', RS.includes("[payroll] payslip-issued fan-out failed (best-effort)"));
check('returns digest AND employeeNotices on the post contract', RS.includes('replay: false, digest, employeeNotices'));
check('audience gated on the portal link (userId)', RS.includes("typeof d.employee?.userId === 'string'"));
check('rows deep-link the portal Payslips page', RS.includes("actionUrl: '/employees/me/payslips'"));
check('rows carry the View payslip label', RS.includes("actionLabel: 'View payslip'"));
check('in-app rows carry the payslip_issued kind marker', RS.includes(`kind: PAYSLIP_ISSUED_METADATA_MARKER`));
check('emails are personalized per employee (type PAYSLIP_ISSUED)', RS.includes("type: 'PAYSLIP_ISSUED'"));
check('emails ride in batches (allSettled, one bad send never stalls)', RS.includes('Promise.allSettled'));
check('email log rows attribute to the employee user', RS.includes('userId: d.employee.userId ?? undefined'));
check('zero-audience short-circuit', RS.includes('portalLinked: 0'));
// v2.48.0 features still intact:
check('v2.48 intact: group posting digest still fires', RS.includes('notifyPayrollRunPosted'));
check('v2.48 intact: posting digest fail-soft warn', RS.includes("console.warn('[payroll] posting digest failed (best-effort)"));
check('v2.48 intact: audience excludes the actor', RS.includes('byId.delete(params.actorId)'));
check('v2.48 intact: CSV rides the group envelope', RS.includes('attachments: [csv]'));

console.log('== Post route response ==');
const PR = read('src/app/api/payroll/runs/[id]/post/route.ts') ?? '';
check('route destructures digest + employeeNotices', PR.includes('digest, employeeNotices }') || PR.includes('employeeNotices,'));
check('response carries employeeNotices at the top level', PR.includes('employeeNotices,'));

console.log('== Email service vocabulary ==');
const ES = read('src/lib/email-service.ts') ?? '';
check('NotificationType.PAYSLIP_ISSUED exists', ES.includes("PAYSLIP_ISSUED: 'PAYSLIP_ISSUED'"));
check('v2.48 intact: PAYROLL_POSTED still exists', ES.includes("PAYROLL_POSTED: 'PAYROLL_POSTED'"));
check('v2.47 intact: PAYROLL_APPROVED still exists', ES.includes("PAYROLL_APPROVED: 'PAYROLL_APPROVED'"));

console.log('== Feed route: both filter lists ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('imports all three payroll/payslip markers', NF.includes('PAYSLIP_ISSUED_METADATA_MARKER') && NF.includes('PAYROLL_POSTED_METADATA_MARKER') && NF.includes('PAYROLL_APPROVED_METADATA_MARKER'));
check("type union carries 'payslip_issued'", NF.includes("| 'payslip_issued'"));
check('section-8 NOT list excludes payslip rows', (NF.split('NOT: {')[1] ?? '').includes('PAYSLIP_ISSUED_METADATA_MARKER'));
check('section-9 OR list includes payslip rows', (NF.split("9. v2.31.0")[1] ?? '').includes('PAYSLIP_ISSUED_METADATA_MARKER'));
check('payslip branch keeps the portal deep link', NF.includes("kind === 'payslip_issued'") && (NF.split("kind === 'payslip_issued'")[1] ?? '').includes('actionUrl: n.actionUrl ?? undefined'));
check('v2.48 intact: posting branch deep-links the Payroll tab', (NF.split("kind === 'payroll_posted'")[1] ?? '').includes("targetTab: 'payroll'"));
check('v2.48 intact: FAILED delivery escalates to warning (posting)', (NF.split("kind === 'payroll_posted'")[1] ?? '').includes("extras.emailStatus === 'FAILED'"));
check('leave kind parser accepts payslip_issued', (read('src/lib/hr/leave-notify.ts') ?? '').includes("rec.kind === 'payslip_issued'"));

console.log('== Client surfaces ==');
const API = read('src/lib/api.ts') ?? '';
check('NotificationItem type union carries payslip_issued', API.includes("| 'payslip_issued'"));
check('v2.48 intact: union carries payroll_posted + payroll_approved', API.includes("| 'payroll_posted'") && API.includes("| 'payroll_approved'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check("icon switch handles 'payslip_issued' (teal wallet)", NC.includes("case 'payslip_issued':") && NC.includes('Wallet'));
check('teal left rail on payslip rows', NC.includes("notification.type === 'payslip_issued' ? 'border-l-[3px] border-l-teal-400"));
check('teal Payslip ready chip', NC.includes('Payslip ready'));
check('v2.48 intact: payroll icons + rails + chips', NC.includes("case 'payroll_posted':") && NC.includes('BookOpenCheck') && NC.includes("'Approved' : 'Posted'"));
const DL = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('captures body.employeeNotices after post', DL.includes('employeeNotices?: EmployeeNoticesNotice | null'));
check('teal Employee notices line renders in the banner', DL.includes('Employee notices · ') && DL.includes('border-teal-200'));
check('banner says the honest "of N portal-linked" counts', DL.includes('portal-linked employee(s)'));
check('v2.48 intact: digest banner label flips by action', DL.includes("'Posting digest · '") && DL.includes("'Approval digest · '"));
check('resets both notice states on dialog open', (DL.split('useEffect(() => {')[1] ?? '').includes('setEmployeeNotices(null)'));

console.log('== Portal home notice strip ==');
const PH = read('src/app/(selfservice)/employees/me/page.tsx') ?? '';
check('portal home loads the personal payslip notices', PH.includes('loadPayslipNotices'));
check('strip reads the payslip_issued marker server-side', PH.includes('PAYSLIP_ISSUED_METADATA_MARKER'));
check('strip read is wrapped runWithoutTenant (feed-API posture)', PH.includes('runWithoutTenant'));
check('strip read is best-effort (dashboard never breaks)', PH.includes('return [];'));
const HV = read('src/app/(selfservice)/employees/me/home-view.tsx') ?? '';
check('notice strip renders first above the stat tiles', HV.indexOf('payslip-notices') >= 0 && HV.indexOf('Profile hero') > HV.indexOf('payslip-notices'));
check('strip uses the teal gradient family', HV.includes('from-teal-400 via-teal-500 to-emerald-500'));
check('newest notice carries the New badge', HV.includes('uppercase tracking-wide text-teal-700') && HV.includes('New'));
check('strip deep-links with the action label', HV.includes('notice.actionUrl') && HV.includes('notice.actionLabel'));

console.log('== Tests ==');
const TD = read('src/tests/payslip-issued-notice.test.ts') ?? '';
check('payslip notice test file exists', !!TD);
check('covers the teal-vs-group surface guard', TD.includes('#0f766e') && TD.includes('#0c4a6e'));
check('covers the own-numbers-only personal rows', TD.includes("not.toContain('PS-20261017-0007')"));
check('covers the portal-link gating', TD.includes('portalLinked'));
check('covers the zero-audience short-circuit', TD.includes('portalLinked: 0'));
check('covers the failed-send honesty', TD.includes('emailsFailed'));
check('covers the rejected-send tolerance (allSettled)', TD.includes('transport exploded'));
check('v2.48 intact: posted digest test file still exists', !!read('src/tests/payroll-posted-digest.test.ts'));
check('v2.47 intact: approval digest test file still exists', !!read('src/tests/payroll-run-digest.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.49.0 verification: ALL PASS');
} else {
  console.log(`v2.49.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
