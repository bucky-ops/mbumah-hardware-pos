#!/usr/bin/env node
// MBUMAH HARDWARE POS - v2.22.0 verification
// Static + structural checks for: parseTrace legacy-shape hardening, the
// B2C retry / stuck-status recovery, and scheduled HR report digests.
// Run: npm run verify:v2-22-0

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

console.log('== parseTrace hardening (QA-caught 500) ==');
const view = read('src/lib/hr/payroll/payslip-view.ts') ?? '';
check('module exists', view !== null);
check('normalises missing optional arrays', view.includes('arr(parsed.deductions)') && view.includes('arr(parsed.rateTableIds)'));
check('accepts legacy engineSteps alias', view.includes('parsed.trace ?? parsed.engineSteps'));
check('lifts legacy string steps to {step, detail}', view.includes("typeof s === 'string' ? { step: s, detail: '' } : s"));
check('derives net from the identity when missing', view.includes('parsed.grossCents - totalDeductionsCents'));

console.log('== B2C retry + stuck-status recovery ==');
const b2c = read('src/lib/mpesa-b2c.ts') ?? '';
check('status query uses Daraja TransactionStatusQuery', b2c.includes("CommandID: 'TransactionStatusQuery'"));
check('status query uses transactionStatus/v1/query', b2c.includes('/mpesa/transactionStatus/v1/query'));
check('mock status query resolves stuck transactions', b2c.includes('Mock B2C status query resolved the stuck transaction'));
const svc = read('src/lib/hr/payroll/disbursement-service.ts') ?? '';
check('retryFailedPayrollB2C exported', svc.includes('export async function retryFailedPayrollB2C'));
check('refreshStuckPayrollB2C exported', svc.includes('export async function refreshStuckPayrollB2C'));
check('summariseRunB2CState exported (PII-free state)', svc.includes('export async function summariseRunB2CState'));
check('staleness threshold constant (10 min)', svc.includes('B2C_STALE_PROCESSING_MS = 10 * 60 * 1000'));
check('retry respects the active-transaction idempotency (NOTHING_TO_RETRY)', svc.includes('NOTHING_TO_RETRY'));
check('code-level age guard in the recovery loop', svc.includes('Belt-and-braces age check'));
check('status-query settle uses withImmutabilityBypass', svc.includes("'payroll_b2c_status_query_settle'"));
check('retry audit logged with b2cRetry marker', svc.includes('b2cRetry: true'));
const runRoute = read('src/app/api/payroll/runs/[id]/disburse-mpesa/route.ts') ?? '';
check('disburse-mpesa accepts mode=retry-failed', runRoute.includes("'retry-failed'"));
check('disburse-mpesa accepts mode=refresh-stuck', runRoute.includes("'refresh-stuck'"));
const runGet = read('src/app/api/payroll/runs/[id]/route.ts') ?? '';
check('run GET embeds additive disbursement block', runGet.includes('summariseRunB2CState') && runGet.includes('disbursement'));
const dialog = read('src/components/hr/payroll-run-dialog.tsx') ?? '';
check('run dialog renders Retry failed affordance', dialog.includes('Retry failed'));
check('run dialog renders Check status affordance', dialog.includes('Check status'));
check('payslip rows show B2C failed · retry ready chip', dialog.includes('B2C failed'));
check('payslip rows show processing chip', dialog.includes('B2C processing'));

console.log('== Scheduled HR report digests ==');
const schema = read('prisma/schema.prisma') ?? '';
check('HrReportSchedule model exists', schema.includes('model HrReportSchedule'));
check('mapped to hr_report_schedules', schema.includes('hr_report_schedules'));
check('org back-relation present', schema.includes('hrReportSchedules'));
check('audit entity registered', (read('src/lib/hr/audit.ts') ?? '').includes("REPORT_SCHEDULE: 'HrReportSchedule'"));
const schedSvc = read('src/lib/hr/report-schedule-service.ts') ?? '';
check('schedule service exists', schedSvc !== null);
check('recipient emails validated', schedSvc.includes('EMAIL_RE'));
check('recipients deduped + lowercased', schedSvc.includes('new Set('));
check('frequency allow-list', schedSvc.includes("HR_SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY']"));
check('report allow-list (6 aggregate reports)', (schedSvc.match(/'(headcount|employment-cost|absence|turnover|time-to-hire|statutory-liability)'/g) ?? []).length >= 6);
check('sweep is per-schedule isolated', schedSvc.includes('result.failed += 1'));
check('force mode does not touch lastRunAt history', schedSvc.includes('force: boolean = false') && !schedSvc.includes('lastRunAt: new Date(0)'));
check('digest built through the governed report service', schedSvc.includes('from \'./reports\''));
check('synthetic session is scope-narrowed (BRANCH_MANAGER for stores)', schedSvc.includes("schedule.storeId ? 'BRANCH_MANAGER' : 'SUPER_ADMIN'"));
const schedRoute = read('src/app/api/hr/reports/schedules/route.ts') ?? '';
check('schedules route exists + guarded', schedRoute.includes("hrGuard('hr.report.branch'"));
const schedIdRoute = read('src/app/api/hr/reports/schedules/[id]/route.ts') ?? '';
check('PATCH + DELETE handlers exist', schedIdRoute.includes('updateSchedule') && schedIdRoute.includes('deleteSchedule'));
const cronRoute = read('src/app/api/cron/hr-report-digests/route.ts') ?? '';
check('cron route exists with CRON_SECRET gate', cronRoute.includes('x-cron-secret'));
check('cron force escape hatch present', cronRoute.includes('force'));
const nightly = read('src/app/api/cron/nightly/route.ts') ?? '';
check('nightly dispatcher includes hr-report-digests', nightly.includes('hr-report-digests'));
const tpl = read('src/lib/email-templates.ts') ?? '';
check('digest HTML template escapes interpolated values', tpl.includes('function esc('));
check('digest plain-text variant exists', tpl.includes('hrReportDigestText'));
check('digest footer carries the aggregates-only contract', tpl.includes('never contains employee names'));
const schedTab = read('src/components/hr/report-schedules-tab.tsx') ?? '';
check('schedules tab exists', schedTab !== null);
check('create dialog validates recipients client-side', schedTab.includes('form.recipients.trim().length === 0'));
check('pause/resume + delete affordances', schedTab.includes('Pause') && schedTab.includes('Resume') && schedTab.includes('Delete'));
check('last delivery status surfaced (SENT/FAILED/SKIPPED chips)', schedTab.includes('LAST_STATUS_STYLES'));
const reportsPage = read('src/app/hr/reports/page.tsx') ?? '';
check('reports page mounts the Schedules tab', reportsPage.includes('ReportSchedulesTab') && reportsPage.includes('value="schedules"'));
check('schedules tab is deep-linkable', reportsPage.includes("'schedules', 'privacy'"));

console.log('== Version metadata ==');
const pkg = JSON.parse(read('package.json') ?? '{}');
check('package.json version is 2.22.0', pkg.version === '2.22.0', pkg.version);
check('mbumah.releaseVersion is 2.22.0', pkg.mbumah?.releaseVersion === '2.22.0', pkg.mbumah?.releaseVersion);
const changelog = read('CHANGELOG.md') ?? '';
check('CHANGELOG has a 2.22.0 entry', /## \[?2\.22\.0/.test(changelog));

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
