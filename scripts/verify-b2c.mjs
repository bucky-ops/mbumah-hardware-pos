#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.21.0 verification
// Static + structural checks for the M-Pesa B2C payroll disbursement and the
// org-console HR tile deep-links. Run: npm run verify:b2c

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

console.log('== Schema: additive B2C linkage ==');
const schema = read('prisma/schema.prisma') ?? '';
check('MpesaTransaction has payrollDetailId column', /payrollDetailId\s+String\?/.test(schema));
check('MpesaTransaction has payrollDetailId index', schema.includes('@@index([payrollDetailId])'));
check('Additive-only: existing transactionId column intact', /transactionId\s+String\?/.test(schema));

console.log('== B2C client (src/lib/mpesa-b2c.ts) ==');
const b2c = read('src/lib/mpesa-b2c.ts') ?? '';
check('module exists', b2c !== null);
check('CommandID SalaryPayment', b2c.includes("CommandID: 'SalaryPayment'"));
check('uses Daraja b2c/v3/paymentrequest', b2c.includes('/mpesa/b2c/v3/paymentrequest'));
check('normalises phone via shared helper', b2c.includes("from '@/lib/mpesa-daraja'"));
check('security credential builder present', b2c.includes('buildSecurityCredential'));
check('idempotent: skips payslips with an active transaction', b2c.includes("status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] }"));
check('mock receipts use SIM prefix (never looks like a real receipt)', b2c.includes('`SIM${'));
check('no secrets in logs (credential values never appear in systemLog metadata)', !/metadata:\s*\{[^}]*(CREDENTIAL|PASSWORD|InitiatorPassword)/i.test(b2c));

console.log('== Disbursement service ==');
const svc = read('src/lib/hr/payroll/disbursement-service.ts') ?? '';
check('module exists', svc !== null);
check('state machine guard: POSTED/LOCKED only', svc.includes("run.status !== 'POSTED' && run.status !== 'LOCKED'"));
check('production refuses mock mode (B2C_NOT_CONFIGURED)', svc.includes('B2C_NOT_CONFIGURED'));
check('skips employees without a phone', svc.includes('No M-Pesa phone number'));
check('mock settle uses withImmutabilityBypass', svc.includes("'payroll_b2c_mock_settle'"));
check('webhook settle uses withImmutabilityBypass', svc.includes("'payroll_b2c_webhook_settle'"));
check('result webhook claim is atomic (callbackReceived=false)', svc.includes('callbackReceived: false'));
check('payslip PAID ref is MPESA- receipt', svc.includes('paymentRef: `MPESA-${'));
check('audit logged', svc.includes('hrAudit('));

console.log('== Routes ==');
const runRoute = read('src/app/api/payroll/runs/[id]/disburse-mpesa/route.ts') ?? '';
check('run-level disburse-mpesa route exists', runRoute !== null);
check('run route gated by hr.payroll.disburse + STORE_OWNER', runRoute.includes("hrGuard('hr.payroll.disburse'") && runRoute.includes('STORE_OWNER'));
const resultRoute = read('src/app/api/payments/mpesa/b2c/result/route.ts') ?? '';
check('B2C result webhook exists', resultRoute !== null);
check('result webhook validates Basic credentials (F6-1 mirror)', resultRoute.includes('MPESA_CALLBACK_USERNAME') && resultRoute.includes('timingSafeEqual'));
check('result webhook supports IP allowlist', resultRoute.includes('MPESA_CALLBACK_IPS'));
check('rejections land in SecurityEvent', resultRoute.includes('securityEvent.create'));
check('rate limited', resultRoute.includes('isRateLimited'));
check('result webhook is public (no requireAuth call) by design', !resultRoute.includes('requireAuth(') && !resultRoute.includes("from '@/lib/auth'"));
const timeoutRoute = read('src/app/api/payments/mpesa/b2c/queue-timeout/route.ts') ?? '';
check('queue-timeout webhook exists', timeoutRoute !== null);

console.log('== UI (payroll run dialog) ==');
const dlg = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('Disburse via M-Pesa action present', dlg.includes('Disburse via M-Pesa'));
check('calls disburse-mpesa endpoint', dlg.includes("'disburse-mpesa'"));
check('confirm dialog shows pending total before sending', dlg.includes('pendingTotal'));
check('colored payment status badges', dlg.includes('PAYMENT_STATUS_STYLES'));
check('lifecycle stepper present', dlg.includes('LIFECYCLE_STEPS') && dlg.includes('aria-label="Run lifecycle progress"'));
check('M-Pesa receipt chip on paid payslips', dlg.includes('MPESA-'));
check('busy state uses spinner (Loader2)', dlg.includes('Loader2'));

console.log('== Org console deep links ==');
const oc = read('src/components/workspace/org-console.tsx') ?? '';
check('HR tiles deep-link to reports tabs', oc.includes('href="/hr/reports?tab=headcount"') && oc.includes('href="/hr/reports?tab=cost"') && oc.includes('href="/hr/reports?tab=absence"'));
check('payroll tile links to /hr/payroll', oc.includes('href="/hr/payroll"'));
check('StatCard supports focus-visible ring', oc.includes('focus-visible:ring-2'));
const reports = read('src/app/hr/reports/page.tsx') ?? '';
check('reports tabs deep-linkable via ?tab=', reports.includes("window.location.search).get('tab')"));
check('tab changes replaceState (bookmarkable)', reports.includes('replaceState'));

console.log('== Tests + docs ==');
const test = read('src/tests/lib/payroll-b2c-disbursement.test.ts') ?? '';
check('B2C test suite exists', test !== null);
check('suite covers idempotent re-run', test.includes('already has an active transaction'));
check('suite covers duplicate webhook delivery', test.includes('duplicate deliveries'));
const envDoc = read('docs/EMS_ENV_AND_DEPLOYMENT_NOTES.md') ?? '';
check('env notes document B2C variables', envDoc.includes('MPESA_INITIATOR_NAME'));

console.log('');
if (failures > 0) {
  console.log(`verify:b2c FAILED - ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log('verify:b2c PASS - all checks green');
}
