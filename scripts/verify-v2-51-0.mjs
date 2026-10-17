#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.51.0 verification
// Scope: the personal "you've been paid" notice — the completion of the pay
// story. v2.49.0 told the employee "your payslip is issued"; v2.50.0 told
// the payroll group "money left the door"; v2.51.0 tells the EMPLOYEE the
// money actually settled, with their own receipt in hand: the pure emerald
// copy (mode-honest prose for mpesa / mpesa-mock / manual, receipt-less
// honesty), the exactly-this-batch fan-out service (never re-derived from
// the run — replays cannot re-notify), wired into disbursePayrollRun
// (manual), POST .../disburse-mpesa ('all' batch, PAID rows only — a live
// SENT row stays quiet) and the Daraja result webhook (first settle only),
// the run-dialog "Employee paid notices" banner line, the notification feed
// carrying payroll_paid rows (both filter lists), the portal home strip
// telling BOTH pay moments, NotificationType.PAYROLL_PAID, and the
// What's-New entry — with every v2.47–v2.50 feature asserted intact.
// Run: node scripts/verify-v2-51-0.mjs

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
check('package.json version is 2.51.0', PKG.version === '2.51.0', PKG.version ?? 'missing');
check('mbumah.releaseVersion is 2.51.0', PKG.mbumah?.releaseVersion === '2.51.0');
check('mbumah.baseVersion is 2.51.0', PKG.mbumah?.baseVersion === '2.51.0');
const WN = read('src/lib/whats-new.ts') ?? '';
check("What's-New carries the 2.51.0 entry", WN.includes("version: '2.51.0'"));
check("What's-New names the personal pay story", WN.includes('You\\u2019ve been paid'));
check("What's-New names the honesty contract", WN.includes('in flight') && WN.includes('webhook'));
check('verify:v2-51-0 script is wired', (PKG.scripts ?? {})['verify:v2-51-0'] === 'node scripts/verify-v2-51-0.mjs');
check('verify:v2-50-0 script is still wired (history intact)', (PKG.scripts ?? {})['verify:v2-50-0'] === 'node scripts/verify-v2-50-0.mjs');

console.log('== Pure module: src/lib/hr/payroll/run-digest.ts ==');
const RD = read('src/lib/hr/payroll/run-digest.ts') ?? '';
check("exports the payroll_paid marker", RD.includes("PAYROLL_PAID_METADATA_MARKER = 'payroll_paid'"));
check('exports the PayrollRunPaidMeta contract', RD.includes('interface PayrollRunPaidMeta'));
check('exports the paid copy builder', RD.includes('export function payrollRunPaidCopy'));
check('paid copy uses the emerald surface family (#047857)', RD.includes('#047857'));
check('mode union is shared with the disbursement digest', RD.includes("'mpesa' | 'mpesa-mock' | 'manual'"));
check('live prose points at the Safaricom message as the proof', RD.includes('your M-Pesa message from Safaricom is the payment proof'));
check('mock prose never reads like real money moved', RD.includes('no real money moved'));
check('manual prose names the bookkeeping record + HR escalation', RD.includes('if the money has not reached your account, talk to HR'));
check('receipt-less copy stays honest (never invents a number)', RD.includes('none recorded — your payslip carries the payment record'));
check('privacy contract in the paid email footer', RD.includes('It never contains other employees&rsquo; data.'));
check('money stays deterministic (no locale-dependent toLocaleString)', !RD.includes('toLocaleString'));
// Earlier lifecycle features still intact:
check('v2.50 intact: disbursement marker + copy + CSV', RD.includes("PAYROLL_DISBURSED_METADATA_MARKER = 'payroll_disbursed'") && RD.includes('export function payrollRunDisbursedCopy') && RD.includes('export function payrollDisbursementToCsv'));
check('v2.49 intact: payslip_issued marker + personal copy', RD.includes("PAYSLIP_ISSUED_METADATA_MARKER = 'payslip_issued'") && RD.includes('export function payslipIssuedCopy'));
check('v2.48 intact: posted marker + posted copy', RD.includes("PAYROLL_POSTED_METADATA_MARKER = 'payroll_posted'") && RD.includes('export function payrollRunPostedCopy'));
check('v2.47 intact: approval marker + approval copy', RD.includes("PAYROLL_APPROVED_METADATA_MARKER = 'payroll_approved'") && RD.includes('export function payrollRunApprovalCopy'));

console.log('== Service fan-out: src/lib/hr/payroll/run-service.ts ==');
const RS = read('src/lib/hr/payroll/run-service.ts') ?? '';
check('exports notifyEmployeesPaid', RS.includes('export async function notifyEmployeesPaid'));
check('paidDetails drive the audience (never re-derived from the run)', RS.includes('paidDetails: Array<{ detailId: string; receipt: string | null }>'));
check('audience query is scoped to the run (stray detailId leaks nothing)', RS.includes('payrollRunId: params.runId'));
check('fail-soft zeros for an empty batch', RS.includes('if (params.paidDetails.length === 0)'));
check('in-app rows carry the payroll_paid kind marker', RS.includes('kind: PAYROLL_PAID_METADATA_MARKER'));
check('rows deep-link the portal Payslips page', RS.includes("actionUrl: '/employees/me/payslips'"));
check('email type is PAYROLL_PAID', RS.includes("type: 'PAYROLL_PAID'"));
check('emails batched in fives with allSettled', RS.includes("console.warn('[payroll] paid-notice email rejected (best-effort)"));
// v2.51 wiring on the manual path:
check('manual disburse fires the paid fan-out best-effort', RS.includes("console.warn('[payroll] manual disbursement paid notices failed (best-effort)"));
check('manual batch snapshot carries detail ids', RS.includes('v2.51.0: the snapshot also carries detail ids'));
check('manual paidDetails map paymentRef per row', RS.includes('paidDetails: batch.map((d) => ({ detailId: d.id, receipt: paymentRef ?? null }))'));
check('manual disburse returns paidNotices', RS.includes('return { disbursed: result.count, digest, paidNotices }'));
// Earlier lifecycle features still intact:
check('v2.50 intact: manual digest still fires best-effort', RS.includes("console.warn('[payroll] manual disbursement digest failed (best-effort)"));
check('v2.50 intact: audience excludes the disbursing actor', RS.includes('u.id !== params.actorId'));
check('v2.49 intact: employee fan-out still fires inside post', RS.includes('notifyEmployeesPayslipsIssued({'));
check('v2.48 intact: posting digest still fires', RS.includes('notifyPayrollRunPosted'));

console.log('== Disbursement service: batch rows ==');
const DS = read('src/lib/hr/payroll/disbursement-service.ts') ?? '';
check('B2CDisburseSummary carries the per-payslip results', DS.includes('results?: Array<{'));
check('v2.51: results rows carry the detailId', DS.includes('detailId?: string'));
check('skipped payslips land in the results rows with their detailId', DS.includes("status: 'SKIPPED', detailId: detail.id"));
check('in-flight payments land as SENT with their detailId', DS.includes("status: 'SENT', detailId: detail.id"));
check('mock receipts flip the row to PAID with the receipt', DS.includes("row.receipt = `MPESA-${result.receiptNumber}`"));

console.log('== Disburse routes ==');
const DM = read('src/app/api/payroll/runs/[id]/disburse-mpesa/route.ts') ?? '';
check('mpesa route imports both fan-outs', DM.includes('notifyPayrollRunDisbursed') && DM.includes('notifyEmployeesPaid'));
check('digest + paid notices ride the ALL batch only (retries never re-notify)', DM.includes("if (mode === 'all')"));
check('paid fan-out filters to rows that actually settled PAID', DM.includes("r.status === 'PAID' && typeof r.detailId === 'string'"));
check('paid fan-out mode maps mock → mpesa-mock', DM.includes("mode: summary.mode === 'mock' ? 'mpesa-mock' : 'mpesa'"));
check('response carries digest AND paidNotices', DM.includes('data: summary, digest, paidNotices'));
check('best-effort catch on the b2c paid fan-out', DM.includes("console.warn('[payroll] b2c paid notices failed (best-effort)"));
const DR = read('src/app/api/payroll/runs/[id]/disburse/route.ts') ?? '';
check('manual route passes digest + paidNotices through', DR.includes('const { disbursed, digest, paidNotices } = await disbursePayrollRun') && DR.includes('data: { disbursed }, digest, paidNotices'));

console.log('== Daraja result webhook (live receipts) ==');
const WB = read('src/app/api/payments/mpesa/b2c/result/route.ts') ?? '';
check('webhook imports the paid fan-out', WB.includes('notifyEmployeesPaid'));
check('notice rides the FIRST settle only (idempotent replays stay quiet)', WB.includes('outcome.settled && outcome.outcome === '));
check('receipt is the real Daraja TransactionID', WB.includes('body.TransactionID || body.Result?.TransactionID'));
check('best-effort: the notice can never fail the webhook', WB.includes("console.warn('[payroll] b2c webhook paid notice failed (best-effort)"));

console.log('== Email service vocabulary ==');
const ES = read('src/lib/email-service.ts') ?? '';
check('NotificationType.PAYROLL_PAID exists', ES.includes("PAYROLL_PAID: 'PAYROLL_PAID'"));
check('v2.50 intact: PAYROLL_DISBURSED still exists', ES.includes("PAYROLL_DISBURSED: 'PAYROLL_DISBURSED'"));
check('v2.49 intact: PAYSLIP_ISSUED still exists', ES.includes("PAYSLIP_ISSUED: 'PAYSLIP_ISSUED'"));

console.log('== Feed route: both filter lists ==');
const NF = read('src/app/api/notifications/route.ts') ?? '';
check('imports all five payroll/payslip markers', NF.includes('PAYROLL_PAID_METADATA_MARKER') && NF.includes('PAYROLL_DISBURSED_METADATA_MARKER') && NF.includes('PAYSLIP_ISSUED_METADATA_MARKER') && NF.includes('PAYROLL_POSTED_METADATA_MARKER') && NF.includes('PAYROLL_APPROVED_METADATA_MARKER'));
check("type union carries 'payroll_paid'", NF.includes("| 'payroll_paid'"));
check('section-8 NOT list excludes paid rows', (NF.split('NOT: {')[1] ?? '').includes('PAYROLL_PAID_METADATA_MARKER'));
check('section-9 OR list includes paid rows', (NF.split("9. v2.31.0")[1] ?? '').includes('PAYROLL_PAID_METADATA_MARKER'));
check('paid branch deep-links the portal Payslips page', (NF.split("kind === 'payroll_paid'")[1] ?? '').includes("actionUrl: n.actionUrl ?? undefined"));
check('paid branch is personal (no group delivery chip)', (NF.split("kind === 'payroll_paid'")[1] ?? '').includes("id: `payslip-${n.id}`"));
check('v2.50 intact: disbursement branch still deep-links the Payroll tab', (NF.split("kind === 'payroll_disbursed'")[1] ?? '').includes("targetTab: 'payroll'"));
check('leave kind parser accepts payroll_paid', (read('src/lib/hr/leave-notify.ts') ?? '').includes("rec.kind === 'payroll_paid'"));

console.log('== Client surfaces ==');
const API = read('src/lib/api.ts') ?? '';
check('NotificationItem type union carries payroll_paid', API.includes("| 'payroll_paid'"));
check('v2.50 intact: union carries payroll_disbursed', API.includes("| 'payroll_disbursed'"));
const NC = read('src/components/notification-center.tsx') ?? '';
check("icon switch handles 'payroll_paid' (emerald hand-coins)", NC.includes("case 'payroll_paid':") && NC.includes('HandCoins'));
check('green left rail on paid rows', NC.includes("notification.type === 'payroll_paid' ? 'border-l-[3px] border-l-green-400"));
check('green Paid chip on paid rows', NC.includes('border-green-200 bg-green-50'));
check('v2.50 intact: amber disbursed icon + rail + chip', NC.includes("case 'payroll_disbursed':") && NC.includes('CircleDollarSign') && NC.includes('Disbursed'));
check('v2.49 intact: teal payslip icon + rail + chip', NC.includes("case 'payslip_issued':") && NC.includes('Wallet') && NC.includes('Payslip ready'));
const DL = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('dialog captures paidNotices after disburse AND disburse-mpesa', DL.includes("const pn = (respBody as { paidNotices?: EmployeeNoticesNotice | null }).paidNotices"));
check('emerald Employee paid notices banner line', DL.includes('Employee paid notices'));
check('banner says in-flight payments stay quiet until the receipt lands', DL.includes('stays quiet until the receipt lands'));
check('v2.50 intact: banner label still flips to Disbursement digest', DL.includes("'Disbursement digest · '"));
check('v2.49 intact: teal employee notices line still renders', DL.includes('Employee notices · '));

console.log('== Portal home strip ==');
const PH = read('src/app/(selfservice)/employees/me/page.tsx') ?? '';
check('strip loads BOTH pay moments (issued + paid)', PH.includes('PAYROLL_PAID_METADATA_MARKER') && PH.includes('PAYSLIP_ISSUED_METADATA_MARKER'));
check('strip items carry the kind discriminator', PH.includes("kind: 'issued' | 'paid'"));
const HV = read('src/app/(selfservice)/employees/me/home-view.tsx') ?? '';
check('paid rows render the emerald hand-coins icon', HV.includes('HandCoins'));
check('paid rows carry the emerald Paid chip', HV.includes('border-emerald-200 bg-emerald-50'));
check('paid rows flip the action pill emerald', HV.includes("paid ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-teal-600 hover:bg-teal-700'"));
check('v2.49 intact: teal issued rows still render', HV.includes('BadgeCheck'));

console.log('== Tests ==');
const TP = read('src/tests/payroll-paid-notice.test.ts') ?? '';
check('paid notice test file exists', !!TP);
check('covers the mode-honest prose (mock never reads real)', TP.includes('no real money moved'));
check('covers the receipt-less honesty', TP.includes('(none recorded — your payslip carries the payment record)'));
check('covers the emerald-vs-siblings surface guard', TP.includes('#047857') && TP.includes('#92400e'));
check('covers per-detail receipt matching', TP.includes('never swaps receipts between rows'));
check('covers the run-scoped audience guard', TP.includes('stray detailId from another run leaks nothing'));
check('covers the unlinked-employee privacy', TP.includes('skips unlinked employees entirely'));
check('v2.50 intact: disbursement digest test file still exists', !!read('src/tests/payroll-disbursed-digest.test.ts'));
check('v2.49 intact: payslip notice test file still exists', !!read('src/tests/payslip-issued-notice.test.ts'));
check('v2.48 intact: posted digest test file still exists', !!read('src/tests/payroll-posted-digest.test.ts'));

console.log('');
if (failures === 0) {
  console.log('v2.51.0 verification: ALL PASS');
} else {
  console.log(`v2.51.0 verification: ${failures} FAILURE(S)`);
  process.exit(1);
}
