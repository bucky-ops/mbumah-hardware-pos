#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.34.0 verification
// Scope: leave RESUBMISSION after rejection (portal pre-filled retry flow
// + per-status rails on request cards) + per-payslip gated B2C retry
// (detailIds filter through the same evaluateB2CRetryGate) + version
// lockstep.
// Run: npm run verify:v2-34-0

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
  return existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null;
}

console.log('== Leave resubmission (portal) ==');
const LV = read('src/app/(selfservice)/employees/me/leave/leave-view.tsx') ?? '';
check('resubmit state exists', LV.includes('const [resubmitOf, setResubmitOf]'));
check('pre-fill maps the balance by code', LV.includes('balances.find((b) => b.code === r.code)'));
check('dates/half-day/reason pre-filled from the rejected row', LV.includes('r.startDate.slice(0, 10)') && LV.includes("r.halfDay ? 'true' : 'false'") && LV.includes('setReason(r.reason'));
check('Review & resubmit CTA on rejected rows', LV.includes('Review &amp; resubmit') && LV.includes("r.status === 'REJECTED'"));
check('dialog shows the rejected context + manager note', LV.includes('Resubmit leave request') && LV.includes("Manager&apos;s note: {resubmitOf.rejectionReason}"));
check('resubmit creates a NEW request (same POST endpoint)', LV.includes("apiSend('/api/self-service/me/leave', 'POST'") && LV.includes('This creates a NEW request'));
check('dialog close resets resubmitOf', LV.includes('closeRequestDialog') && (LV.match(/setResubmitOf\(null\)/g) ?? []).length >= 2);
check('per-status rails on request cards', LV.includes('border-l-rose-400') && LV.includes('border-l-amber-400') && LV.includes('border-l-emerald-400') && LV.includes('border-l-violet-400'));
check('manager-note treatment on declined cards', LV.includes('MessageSquareWarning') && LV.includes('Manager&apos;s note'));

console.log('== Per-payslip gated B2C retry ==');
const DS = read('src/lib/hr/payroll/disbursement-service.ts') ?? '';
check('retry service accepts detailIds', DS.includes('detailIds?: string[]'));
check('detailIds narrows the failed-payslip sweep', /detailIds && detailIds\.length > 0 \? \{ id: \{ in: detailIds \} \}/.test(DS));
check('filter lives inside the retry service (not the disburse sweep)', DS.indexOf('detailIds?: string[]') < DS.indexOf('id: { in: detailIds }') && DS.indexOf('detailIds?: string[]') > DS.indexOf('export async function retryFailedPayrollB2C'));

const ROUTE = read('src/app/api/payroll/runs/[id]/disburse-mpesa/route.ts') ?? '';
check('route parses detailIds', ROUTE.includes('detailIds?: unknown'));
check('route sanitizes detailIds (strings only, deduped, capped)', ROUTE.includes("typeof v === 'string' && v.length > 0 && v.length <= 64") && ROUTE.includes('.slice(0, 50)'));
check('route passes detailIds only to the retry path', ROUTE.includes('retryFailedPayrollB2C(payrollActorContext(session), id, detailIds)'));

const RD = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('runB2C forwards detailIds', RD.includes('detailIds: [detailId]'));
check('per-row Retry button gated like the summary', RD.includes("b2cStateByPayslip.get(p.id)?.lastStatus === 'FAILED'") && RD.includes('!b2cStateByPayslip.get(p.id)?.retryBlocked'));
check('row Retry has its own spinner state', RD.includes('rowRetryingId') && RD.includes('retryOne'));
check('hooks order preserved (rowRetryingId before the !runId return)', RD.indexOf('rowRetryingId') < RD.indexOf('if (!runId) return null'));

console.log('== Version lockstep ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
const rel = pkg.mbumah ?? {};
check('package.json version is 2.34.0', pkg.version === '2.34.0', pkg.version);
check('mbumah.releaseVersion is 2.34.0', rel.releaseVersion === '2.34.0', rel.releaseVersion);
check('mbumah.baseVersion is 2.34.0', rel.baseVersion === '2.34.0', rel.baseVersion);
check("What's-New has a 2.34.0 entry", (read('src/lib/whats-new.ts') ?? '').includes("version: '2.34.0'"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
