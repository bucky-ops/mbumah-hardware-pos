#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.50.0 verification
// Scope: the DISBURSEMENT digest — money leaves the door and the payroll
// group hears it with the per-batch payment record: the pure amber copy
// (mode-specific prose for mpesa / mpesa-mock / manual, gate counters,
// privacy contract) + the per-payslip payment CSV, the batch-rows extension
// on B2CDisburseSummary, the notify fan-out (group minus actor) wired into
// disbursePayrollRun (manual) and POST .../disburse-mpesa ('all' batch only —
// retries never re-notify), the run-dialog "Disbursement digest" banner,
// the notification feed carrying payroll_disbursed rows (both filter lists),
// NotificationType.PAYROLL_DISBURSED, and the What's-New entry — with every
// v2.47/2.48/2.49 feature asserted intact.
// Run: node scripts/verify-v2-50-0.mjs

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
check('package.json version is 2.50.0', PKG.version === '2.50.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.50.0', PKG.mbumah?.releaseVersion === '2.50.0');
check('mbumah.baseVersion is 2.50.0', PKG.mbumah?.baseVersion === '2.50.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.50.0 entry", WN.includes("version: '2.50.0'"));
check("What's-New mentions the disbursement digest", WN.includes('Disbursement digest') || WN.includes('disbursement'));
check("What's-New names the channels honestly", WN.includes('simulated') && WN.includes('manual'));
check('verify:v2-50-0 script is wired', (PKG.scripts ?? {})['verify:v2-50-0'] === 'node scripts/verify-v2-50-0.mjs');
check('verify:v2-49-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-49-0'] === 'node scripts/verify-v2-49-0.mjs');

console.log('== Pure module: src/lib/hr/payroll/run-digest.ts ==');
const RD = read('src/lib/hr/payroll/run-digest.ts') ?? '';
check('exports the payroll_disbursed marker', RD.includes("PAYROLL_DISBURSED_METADATA_MARKER = 'payroll_disbursed'"));
check('exports the PayrollRunDisbursedMeta contract', RD.includes('interface PayrollRunDisbursedMeta'));
check('exports the disbursed copy builder', RD.includes('export function payrollRunDisbursedCopy'));
check('disbursed copy uses the amber surface family (#92400e)', RD.includes('#92400e'));
check('mode union covers mpesa / mpesa-mock / manual', RD.includes("'mpesa' | 'mpesa-mock' | 'manual'"));
check('manual prose names the bookkeeping confirmation', RD.includes('bookkeeping confirmation, not an M-Pesa send'));
check('failed batch reroutes the next step to retry', RD.includes('Retry the failed payments from the run dialog, then lock.'));
check('gate counters surface in the copy', RD.includes('backoffSkipped') && RD.includes('maxAttemptSkipped'));
check('exports the per-payslip payment CSV builder', RD.includes('export function payrollDisbursementToCsv'));
check('CSV header names the disbursement summary', RD.includes("'Payroll disbursement summary'"));
check('payment CSV status/receipt columns', RD.includes("'Employee', 'Staff number', 'Net (KES)', 'Status', 'Receipt'"));
check('payment filename suffix prevents inbox collisions', RD.includes('-disbursement.csv'));
check('privacy contract in the disbursed email footer', RD.includes('never contains national IDs'));
check('money stays deterministic (no locale-dependent toLocaleString)', !RD.includes('toLocaleString'));
// Earlier lifecycle features still intact:
check('v2.49 intact: payslip_issued marker + personal copy', RD.includes("PAYSLIP_ISSUED_METADATA_MARKER = 'payslip_issued'") && RD.includes('export function payslipIssuedCopy'));
check('v2.48 intact: posted marker + posted copy', RD.includes("PAYROLL_POSTED_METADATA_MARKER = 'payroll_posted'") && RD.includes('export function payrollRunPostedCopy'));
check('v2.47 intact: approval marker + approval copy', RD.includes("PAYROLL_APPROVED_METADATA_MARKER = 'payroll_approved'") && RD.includes('export function payrollRunApprovalCopy'));

console.log('== Service fan-out: src/lib/hr/payroll/run-service.ts ==');
const RS = read('src/lib/hr/payroll/run-service.ts') ?? '';
check('exports the PayrollDisbursementDigestResult contract', RS.includes('interface PayrollDisbursementDigestResult'));
check('manual disburse snapshots the batch before marking paid', RS.includes('snapshot the batch BEFORE the updateMany'));
check('manual disburse fires the digest best-effort', RS.includes("console.warn('[payroll] manual disbursement digest failed (best-effort)"));
check('manual mode is declared on the digest call', RS.includes("mode: 'manual'"));
check('rows carry PAID status + payment ref on the manual path', RS.includes("status: 'PAID'") && RS.includes('receipt: paymentRef ?? null'));
check('audience excludes the disbursing actor', RS.includes('u.id !== params.actorId'));
check('email type is PAYROLL_DISBURSED', RS.includes("type: 'PAYROLL_DISBURSED'"));
check('in-app rows carry the payroll_disbursed kind marker', RS.includes('kind: PAYROLL_DISBURSED_METADATA_MARKER'));
check('metadata stamps mode + counts + disbursedBy', RS.includes('mode: meta.mode') && RS.includes('disbursedBy: actorLabel'));
// Earlier lifecycle features still intact:
check('v2.49 intact: employee fan-out still fires inside post', RS.includes('notifyEmployeesPayslipsIssued({'));
check('v2.48 intact: posting digest still fires', RS.includes('notifyPayrollRunPosted'));
check('v2.48 intact: post returns digest + employeeNotices', RS.includes('replay: false, digest, employeeNotices'));

console.log('== Disbursement service: batch rows ==');
const DS = read('src/lib/hr/payroll/disbursement-service.ts') ?? '';
check('B2CDisburseSummary carries the per-payslip results', DS.includes('results?: Array<{'));
check('skipped payslips land in the results rows', DS.includes("status: 'SKIPPED'"));
check('failed initiations land in the results rows', DS.includes("status: 'FAILED'"));
check('in-flight payments land as SENT', DS.includes("status: 'SENT'"));
check('mock receipts flip the row to PAID with the receipt', DS.includes("row.receipt = `MPESA-${result.receiptNumber}`"));

console.log('== Disburse routes ==');
const DM = read('src/app/api/payroll/runs/[id]/disburse-mpesa/route.ts') ?? '';
check('mpesa route imports the notify fan-out', DM.includes('notifyPayrollRunDisbursed'));
check('digest rides the ALL batch only (retries never re-notify)', DM.includes("if (mode === 'all')"));
check('mode maps mock → mpesa-mock for the copy', DM.includes("'mpesa-mock'"));
check('digest rides the response top-level', DM.includes('data: summary, digest'));
check('best-effort catch on the b2c digest', DM.includes("console.warn('[payroll] b2c disbursement digest failed (best-effort)"));
const DR = read('src/app/api/payroll/runs/[id]/disburse/route.ts') ?? '';
check('manual route passes the digest through', DR.includes('const { disbursed, digest } = await disbursePayrollRun') && DR.includes('data: { disbursed }, digest'));

console.log('== Email service vocabulary ==');
const ES = read('src/lib/email-service.ts') ?? '';
check('NotificationType.PAYROLL_DISBURSED exists', ES.includes("PAYROLL_DISBURSED: 'PAYROLL_DISBURSED'"));
check('v2.49 intact: PAYSLIP_ISSUED still exists', ES.includes("PAYSLIP_ISSUED: 'PAYSLIP_ISSUED'"));
check('v2.48 intact: PAYROLL_POSTED still exists', ES.includes("PAYROLL_POSTED: 'PAYROLL_POSTED'"));

console.log('== Feed route: both filter lists ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('imports all four payroll/payslip markers', NF.includes('PAYROLL_DISBURSED_METADATA_MARKER') && NF.includes('PAYSLIP_ISSUED_METADATA_MARKER') && NF.includes('PAYROLL_POSTED_METADATA_MARKER') && NF.includes('PAYROLL_APPROVED_METADATA_MARKER'));
check("type union carries 'payroll_disbursed'", NF.includes("| 'payroll_disbursed'"));
check('section-8 NOT list excludes disbursement rows', (NF.split('NOT: {')[1] ?? '').includes('PAYROLL_DISBURSED_METADATA_MARKER'));
check('section-9 OR list includes disbursement rows', (NF.split("9. v2.31.0")[1] ?? '').includes('PAYROLL_DISBURSED_METADATA_MARKER'));
check('disbursement branch deep-links the Payroll tab', (NF.split("kind === 'payroll_disbursed'")[1] ?? '').includes("targetTab: 'payroll'"));
check('FAILED email delivery escalates to warning (disbursement)', (NF.split("kind === 'payroll_disbursed'")[1] ?? '').includes("extras.emailStatus === 'FAILED'"));
check('leave kind parser accepts payroll_disbursed', (read('src/lib/hr/leave-notify.ts') ?? '').includes("rec.kind === 'payroll_disbursed'"));

console.log('== Client surfaces ==');
const API = read('src/lib/api.ts') ?? '';
check('NotificationItem type union carries payroll_disbursed', API.includes("| 'payroll_disbursed'"));
check('v2.49 intact: union carries payslip_issued', API.includes("| 'payslip_issued'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check("icon switch handles 'payroll_disbursed' (amber dollar-circle)", NC.includes("case 'payroll_disbursed':") && NC.includes('CircleDollarSign'));
check('amber left rail on disbursement rows', NC.includes("notification.type === 'payroll_disbursed' ? 'border-l-[3px] border-l-amber-400"));
check('amber Disbursed chip + honest delivery chip', NC.includes('Disbursed') && NC.includes("'Email sent' : 'Email failed'"));
check('v2.49 intact: teal payslip icon + rail + chip', NC.includes("case 'payslip_issued':") && NC.includes('Wallet') && NC.includes('Payslip ready'));
const DL = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check("DigestNotice kind carries 'disbursed'", DL.includes("'approval' | 'posted' | 'disbursed'"));
check('captures body.digest after disburse AND disburse-mpesa', DL.includes("action === 'disburse' || action === 'disburse-mpesa'"));
check('banner label flips to Disbursement digest', DL.includes("'Disbursement digest · '"));
check('v2.48 intact: banner label still flips for approval/posting', DL.includes("'Posting digest · '") && DL.includes("'Approval digest · '"));

console.log('== Tests ==');
const TD = read('src/tests/payroll-disbursed-digest.test.ts') ?? '';
check('disbursement digest test file exists', !!TD);
check('covers the amber-vs-siblings surface guard', TD.includes('#92400e') && TD.includes('#0c4a6e'));
check('covers the manual-confirmation prose', TD.includes('bookkeeping confirmation'));
check('covers the gate counters', TD.includes('Backoff-blocked retries'));
check('covers the payment CSV + -disbursement filename', TD.includes('-disbursement.csv'));
check('covers the injection guard on payment rows', TD.includes('=HYPERLINK'));
check('covers the actor exclusion', TD.includes("['accountant-1', 'owner-1']"));
check('covers the honest FAILED stamp', TD.includes('expect(result.emailStatus).toBe'));
check('v2.49 intact: payslip notice test file still exists', !!read('src/tests/payslip-issued-notice.test.ts'));
check('v2.48 intact: posted digest test file still exists', !!read('src/tests/payroll-posted-digest.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.50.0 verification: ALL PASS');
} else {
  console.log(`v2.50.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
